import { InferredOptionType, Options } from "yargs";

export type ArgvParsingParams = {
    $arg: <O extends Options = Options>(opts: O) => InferredOptionType<O>;
};

export type AddOptionType<T> = T extends Options
    ? T | InferredOptionType<T>
    : T extends object // eslint-disable-line @typescript-eslint/ban-types
    ? { [P in keyof T]: AddOptionType<T[P]> }
    : T;
