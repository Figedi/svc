/* eslint-disable max-classes-per-file */
import { MeteringRecorder, Gauge } from "@figedi/metering";
import { createValidator, SchemaValidationError, SchemaValidator, JSONSchema } from "@figedi/typecop";
import { KeyManagementServiceClient } from "@google-cloud/kms";
import { Subject, Observable } from "rxjs";
import { take } from "rxjs/operators";
import { parse } from "semver";
import stringify from "fast-json-stable-stringify";

import { Logger } from "../../../logger";
import { remapTreeAsync } from "../../utils";
import { ServiceWithLifecycleHandlers } from "../../types/service";
import { decryptSopsJson } from "./sops";
import { K8sReplicaService } from "./K8sReplicaService";
import { AppContext } from "./types/base";

export interface RemoteSource<Schema> extends ServiceWithLifecycleHandlers {
    setContext: (appContext: AppContext) => void;
    execute: () => Promise<any>;
    get: () => Promise<Schema>;
    stream: () => Observable<Schema>;
}

export type ConfigMetrics = {
    requiredVersionMajorTotal: Gauge;
    requiredVersionMinorTotal: Gauge;
    requiredVersionPatchTotal: Gauge;
    lastConsumedVersionTotal: Gauge;
    invalidDataReceivedTotal: Gauge;
    lastConsumedVersionMajorTotal: Gauge;
    lastConsumedVersionMinorTotal: Gauge;
    lastConsumedVersionPatchTotal: Gauge;
};

export class InvalidConfigWithoutDataError extends Error {}

export abstract class BaseRemoteSource<Schema> {
    public value$!: Subject<Schema>;

    private validator?: SchemaValidator;
    private rootSchema?: JSONSchema<Schema>;
    private kmsClient?: KeyManagementServiceClient;
    protected stopped = true;
    protected lastValue: Schema | Error | null = null;
    protected metrics?: ConfigMetrics;
    protected logger!: Logger;

    private k8sReplicaService!: K8sReplicaService;

    constructor(
        private serviceName: string,
        private baseVersion: string,
        private schema: JSONSchema<Schema>,
        private kmsManagementClientFactory: (ctx: K8sReplicaService) => KeyManagementServiceClient,
        private getMetricsRecorder?: () => MeteringRecorder,
        private fallback?: Schema,
    ) {
        /**
         * todo: if there is a fallback:
         * 3.1 raise an alarm
         */
        this.value$ = new Subject();
    }

    public setContext({ logger, k8s }: AppContext): void {
        this.logger = logger;
        this.k8sReplicaService = k8s;
        this.kmsClient = this.kmsManagementClientFactory(this.k8sReplicaService);
    }

    protected validate(data: unknown): data is Schema {
        try {
            return this.validator!.validate(this.rootSchema! as any, data);
        } catch (e) {
            if (e instanceof SchemaValidationError) {
                return false;
            }
            throw e;
        }
    }

    private async decryptConfigValue(config: Schema, kmsClient: KeyManagementServiceClient) {
        return remapTreeAsync(
            config,
            (_, path) => String(path[path.length - 1]).includes(".enc.json"),
            async (value, path) => {
                return {
                    /**
                     * any decrypted value is by convention not to be named ".enc.json"
                     * This convention is validated in the schema of a config-repository
                     */
                    path: path.map(pathPart => {
                        return String(pathPart).replace(".enc.json", ".json");
                    }),
                    value: await decryptSopsJson(kmsClient, value),
                };
            },
        );
    }

    private initMetrics(): void {
        if (this.getMetricsRecorder) {
            this.metrics = {
                requiredVersionMajorTotal: this.getMetricsRecorder().createGauge(
                    `${this.serviceName.replace(/-/g, "_")}__required_version_major_total`,
                    "The required MAJOR config version",
                    ["service", "version"],
                ),
                requiredVersionMinorTotal: this.getMetricsRecorder().createGauge(
                    `${this.serviceName.replace(/-/g, "_")}__required_version_minor_total`,
                    "The required MINOR config version",
                    ["service", "version"],
                ),
                requiredVersionPatchTotal: this.getMetricsRecorder().createGauge(
                    `${this.serviceName.replace(/-/g, "_")}__required_version_patch_total`,
                    "The required PATCH config version",
                    ["service", "version"],
                ),
                lastConsumedVersionTotal: this.getMetricsRecorder().createGauge(
                    `${this.serviceName.replace(/-/g, "_")}__last_consumed_config_version_total`,
                    "The last consumed config version",
                    ["service", "version", "received"],
                ),
                lastConsumedVersionMajorTotal: this.getMetricsRecorder().createGauge(
                    `${this.serviceName.replace(/-/g, "_")}__last_consumed_config_version_major_total`,
                    "The last consumed config MAJOR version",
                    ["service", "version", "received"],
                ),
                lastConsumedVersionMinorTotal: this.getMetricsRecorder().createGauge(
                    `${this.serviceName.replace(/-/g, "_")}__last_consumed_config_version_minor_total`,
                    "The last consumed config MINOR version",
                    ["service", "version", "received"],
                ),
                lastConsumedVersionPatchTotal: this.getMetricsRecorder().createGauge(
                    `${this.serviceName.replace(/-/g, "_")}__last_consumed_config_version_patch_total`,
                    "The last consumed config PATCH version",
                    ["service", "version", "received"],
                ),
                invalidDataReceivedTotal: this.getMetricsRecorder().createGauge(
                    `${this.serviceName.replace(/-/g, "_")}__invalid_config_data_received_total`,
                    "Total amount of invalid remote-config-data received",
                    ["service", "version", "received"],
                ),
            };
        }
    }

