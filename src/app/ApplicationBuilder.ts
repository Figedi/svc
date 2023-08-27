/* eslint-disable no-underscore-dangle */
import type { interfaces } from "inversify";
import type { ParsedArgs } from "minimist";
import type { ValidatorSpec } from "envalid";
import type {
    EnvTransformFn,
    RefTransformFn,
    AppBuilderConfig,
    AppConfig,
    ServiceWithLifecycleHandlers,
    EnvFn,
    EnvTransformConfig,
    RefTransformConfig,
    Provider,
    Command,
    ResolveRegisterFnArgs,
    BaseRegisterFnArgs,
    EnvalidTransformer,
    AnyTransformStrict,
    InferredOptionType,
    AllOptions,
    DynamicOnceTransformFn,
    DynamicStreamedTransformFn,
    DynamicPromiseTransformFn,
    DynamicObservableTransformFn,
    DynamicConfigFnArgs,
    UnpackTransformConfigTypes,
} from "./types";
import type { RemoteDependencyArgs, IRemoteSource } from "./remoteConfig";
import type { DeepMerge, DeepPartial } from "./types/base";

import { onExit } from "signal-exit";
import { Container } from "inversify";
import { pick, kebabCase, uniq, camelCase, once as _once, merge, mergeWith, isUndefined, isPlainObject } from "lodash";
import { set } from "lodash/fp";
import { str, bool, num, host, port, url, json, cleanEnv } from "envalid";
import { createLogger, type Logger } from "../logger";
import {
    sleep,
    remapTree,
    toConstantCase,
    reduceTree,
    serviceWithPreflightOrShutdown,
    type TreeNodeTransformerConfig,
} from "./utils";
import { ShutdownHandle, ErrorHandle, REF_SYMBOLS, REF_TYPES, isTransformer } from "./types";
import buildOptions from "minimist-options";
import minimist from "minimist";
import { MissingCommandArgsError } from "./errors";
import { getRootDir } from "./utils/util";
import type { BaseRemoteSource } from "./remoteConfig/remoteSource/BaseRemoteSource";
import { DynamicConfigSource } from "./remoteConfig/remoteSource/DynamicConfigSource";
import _debug from "debug";

const debug = _debug("@figedi/svc");

export type AppPreflightFn<C> = (container: RegisterFnArgs<C>) => Promise<any> | any;

export type ErrorHandlerFn<C> = (args: RegisterFnArgs<C>, e?: Error) => ErrorHandle | Promise<ErrorHandle>;
export type ShutdownHandlerFn<C> = (
    args: RegisterFnArgs<C>,
    reason?: string,
) => ShutdownHandle | Promise<ShutdownHandle>;

export interface RegisterFnArgs<Config> extends ResolveRegisterFnArgs<Config> {}

const env: EnvTransformFn = (transformFn, defaultValue) => ({
    transformFn,
    defaultValue,
    __type: REF_TYPES.ENV,
    __sym: REF_SYMBOLS.ENV,
});

const ref: RefTransformFn = (referenceValue, refTransformFn) => ({
    referenceValue,
    refTransformFn,
    __type: REF_TYPES.REF,
    __sym: REF_SYMBOLS.REF,
});

const once: DynamicOnceTransformFn<any> = propGetter => ({
    propGetter,
    __type: REF_TYPES.DYNAMIC_ONCE,
    __sym: REF_SYMBOLS.DYNAMIC_ONCE,
});

const streamed: DynamicStreamedTransformFn<any> = propGetter => ({
    propGetter,
    __type: REF_TYPES.DYNAMIC_STREAMED,
    __sym: REF_SYMBOLS.DYNAMIC_STREAMED,
});

const dynamicPromise: DynamicPromiseTransformFn = propGetter => ({
    propGetter,
    __type: REF_TYPES.DYNAMIC_PROMISE,
    __sym: REF_SYMBOLS.DYNAMIC_PROMISE,
});
const dynamicObservable: DynamicObservableTransformFn = propGetter => ({
    propGetter,
    __type: REF_TYPES.DYNAMIC_OBSERVABLE,
    __sym: REF_SYMBOLS.DYNAMIC_OBSERVABLE,
});

const $env: EnvalidTransformer = {
    str,
    bool,
    num,
    host,
    port,
    url,
    json,
    any: env,
    ref,
};

