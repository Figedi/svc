import type {
    BooleanArrayOption,
    BooleanOption,
    DefaultArrayOption,
    MinimistOption,
    NumberArrayOption,
    NumberOption,
    OptionType,
    StringArrayOption,
    StringOption,
} from "minimist-options";

export type AllOptions = (
    | OptionType
    | StringOption
    | BooleanOption
    | NumberOption
    | DefaultArrayOption
    | StringArrayOption
    | BooleanArrayOption
    | NumberArrayOption
    // Workaround for https://github.com/microsoft/TypeScript/issues/17867
    | MinimistOption
) & { required?: boolean };

type InferredOptionTypePrimitive<O extends AllOptions> = O extends { default: infer D }
    ? IsRequiredOrHasDefault<O> extends true
        ? InferredOptionTypeInner<O> | Exclude<D, undefined>
        : InferredOptionTypeInner<O> | D
    : IsRequiredOrHasDefault<O> extends true
    ? InferredOptionTypeInner<O>
    : InferredOptionTypeInner<O> | undefined;

// @todo align types ()
// prettier-ignore
type InferredOptionTypeInner<O extends AllOptions > =
O extends { type: "array", string: true } ? string[] :
O extends { type: "array", number: true } ? number[] :
O extends { type: "array", normalize: true } ? string[] :
O extends { type: "array" } ? Array<string | number> :
O extends { type: "boolean" } ? boolean :
O extends { type: "number" } ? number :
O extends { type: "string" } ? string :
unknown;

type IsAny<T> = 0 extends 1 & T ? true : false;
type IsUnknown<T> = IsAny<T> extends true ? false : unknown extends T ? true : false;

type IsRequiredOrHasDefault<O extends AllOptions> = O extends { required: true } ? true : false;

// @todo there is only type, alias, default, not required, thus everything is optional, aaaaaaaaarg
export type InferredOptionType<O extends AllOptions> =
    // Handle special cases first

    IsUnknown<InferredOptionTypePrimitive<O>> extends false
        ? InferredOptionTypePrimitive<O>
        : // Use the type of `default` as the last resort
        O extends { default: infer D }
        ? Exclude<D, undefined>
        : unknown;

export type ArgvParsingParams = {
    $arg: <O extends AllOptions = AllOptions>(opts: O) => InferredOptionType<O>;
};

export type AddOptionType<T> = T extends AllOptions
    ? T | InferredOptionType<T>
    : T extends object // eslint-disable-line @typescript-eslint/ban-types
    ? { [P in keyof T]: AddOptionType<T[P]> }
    : T;