    private trySetRequiredMetrics() {
        const parsed = parse(this.baseVersion);
        if (!parsed || !this.metrics) {
            return;
        }
        const labelSet = {
            service: this.serviceName,
            version: this.baseVersion,
        };
        this.metrics.requiredVersionMajorTotal.reset();
        this.metrics.requiredVersionMajorTotal.set(labelSet, parsed.major);
        this.metrics.requiredVersionMinorTotal.reset();
        this.metrics.requiredVersionMinorTotal.set(labelSet, parsed.minor);
        this.metrics.requiredVersionPatchTotal.reset();
        this.metrics.requiredVersionPatchTotal.set(labelSet, parsed.patch);
    }

    private trySetConsumedMetrics(metricsName: keyof ConfigMetrics, receivedVersion?: string, { reset = false } = {}) {
        if (!this.metrics) {
            return;
        }
        if (reset) {
            this.metrics[metricsName].reset();
        }
        const labelSet = {
            service: this.serviceName,
            version: this.baseVersion,
            ...(receivedVersion ? { received: receivedVersion } : {}),
        };
        this.metrics[metricsName].set(labelSet, 1);
        if (metricsName === "lastConsumedVersionTotal" && receivedVersion) {
            // calc major, minor, patch
            const parsed = parse(receivedVersion);
            if (!parsed) {
                return;
            }
            this.metrics.lastConsumedVersionMajorTotal.reset();
            this.metrics.lastConsumedVersionMajorTotal.set(labelSet, parsed.major);

            this.metrics.lastConsumedVersionMinorTotal.reset();
            this.metrics.lastConsumedVersionMinorTotal.set(labelSet, parsed.minor);

            this.metrics.lastConsumedVersionPatchTotal.reset();
            this.metrics.lastConsumedVersionPatchTotal.set(labelSet, parsed.patch);
        }
    }

    protected async tryUseFallback(): Promise<boolean> {
        if (this.fallback && this.kmsClient) {
            const config = await this.decryptConfigValue(this.fallback, this.kmsClient);
            await this.trySetNextState(config, this.baseVersion, false);
            return true;
        }
        return false;
    }

    protected async trySetNextState(
        value: Schema | Error,
        configVersion?: string,
        retryWithFallback = true,
    ): Promise<void> {
        const isValid = this.validate(value);

        if (!isValid && !this.lastValue && this.fallback && retryWithFallback) {
            await this.tryUseFallback();
            return;
        }
        if (!isValid && !this.lastValue) {
            throw new InvalidConfigWithoutDataError("Did not receive a valid config-value and no local data present");
        } else if (!isValid && this.lastValue) {
            this.logger.warn(`Did not receive a valid remote-config and will use last-value`);
            this.trySetConsumedMetrics("invalidDataReceivedTotal", configVersion, { reset: true });
            return;
        }
        if (stringify(value) === stringify(this.lastValue || {})) {
            this.logger.debug(`Remote-config-value did not change, will omit change-propagation`);
            return;
        }
        this.trySetConsumedMetrics("lastConsumedVersionTotal", configVersion, { reset: false });
        return this.setState(value);
    }

    private setState(value: Schema | Error): void {
        if (value instanceof Error) {
            this.value$.error(value);
        } else {
            this.value$.next(value);
        }
        this.lastValue = value;
    }

    public shutdown(): void {
        this.stopped = true;
    }

    public async preflight(): Promise<void> {
        if (!this.logger || !this.k8sReplicaService) {
            throw new Error(`Preflight called before setContext(). This should never happen`);
        }
        this.initMetrics();
        this.trySetRequiredMetrics();
        this.stopped = false;
        this.validator = createValidator();
        this.rootSchema = await this.validator.compile(this.schema, {
            schemaDirs: [require("@figedi/svc-config").SCHEMA_BASE_DIR],
        });
    }

    public async get(): Promise<Schema> {
        if (this.stopped) {
            throw new Error(`Please call preflight() first before retrieving values`);
        }

        return this.stream()
            .pipe(take(1))
            .toPromise();
    }

    public stream(): Observable<Schema> {
        return this.value$.asObservable();
    }
}

/* eslint-enable max-classes-per-file */
