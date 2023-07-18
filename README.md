# SVC

Base svc-framework for µ-services. 


## TODO
Replace them with non nodejs related versions for edge compat
- axios <-- replace with isomorphic fetch
## Features

This framework is the base for most of my µ-services. Some functionalities include:
- IOC-container through inversify
- Service Lifecycle-management (pre-boot hooks, pre-shutdown hooks)
- Base-logger through pino
- env-parsing through declarative syntax
- Remote-config through polling with semantic versioning strategy
- Test-helpers for full-service integration tests

## Usage 

Example for index entry file
```typescript 
import { ApplicationBuilder, ExecuteCommandArgs } from "@figedi/svc";

ApplicationBuilder.create()
    .setEnv(({ env }) => ({
        serviceName: env(), // translates to SERVICE_NAME
        nested: {
            value: env(), // translates to NESTED_VALUE
        },
        constant: 'constant' // no env needed
    }))
    // 
    /**
     * sync dependency, e.g. a service-class, an object etc.
     * config is fully-typed through the setEnv structure.
     * Other properties in the callback-param are:
     * - resolve: Resolve other dependencies in the ioc-container
     * - app: Generic App-flags/-settings
     * - logger: Root-logger
     */
    .registerDependency("dependencyA", ({ config }) => ({ dependency: "value", val: config.nested.value }))
    /**
     * Async-dependency through provider-pattern. This simply requires
     * the user to provide a fn returning a promise. Otherwise all rules
     * from registerDependency apply
     */
    .registerProvider("providerA", () => async () => ({ providerA: "value" }))
    // nested resolving of providers/dependencies possible
    .registerProvider("providerB", ({ resolve }) => async () => {
        return {
            ...resolve<Record<string, string>>("dependencyA"),
            providerB: await resolve<Provider<any>>("providerA")(),
        };
    })
    // lifecycle-management, e.g. global error-handlers. 
    .onError((_, e) => {
        return ErrorHandle.IGNORE;
    })
    /**
     * The application needs commands to run (command-pattern).
     * You can register different commands with registerCommand() 
     * and run them with the cli-param --command <commandName>.
     * 
     * To register a default-command, which is always run when
     * no param is passed, use registerDefaultCommand()
     */
    .registerDefaultCommand("start", ({ resolve, config }) => ({
        info: {
            name: "DefaultCommand",
        },
        execute: async ({ logger }: ExecuteCommandArgs) => {
            logger.info(
                {
                    provider: resolve("providerB"), 
                    config: config.serviceName
                }, 
                'Started the svc, yay'
            );
        }
    })
    )
    // run the app-builder, runs until the current command resolves
    .run()
```

Example for remote-config
```typescript 
import { ApplicationBuilder, AcceptedVersionRange } from "@figedi/svc";
/**
 * the base for the svc-config is an accompanied npm package which defines 
 * the current version, schema and typings of potentially consumeable remote-configs
 */
import { getFallback, getVersion, ConfigRepository, getRootSchema } from "@figedi/svc-config";

/**
 * Projections for later consumption, see description in projections() for usage
 */
const PROJECTIONS = {
    logLevel: (config: ConfigRepository) => config.resources.configs.service["common.json"].logLevel,
};

/**
 * A fn which determines whether a given restart-strategy should be executed. False means no strategy ought
 * to be executed. Receives the old (if any) and the new value of a given config
 */
const reactsOn: ReactsOnFn<ConfigRepository> = () => false;


// note that the app-builder receives this time the typings of the remote-config
ApplicationBuilder.create<ConfigRepository>()
    .setEnv(({ env }) => ({
        constant: 'constant' ,
        configEndpoint: 'http://config-svc.figedi.de',
    }))
    /**
     * Defines a remote-config which ought to be used 
     * for the lifecycle of the service. A remote-config 
     * needs 3 different things:
     * - A source to pull values from. Currently this only has PollingRemoteSource
     * - A reloading-strategy. Defines what to do with new values (e.g. a full service restart or inline updates)
     * - projections: A fully-typed projection based on the consumed config-values to individual streams
     */
    .setRemoteConfig(({ config }) => ({
        /**
         * Sets a PollingRemoteSource. This source periodically polls
         * data from a given endpoint. 
         * 
         * The remote-source needs to verify the consumed data to minify svc-disprutions. 
         * For this very reason, you can provide a fallback, which is used whenever 
         * no config-value could be consumed (e.g. config-svc-down), on which this running
         * svc can fallback to.
         * 
         * Consuming remote-configs is risky, therefore this svc uses semantic versioning
         * to determine whether it is "safe" to consume a config. The service defines its
         * base-version in the poll-config. Then the user can decide whether patch/minor/major
         * version-changes are allowed to be consumed
         * 
         * Remote-configs can be broken, e.g. when the config-svc is provided malformed data.
         * This svc additionally checks consumed data against its known JSON-schema.
         * 
         * The svc-client can decrypt SOPS-encrypted secrets (e.g. provided in the fallback-value).
         * For this, there exists a sops-client which uses google KMS (sorry AWS)
         * 
         */
        source: new PollingRemoteSource({
            schema: getRootSchema(),
            serviceName: config.serviceName,
            fallback: getFallback(),
            jsonDecryptor: new SopsClient(KmsKeyDecryptor.createWithKmsClient(kmsClient)), // e.g. SopsClient from @figedi/sops
            poll: {
                pollingIntervalMs: 5000, // poll every 5s
                maxTriesWithoutValue: 2, // retry twice when no value was consumed before throwing
                backoffBaseMs: 100, // exponentional-backoff, using the current tries (2 ^ tries * backoffBase + randomness)
                endpoint: config.configEndpoint, // the endpoint to poll
                version: getVersion(), // the current base-version
                acceptedRange: AcceptedVersionRange.patch // only patch increments allowed
            },
        }),
        /**
         * The reloading strategy defines whether a consumed value can be used without a restart
         * or whether a full-svc-restart has to be performed. 
         * 
         * This section consists of 2 sections:
         * - reactsOn: A fn which determines whether a consumed config-value needs to trigger a given strategy
         * - strategy: A strategy to execute when the reactsOn-Fn is triggered.
         * 
         * The current only available strategy is a rolling-service restartin k8s to minify downtime. 
         * This works as follows:
         * Each svc might eventually consume remote-config-updates and asks via the k8s-api for its 
         * neighbouring pods. Then, only the oldest pod may restart at any given time (all services must
         * be healthy to trigger a restart). Eventually, all pods, from oldest to newest will be restarted 
         * without downtime (k8s will redirect traffic whenever a pod is unavailable)
         * 
         */
        reloading: {
            reactsOn,
            strategy: new KubernetesRollingUpdateStrategy(),
        },
        /**
         * A projections-object which can split a consumed config. If the svc-config has a lot of config-files,
         * the projections can be used to split the values. The callback-param provides
         * 2 different config-values for consumption:
         * - once: A value which resolves once and then never again. Essentially this is a promise.
         * - streamed: An observable sequence of config-values
         */
        projections: ({ once, streamed }) => ({
            onceValue: once(PROJECTIONS.logLevel),
            streamedValue: streamed(PROJECTIONS.logLevel),
        }),
    }));

    .registerDefaultCommand("start", ({ resolve, config }) => ({
        info: {
            name: "DefaultCommand",
        },
        execute: async ({ logger }: ExecuteCommandArgs) => {
            logger.info(
                {
                    provider: resolve("providerB"), 
                    config: config.serviceName
                }, 
                'Started the svc, yay'
            );
        }
    }))
    .run()
```