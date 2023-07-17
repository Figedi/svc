import type { Options } from "minimist-options";

type InferredOptionTypePrimitive<O extends Options> = O extends { default: infer D }
    ? IsRequiredOrHasDefault<O> extends true
        ? InferredOptionTypeInner<O> | Exclude<D, undefined>
        : InferredOptionTypeInner<O> | D
    : IsRequiredOrHasDefault<O> extends true
    ? InferredOptionTypeInner<O>
    : InferredOptionTypeInner<O> | undefined;

// prettier-ignore
type InferredOptionTypeInner<O extends Options > =
O extends { type: "array", choices: ReadonlyArray<infer C> } ? C[] :
O extends { type: "array", string: true } ? string[] :
O extends { type: "array", number: true } ? number[] :
O extends { type: "array", normalize: true } ? string[] :
O extends { array: true, choices: ReadonlyArray<infer C> } ? C[] :
O extends { array: true, type: "string" } ? string[] :
O extends { array: true, type: "number" } ? number[] :
O extends { array: true, string: true } ? string[] :
O extends { array: true, number: true } ? number[] :
O extends { array: true, normalize: true } ? string[] :
O extends { choices: ReadonlyArray<infer C> } ? C :
O extends { type: "array" } ? Array<string | number> :
O extends { type: "boolean" } ? boolean :
O extends { type: "number" } ? number :
O extends { type: "string" } ? string :
O extends { array: true } ? Array<string | number> :
O extends { boolean: true } ? boolean :
O extends { number: true } ? number :
O extends { string: true } ? string :
O extends { normalize: true } ? string :
unknown;

type IsAny<T> = 0 extends 1 & T ? true : false;
type IsUnknown<T> = IsAny<T> extends true ? false : unknown extends T ? true : false;

type IsRequiredOrHasDefault<O extends Options> = O extends
    | { required: string | true }
    | { require: string | true }
    | { demand: string | true }
    | { demandOption: string | true }
    | { default: {} }
    ? true
    : false;

export type InferredOptionType<O extends Options> =
    // Handle special cases first
    O extends { coerce: (arg: any) => infer T }
        ? IsRequiredOrHasDefault<O> extends true
            ? T
            : T | undefined
        : O extends { type: "count"; default: infer D } | { count: true; default: infer D }
        ? number | Exclude<D, undefined>
        : O extends { type: "count" } | { count: true }
        ? number
        : // Try to infer type with InferredOptionTypePrimitive
        IsUnknown<InferredOptionTypePrimitive<O>> extends false
        ? InferredOptionTypePrimitive<O>
        : // Use the type of `default` as the last resort
        O extends { default: infer D }
        ? Exclude<D, undefined>
        : unknown;

export type ArgvParsingParams = {
    $arg: <O extends Options = Options>(opts: O) => InferredOptionType<O>;
};

export type AddOptionType<T> = T extends Options
    ? T | InferredOptionType<T>
    : T extends object // eslint-disable-line @typescript-eslint/ban-types
    ? { [P in keyof T]: AddOptionType<T[P]> }
    : T;
