export const isNode = typeof process !== "undefined" && process.versions != null && process.versions.node != null;

const getFirstPartFromNodeModules = (resolved: string): string | null => {
    if (resolved.indexOf("/node_modules") !== -1) {
        const parts = resolved.split("/node_modules");
        if (parts.length) {
            return parts[0];
        }
    }

    return null;
};

// stolen from https://github.com/gulpjs/path-dirname/blob/master/index.js
const pathDirname = (path: string) => {
    if (path.length === 0) return ".";
    let code = path.charCodeAt(0);
    const hasRoot = code === 47;
    let end = -1;
    let matchedSlash = true;
    // eslint-disable-next-line no-plusplus
    for (let i = path.length - 1; i >= 1; --i) {
        code = path.charCodeAt(i);
        if (code === 47) {
            if (!matchedSlash) {
                end = i;
                break;
            }
        } else {
            // We saw the first non-path separator
            matchedSlash = false;
        }
    }

    if (end === -1) return hasRoot ? "/" : ".";
    if (hasRoot && end === 1) return "//";
    return path.slice(0, end);
};

// stolen and simplified to live without path-module from https://github.com/inxilpro/node-app-root-path/blob/master/lib/resolve.js
export const getRootDir = (): string => {
    const resolved = __dirname;

    let rootPath = getFirstPartFromNodeModules(resolved);

    if (!rootPath && require.main) {
        rootPath = pathDirname(require.main.filename);
    } else {
        rootPath = pathDirname(process.argv[1]);
    }

    return rootPath!;
};
