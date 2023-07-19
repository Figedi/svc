import type { IRemoteSource } from "../remoteSource/types";
import { IReloadingStrategy } from "./base";
import { AddTransformConfigToPrimitives, DynamicOnceTransformFn, DynamicStreamedTransformFn } from "../../types";

export type RemoteDependencyArgs<RemoteConfig> = {
    streamed: DynamicStreamedTransformFn<RemoteConfig>;
    once: DynamicOnceTransformFn<RemoteConfig>;
};

export type BaseRemoteConfig<TRemote, TProjectedRemoteConfig> = {
    source: IRemoteSource<TRemote>;
    reloading?: {
        reactsOn: (oldConfig: TRemote | undefined, newConfig: TRemote) => boolean;
        strategy: IReloadingStrategy;
    };
    projections: (
        remoteArgs: RemoteDependencyArgs<TRemote>,
    ) => AddTransformConfigToPrimitives<TProjectedRemoteConfig, TRemote>;
};

export type ReactsOnFn<V> = (oldVal: V | undefined, newVal: V) => boolean;
