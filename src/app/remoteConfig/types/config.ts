import type { IRemoteSource } from "../remoteSource/types";
import type { StreamedRemoteConfigValue, OnceRemoteConfigValue } from "../remoteValues";
import { IReloadingStrategy, REMOTE_REF_SYMBOLS, REMOTE_REF_TYPES } from "./base";
import type { Primitive } from "../../types/base";

export const streamedRemoteRef: StreamedRemoteRefTransformFn<any> = propGetter => ({
    propGetter,
    __type: REMOTE_REF_TYPES.STREAMED_REMOTE,
    __sym: REMOTE_REF_SYMBOLS.STREAMED_REMOTE,
});

export const onceRemoteRef: OnceRemoteRefTransformFn<any> = propGetter => ({
    propGetter,
    __type: REMOTE_REF_TYPES.ONCE_REMOTE,
    __sym: REMOTE_REF_SYMBOLS.ONCE_REMOTE,
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
    __type: typeof REMOTE_REF_TYPES.STREAMED_REMOTE;
    __sym: symbol;
    propGetter?: (config: Config) => ReturnValue;
}

export interface OnceRemoteRefTransformConfig<Config, ReturnValue = string> {
    __type: typeof REMOTE_REF_TYPES.ONCE_REMOTE;
    __sym: symbol;
    propGetter?: (config: Config) => ReturnValue;
}

export type OnceRemoteRefTransformFn<RemoteConfig> = <ReturnValue = string>(
    propGetter?: (config: RemoteConfig) => ReturnValue,
) => OnceRemoteRefTransformConfig<RemoteConfig, ReturnValue>;

export type StreamedRemoteRefTransformFn<RemoteConfig> = <ReturnValue = string>(
    propGetter?: (config: RemoteConfig) => ReturnValue,
) => StreamedRemoteRefTransformConfig<RemoteConfig, ReturnValue>;

type AnyRemoteRefTransformConfig<TConf, TReturn> =
    | StreamedRemoteRefTransformConfig<TConf, TReturn>
    | OnceRemoteRefTransformConfig<TConf, TReturn>;

// typescript does weird things with booleans by converting it to true | false, which then breaks inferrence
export type AddRemoteConfigToPrimitives<C, T> = T extends Primitive | Date
    ? T | AnyRemoteRefTransformConfig<C, T>
    : T extends boolean
    ? boolean | AnyRemoteRefTransformConfig<C, boolean>
    : T extends object // eslint-disable-line @typescript-eslint/ban-types
    ? { [P in keyof T]: AddRemoteConfigToPrimitives<C, T[P]> }
    : T;

export type BaseRemoteConfig<TRemote, TProjectedRemoteConfig> = {
    source: IRemoteSource<TRemote>;
    reloading?: {
        reactsOn: (oldConfig: TRemote | undefined, newConfig: TRemote) => boolean;
        strategy: IReloadingStrategy;
    };
    projections: (
        remoteArgs: RemoteDependencyArgs<TRemote>,
    ) => AddRemoteConfigToPrimitives<TRemote, TProjectedRemoteConfig>;
};

export type ReactsOnFn<V> = (oldVal: V | undefined, newVal: V) => boolean;
