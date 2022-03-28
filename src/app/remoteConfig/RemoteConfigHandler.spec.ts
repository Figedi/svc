import { spy, assert } from "sinon";
import { expect } from "chai";
import { Subject } from "rxjs";
import { RemoteConfigHandler } from "./RemoteConfigHandler";
import { sleep } from "../utils";

describe("RemoteConfigHandler", () => {
    it("should call execute whenever the predicate yields a truthy result", async () => {
        const parent$ = new Subject<number>();
        const reactsOn = (_: number | undefined, newValue: number) => newValue > 42;
        const reactsOnSpy = spy(reactsOn);
        const pipeline = Promise.race([
            sleep(1000, false).then(() => {
                throw new Error("timeout in RemoteConfigHandler-specs");
            }),
            // eslint-disable-next-line no-async-promise-executor
            new Promise(async resolve => {
                const handler = new RemoteConfigHandler(parent$.asObservable(), reactsOnSpy, async value =>
                    resolve(value),
                );
                resolve(await handler.preflight());
            }),
        ]);
        parent$.next(10); // does not trigger the predicate
        parent$.next(44); // triggers predicate
        const result = await pipeline;
        assert.callCount(reactsOnSpy, 2);
        assert.calledWith(reactsOnSpy.firstCall, undefined, 10);
        assert.calledWith(reactsOnSpy.secondCall, 10, 44);
        expect(result).to.equal(44);
    });
});
