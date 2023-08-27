import { expect } from "chai";
import { ApplicationBuilder } from "./ApplicationBuilder";
import { TestApplicationBuilder } from "./TestApplicationBuilder";
import type { Command } from "./types/app";

describe("TestApplicationBuilder", () => {
    const createDefaultCommand = (depThing: Record<string, any>): Command => ({
        info: {
            name: "DefaultCommand",
        },
        execute: async ({ logger }) => {
            logger.info({ config: depThing }, `Executing default-command.`);
        },
    });

    const appBuilder = ApplicationBuilder.create()
        .addConfig(() => ({
            serviceName: "example-svc",
            environmentName: "dev",
        }))

        .registerDependency("depThing", () => ({ whatever: "value" }))
        .registerDefaultCommand("start", ({ resolve }) => createDefaultCommand(resolve("depThing")));

    it("should mount an existing app-builder and replace dependencies  with stubs", done => {
        TestApplicationBuilder.mount(appBuilder)
            .rebindAsStub("depThing", () => ({ another: "value" }))
            .runInContainer(({ resolve }) => {
                expect(resolve("depThing")).to.deep.equal({ another: "value" });
                done();
            });
    });
});