const defaultAppBuilderConfig: AppBuilderConfig = {
    deferredShutdownHandle: false,
    shutdownGracePeriodSeconds: 10,
    bindProcessSignals: true,
    exitAfterRun: true,
    rootLoggerProperties: {},
    loggerFactory: createLogger,
};

export type GetAppConfig<T> = T extends ApplicationBuilder<infer V>
    ? V
    : T extends ApplicationBuilder<infer K>
    ? K
    : never;

type PartialConfig<TConfig> = DeepPartial<UnpackTransformConfigTypes<TConfig>>;

export enum AppBuilderBindings {
    LOGGER = "LOGGER",
    CONFIG = "CONFIG",
    APP = "APP",
}

/**
 * Service-factory for initialization of services. This factory creates a base-service
 * and runs it as the single-entrypoint. As a result, use any instance in your index.ts and
 * point the docker-entrypoint to it. The builder introduces several concepts:
 *
 * Concepts:
 * - IOC: We are using IOC/DI for our services. The builder supports this for providers and regular dependencies
 * - lifecycle-handlers: The builder has 3 phases: preflight, running, shutdown. Services can register preflight
 *    and shutdown handlers for initialization logic to separate class-creation with class-initialization.
 * - config-parsing: The builder can parse envs and expose them through a config-object for service-creation
 * - remote-config: The builder can handle remote-config values and react on changes
 * - commands: The builder works with commands (as in the command-pattern) to start the servicee
 *    with different functionalities
 * - error-/shutdown-handlers: The builder has optional error/shutdown-handlers, e.g. for additional shutdown logic
 *
 */
export class ApplicationBuilder<Config> {
    private rootLogger!: Logger;
    private defaultCommandName?: string;
    private app!: AppConfig;
    private errorHandlers: ErrorHandlerFn<Config>[] = [];
    private shutdownHandlers: ShutdownHandlerFn<Config>[] = [];
    private preflightFns: AppPreflightFn<Config>[] = [];
    private commandReferences: string[] = [];
    private appBuilderConfig!: AppBuilderConfig;

    public container = new Container();
    public config: Config = {} as Config;
    public servicesWithLifecycleHandlers: ServiceWithLifecycleHandlers[] = [];

    static create = <C = {}>(config: Partial<AppBuilderConfig> = defaultAppBuilderConfig): ApplicationBuilder<C> =>
        new ApplicationBuilder<C>(config);

    private constructor(appConfig: Partial<AppBuilderConfig>) {
        this.reconfigure({ appConfig });
    }

    private buildBaseResolveArgs = (): BaseRegisterFnArgs<Config> => ({
        config: this.config as any, // ts cannot infer here the unpacked-types
        app: this.app,
        logger: this.rootLogger,
    });

    private buildResolveArgs = (container: interfaces.Container): RegisterFnArgs<Config> => ({
        resolve: <T>(serviceIdentifier: interfaces.ServiceIdentifier<T>): T => {
            try {
                return container.get<T>(serviceIdentifier);
            } catch (e) {
                this.rootLogger.error(
                    { error: e },
                    `Error while resolving dependency '${String(serviceIdentifier)}': ${e.message}`,
                );
                throw e;
            }
        },
        ...this.buildBaseResolveArgs(),
    });

