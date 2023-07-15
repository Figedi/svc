export type Maybe<T> = T | undefined;
export type Primitive = string | number | bigint | symbol | null | undefined;

// deep merges two objects. If U extends S, it doesnt recurse further
export type DeepMerge<T, U, S = never> = T extends S
    ? U
    : U extends S
    ? U
    : T extends object
    ? U extends object
        ? {
              [K in keyof (T & U)]: K extends keyof U
                  ? K extends keyof T
                      ? DeepMerge<T[K], U[K], S>
                      : U[K]
                  : K extends keyof T
                  ? T[K]
                  : never;
          }
        : U
    : U;
