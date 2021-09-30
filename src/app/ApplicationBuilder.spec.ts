import { MeteringRecorder } from "@figedi/metering";
import { expect } from "chai";

import { ApplicationBuilder } from "./ApplicationBuilder";
import { Provider, ExecuteCommandArgs, ErrorHandle } from "./types/app";
import { createStubbedLogger } from "../logger";

describe("ApplicationBuilder", function AppBuilderTest() {
    this.timeout(20000);

    describe("integration", function AppBuilderIntTest() {
        this.timeout(10000);

        const createDefaultCommand = (
            configProvider: Provider<any>,
            confValue: any,
            expectedConfValue: any,
            testDone: () => void,
        ) => ({
            info: {
                name: "DefaultCommand",
            },
            execute: async ({ logger }: ExecuteCommandArgs) => {
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
            ApplicationBuilder.create({ loggerFactory: createStubbedLogger })
                .setEnv(({ $env }) => ({
                    a: {
                        deep: {
                            fileVal: $env.file(
                                ({ app }) => `${app.rootPath}/resources/example.json`,
                                // for testability, the file is being parsed as json
                                fileContent => ({ parsedContent: JSON.parse(fileContent.toString("utf-8")) }),
                            ),
                            bool: $env.bool(),
                            str: $env.str({ choices: ["example_string", "whatup"] }),
                            json: $env.json<{ foo: number }>(),
                        },
                    },
                    serviceName: "example-svc",
                    environmentName: "dev",
                }))
                .registerDependency("meteringRecorder", () => new MeteringRecorder())
                .registerDependency("dependencyA", () => ({ dependency: "value" }))
                .registerProvider("providerA", () => async () => ({ providerA: "value" }))
                .registerProvider("providerB", ({ resolve }) => async () => {
                    return {
                        ...resolve<Record<string, string>>("dependencyA"),
                        providerB: await resolve<Provider<any>>("providerA")(),
                    };
                })
                .onError((_, e) => {
                    done(e);
                    return ErrorHandle.IGNORE;
                })
                .registerDefaultCommand("start", ({ resolve, config }) =>
                    createDefaultCommand(resolve("providerB"), config.a.deep.fileVal.parsedContent, { foo: 42 }, done),
                )
                .run();
        });
    });
});
