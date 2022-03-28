import pino from "pino";
import { Container } from "inversify";
import { ValidatorSpec, Spec } from "envalid";
import { Arguments } from "yargs";

import { Logger } from "../../logger";
import { Primitive } from "./base";
import { ArgvParsingParams, AddOptionType } from "./args";

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

export interface ExecuteCommandArgs<TArgv extends Record<string, any>> {
    logger: Logger;
    app: AppConfig;
    argv?: TArgv & { $raw: Arguments };
}

export interface ICommandInfo<TArgv extends Record<string, any> = Record<string, any>> {
    name: string;
    usage?: string;
    argv?: (parsingParams: ArgvParsingParams) => AddOptionType<TArgv>;
}

export interface Command<TArgv extends Record<string, any> = Record<string, any>> {
    info: ICommandInfo<TArgv>;

    execute: (args: ExecuteCommandArgs<TArgv>) => void | Promise<void>;
}

// =================== env stuff / config stuff.. todo: move to correct file

export type DependencyArgs = {
    $env: EnvalidTransformer;
    app: AppConfig;
};

export type EnvFn<Config extends Record<string, any>> = (
    envArgs: DependencyArgs,
) => AddTransformConfigToPrimitives<Config>;

export type FileTransformFn = <ReturnValue = Buffer>(
    filePath: string | ((env: Omit<DependencyArgs, "$env">) => string),
    fileTransformFn?: (value: Buffer) => ReturnValue,
) => FileTransformConfig<ReturnValue>;

export type EnvalidTransformer = {
    any: EnvTransformFn;
    ref: RefTransformFn;
    file: FileTransformFn;
    str: <T extends string = string>(spec?: Spec<T>) => ValidatorSpec<string>;
    host: <T extends string = string>(spec?: Spec<T>) => ValidatorSpec<string>;
    url: <T extends string = string>(spec?: Spec<T>) => ValidatorSpec<string>;
    bool: <T extends boolean = boolean>(spec?: Spec<T>) => ValidatorSpec<boolean>;
    num: <T extends number = number>(spec?: Spec<T>) => ValidatorSpec<number>;
    port: <T extends number = number>(spec?: Spec<T>) => ValidatorSpec<number>;
    json: <T>(spec?: Spec<T>) => ValidatorSpec<T>;
};

export type EnvTransformFn = <ReturnValue = string>(
    transformFn?: (value: string) => ReturnValue,
    defaultValue?: ReturnValue,
) => EnvTransformConfig<ReturnValue>;

export type RefTransformFn = <ReturnValue = string>(
    referenceValue: string,
    refTransformFn?: (value?: string) => ReturnValue,
) => RefTransformConfig<ReturnValue>;

export interface EnvTransformConfig<ReturnValue = string> {
    __type: 0;
    transformFn?: (value: string) => ReturnValue;
    defaultValue?: ReturnValue;
}

export interface RefTransformConfig<ReturnValue = string> {
    __type: 2;
    referenceValue: string;
    refTransformFn?: (value?: string) => ReturnValue;
}

export interface FileTransformConfig<ReturnValue = Buffer> {
    __type: 3;
    filePath: string | ((env: Omit<DependencyArgs, "$env">) => string);
    fileTransformFn?: (fileBuffer: Buffer) => ReturnValue;
}

export type UnpackEnvConfig<T> = T extends EnvTransformConfig<infer V> ? V : never;
export type UnpackRefConfig<T> = T extends RefTransformConfig<infer V> ? V : never;
export type UnpackFileConfig<T> = T extends FileTransformConfig<infer V> ? V : never;
export type UnpackValidatorSpec<T> = T extends ValidatorSpec<infer V> ? V : never;

// this type tries to unpack the types one by one. If none of the configs match, it returns never
export type Unpacked<T> = UnpackRefConfig<T> | UnpackEnvConfig<T> | UnpackFileConfig<T> | UnpackValidatorSpec<T>;

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
    | EnvTransformConfig<any>
    | RefTransformConfig<any>
    | FileTransformConfig<any>
    | ValidatorSpec<any>
    ? Unpacked<T> extends never
        ? T
        : Unpacked<T>
    : T extends object // eslint-disable-line @typescript-eslint/ban-types
    ? { [K in keyof T]: UnpackTransformConfigTypes<T[K]> }
    : T;

// typescript does weird things with booleans by converting it tu true | false, which then breaks inferrence
export type AddTransformConfigToPrimitives<T> = T extends Primitive | Date
    ? T | EnvTransformConfig<T> | RefTransformConfig<T> | FileTransformConfig<T> | ValidatorSpec<T>
    : T extends boolean
    ?
          | boolean
          | EnvTransformConfig<boolean>
          | RefTransformConfig<boolean>
          | FileTransformConfig<boolean>
          | ValidatorSpec<boolean>
    : T extends object // eslint-disable-line @typescript-eslint/ban-types
    ? { [P in keyof T]: AddTransformConfigToPrimitives<T[P]> }
    : T;

export type AppConfig = {
    startedAt: Date;
    rootPath: string;
    packageJson: Record<string, any>;
    version: string;
    envName: string;
};

export interface BaseRegisterFnArgs<Config> {
    config: UnpackTransformConfigTypes<Config>;
    app: AppConfig;
    logger: pino.Logger;
}

export interface ResolveRegisterFnArgs<Config> extends BaseRegisterFnArgs<Config> {
    resolve: Container["get"];
}

export interface Provider<T> extends Function {
    (...args: any[]): ((...args1: any[]) => Promise<T>) | Promise<T>;
}
