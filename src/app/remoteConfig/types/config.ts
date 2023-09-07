import type { DynamicOnceTransformFn, DynamicStreamedTransformFn } from "../../types/index.js";

export type RemoteDependencyArgs<RemoteConfig> = {
    streamed: DynamicStreamedTransformFn<RemoteConfig>;
    once: DynamicOnceTransformFn<RemoteConfig>;
};

export type ReactsOnFn<V> = (oldVal: V | undefined, newVal: V) => boolean;
