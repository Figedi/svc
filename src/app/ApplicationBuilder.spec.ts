import { MeteringRecorder } from "@figedi/metering";
import { expect } from "chai";

import { ApplicationBuilder } from "./ApplicationBuilder";
import { Provider, ExecuteCommandArgs, ErrorHandle } from "./types/app";
import { createStubbedLogger } from "../logger";

describe("ApplicationBuilder", function AppBuilderTest() {
    this.timeout(20000);

    describe("integration", function AppBuilderIntTest() {
        this.timeout(10000);

        const createDefaultCommand = (configProvider: Provider<any>, serviceName: string, testDone: () => void) => ({
            info: {
                name: "DefaultCommand",
            },
            execute: async ({ logger }: ExecuteCommandArgs) => {
                expect(serviceName).to.equal("example-svc");
                expect(await configProvider()).to.deep.equal({
                    dependency: "value",
                    providerB: {
                        providerA: "value",
                    },
                });
                logger.info(
                    { config: await configProvider() },
                    `Executing default-command. the serviceName is: ${serviceName}`,
                );
                testDone();
            },
        });

        it("should be able to run a command", done => {
            ApplicationBuilder.create({ loggerFactory: createStubbedLogger })
                .setEnv(() => ({
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
                    createDefaultCommand(resolve("providerB"), config.serviceName, done),
                )
                .run();
        });
    });
});
