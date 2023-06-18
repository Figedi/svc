/* eslint-disable no-underscore-dangle */
import { Container, interfaces } from "inversify";
import pino from "pino";
import appRootPath from "app-root-path";
import { pick, kebabCase, uniq, camelCase, once, merge } from "lodash";
import { set } from "lodash/fp";
// import { join } from "path";
import yargs, { argv as defaultArgv, Options, InferredOptionType, Arguments } from "yargs";
import { readFileSync } from "fs";
import { str, bool, num, host, port, url, json, ValidatorSpec, cleanEnv } from "envalid";

import { createLogger } from "../logger";
import { sleep, remapTree, toConstantCase, reduceTree } from "./utils";
import {
    EnvTransformFn,
    RefTransformFn,
    AppBuilderConfig,
    AppConfig,
    ServiceWithLifecycleHandlers,
    EnvFn,
    EnvTransformConfig,
    RefTransformConfig,
    serviceWithPreflightOrShutdown,
    Provider,
    ErrorHandle,
    ShutdownHandle,
    Command,
    ResolveRegisterFnArgs,
    BaseRegisterFnArgs,
    FileTransformFn,
    FileTransformConfig,
    EnvalidTransformer,
} from "./types";

import { RemoteConfigFn, setRemoteConfig, UnpackRemoteConfigTypes } from "./remoteConfig";

export type AppPreflightFn<C, RC> = (container: RegisterFnArgs<C, RC>) => Promise<any> | any;

export type ErrorHandlerFn<C, RC> = (args: RegisterFnArgs<C, RC>, e?: Error) => ErrorHandle | Promise<ErrorHandle>;
export type ShutdownHandlerFn<C, RC> = (
    args: RegisterFnArgs<C, RC>,
    reason?: string,
) => ShutdownHandle | Promise<ShutdownHandle>;

export interface RegisterFnArgs<Config, RemoteConfig> extends ResolveRegisterFnArgs<Config> {
    remoteConfig: UnpackRemoteConfigTypes<RemoteConfig>;
}

const REF_TYPES = {
    ENV: 0,
    OPT: 1,
    REF: 2,
    FILE: 3,
};

const any: EnvTransformFn = (transformFn, defaultValue) => ({
    transformFn,
    defaultValue,
    __type: 0,
});

const ref: RefTransformFn = (referenceValue, refTransformFn) => ({
    referenceValue,
    refTransformFn,
    __type: 2,
});

const file: FileTransformFn = (filePath, fileTransformFn) => ({
    filePath,
    fileTransformFn,
    __type: 3,
});

const $env: EnvalidTransformer = {
    str,
    bool,
    num,
    host,
    port,
    url,
    json,
    file,
    any,
    ref,
};

const defaultAppBuilderConfig: AppBuilderConfig = {
    shutdownGracePeriodSeconds: 10,
    bindProcessSignals: true,
    exitAfterRun: true,
    rootLoggerProperties: {},
    loggerFactory: createLogger,
};

export type GetAppConfig<T> = T extends ApplicationBuilder<infer V, never>
    ? V
    : T extends ApplicationBuilder<infer K, any>
    ? K
    : never;

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
export class ApplicationBuilder<Config, RemoteConfig> {
    private rootLogger!: pino.Logger;
    private defaultCommandName?: string;
    private app!: AppConfig;
    private errorHandlers: ErrorHandlerFn<Config, RemoteConfig>[] = [];
    private shutdownHandlers: ShutdownHandlerFn<Config, RemoteConfig>[] = [];
    private preflightFns: AppPreflightFn<Config, RemoteConfig>[] = [];
    private commandReferences: string[] = [];
    private appBuilderConfig!: AppBuilderConfig;

    public container = new Container();
    public config: Config = {} as Config;
    public remoteConfig: RemoteConfig = {} as RemoteConfig;
    public servicesWithLifecycleHandlers: ServiceWithLifecycleHandlers[] = [];

    static create = <RC = never, C = never>(
        config: Partial<AppBuilderConfig> = defaultAppBuilderConfig,
    ): ApplicationBuilder<C, RC> => new ApplicationBuilder<C, RC>(config);

    private constructor(config: Partial<AppBuilderConfig>) {
        this.reconfigure(config);
    }

    private buildBaseResolveArgs = (): BaseRegisterFnArgs<Config> => ({
        config: this.config as any, // ts cannot infer here the unpacked-types
        app: this.app,
        logger: this.rootLogger,
    });

    private buildResolveArgs = (container: interfaces.Container): RegisterFnArgs<Config, RemoteConfig> => ({
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
        remoteConfig: this.remoteConfig as any,
        ...this.buildBaseResolveArgs(),
    });