    public reconfigure<TConf extends Config>(opts: {
        appConfig: Partial<AppBuilderConfig>;
        env?: never;
        mode?: never;
    }): ApplicationBuilder<DeepMerge<Config, TConf, AnyTransformStrict<any>>>;
    public reconfigure<TConf extends Record<string, any>>(opts: {
        appConfig: Partial<AppBuilderConfig>;
        env?: EnvFn<TConf>;
        mode?: "merge";
    }): ApplicationBuilder<DeepMerge<Config, TConf, AnyTransformStrict<any>>>;
    public reconfigure<TConf extends Record<string, any>>(opts: {
        appConfig: Partial<AppBuilderConfig>;
        env?: EnvFn<TConf>;
        mode?: "overwrite";
    }): ApplicationBuilder<TConf>;
    public reconfigure<TConf extends Record<string, any>>(opts: {
        appConfig?: Partial<AppBuilderConfig>;
        env: EnvFn<TConf>;
        mode?: "merge";
    }): ApplicationBuilder<DeepMerge<Config, TConf, AnyTransformStrict<any>>>;
    public reconfigure<TConf extends Record<string, any>>(opts: {
        appConfig?: Partial<AppBuilderConfig>;
        env: EnvFn<TConf>;
        mode?: "overwrite";
    }): ApplicationBuilder<TConf>;
    public reconfigure<TConf extends Record<string, any>>(opts: {
        appConfig?: Partial<AppBuilderConfig>;
        env?: EnvFn<TConf>;
        mode?: "merge" | "overwrite";
    }): ApplicationBuilder<DeepMerge<Config, TConf, AnyTransformStrict<any>>> {
        if (opts.appConfig) {
            this.appBuilderConfig = merge(
                {},
                defaultAppBuilderConfig,
                this.appBuilderConfig,
                opts.appConfig,
            ) as AppBuilderConfig;
        }
        if (opts.env) {
            const overwrittenConfig = remapTree(opts.env({ $env, app: this.app }), ...this.configTransformers);
            if (opts.mode === "overwrite") {
                this.config = overwrittenConfig;
            } else {
                this.config = mergeWith({}, this.config, overwrittenConfig, obj => {
                    if (isTransformer(obj)) {
                        return obj;
                    }
                    return undefined;
                });
            }
        }

        const envName = process.env.ENVIRONMENT_NAME || "[unknown]";
        this.rootLogger = this.appBuilderConfig.loggerFactory({
            level: process.env.LOG_LEVEL || "info",
            base: {
                ...this.appBuilderConfig.rootLoggerProperties,
                env: envName,
                service: process.env.npm_package_name?.split("/").slice(1).join("/"),
            },
        });

        this.app = {
            envName,
            startedAt: new Date(),
            rootPath: getRootDir(),
            version: process.env.npm_package_version,
        };

        this.bindAppBuilderBinding(AppBuilderBindings.LOGGER, this.rootLogger);
        this.bindAppBuilderBinding(AppBuilderBindings.APP, this.app);

        return this as any;
    }

    private bindAppBuilderBinding = (sym: AppBuilderBindings, val: any) => {
        if (this.container.isBound(sym)) {
            this.container.rebind(sym).toConstantValue(val);
        } else {
            this.container.bind(sym).toConstantValue(val);
        }
    };

    /**
     * Sets up a remote-config handler. The setup consists of 3 different components:
     *
     * 1. A RemoteSource: Responsible for pulling new config-values from a config-server
     * 2. A ReloadHandler: Responsible for reloading-behaviour, i.e. full-service restart or inline-reloading
     * 3. A Projection / Multiple Projections: Remote-config projections, i.e. for selecting service-specific subsets
     *
     * For the most-part you'll want to setup config-projections. A projection is a record in which leaves are
     * typically RemoteConfigValue's, which allow downstream services to subscribe to asynchronous config changes
     *
     */
    public addDynamicConfig<TRemoteConfig, TProjRemoteConfig>(
        sourceFn: (
            args: DynamicConfigFnArgs<Config>,
        ) => IRemoteSource<TProjRemoteConfig, TRemoteConfig> | TProjRemoteConfig,
    ): ApplicationBuilder<DeepMerge<Config, TProjRemoteConfig, AnyTransformStrict<any>>> {
        const baseArgs: DynamicConfigFnArgs<Config> = {
            ...this.buildBaseResolveArgs(),
            awaited: dynamicPromise,
            streamed: dynamicObservable,
        };
        const source = sourceFn(baseArgs);
        let projectedConfig: TProjRemoteConfig;

        if (isPlainObject(source)) {
            const sourceArtefact = new DynamicConfigSource(source as TProjRemoteConfig);
            this.servicesWithLifecycleHandlers.push(sourceArtefact);

            projectedConfig = sourceArtefact.init();
        } else {
            const sourceTyped = source as BaseRemoteSource<any, any>;
            this.servicesWithLifecycleHandlers.push(sourceTyped);
            const dependencyArgs = { once, streamed } as RemoteDependencyArgs<TRemoteConfig>;
            const { config, lifecycleArtefacts } = sourceTyped.init(dependencyArgs);
            if (lifecycleArtefacts?.length) {
                this.servicesWithLifecycleHandlers.push(...lifecycleArtefacts);
            }

            projectedConfig = config;
        }

        this.config = mergeWith({}, this.config, projectedConfig, obj => {
            if (isTransformer(obj)) {
                return obj;
            }
            return undefined;
        });

        return this as any as ApplicationBuilder<DeepMerge<Config, TProjRemoteConfig, AnyTransformStrict<any>>>;
    }

