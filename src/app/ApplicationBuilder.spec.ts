import { MeteringRecorder } from "@figedi/metering";
import { expect } from "chai";
import { assert, stub } from "sinon";

import { ApplicationBuilder } from "./ApplicationBuilder";
import { type Command, type Provider, ErrorHandle, ShutdownHandle } from "./types/app";
import { createStubbedLogger } from "../logger";

describe("ApplicationBuilder", function AppBuilderTest() {
    this.timeout(20000);

    beforeEach(() => {
        process.argv = ["npx", "specs", "--bar", "42", "--foo-bar", "10.5", "--foo-baz", "21"];
    });

    describe("integration", function AppBuilderIntTest() {
        this.timeout(10000);
        const createDefaultCommand = (
            configProvider: Provider<any>,
            confValue: any,
            expectedConfValue: any,
            testDone: () => void,
        ): Command<{ bar: number; fooBar: number; foo: { default: boolean; undef?: string; baz: number } }> => ({
            info: {
                name: "DefaultCommand",
                argv: ({ $arg }) => ({
                    bar: $arg({ required: true, alias: ["b"], type: "number" }),
                    foo: {
                        baz: $arg({ required: true, type: "number" }),
                        default: $arg({ default: false, type: "boolean" }),
                        undef: $arg({ type: "string" }),
                    },
                    fooBar: $arg({ required: true, type: "number" }),
                }),
            },
            execute: async ({ logger, argv }) => {
                expect(argv?.bar).to.eq(42);
                expect(typeof argv?.bar).to.eq("number");
                expect(argv?.foo.baz).to.eq(21);
                expect(argv?.foo.default).to.eq(false);
                expect(argv?.foo.undef).to.eq(undefined);
                expect(typeof argv?.foo.baz).to.eq("number");
                expect(argv?.fooBar).to.eq(10.5);
                expect(typeof argv?.fooBar).to.eq("number");
                expect(confValue).to.deep.equal(expectedConfValue);
                expect(await configProvider()).to.deep.equal({
                    dependency: "value",
                    providerB: {
                        providerA: "value",
                    },
                });
                logger.info(
                    { config: await configProvider() },
                    `Executing default-command. the config-value is: ${expectedConfValue}`,
                );
                testDone();
            },
        });

        it("should be able to run a command", done => {
            process.env.A_DEEP_STR = "example_string";
            process.env.A_DEEP_BOOL = "0";
            process.env.A_DEEP_JSON = '{ "stringified": "json" }';
            process.env.A_DEEP_OVERWRITEABLE = "i-am-overriden-in-run()";
            ApplicationBuilder.create({
                bindProcessSignals: false,
                loggerFactory: createStubbedLogger,
            })
                .addConfig(({ $env }) => ({
                    a: {
                        deep: {
                            fileVal: $env.file(
                                ({ app }) => `${app.rootPath}/resources/example.json`,
                                // for testability, the file is being parsed as json
                                fileContent => ({ parsedContent: JSON.parse(fileContent.toString("utf-8")) }),
                            ),
                            bool: $env.bool(),
                            overwriteable: $env.str(),
                            str: $env.str({ choices: ["example_string", "whatup"] }),
                            json: $env.json<{ foo: number }>(),
                        },
                    },
                    serviceName: "example-svc",
                    environmentName: "dev",
                }))
                .reconfigure({
                    env: ({ $env }) => ({
                        a: {
                            deep: {
                                bool: $env.str(),
                            },
                        },
                        serviceName: 42,
                    }),
                })

                .registerDependency("meteringRecorder", () => new MeteringRecorder("svc_test"))
                .registerDependency("dependencyA", () => ({ dependency: "value" }))
                .registerDependency("dependencyB", ({ config }) => ({ dependency: config.a.deep.overwriteable }))
                .registerProvider("providerA", () => async () => ({ providerA: "value" }))
                .registerProvider("providerB", ({ resolve }) => async () => ({
                    ...resolve<Record<string, string>>("dependencyA"),
                    providerB: await resolve<Provider<any>>("providerA")(),
                }))
                .onError((_, e) => {
                    done(e);
                    return ErrorHandle.IGNORE;
                })
                .registerDefaultCommand("start", ({ resolve, config }) => {
                    expect(config.a.deep.overwriteable).to.eq("hello-new-value");
                    expect(resolve("dependencyB")).to.deep.eq({ dependency: config.a.deep.overwriteable });
                    return createDefaultCommand(resolve("providerB"), config.a.deep.bool, "0", done);
                })
                .run({
                    config: {
                        a: {
                            deep: {
                                overwriteable: "hello-new-value",
                            },
                        },
                    },
                });
        });

        it("should be able to extend app builders", async () => {
            process.env.NUM_A1 = "40";
            process.env.NUM_A2 = "2";
            process.env.STR_B = "The answer to the universe is:";
            const appBuilderA = ApplicationBuilder.create({
                loggerFactory: createStubbedLogger,
                bindProcessSignals: false,
                exitAfterRun: false,
            })
                .addConfig(({ $env }) => ({
                    numA1: $env.num(),
                }))
                .addConfig(({ $env }) => ({
                    numA2: $env.num(),
                }))
                .registerDependency("testDepA1", ({ config }) => ({ num: config.numA1 }));

            const appBuilderB = appBuilderA
                .addConfig(({ $env }) => ({
                    strB: $env.str(),
                }))
                .registerDependency("testDepB", ({ resolve, config }) => ({
                    strB: `${config.strB} ${resolve<{ num: number }>("testDepA1").num + config.numA2}`,
                }))
                .registerDefaultCommand("commandB", ({ resolve }) => ({
                    info: {
                        name: "commandB",
                    },
                    async execute() {
                        return resolve("testDepB");
                    },
                }));
            const { result } = await appBuilderB.run();

            expect(result).to.deep.eq({
                strB: `The answer to the universe is: 42`,
            });
        });

        it("returns a commands execute result", async () => {
            const commandPreflightFn = stub();
            const globalPreflightFn = stub();
            const commandShutdownFn = stub();

            const { result } = await ApplicationBuilder.create({
                loggerFactory: createStubbedLogger,
                bindProcessSignals: false,
                exitAfterRun: false,
            })
                .registerPreflightFn(async () => globalPreflightFn())

                .registerDefaultCommand("start-intermediate", () => ({
                    info: {
                        name: "DefaultCommand",
                    },
                    preflight() {
                        commandPreflightFn();
                    },
                    shutdown() {
                        commandShutdownFn();
                    },
                    execute: async () => ({ universe: 42 }),
                }))
                .run();

            expect(result).to.deep.eq({ universe: 42 });
            assert.calledOnce(commandPreflightFn);
            assert.calledOnce(globalPreflightFn);
            assert.calledOnce(commandShutdownFn);
        });

        it("allows to expose a deferred shutdown handler", async () => {
            const commandPreflightFn = stub();
            const globalPreflightFn = stub();
            const globalShutdownFn = stub();
            const commandShutdownFn = stub();

            const { result, shutdownHandle } = await ApplicationBuilder.create({
                loggerFactory: createStubbedLogger,
                bindProcessSignals: false,
                exitAfterRun: false,
                deferredShutdownHandle: true,
            })
                .registerPreflightFn(async () => globalPreflightFn())
                .registerShutdownFn(() => {
                    globalShutdownFn();
                    return ShutdownHandle.GRACEFUL;
                })
                .registerDefaultCommand("start-intermediate", () => ({
                    info: {
                        name: "DefaultCommand",
                    },
                    preflight() {
                        commandPreflightFn();
                    },
                    shutdown() {
                        commandShutdownFn();
                    },
                    execute: async () => ({ universe: 42 }),
                }))
                .run();

            expect(result).to.deep.eq({ universe: 42 });
            assert.notCalled(commandShutdownFn);
            assert.notCalled(globalShutdownFn);
            assert.calledOnce(commandPreflightFn);
            assert.calledOnce(globalPreflightFn);
            await shutdownHandle!();
            assert.calledOnce(commandShutdownFn);
            assert.calledOnce(globalShutdownFn);
        });
    });
});
