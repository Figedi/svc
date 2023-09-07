// eslint-disable-next-line import/no-extraneous-dependencies
import { expect } from "chai";
import type { TestApplicationBuilder } from "../TestApplicationBuilder.js";
import type { RegisterFnArgs } from "../ApplicationBuilder.js";
import { sleep } from "../utils/index.js";

export const assertInTestAppBuilder = async <C>(
    testApp: TestApplicationBuilder<C>,
    runnableAssertionFn: (args: RegisterFnArgs<C>) => void | Promise<void>,
    timeout = 5000,
): Promise<void> => {
    await Promise.race([
        sleep(timeout, true).then(() => {
            throw new Error("timeout");
        }),
        testApp.runInContainer(runnableAssertionFn),
    ]);
};

export const assertErrorInTestAppBuilder = async <C>(
    testApp: TestApplicationBuilder<C>,
    assertionFn: (e: Error) => void,
): Promise<void> => {
    try {
        await testApp.runInContainer(async () => {});
        throw new Error("App-builder should throw");
    } catch (e: any) {
        expect(e.message).to.not.equal("App-builder should throw");
        assertionFn(e);
    }
};