    private configTransformers: TreeNodeTransformerConfig[] = [
        {
            predicate: value => !!value && value.__type === REF_TYPES.ENV,
            transform: ({ transformFn, defaultValue }: EnvTransformConfig, path) => {
                const envLookupKey = toConstantCase(path);
                const envValue = process.env[envLookupKey] || defaultValue;
                if (typeof envValue === "undefined") {
                    throw new Error(
                        `Required env-variable ${envLookupKey} not found, please check your service-config`,
                    );
                }
                return transformFn ? transformFn(envValue) : envValue;
            },
        },
        {
            predicate: value => !!value && typeof value === "object" && "_parse" in value,
            transform: (refValue: ValidatorSpec<any>, path) => {
                const envLookupKey = toConstantCase(path);
                const parsedEnv = cleanEnv(process.env, { [envLookupKey]: refValue });
                return parsedEnv[envLookupKey];
            },
        },
        {
            predicate: value => !!value && value.__type === REF_TYPES.REF,
            transform: ({ referenceValue, refTransformFn }: RefTransformConfig) => {
                const envValue = process.env[referenceValue];
                return refTransformFn ? refTransformFn(envValue) : envValue;
            },
        },
    ];

    /**
     * Sets a service's required config based on envs. The callback of this method
     * exposes 3 different handlers for fetching envs:
     * 1. env(transform, default): Requires an env-value (unless default-value is passed)
     * 2. ref(refName, transform): References another env-value, transforms, if needed
     * 3. optEnv(transform): Optional env-values
     *
     * Env-key-names are calculated based on the object-structure of the config.
     * The parser replaces any nesting  and camel-case with a constant_case representation,e.g.:
     * ```js
     * {
     *  foo: {
     *    barFoo: env()
     *  }
     * }
     * ```
     * will become `FOO_BAR_FOO`
     *
     *
     */
    public addConfig<TConf extends Record<string, any>>(
        envFn: EnvFn<TConf>,
    ): ApplicationBuilder<DeepMerge<Config, TConf, AnyTransformStrict<any>>> {
        // @todo somehow allow async transformers, this however needs async DI injection ? (or use the fact that we have lifecycles, so config is materialized before resolution phase)
        const projectedConfig = remapTree(envFn({ $env, app: this.app }), ...this.configTransformers);

        this.config = mergeWith({}, this.config, projectedConfig, obj => {
            if (isTransformer(obj)) {
                return obj;
            }
            return undefined;
        });

        this.bindAppBuilderBinding(AppBuilderBindings.CONFIG, this.config);

        return this as any as ApplicationBuilder<DeepMerge<Config, TConf, AnyTransformStrict<any>>>;
    }

    /**
     * Application error-handlers. Whenever an UNCAUGHT error or UNHANDLED rejection is registered,
     * this error-handler is called. The user can indicate whether the error should be ignored
     * or lead to service-shutdown
     *
     */
    public onError(onError: ErrorHandlerFn<Config>): ApplicationBuilder<Config> {
        this.errorHandlers.push(onError);
        return this;
    }

    /**
     * Application shutdown-handlers. Whenever a shutdown is requested, this handler can perform
     * additional shutdown logic and indicate whether a graceful-shutdown should be attempted or whether
     * a forced-shutdown is performed, resulting in immediate process-exiting.
     *
     * If one handle indicates FORCE, all other handlers are ignored
     *
     */
    public onShutdown(onShutdown: ShutdownHandlerFn<Config>): ApplicationBuilder<Config> {
        this.shutdownHandlers.push(onShutdown);
        return this;
    }

    /**
     * Registers a dependency which can be resolved by the IOC-container. Please note that
     * this method does NOT allow re-binding of dependency-identifiers. Doing so will throw an
     * error at startup
     */
    public registerDependency<T>(
        name: string,
        registerFn: (args: RegisterFnArgs<Config>) => T extends Promise<any> ? never : T,
    ): ApplicationBuilder<Config> {
        if (Object.values(AppBuilderBindings).some(b => b === name)) {
            throw new Error("Cannot register dependency with the same name as internal-bindings");
        }
        let binding: interfaces.BindingToSyntax<any>;
        if (this.container.isBound(name)) {
            binding = this.container.rebind(name);
        } else {
            binding = this.container.bind(name);
        }
        binding
            .toDynamicValue(context => {
                try {
                    const inst = registerFn(this.buildResolveArgs(context.container));
                    if (serviceWithPreflightOrShutdown(inst)) {
                        this.servicesWithLifecycleHandlers.push(inst);
                    }
                    return inst;
                } catch (e) {
                    this.rootLogger.info(`Error while instantiating service '${name}': ${e.message}`);
                    throw e;
                }
            })
            .inSingletonScope();

        return this;
    }

