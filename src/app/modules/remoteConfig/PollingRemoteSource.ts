import { v1 } from "@google-cloud/kms";
import { MeteringRecorder } from "@figedi/metering";
import { JSONSchema } from "@figedi/typecop";
import { createKMSManagementClient } from "@figedi/sops";
import axios, { AxiosResponse } from "axios";
import { resolve } from "url";

import { sleep } from "../../utils";
import { BaseRemoteSource, RemoteSource } from "./BaseRemoteSource";
import { K8sReplicaService } from "./K8sReplicaService";

export const createKMSManagementFromContext = (k8sReplicaService: K8sReplicaService): v1.KeyManagementServiceClient => {
    const { projectId, serviceAccountPath } = k8sReplicaService;

    return createKMSManagementClient(projectId, serviceAccountPath);
};

export enum AcceptedVersionRange {
    none = "none",
    patch = "patch",
    minor = "minor",
    latest = "latest",
}

export interface RequiredPollingOpts {
    endpoint: string;
    version: string;
}

export interface PollingOpts {
    acceptedRange?: AcceptedVersionRange;
    prefix?: string;

    pollingIntervalMs?: number;
    maxTriesWithoutValue?: number;
    maxTriesWithValue?: number;
    backoffBaseMs?: number;
}

export interface PollingRemoteSourceConfig<Schema> {
    schema: JSONSchema<Schema>;
    fallback?: Schema;
    serviceName: string;
    poll: RequiredPollingOpts & PollingOpts;
    kmsManagementClientFactory?: (ctx: K8sReplicaService) => v1.KeyManagementServiceClient;
    getMetricsRecorder?: () => MeteringRecorder;
}

interface ConfigServiceResponse<Schema> {
    id: string;
    commit: string;
    files: Schema;
}

const DEFAULT_POLLING_REMOTE_SOURCE_CONFIG: PollingOpts = {
    acceptedRange: AcceptedVersionRange.minor,
    prefix: `/api/v1/configs`,

    pollingIntervalMs: 5000,
    maxTriesWithoutValue: 5,
    maxTriesWithValue: 3,
    backoffBaseMs: 1000,
};

const DEFAULT_BACKOFF_BASE_MS = 1000;
const EXP_BACKOFF_RANDOMNESS_MS = 10;

export class MaxRetriesWithoutDataError extends Error {}
export class MaxRetriesWithDataError extends Error {}

/**
 * Fetches a remote-config value from a config-server by periodically polling.
 * This class performs validation-check based on a given schema to guarantee that
 * a fetched config will always be in the correct format.
 */
export class PollingRemoteSource<Schema> extends BaseRemoteSource<Schema> implements RemoteSource<Schema> {
    private config!: PollingRemoteSourceConfig<Schema>;
    private pollingTimeout?: NodeJS.Timer;

    constructor(config: PollingRemoteSourceConfig<Schema>) {
        super(
            config.serviceName,
            config.poll.version,
            config.schema,
            config.kmsManagementClientFactory || createKMSManagementFromContext,
            config.getMetricsRecorder,
            config.fallback,
        );
        this.config = {
            ...config,
            poll: { ...DEFAULT_POLLING_REMOTE_SOURCE_CONFIG, ...config.poll },
        };
    }

    private getFetchUrl(): string {
        const { endpoint, prefix, version, acceptedRange } = this.config.poll;
        const replacedVersion = {
            [AcceptedVersionRange.none]: (v: string) => v,
            [AcceptedVersionRange.patch]: (v: string) =>
                String(v)
                    .split(".")
                    .slice(0, -1)
                    .concat("x")
                    .join("."),
            [AcceptedVersionRange.minor]: (v: string) =>
                String(v)
                    .split(".")
                    .slice(0, -2)
                    .concat(["x", "x"])
                    .join("."),
            [AcceptedVersionRange.latest]: () => "latest",
        }[acceptedRange!](version);
        return resolve(endpoint, `${prefix}/v${replacedVersion}`);
    }

    private fetchData = async (url: string, tries = 0): Promise<AxiosResponse<ConfigServiceResponse<Schema>>> => {
        const { maxTriesWithValue, maxTriesWithoutValue, backoffBaseMs } = this.config.poll;
        try {
            this.logger.info({ tries }, `Getting config from url via http: ${url}`);
            return await axios({ url, method: "GET" });
        } catch (e) {
            if (!this.lastValue && tries >= maxTriesWithoutValue!) {
                throw new MaxRetriesWithoutDataError();
            } else if (this.lastValue && tries >= maxTriesWithValue!) {
                throw new MaxRetriesWithDataError();
            }
            await sleep(
                2 ** tries * (backoffBaseMs || DEFAULT_BACKOFF_BASE_MS) + Math.random() * EXP_BACKOFF_RANDOMNESS_MS,
            );
            return this.fetchData(url, tries + 1);
        }
    };

    private getNextData = async () => {
        let config: Schema;
        let configVersion: string | undefined;
        try {
            const url = this.getFetchUrl();
            const response = await this.fetchData(url);
            config = response.data.files;
            configVersion = response.data.id;
        } catch (e) {
            if (e instanceof MaxRetriesWithDataError) {
                return this.trySetNextState(this.lastValue!, configVersion);
            }
            /**
             * recovery-approach: if the repeated fetching to a config-service failed,
             * try to use the fallback-value. If there is no fallback provided, throw the error
             */
            this.logger.error({ error: e }, `Error while fetching config from config-service: ${e.message}`);
            const fallbackUsed = await this.tryUseFallback();
            if (!fallbackUsed) {
                throw e;
            } else {
                return;
            }
        }
        return this.trySetNextState(config, configVersion);
    };

    public execute = async (): Promise<void> => {
        if (this.stopped) {
            return;
        }
        await this.getNextData();
        this.pollingTimeout = setTimeout(this.execute, this.config.poll.pollingIntervalMs!);
    };

    public shutdown(): void {
        super.shutdown();
        if (this.pollingTimeout) {
            clearTimeout(this.pollingTimeout);
        }
    }

    public async preflight(): Promise<void> {
        await super.preflight();
        return this.execute();
    }
}
