import { IRemoteSource } from "../remoteSource/types";
import { StreamedRemoteConfigValue, OnceRemoteConfigValue } from "../remoteValues";
import { IReloadingStrategy } from "./base";
import { Primitive } from "../../types/base";
import { BaseRegisterFnArgs } from "../../types";

export const streamedRemoteRef: StreamedRemoteRefTransformFn<any> = propGetter => ({
    propGetter,
    __type: 3,
});

export const onceRemoteRef: OnceRemoteRefTransformFn<any> = propGetter => ({
    propGetter,
    __type: 4,
});

export type UnpackRemoteConfigTypes<T> = T extends
    | StreamedRemoteRefTransformConfig<any, any>
    | OnceRemoteRefTransformConfig<any, any>
    ? RemoteUnpacked<T> extends never
        ? T
        : RemoteUnpacked<T>
    : T extends object // eslint-disable-line @typescript-eslint/ban-types
    ? { [K in keyof T]: UnpackRemoteConfigTypes<T[K]> }
    : T;

export type UnpackOnceRemoteRefConfig<T> = T extends OnceRemoteRefTransformConfig<infer V, infer K>
    ? OnceRemoteConfigValue<V, K>
    : never;
export type UnpackStreamedRemoteRefConfig<T> = T extends StreamedRemoteRefTransformConfig<infer V, infer K>
    ? StreamedRemoteConfigValue<V, K>
    : never;

export type RemoteUnpacked<T> = UnpackOnceRemoteRefConfig<T> | UnpackStreamedRemoteRefConfig<T>;

export type RemoteDependencyArgs<RemoteConfig> = {
    streamed: StreamedRemoteRefTransformFn<RemoteConfig>;
    once: OnceRemoteRefTransformFn<RemoteConfig>;
};

export interface StreamedRemoteRefTransformConfig<Config, ReturnValue = string> {
    __type: 3;
    propGetter?: (config: Config) => ReturnValue;
}

export interface OnceRemoteRefTransformConfig<Config, ReturnValue = string> {
    __type: 4;
    propGetter?: (config: Config) => ReturnValue;
}

export type OnceRemoteRefTransformFn<RemoteConfig> = <ReturnValue = string>(
    propGetter?: (config: RemoteConfig) => ReturnValue,
) => OnceRemoteRefTransformConfig<RemoteConfig, ReturnValue>;

export type StreamedRemoteRefTransformFn<RemoteConfig> = <ReturnValue = string>(
    propGetter?: (config: RemoteConfig) => ReturnValue,
) => StreamedRemoteRefTransformConfig<RemoteConfig, ReturnValue>;

// typescript does weird things with booleans by converting it to true | false, which then breaks inferrence
export type AddRemoteConfigToPrimitives<C, T> = T extends Primitive | Date
    ? T | OnceRemoteRefTransformConfig<C, T> | StreamedRemoteRefTransformConfig<T>
    : T extends boolean
    ? boolean | OnceRemoteRefTransformConfig<C, boolean> | StreamedRemoteRefTransformConfig<C, boolean>
    : T extends object // eslint-disable-line @typescript-eslint/ban-types
    ? { [P in keyof T]: AddRemoteConfigToPrimitives<C, T[P]> }
    : T;

export type RemoteConfigFn<RemoteConfig, Config, ProjectedRemoteConfig> = (
    envArgs: BaseRegisterFnArgs<Config>,
) => {
    source: IRemoteSource<RemoteConfig>;
    reloading?: {
        reactsOn: (oldConfig: RemoteConfig | undefined, newConfig: RemoteConfig) => boolean;
        strategy: IReloadingStrategy;
    };
    projections?: (
        remoteArgs: RemoteDependencyArgs<RemoteConfig>,
    ) => AddRemoteConfigToPrimitives<RemoteConfig, ProjectedRemoteConfig>;
};

export type ReactsOnFn<V> = (oldVal: V | undefined, newVal: V) => boolean;