    /**
     * Registers a provider for dependency resolution. This method differs from the regular
     * registerDependency in that it only allows providers to be registered. A provider
     * is an async factory-function.
     *
     * The provider is NOT in a singleton-scope, therefore calling this multiple times results
     * in multiple instances of the generated instance of the factory-fn
     *
     */
    public registerProvider<T>(
        name: string,
        registerFn: (args: RegisterFnArgs<Config>) => Provider<T>,
    ): ApplicationBuilder<Config> {
        if (Object.values(AppBuilderBindings).some(b => b === name)) {
            throw new Error("Cannot register provider with the same name as internal-bindings");
        }
        this.container.bind(name).toProvider(context => registerFn(this.buildResolveArgs(context.container)));
        return this;
    }

    /**
     * Registers a command for the service. A service can have multiple commands, which can be independently started
     * (but never at the same time).
     * In order to execute a specific command, please pass the cli-parameter: --command <name>
     */
    public registerCommand(
        name: string,
        registerFn: (args: RegisterFnArgs<Config>) => Command | Promise<Command>,
    ): ApplicationBuilder<Config> {
        this.commandReferences.push(name);

        return this.registerDependency<any>(name, registerFn);
    }

    /**
     * Registers a default-command for service-exectuion, allowing the process to start without additional flags
     */
    public registerDefaultCommand(
        name: string,
        registerFn: (args: RegisterFnArgs<Config>) => Command | Promise<Command>,
    ): ApplicationBuilder<Config> {
        this.defaultCommandName = name;

        return this.registerCommand(name, registerFn);
    }

    /**
     * Registers a preflight-function which is executed prior to the command-execution
     */
    public registerPreflightFn(fn: AppPreflightFn<Config>): ApplicationBuilder<Config> {
        this.preflightFns.push(fn);
        return this;
    }

    /**
     * @alias onShutdown This is just an alias for onShutdown for the sake of same naming as registerPreflightFn
     */
    public registerShutdownFn(fn: ShutdownHandlerFn<Config>): ApplicationBuilder<Config> {
        return this.onShutdown(fn);
    }

    private parseCommandArgs<TArgs extends Record<string, any>>(
        command: Command<TArgs, any>,
    ): (TArgs & { $raw: ParsedArgs }) | undefined {
        if (!command.info.argv) {
            return;
        }
        const baseArgs = command.info.argv({
            $arg: <O extends AllOptions>(opts: O) => ({ ...(opts as any), __type: "opt" }) as InferredOptionType<O>,
        }) as Record<string, AllOptions>;

        const isArgvType = (v: any) => "__type" in v && v.__type === "opt";
        // in order to pass the options to yargs, we need to flatten the tree and generate a record of only yargs-compliant Options
        const flattenedBaseArgs = reduceTree<Record<string, AllOptions>>(baseArgs, isArgvType, (v, k) => ({
            [k.map(kebabCase).join("-")]: { ...v, __path: k },
        }));

        // makes sure to not have the same generated key accidentally being defined twice through nesting and naming
        const camelKeys = Object.keys(flattenedBaseArgs).map(k => camelCase(k));
        if (camelKeys.length !== uniq(camelKeys).length) {
            throw new Error(
                `Encounted doubly camelized keys. Make sure you are not naming keys in camelCase and nest them in the same parts, e.g. '{ fooBar: "..." }' and '{ foo: { bar: "..." } }'`,
            );
        }
        if (Object.keys(flattenedBaseArgs).some(k => ["$raw", "command"].includes(k))) {
            throw new Error(
                `Encounted reserved keyword in command-args, please change the arg-name to something different than '$raw' or 'command'`,
            );
        }
        const options = buildOptions(flattenedBaseArgs);

        const convertedArgs = minimist(process.argv.slice(2), options) as Record<string, any>;

        /**
         * for compliance w/ tArgs, we need to re-nest again with the result of convertedArgs.
         * yArgs converts kebab-case to camelCase, so we can make a lookup afterwards.
         * Due to the uniqueness of camel-cased keys (see check above), this op is deterministic
         *
         */
        const { missingPaths, tree: reNestedTree } = Object.entries(flattenedBaseArgs).reduce(
            (acc, [k, v]) => {
                if (!v.__path?.length) {
                    return acc;
                }
                const parsedVal = convertedArgs[k as keyof typeof convertedArgs];
                return {
                    missingPaths: v.required && isUndefined(parsedVal) ? [...acc.missingPaths, k] : acc.missingPaths,
                    tree: set(v.__path, parsedVal)(acc.tree),
                };
            },

            { tree: {} as Record<string, any>, missingPaths: [] },
        );

        if (missingPaths.length) {
            throw new MissingCommandArgsError(missingPaths);
        }
        return {
            ...reNestedTree,
            $raw: pick(convertedArgs, Object.keys(flattenedBaseArgs)),
        } as TArgs & { $raw: ParsedArgs };
    }

