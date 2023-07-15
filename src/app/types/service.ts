export interface ServiceWithLifecycleHandlers {
    preflight?: () => void | Promise<void>;
    shutdown?: () => void | Promise<void>;
}
