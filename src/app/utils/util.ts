export const safeReadFile = async (filePath: string): Promise<Buffer> => {
    if ((globalThis as any).EdgeRuntime) {
        // @todo implement
        return Buffer.from("");
    }

    return import("fs/promises").then(mod => mod.readFile(filePath));
};
