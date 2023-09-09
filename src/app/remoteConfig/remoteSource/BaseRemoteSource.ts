/* eslint-disable max-classes-per-file */
import type { MeteringRecorder } from "@figedi/metering";
import type { SchemaValidator, JSONSchema } from "@figedi/typecop";
import { Subject, type Observable, lastValueFrom } from "rxjs";
import { take } from "rxjs/operators";
import { parse } from "semver";
import stringify from "fast-json-stable-stringify";

import { remapTreeAsync } from "../../utils/index.js";
import { InvalidConfigWithoutDataError } from "./errors.js";
import type { Logger } from "../../utils/logger.js";
import type { IJsonDecryptor, RemoteDependencyArgs } from "../types/index.js";
import type { ConfigMetrics } from "./types.js";
import type { ServiceWithLifecycleHandlers } from "../../types/index.js";

export abstract class BaseRemoteSource<TProject, Schema> {
    public value$!: Subject<Schema>;

    private validator?: SchemaValidator;
    private rootSchema?: JSONSchema<Schema>;
    protected stopped = true;
    protected lastValue: Schema | Error | null = null;
    protected metrics?: ConfigMetrics;

    constructor(
        private logger: Logger,
        private serviceName: string,
        private baseVersion: string,
        private schema: JSONSchema<Schema>,
        private decryptorClient: IJsonDecryptor,
        private schemaBaseDir: string,
        private getMetricsRecorder?: () => MeteringRecorder,
        private fallback?: Schema,
    ) {
        /**
         * todo: if there is a fallback:
         * 3.1 raise an alarm
         */
        this.value$ = new Subject();
    }

    public abstract init(args: RemoteDependencyArgs<Schema>): {
        config: TProject;
        lifecycleArtefacts?: ServiceWithLifecycleHandlers[];
    };

    protected validate(data: unknown): data is Schema {
        try {
            return this.validator!.validate(this.rootSchema!, data);
        } catch (e: any) {
            if (e.constructor.name === "SchemaValidationError") {
                return false;
            }
            throw e;
        }
    }

    private async decryptConfigValue(config: Schema) {
        return remapTreeAsync(
            config,
            (_, path) => String(path[path.length - 1]).includes(".enc.json"),
            async (value, path) => ({
                /**
                 * any decrypted value is by convention not to be named ".enc.json"
                 * This convention is validated in the schema of a config-repository
                 */
                path: path.map(pathPart => String(pathPart).replace(".enc.json", ".json")),
                value: await this.decryptorClient.decrypt(value),
            }),
        );
    }

    private initMetrics(): void {
        if (this.getMetricsRecorder) {
            const recorder = this.getMetricsRecorder();
            this.metrics = {
                requiredVersionMajorTotal: recorder.createGauge(
                    `${this.serviceName.replace(/-/g, "_")}__required_version_major_total`,
                    "The required MAJOR config version",
                    ["service", "version"],
                ),
                requiredVersionMinorTotal: recorder.createGauge(
                    `${this.serviceName.replace(/-/g, "_")}__required_version_minor_total`,
                    "The required MINOR config version",
                    ["service", "version"],
                ),
                requiredVersionPatchTotal: recorder.createGauge(
                    `${this.serviceName.replace(/-/g, "_")}__required_version_patch_total`,
                    "The required PATCH config version",
                    ["service", "version"],
                ),
                lastConsumedVersionTotal: recorder.createGauge(
                    `${this.serviceName.replace(/-/g, "_")}__last_consumed_config_version_total`,
                    "The last consumed config version",
                    ["service", "version", "received"],
                ),
                lastConsumedVersionMajorTotal: recorder.createGauge(
                    `${this.serviceName.replace(/-/g, "_")}__last_consumed_config_version_major_total`,
                    "The last consumed config MAJOR version",
                    ["service", "version", "received"],
                ),
                lastConsumedVersionMinorTotal: recorder.createGauge(
                    `${this.serviceName.replace(/-/g, "_")}__last_consumed_config_version_minor_total`,
                    "The last consumed config MINOR version",
                    ["service", "version", "received"],
                ),
                lastConsumedVersionPatchTotal: recorder.createGauge(
                    `${this.serviceName.replace(/-/g, "_")}__last_consumed_config_version_patch_total`,
                    "The last consumed config PATCH version",
                    ["service", "version", "received"],
                ),
                invalidDataReceivedTotal: recorder.createGauge(
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
        if (this.fallback) {
            const config = await this.decryptConfigValue(this.fallback);
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
        this.initMetrics();
        this.trySetRequiredMetrics();
        this.stopped = false;
        const typecopMod = await import("@figedi/typecop");
        this.validator = typecopMod.createValidator();

        this.rootSchema = await this.validator.compile(this.schema, [this.schemaBaseDir]);
    }

    public async get(): Promise<Schema> {
        if (this.stopped) {
            throw new Error(`Please call preflight() first before retrieving values`);
        }

        return lastValueFrom(this.stream().pipe(take(1)));
    }

    public stream(): Observable<Schema> {
        return this.value$.asObservable();
    }
}
/* eslint-enable max-classes-per-file */
