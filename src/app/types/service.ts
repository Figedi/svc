export interface ServiceWithLifecycleHandlers {
    preflight?: () => void | Promise<void>;
    shutdown?: () => void | Promise<void>;
}

export const serviceWithPreflightOrShutdown = (svc: any): svc is ServiceWithLifecycleHandlers =>
    "preflight" in svc || "shutdown" in svc;
