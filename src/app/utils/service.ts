import type { ServiceWithLifecycleHandlers } from "../types/index.js";

export const serviceWithPreflightOrShutdown = (svc: any): svc is ServiceWithLifecycleHandlers =>
    "preflight" in svc || "shutdown" in svc;