    private async runCommand<TResult>(
        commandName: string,
    ): Promise<{ result: TResult; shutdownHandle?: () => Promise<void> }> {
        debug("Running command");
        await Promise.all(this.preflightFns.map(fn => fn(this.buildResolveArgs(this.container))));
        debug("Ran all global-preflight fns");
        const command = this.container.get<Command<any, TResult>>(commandName);
        debug("Resolved ioc-container");
        const argv = this.parseCommandArgs(command);

        await Promise.all(this.servicesWithLifecycleHandlers.map(svc => svc.preflight && svc.preflight()));
        debug("Ran all service-preflight fns");
        const commandResult = await command.execute({ logger: this.rootLogger, app: this.app, argv });
        debug("Executed command");
        let shutdownHandle;

        if (this.appBuilderConfig.deferredShutdownHandle) {
            shutdownHandle = async () => {
                const result = await this.handleShutdown({ reason: "SVC_ENDED", code: 0 });
                debug("Ran deferred shutdown successfully");
                return result;
            };
        } else {
            await this.handleShutdown({ reason: "SVC_ENDED", code: 0 });
            debug("Ran shutdown successfully");
        }
        return { result: commandResult, shutdownHandle };
    }

    private shutdown = _once(async (reason: string, exitCode = 1, forceExit = false): Promise<void> => {
        // @todo this is wrong, its just HAX for the specs to not call process.exit
        if (!this.servicesWithLifecycleHandlers.length) {
            this.rootLogger.info({ reason }, `Successfully shut down all services. Goodbye 👋`);
            return;
        }
        if (forceExit && this.appBuilderConfig.exitAfterRun) {
            process.exit(exitCode);
        }
        this.rootLogger.debug(
            {
                servicesWithLifecycleHandlers: this.servicesWithLifecycleHandlers.map(s => s.constructor.name),
            },
            `Trying to shut down services`,
        );

        try {
            const shutdownServices = new Set<ServiceWithLifecycleHandlers>(this.servicesWithLifecycleHandlers);
            await Promise.race([
                sleep(this.appBuilderConfig.shutdownGracePeriodSeconds * 1000, true).then(() => {
                    if (shutdownServices.size === 0) {
                        return;
                    }
                    const error = new Error("Timeout while graceful-shutdown, will exit now");
                    this.rootLogger.error(
                        {
                            remainingServicesWithLifecycleHandlers: Array.from(shutdownServices).map(
                                s => s.constructor.name,
                            ),
                            reason,
                        },
                        error.message,
                    );
                    if (this.appBuilderConfig.exitAfterRun) {
                        process.exit(1);
                    } else {
                        throw error;
                    }
                }),
                Promise.all(
                    this.servicesWithLifecycleHandlers.map(async svc => {
                        await svc.shutdown?.();
                        shutdownServices.delete(svc);
                    }),
                ),
            ]);
            debug("Ran all service shutdown handlers");
            if (this.appBuilderConfig.exitAfterRun) {
                this.rootLogger.info({ reason }, `Successfully shut down all services. Reason ${reason}. Goodbye 👋`);
                process.exit(exitCode);
            } else {
                this.rootLogger.info({ reason }, `Successfully shut down all services. Goodbye 👋`);
            }
        } catch (e) {
            this.rootLogger.error({ reason, error: e }, `Uncaught error while shutting-down: ${e.message}`);
            if (this.appBuilderConfig.exitAfterRun) {
                process.exit(1);
            } else {
                throw e;
            }
        }
    });

