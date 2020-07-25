import pino from "pino";
import { Container } from "inversify";

import { Logger } from "../../logger";
import { Maybe, Primitive } from "./base";

export enum ErrorHandle {
    IGNORE = "IGNORE",
    DIE = "DIE",
}

export enum ShutdownHandle {
    GRACEFUL = "GRACEFUL",
    FORCE = "FORCE",
}

export interface AppBuilderConfig {
    shutdownGracePeriodSeconds: number;
    bindProcessSignals: boolean;
    rootLoggerProperties: Record<string, any>;
    loggerFactory: (loggerOptions?: any) => Logger;
}

export interface ExecuteCommandArgs {
    logger: Logger;
    app: AppConfig;
    cliArgs: Record<string, any>;
}

export interface Command {
    info: {
        name: string;
        usage?: string;
        argv?: string[];
    };
    execute: (args: ExecuteCommandArgs) => void | Promise<void>;
}

// =================== env stuff / config stuff.. todo: move to correct file

export type DepdencyArgs = {
    env: EnvTransformFn;
    optEnv: OptEnvTransformFn;
    ref: RefTransformFn;
    app: AppConfig;
};

export type EnvFn<Config extends Record<string, any>> = (
    envArgs: DepdencyArgs,
) => AddTransformConfigToPrimitives<Config>;

export type EnvTransformFn = <ReturnValue = string>(
    transformFn?: (value: string) => ReturnValue,
    defaultValue?: ReturnValue,
) => EnvTransformConfig<ReturnValue>;

export type OptEnvTransformFn = <ReturnValue = string>(
    optTransformFn?: (value?: string) => ReturnValue,
) => OptEnvTransformConfig<ReturnValue>;

export type RefTransformFn = <ReturnValue = string>(
    referenceValue: string,
    refTransformFn?: (value?: string) => ReturnValue,
) => RefTransformConfig<ReturnValue>;

export interface EnvTransformConfig<ReturnValue = string> {
    __type: 0;
    transformFn?: (value: string) => ReturnValue;
    defaultValue?: ReturnValue;
}

export interface OptEnvTransformConfig<ReturnValue = string> {
    __type: 1;
    optTransformFn?: (value?: string) => ReturnValue;
}

export interface RefTransformConfig<ReturnValue = string> {
    __type: 2;
    referenceValue: string;
    refTransformFn?: (value?: string) => ReturnValue;
}

export type UnpackOptionalConfig<T> = T extends OptEnvTransformConfig<infer V> ? Maybe<V> : never;
export type UnpackEnvConfig<T> = T extends EnvTransformConfig<infer V> ? V : never;
export type UnpackRefConfig<T> = T extends RefTransformConfig<infer V> ? V : never;

// this type tries to unpack the types one by one. If none of the configs match, it returns never
export type Unpacked<T> = UnpackRefConfig<T> | UnpackOptionalConfig<T> | UnpackEnvConfig<T>;

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
export type UnpackTransformConfigTypes<T> = T extends
    | OptEnvTransformConfig<any>
    | EnvTransformConfig<any>
    | RefTransformConfig<any>
    ? Unpacked<T> extends never
        ? T
        : Unpacked<T>
    : T extends object // eslint-disable-line @typescript-eslint/ban-types
    ? { [K in keyof T]: UnpackTransformConfigTypes<T[K]> }
    : T;

// typescript does weird things with booleans by converting it tu true | false, which then breaks inferrence
export type AddTransformConfigToPrimitives<T> = T extends Primitive | Date
    ? T | EnvTransformConfig<T> | OptEnvTransformConfig<T> | RefTransformConfig<T>
    : T extends boolean
    ? boolean | EnvTransformConfig<boolean> | OptEnvTransformConfig<boolean> | RefTransformConfig<boolean>
    : T extends object // eslint-disable-line @typescript-eslint/ban-types
    ? { [P in keyof T]: AddTransformConfigToPrimitives<T[P]> }
    : T;

export type AppConfig = {
    startedAt: Date;
    rootPath: string;
    packageJson: Record<string, any>;
    version: string;
};

export interface BaseRegisterFnArgs<Config> {
    resolve: Container["get"];
    config: UnpackTransformConfigTypes<Config>;
    app: AppConfig;
    logger: pino.Logger;
}

export interface Provider<T> extends Function {
    (...args: any[]): ((...args: any[]) => Promise<T>) | Promise<T>;
}
