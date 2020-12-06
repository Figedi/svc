import { expect } from "chai";
import { Subject } from "rxjs";
import { take } from "rxjs/operators";
import { StreamedRemoteConfigValue } from "./StreamedRemoteConfigValue";

describe("StreamedRemoteConfigValue", () => {
    it("should perform a projection based on a passend projection-fn", async () => {
        const parent$ = new Subject<number>();
        const remoteValue = new StreamedRemoteConfigValue(parent$.asObservable(), (v: number) => v + 1295);
        await remoteValue.preflight();

        const valueGetter = remoteValue
            .stream()
            .pipe(take(1))
            .toPromise();
        parent$.next(42);
        expect(await valueGetter).to.equal(1337); // because 1295 + 42 is 1337
    });
});
