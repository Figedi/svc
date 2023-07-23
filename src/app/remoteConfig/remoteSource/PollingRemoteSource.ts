import type { MeteringRecorder } from "@figedi/metering";
import type { JSONSchema } from "@figedi/typecop";
import axios, { AxiosResponse } from "axios";

import { remapTree, sleep } from "../../utils";
import { BaseRemoteSource } from "./BaseRemoteSource";
import { MaxRetriesWithDataError, MaxRetriesWithoutDataError } from "./errors";
import type { IJsonDecryptor, IReloadingStrategy, RemoteDependencyArgs } from "../types";
import type { IRemoteSource } from "./types";
import type { Logger } from "../../../logger";
import {
    type AddTransformConfigToPrimitives,
    type DynamicOnceTransformConfig,
    type DynamicStreamedTransformConfig,
    type ServiceWithLifecycleHandlers,
    REF_TYPES,
} from "../../types";
import { RemoteConfigHandler } from "../RemoteConfigHandler";
import { share } from "rxjs";
import { OnceRemoteConfigValue, StreamedRemoteConfigValue } from "../remoteValues";

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
    // @todo add auth / headers for endpoint
    acceptedRange?: AcceptedVersionRange;
    prefix?: string;

    pollingIntervalMs?: number;
    maxTriesWithoutValue?: number;
    maxTriesWithValue?: number;
    backoffBaseMs?: number;
}

export interface PollingRemoteSourceConfig<Schema, TProjected> {
    logger: Logger;
    source: {
        schema: JSONSchema<Schema>;
        schemaBaseDir: string;
        fallback?: Schema;
        serviceName: string;
        poll: RequiredPollingOpts & PollingOpts;
        jsonDecryptor: IJsonDecryptor;
        getMetricsRecorder?: () => MeteringRecorder;
    };
    reloading?: {
        reactsOn: (oldConfig: Schema | undefined, newConfig: Schema) => boolean;
        strategy: IReloadingStrategy;
    };
    projections: (remoteArgs: RemoteDependencyArgs<Schema>) => AddTransformConfigToPrimitives<TProjected, Schema>;
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

/**
 * Fetches a remote-config value from a config-server by periodically polling.
 * This class performs validation-check based on a given schema to guarantee that
 * a fetched config will always be in the correct format.
 */
export class PollingRemoteSource<TProject, Schema>
    extends BaseRemoteSource<TProject, Schema>
    implements IRemoteSource<TProject, Schema>
{
    private config!: PollingRemoteSourceConfig<Schema, TProject>;
    private pollingTimeout?: NodeJS.Timer;

    constructor(config: PollingRemoteSourceConfig<Schema, TProject>) {
        super(
            config.logger,
            config.source.serviceName,
            config.source.poll.version,
            config.source.schema,
            config.source.jsonDecryptor,
            config.source.schemaBaseDir,
            config.source.getMetricsRecorder,
            config.source.fallback,
        );
        this.config = {
            ...config,
            source: {
                ...config.source,
                poll: { ...DEFAULT_POLLING_REMOTE_SOURCE_CONFIG, ...config.source.poll },
            },
        };
    }

    public init(args: RemoteDependencyArgs<Schema>): {
        config: TProject;
        lifecycleArtefacts?: ServiceWithLifecycleHandlers[];
    } {
        const projections = this.config.projections(args);
        const stream$ = this.stream().pipe(share());
        const lifecycleArtefacts: ServiceWithLifecycleHandlers[] = [];
        if (this.config.reloading?.reactsOn) {
            const handler = new RemoteConfigHandler(
                stream$,
                this.config.reloading.reactsOn,
                this.config.reloading.strategy.execute,
            );
            lifecycleArtefacts.push(handler);
        }

        const projectedRemoteConfig = remapTree(
            projections,
            {
                // eslint-disable-next-line no-underscore-dangle
                predicate: value => !!value && value.__type === REF_TYPES.DYNAMIC_ONCE,
                transform: ({ propGetter }: DynamicOnceTransformConfig<Schema>) => {
                    const remoteConfigValue = new OnceRemoteConfigValue(stream$, propGetter);
                    lifecycleArtefacts.push(remoteConfigValue);

                    return remoteConfigValue;
                },
            },
            {
                // eslint-disable-next-line no-underscore-dangle
                predicate: value => !!value && value.__type === REF_TYPES.DYNAMIC_STREAMED,
                transform: ({ propGetter }: DynamicStreamedTransformConfig<Schema>) => {
                    const remoteConfigValue = new StreamedRemoteConfigValue(stream$, propGetter);
                    lifecycleArtefacts.push(remoteConfigValue);

                    return remoteConfigValue;
                },
            },
        ) as TProject;

        return {
            config: projectedRemoteConfig,
            lifecycleArtefacts,
        };
    }

    private resolveUrl = (from: string, to: string): string => {
        const resolvedUrl = new URL(to, new URL(from, "resolve://"));
        if (resolvedUrl.protocol === "resolve:") {
            // `from` is a relative URL.
            const { pathname, search, hash } = resolvedUrl;
            return pathname + search + hash;
        }
        return resolvedUrl.toString();
    };

    private getFetchUrl(): string {
        const { endpoint, prefix, version, acceptedRange } = this.config.source.poll;
        const replacedVersion = {
            [AcceptedVersionRange.none]: (v: string) => v,
            [AcceptedVersionRange.patch]: (v: string) => String(v).split(".").slice(0, -1).concat("x").join("."),
            [AcceptedVersionRange.minor]: (v: string) => String(v).split(".").slice(0, -2).concat(["x", "x"]).join("."),
            [AcceptedVersionRange.latest]: () => "latest",
        }[acceptedRange!](version);

        return this.resolveUrl(endpoint, `${prefix}/v${replacedVersion}`);
    }

    private fetchData = async (url: string, tries = 0): Promise<AxiosResponse<ConfigServiceResponse<Schema>>> => {
        const { maxTriesWithValue, maxTriesWithoutValue, backoffBaseMs } = this.config.source.poll;
        try {
            this.config.logger.info({ tries }, `Getting config from url via http: ${url}`);
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
            this.config.logger.error({ error: e }, `Error while fetching config from config-service: ${e.message}`);
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
        this.pollingTimeout = setTimeout(this.execute, this.config.source.poll.pollingIntervalMs!);
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
