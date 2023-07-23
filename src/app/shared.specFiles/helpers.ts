// eslint-disable-next-line import/no-extraneous-dependencies
import { expect } from "chai";
import type { TestApplicationBuilder } from "../TestApplicationBuilder";
import type { RegisterFnArgs } from "../ApplicationBuilder";
import { sleep } from "../utils";

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
    } catch (e) {
        expect(e.message).to.not.equal("App-builder should throw");
        assertionFn(e);
    }
};
