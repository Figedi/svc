import { kebabCase, set, isArray, isObjectLike, mapValues } from "lodash-es";

export interface TreeNodeTransformerConfig {
    predicate: (refValue: any, path: (string | number)[]) => boolean;
    transform: (refValue: any, path: (string | number)[]) => any;
}

const walk = (tree: any, pathMemo: (string | number)[], ...transformers: TreeNodeTransformerConfig[]): any => {
    const transformer = transformers.find(({ predicate }) => predicate(tree, pathMemo));
    if (transformer) {
        return transformer.transform(tree, pathMemo);
    }
    if (isArray(tree)) {
        return tree.map((v, i) => walk(v, [...pathMemo, i], ...transformers));
    }
    if (isObjectLike(tree)) {
        return mapValues(tree, (v, k) => walk(v, [...pathMemo, k], ...transformers));
    }

    return tree;
};

export const reduceTree = <TOutput>(
    tree: Record<string, any>,
    predicate: (v: any) => boolean,
    transformer: (v: any, k: string[]) => any = (v, k) => ({ [k.map(kebabCase).join("-")]: v }),
    pathMemo: string[] = [],
): TOutput =>
    Object.entries(tree).reduce((acc, [k, v]) => {
        const keys = [...pathMemo, k];
        const predFullfilled = predicate(v);
        if (isArray(v)) {
            // ignore arrays for now
            return acc;
        }
        if (isObjectLike(v) && !predFullfilled) {
            const subtree = reduceTree(v, predicate, transformer, keys) as any;
            return { ...acc, ...subtree };
        }

        if (!predFullfilled) {
            return acc;
        }
        return { ...acc, ...transformer(v, keys) };
    }, [] as TOutput);

export const remapTree = (tree: any, ...transformers: TreeNodeTransformerConfig[]): any =>
    walk(tree, [], ...transformers);

export const remapTreeAsync = async (
    tree: any,
    predicate: (refValue: any, path: (string | number)[]) => boolean,
    transform: (refValue: any, path: (string | number)[]) => Promise<{ path: (string | number)[]; value: any }>,
): Promise<any> => {
    const pathValues: any[] = [];
    walk(tree, [], {
        predicate,
        transform: (refValue, path) => {
            pathValues.push({ refValue, path });
        },
    });

    const transformedValues = await Promise.all(
        pathValues.map(async ({ refValue, path }) => {
            const { path: nextPath, value } = await transform(refValue, path);
            return {
                path: nextPath,
                transformedRefValue: value,
            };
        }),
    );

    return transformedValues.reduce((acc, { path, transformedRefValue }) => set(acc, path, transformedRefValue), tree);
};
