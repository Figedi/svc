import type { IReloadingStrategy } from "../types/index.js";

export const createUpdateStrategyStub = (): IReloadingStrategy => ({
    execute: async () => {},
});
