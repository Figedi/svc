import type { IReloadingStrategy } from "../types";

export const createUpdateStrategyStub = (): IReloadingStrategy => ({
    execute: async () => {},
});
