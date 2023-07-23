import type { Observable } from "rxjs";
import type { Gauge } from "@figedi/metering";
import type { ServiceWithLifecycleHandlers } from "../../types";
import type { RemoteDependencyArgs } from "../types";

export interface IRemoteSource<TProject, Schema> {
    init: (args: RemoteDependencyArgs<Schema>) => {
        config: TProject;
        lifecycleArtefacts?: ServiceWithLifecycleHandlers[];
    };
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