    public reconfigure(config: Partial<AppBuilderConfig>): ApplicationBuilder<Config, RemoteConfig> {
        this.appBuilderConfig = merge({}, defaultAppBuilderConfig, config) as AppBuilderConfig;
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
            rootPath: appRootPath.toString(),
            version: process.env.npm_package_version,
        };
        return this;
    }

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
    public setRemoteConfig<ProjectedRemoteConfig>(
        envFn: RemoteConfigFn<RemoteConfig, Config, ProjectedRemoteConfig>,
    ): ApplicationBuilder<Config, ProjectedRemoteConfig> {
        const remoteConfig = setRemoteConfig(
            envFn,
            this.buildBaseResolveArgs,
            this.servicesWithLifecycleHandlers.push.bind(this.servicesWithLifecycleHandlers),
        );
        this.remoteConfig = remoteConfig as any; // ts-cannot infer the projected type here

        return this as any as ApplicationBuilder<Config, ProjectedRemoteConfig>;
    }

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
    public setEnv<C extends Record<string, any>>(envFn: EnvFn<C>): ApplicationBuilder<C, RemoteConfig> {
        this.config = remapTree(
            envFn({ $env, app: this.app }),
            {
                predicate: value => !!value && value.__type === REF_TYPES.FILE,
                transform: ({ filePath, fileTransformFn }: FileTransformConfig) => {
                    const resolvedPath = typeof filePath === "function" ? filePath({ app: this.app }) : filePath;
                    const fileContent = readFileSync(resolvedPath);
                    if (!fileTransformFn) {
                        return fileContent;
                    }

                    return fileTransformFn(fileContent);
                },
            },
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
        );

        return this as any as ApplicationBuilder<C, RemoteConfig>;
    }

    /**
     * Application error-handlers. Whenever an UNCAUGHT error or UNHANDLED rejection is registered,
     * this error-handler is called. The user can indicate whether the error should be ignored
     * or lead to service-shutdown
     *
     */
    public onError(onError: ErrorHandlerFn<Config, RemoteConfig>): ApplicationBuilder<Config, RemoteConfig> {
        this.errorHandlers.push(onError);
        return this;
    }

    /**
     * Application shutdown-handlers. Whenever a shutdown is requested, this handler can perform
     * additional shutdown logic and indicate whether  a graceful-shutdown should be atteempted or whether
     * a forced-shutdown  is performed, resulting in immediate process-exiting.
     *
     * If one handle indicates FORCE, all other handlers are ignored
     *
     */
    public onShutdown(onShutdown: ShutdownHandlerFn<Config, RemoteConfig>): ApplicationBuilder<Config, RemoteConfig> {
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
        registerFn: (args: RegisterFnArgs<Config, RemoteConfig>) => T extends Promise<any> ? never : T,
    ): ApplicationBuilder<Config, RemoteConfig> {
        this.container
            .bind(name)
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
        registerFn: (args: RegisterFnArgs<Config, RemoteConfig>) => Provider<T>,
    ): ApplicationBuilder<Config, RemoteConfig> {
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
        registerFn: (args: RegisterFnArgs<Config, RemoteConfig>) => Command | Promise<Command>,
    ): ApplicationBuilder<Config, RemoteConfig> {
        this.commandReferences.push(name);

        return this.registerDependency<any>(name, registerFn);
    }

    /**
     * Registers a default-command for service-exectuion, allowing the process to start without additional flags
     */
    public registerDefaultCommand(
        name: string,
        registerFn: (args: RegisterFnArgs<Config, RemoteConfig>) => Command | Promise<Command>,
    ): ApplicationBuilder<Config, RemoteConfig> {
        this.defaultCommandName = name;

        return this.registerCommand(name, registerFn);
    }

    /**
     * Registers a preflight-function which is executed prior to the command-execution
     */
    public registerPreflightFn(fn: AppPreflightFn<Config, RemoteConfig>): ApplicationBuilder<Config, RemoteConfig> {
        this.preflightFns.push(fn);
        return this;
    }

    private parseCommandArgs<TArgs extends Record<string, any>>(
        command: Command<TArgs, any>,
    ): (TArgs & { $raw: Arguments }) | undefined {
        if (!command.info.argv) {
            return;
        }
        const baseArgs = command.info.argv!({
            $arg: <O extends Options>(opts: O) => ({ ...opts, __type: "opt" } as InferredOptionType<O>),
        }) as Record<string, Options>;

        const isArgvType = (v: any) => "__type" in v && v.__type === "opt";
        // in order to pass the options to yargs, we need to flatten the tree and generate a record of only yargs-compliant Options
        const flattenedBaseArgs = reduceTree<Record<string, Options>>(baseArgs, isArgvType, (v, k) => ({
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
        // this actually registers the flattened argv-object to yargs and parses process.argv. throws if sth doesnt match
        const convertedArgs = yargs(process.argv)
            .option("command", {
                type: "string",
                required: !this.defaultCommandName,
                choices: this.commandReferences,
                description: "Name of the command to execute, required if no default-command has been registered",
            })
            .options(flattenedBaseArgs)
            .strictOptions()
            .parse();

        /**
         * for compliance w/ tArgs, we need to re-nest again with the result of convertedArgs.
         * yArgs converts kebab-case to camelCase, so we can make a lookup afterwards.
         * Due to the uniqueness of camel-cased keys (see check above), this op is deterministic
         *
         */
        const reNestedTree = Object.entries(flattenedBaseArgs).reduce(
            (acc, [k, v]) => set((v as any).__path as string[], convertedArgs[k as keyof typeof convertedArgs])(acc),
            {},
        );
        return {
            ...reNestedTree,
            $raw: pick(convertedArgs, Object.keys(flattenedBaseArgs)),
        } as TArgs & { $raw: Arguments };
    }

    private async runCommand<TResult>(commandName: string): Promise<TResult> {
        await Promise.all(this.preflightFns.map(fn => fn(this.buildResolveArgs(this.container))));
        const command = this.container.get<Command<any, TResult>>(commandName);
        const argv = this.parseCommandArgs(command);

        await Promise.all(this.servicesWithLifecycleHandlers.map(svc => svc.preflight && svc.preflight()));
        const commandResult = await command.execute({ logger: this.rootLogger, app: this.app, argv });

        await this.shutdown("SVC_ENDED", 0);
        return commandResult;
    }

    private shutdown = once(async (reason: string, exitCode = 1, forceExit = false): Promise<void> => {
        if (!this.servicesWithLifecycleHandlers.length) {
            return;
        }
        if (forceExit && this.appBuilderConfig.exitAfterRun) {
            process.exit(exitCode);
        }
        try {
            await Promise.race([
                sleep(this.appBuilderConfig.shutdownGracePeriodSeconds, true).then(() => {
                    const error = new Error("Timeout while graceful-shutdown, will exit now");
                    this.rootLogger.error({ reason }, error.message);
                    if (this.appBuilderConfig.exitAfterRun) {
                        process.exit(1);
                    } else {
                        throw error;
                    }
                }),
                Promise.all(this.servicesWithLifecycleHandlers.map(svc => svc.shutdown && svc.shutdown())),
            ]);
            if (this.appBuilderConfig.exitAfterRun) {
                this.rootLogger.info(
                    { reason },
                    `Successfully shut down all services. Reason ${reason}. Will exit now`,
                );

                process.exit(exitCode);
            }
        } catch (e) {
            this.rootLogger.info({ reason, error: e }, `Uncaught error while shutting-down: ${e.message}`);
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
        const errorHandlerResults = await Promise.all(
            this.errorHandlers.map(errorFn => errorFn(this.buildResolveArgs(this.container), args.error)),
        );

        if (errorHandlerResults.some(e => e === ErrorHandle.DIE)) {
            this.rootLogger.error("Received DIE-signal from one error-handler, will exit now");
            return this.shutdown(args.reason, 1);
        }
        this.rootLogger.info(`All error-handlers indicated to ignore the error: ${args.error && args.error.message}`);
    };

    private handleShutdown = async (args: { error?: Error; reason: string }): Promise<void> => {
        if (!this.shutdownHandlers.length) {
            this.rootLogger.info(args, "No shutdown handlers registered, will try to shutdown gracefully");
            return this.shutdown(args.reason, 1);
        }
        const shutdownHandlerResults = await Promise.all(
            this.shutdownHandlers.map(errorFn => errorFn(this.buildResolveArgs(this.container), args.reason)),
        );

        if (shutdownHandlerResults.some(e => e === ShutdownHandle.FORCE)) {
            this.rootLogger.info("Received FORCE-signal from one shutdown-handler, will exit immediately");
            return this.shutdown(args.reason, 1, true);
        }
        this.rootLogger.info("All shutdown-handlers indicated non-force-shutdown, will try to shutdown gracefully");
        return this.shutdown(args.reason, 1);
    };

    private bindErrorSignals = () => {
        process.on("uncaughtException", error => this.handleError({ error, reason: "UNCAUGHT_EXCEPTION" }));
        process.on("unhandledRejection", reason =>
            this.handleError({ ...(reason instanceof Error ? { error: reason } : {}), reason: "UNHANDLED_REJECTION" }),
        );
        process.on("beforeExit", () => this.handleShutdown({ reason: "BEFORE_EXIT" }));
        process.on("exit", () => this.handleShutdown({ reason: "EXIT" }));
        process.on("SIGINT", () => this.handleShutdown({ reason: "SIGINT" }));
        process.on("SIGQUIT", () => this.handleShutdown({ reason: "SIGQUIT" }));
        process.on("SIGTERM", () => this.handleShutdown({ reason: "SIGTERM" }));
    };

    public async run<TResult = any>(command?: string): Promise<TResult> {
        const argv: any = defaultArgv;
        const commandName = (command || argv.command || this.defaultCommandName) as string | undefined;
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