    private handleError = async (args: { error?: Error; reason: string }): Promise<void> => {
        if (!this.errorHandlers.length) {
            this.rootLogger.error("Uncaught error and no error-handler registered, will exit now");
            return this.shutdown(args.reason, 1);
        }
        const errorHandlerResults = await Promise.allSettled(
            this.errorHandlers.map(errorFn => errorFn(this.buildResolveArgs(this.container), args.error)),
        );

        if (errorHandlerResults.some(r => r.status === "rejected")) {
            this.rootLogger.info("Some error handlers were rejected, will exit immediately");
            return this.shutdown("UNHANDLED_REJECTION", 1, true);
        }

        if (errorHandlerResults.some(r => r.status === "fulfilled" && r.value === ErrorHandle.DIE)) {
            this.rootLogger.error("Received DIE-signal from one error-handler, will exit now");
            return this.shutdown(args.reason, 1);
        }
        this.rootLogger.info(`All error-handlers indicated to ignore the error: ${args.error && args.error.message}`);
    };

    private handleShutdown = _once(async (args: { error?: Error; reason: string; code: number }): Promise<void> => {
        if (!this.shutdownHandlers.length) {
            this.rootLogger.info(args, "No shutdown handlers registered, will try to shutdown gracefully");
            return this.shutdown(args.reason, args.code);
        }
        const shutdownHandlerResults = await Promise.allSettled(
            this.shutdownHandlers.map(errorFn => errorFn(this.buildResolveArgs(this.container), args.reason)),
        );
        debug("Ran all global shutdown handlers");

        if (shutdownHandlerResults.some(r => r.status === "rejected")) {
            this.rootLogger.info("Some shutdown handlers were rejected, will exit immediately");
            return this.shutdown("UNHANDLED_REJECTION", 1, true);
        }

        if (shutdownHandlerResults.some(r => r.status === "fulfilled" && r.value === ShutdownHandle.FORCE)) {
            this.rootLogger.info("Received FORCE-signal from one shutdown-handler, will exit immediately");
            return this.shutdown(args.reason, args.code, true);
        }
        this.rootLogger.info("All shutdown-handlers indicated non-force-shutdown, will try to shutdown gracefully");
        return this.shutdown(args.reason, args.code);
    });

    private bindErrorSignals = () => {
        onExit(code => this.handleShutdown({ reason: "EXIT", code: code ?? 1 }));
        process.on("uncaughtException", error => this.handleError({ error, reason: "UNCAUGHT_EXCEPTION" }));
        process.on("unhandledRejection", reason =>
            this.handleError({ ...(reason instanceof Error ? { error: reason } : {}), reason: "UNHANDLED_REJECTION" }),
        );
    };

    public async run<TResult = any>(opts?: {
        command?: string;
        config?: PartialConfig<Config>;
    }): Promise<{ result: TResult; shutdownHandle?: () => Promise<void> }> {
        debug("Init run()");
        if (opts?.config) {
            this.config = merge({}, this.config, opts.config);
        }
        const argv: any = minimist(process.argv.slice(2), buildOptions({ command: { type: "string", alias: "c" } }));
        debug("Processed argv");
        const commandName = (opts?.command || argv.command || this.defaultCommandName) as string | undefined;
        if (!commandName || typeof commandName !== "string") {
            const availableCommands = this.commandReferences.join("\n");
            const error = new Error(
                `Did not receive a command argument or no defaultCommand was set. Available Commands:\n${availableCommands}`,
            );
            this.rootLogger.error(error.message);
            if (this.appBuilderConfig.exitAfterRun) {
                this.shutdown("NO_COMMAND", 1, true);
                return null!; // never reached, shutdown force exits
            }
            throw error;
        }
        if (this.appBuilderConfig.bindProcessSignals) {
            this.bindErrorSignals();
        }

        try {
            return await this.runCommand<TResult>(commandName);
        } catch (error: any) {
            if (this.appBuilderConfig.exitAfterRun) {
                await this.handleError({ error, reason: "INTERNAL_ERROR" }).catch(innerError => {
                    // in case of unexpected errors, panic
                    this.rootLogger.error(
                        { error: innerError },
                        `Unexpected error in global-error-handling, shutting down`,
                    );
                    process.exit(1);
                });
            }
            // either when graceful exit is set or no exit-after-run, throw the error
            throw error;
        }
    }
}
