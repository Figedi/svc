import type { ServiceWithLifecycleHandlers } from "../types";

export const serviceWithPreflightOrShutdown = (svc: any): svc is ServiceWithLifecycleHandlers =>
    "preflight" in svc || "shutdown" in svc;
