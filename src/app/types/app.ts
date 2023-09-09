import type { Logger as PinoLogger } from "pino";
import type { Container } from "inversify";
import type { ValidatorSpec, Spec } from "envalid";
import type { ParsedArgs } from "minimist";
import type { Observable } from "rxjs";
import type { Logger } from "../utils/logger.js";
import type { Primitive } from "./base.js";
import type { ArgvParsingParams, AddOptionType } from "./args.js";
import type { IOnceRemoteConfigValue, IStreamedRemoteConfigValue } from "../remoteConfig/remoteValues/types.js";
import type { Ref } from "../remoteConfig/remoteSource/DynamicConfigSource.js";

export enum ErrorHandle {
    IGNORE = "IGNORE",
    DIE = "DIE",
}

export enum ShutdownHandle {
    GRACEFUL = "GRACEFUL",
    FORCE = "FORCE",
}

export interface AppBuilderConfig {
    deferredShutdownHandle: boolean;
    shutdownGracePeriodSeconds: number;
    bindProcessSignals: boolean;
    rootLoggerProperties: Record<string, any>;
    exitAfterRun: boolean;
    loggerFactory: (loggerOptions?: any) => Logger;
}

export interface ExecuteCommandArgs<TArgv extends Record<string, any>> {
    logger: Logger;
    app: AppConfig;
    argv?: TArgv & { $raw: ParsedArgs };
}

export interface ICommandInfo<TArgv extends Record<string, any> = Record<string, any>> {
    name: string;
    usage?: string;
    argv?: (parsingParams: ArgvParsingParams) => AddOptionType<TArgv>;
}

export interface Command<TArgv extends Record<string, any> = Record<string, any>, TResult extends any = any> {
    info: ICommandInfo<TArgv>;

    execute: (args: ExecuteCommandArgs<TArgv>) => TResult | Promise<TResult>;
}

// =================== env stuff / config stuff.. todo: move to correct file

export type DependencyArgs = {
    $env: EnvalidTransformer;
    app: AppConfig;
};

export type EnvFn<Config extends Record<string, any>> = (
    envArgs: DependencyArgs,
) => AddTransformConfigToPrimitives<Config>;

export type EnvalidTransformer = {
    any: EnvTransformFn;
    ref: RefTransformFn;
    str: <T extends string = string>(spec?: Spec<T>) => ValidatorSpec<string>;
    host: <T extends string = string>(spec?: Spec<T>) => ValidatorSpec<string>;
    url: <T extends string = string>(spec?: Spec<T>) => ValidatorSpec<string>;
    bool: <T extends boolean = boolean>(spec?: Spec<T>) => ValidatorSpec<boolean>;
    num: <T extends number = number>(spec?: Spec<T>) => ValidatorSpec<number>;
    port: <T extends number = number>(spec?: Spec<T>) => ValidatorSpec<number>;
    json: <T>(spec?: Spec<T>) => ValidatorSpec<T>;
};

export const REF_TYPES = {
    ENV: 0,
    REF: 1,
    DYNAMIC_ONCE: 3,
    DYNAMIC_STREAMED: 4,
    DYNAMIC_PROMISE: 5,
    DYNAMIC_OBSERVABLE: 6,
} as const;

export const REF_SYMBOLS = {
    ENV: Symbol.for("@figedi/svc-transform-env"),
    REF: Symbol.for("@figedi/svc-transform-ref"),
    DYNAMIC_ONCE: Symbol.for("@figedi/svc-transform-dynamic-once"),
    DYNAMIC_STREAMED: Symbol.for("@figedi/svc-transform-dynamic-streamed"),
    DYNAMIC_PROMISE: Symbol.for("@figedi/svc-transform-dynamic-promise"),
    DYNAMIC_OBSERVABLE: Symbol.for("@figedi/svc-transform-dynamic-observable"),
} as const;

export type EnvTransformFn = <ReturnValue = string>(
    transformFn?: (value: string) => ReturnValue,
    defaultValue?: ReturnValue,
) => EnvTransformConfig<ReturnValue>;

export type RefTransformFn = <ReturnValue = string>(
    referenceValue: string,
    refTransformFn?: (value?: string) => ReturnValue,
) => RefTransformConfig<ReturnValue>;

export type DynamicOnceTransformFn<RemoteConfig> = <ReturnValue = string>(
    propGetter?: (config: RemoteConfig) => ReturnValue,
) => DynamicOnceTransformConfig<RemoteConfig, ReturnValue>;

export type DynamicStreamedTransformFn<RemoteConfig> = <ReturnValue = string>(
    propGetter?: (config: RemoteConfig) => ReturnValue,
) => DynamicStreamedTransformConfig<RemoteConfig, ReturnValue>;

export type DynamicPromiseTransformFn = <ReturnValue = string>(
    propGetter: () => Promise<ReturnValue>,
) => DynamicPromiseTransformConfig<ReturnValue>;

export type DynamicObservableTransformFn = <ReturnValue = string>(
    propGetter: () => Observable<ReturnValue>,
) => DynamicObservableTransformConfig<ReturnValue>;

export interface EnvTransformConfig<ReturnValue = string> {
    __type: typeof REF_TYPES.ENV;
    __sym: symbol;
    transformFn?: (value: string) => ReturnValue;
    defaultValue?: ReturnValue;
}

export interface RefTransformConfig<ReturnValue = string> {
    __type: typeof REF_TYPES.REF;
    __sym: symbol;
    referenceValue: string;
    refTransformFn?: (value?: string) => ReturnValue;
}

