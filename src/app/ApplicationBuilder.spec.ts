import { MeteringRecorder } from "@figedi/metering";
import { expect } from "chai";

import { ApplicationBuilder } from "./ApplicationBuilder";
import { Command, Provider, ErrorHandle } from "./types/app";
import { createStubbedLogger } from "../logger";

describe("ApplicationBuilder", function AppBuilderTest() {
    this.timeout(20000);

    beforeEach(() => {
        process.argv = ["--bar", "42", "--foo-bar", "10.5", "--foo-baz", "21"];
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
                    bar: $arg({ required: true, alias: "b", type: "number", description: "example" }),
                    foo: {
                        baz: $arg({ required: true, alias: "v", type: "number", description: "other example" }),
                        default: $arg({ default: false, type: "boolean", description: "default example" }),
                        undef: $arg({ type: "string", description: "undef example" }),
                    },
                    fooBar: $arg({ required: true, alias: "c", type: "number", description: "example" }),
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
                .registerDependency("meteringRecorder", () => new MeteringRecorder("svc_test"))
                .registerDependency("dependencyA", () => ({ dependency: "value" }))
                .registerProvider("providerA", () => async () => ({ providerA: "value" }))
                .registerProvider("providerB", ({ resolve }) => async () => ({
                    ...resolve<Record<string, string>>("dependencyA"),
                    providerB: await resolve<Provider<any>>("providerA")(),
                }))
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
