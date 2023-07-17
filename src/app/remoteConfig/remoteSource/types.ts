import type { Observable } from "rxjs";
import type { Gauge } from "@figedi/metering";

export interface IRemoteSource<Schema> {
    execute: () => Promise<any>;
    get: () => Promise<Schema>;
    stream: () => Observable<Schema>;
}

export type ConfigMetrics = {
    requiredVersionMajorTotal: Gauge;
    requiredVersionMinorTotal: Gauge;
    requiredVersionPatchTotal: Gauge;
    lastConsumedVersionTotal: Gauge;
    invalidDataReceivedTotal: Gauge;
    lastConsumedVersionMajorTotal: Gauge;
    lastConsumedVersionMinorTotal: Gauge;
    lastConsumedVersionPatchTotal: Gauge;
};