export interface DynamicOnceTransformConfig<Config, ReturnValue = string> {
    __type: typeof REF_TYPES.DYNAMIC_ONCE;
    __sym: symbol;
    propGetter?: (config: Config) => ReturnValue;
}

export interface DynamicStreamedTransformConfig<Config, ReturnValue = string> {
    __type: typeof REF_TYPES.DYNAMIC_STREAMED;
    __sym: symbol;
    propGetter?: (config: Config) => ReturnValue;
}
export interface DynamicPromiseTransformConfig<ReturnValue = string> {
    __type: typeof REF_TYPES.DYNAMIC_PROMISE;
    __sym: symbol;
    propGetter: () => Promise<ReturnValue>;
}
export interface DynamicObservableTransformConfig<ReturnValue = string> {
    __type: typeof REF_TYPES.DYNAMIC_OBSERVABLE;
    __sym: symbol;
    propGetter: () => Observable<ReturnValue>;
}

export type UnpackEnvConfig<T> = T extends EnvTransformConfig<infer V> ? V : never;
export type UnpackRefConfig<T> = T extends RefTransformConfig<infer V> ? V : never;
export type UnpackValidatorSpec<T> = T extends ValidatorSpec<infer V> ? V : never;
export type UnpackDynamicOnceConfig<T> = T extends DynamicOnceTransformConfig<infer V, infer K>
    ? IOnceRemoteConfigValue<V, K>
    : never;
export type UnpackDynamicStreamedConfig<T> = T extends DynamicStreamedTransformConfig<infer V, infer K>
    ? IStreamedRemoteConfigValue<V, K>
    : never;
export type UnpackDynamicPromiseConfig<T> = T extends DynamicPromiseTransformConfig<infer K> ? Ref<Promise<K>> : never;
export type UnpackDynamicObservableConfig<T> = T extends DynamicObservableTransformConfig<infer K>
    ? Ref<Observable<K>>
    : never;
// this type tries to unpack the types one by one. If none of the configs match, it returns never
type Unpacked<T> =
    | UnpackRefConfig<T>
    | UnpackEnvConfig<T>
    | UnpackValidatorSpec<T>
    | UnpackDynamicOnceConfig<T>
    | UnpackDynamicStreamedConfig<T>
    | UnpackDynamicPromiseConfig<T>
    | UnpackDynamicObservableConfig<T>;

export type InternalTransform<T, TSchema = any> =
    | EnvTransformConfig<T>
    | RefTransformConfig<T>
    | DynamicOnceTransformConfig<TSchema, T>
    | DynamicStreamedTransformConfig<TSchema, T>
    | DynamicPromiseTransformConfig<T>
    | DynamicObservableTransformConfig<T>;

export type AnyTransformStrict<T, TSchema = any> = InternalTransform<T, TSchema> | ValidatorSpec<T>;
export type AnyTransform<T, TSchema = any> = T | AnyTransformStrict<T, TSchema>;

export const isTransformer = (obj: any): obj is InternalTransform<any> =>
    // eslint-disable-next-line no-underscore-dangle
    !!(obj as InternalTransform<any>)?.__sym &&
    // eslint-disable-next-line no-underscore-dangle
    Object.values(REF_SYMBOLS).some(sym => (obj as InternalTransform<any>)?.__sym === sym);

/**
 * Here's the deal: This automatic  inferrence of generics in ts works only partially
 * if you have multiple generics to be inferred. As a workaround, I chose to structure
 * each transformConfig differently with a number-identifier
 * What does not work:
 * - string literals
 * - enums
 * - symbols
 * What does work
 * - different primitives
 * - number literals
 *
 * As a result, im using magic numbers. Their usage is only limited to this file.
 * It aint stupid if it works.
 * ---
 * This type does the following recursively
 * 1. Check whether the given type is a config.
 * 2. Check config whether it would return never, if so, return the type. This is for hardcoded values, else unpack
 * 3. If it is not a config, but an object, recursively apply 1
 * 4. If it is not  a transformConfig or an object, do nothing (e.g. it might be a primitive)
 */
export type UnpackTransformConfigTypes<T> = T extends AnyTransformStrict<any>
    ? Unpacked<T> extends never
        ? T
        : Unpacked<T>
    : T extends object // eslint-disable-line @typescript-eslint/ban-types
    ? { [K in keyof T]: UnpackTransformConfigTypes<T[K]> }
    : T;

// typescript does weird things with booleans by converting it tu true | false, which then breaks inferrence
export type AddTransformConfigToPrimitives<T, TSchema = any> = T extends Primitive | Date
    ? AnyTransform<T, TSchema>
    : T extends boolean
    ? AnyTransform<boolean, TSchema>
    : T extends object // eslint-disable-line @typescript-eslint/ban-types
    ? { [P in keyof T]: AddTransformConfigToPrimitives<T[P], TSchema> }
    : T;

export type AppConfig = {
    startedAt: Date;
    version?: string;
    envName: string;
};

export interface BaseRegisterFnArgs<Config> {
    config: UnpackTransformConfigTypes<Config>;
    app: AppConfig;
    logger: PinoLogger;
}
export interface DynamicConfigFnArgs<Config> extends BaseRegisterFnArgs<Config> {
    awaited: DynamicPromiseTransformFn;
    streamed: DynamicObservableTransformFn;
}

export interface ResolveRegisterFnArgs<Config> extends BaseRegisterFnArgs<Config> {
    resolve: Container["get"];
}

export interface Provider<T> extends Function {
    (...args: any[]): ((...args1: any[]) => Promise<T>) | Promise<T>;
}
