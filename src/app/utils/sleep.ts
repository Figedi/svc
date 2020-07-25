export const sleep = (timeMs: number, unref?: boolean): Promise<void> =>
    new Promise(resolve => {
        const timeout = setTimeout(resolve, timeMs);
        if (unref) {
            (timeout as any).unref();
        }
    });
