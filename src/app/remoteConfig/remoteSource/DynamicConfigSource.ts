import type { Observable, Subscription } from "rxjs";
import {
    type DynamicObservableTransformConfig,
    type DynamicPromiseTransformConfig,
    type ServiceWithLifecycleHandlers,
    REF_TYPES,
} from "../../types";
import { remapTree } from "../../utils";

export class Ref<T> {
    private value: T;

    constructor(private factory: () => T) {}

    public init(): void {
        this.value = this.factory();
    }

    public get(): T {
        return this.value;
    }
}

export class DynamicConfigSource<TConfig> implements ServiceWithLifecycleHandlers {
    private promiseRefs: Ref<Promise<any>>[] = [];
    private observableRefs: Ref<Observable<any>>[] = [];

    private subscriptions: Subscription[] = [];

    constructor(private config: TConfig) {}

    public init(): TConfig {
        const projectedRemoteConfig = remapTree(
            this.config,
            {
                // eslint-disable-next-line no-underscore-dangle
                predicate: value => !!value && value.__type === REF_TYPES.DYNAMIC_PROMISE,
                transform: ({ propGetter }: DynamicPromiseTransformConfig) => {
                    const ref = new Ref(propGetter);
                    this.promiseRefs.push(ref);

                    return ref;
                },
            },
            {
                // eslint-disable-next-line no-underscore-dangle
                predicate: value => !!value && value.__type === REF_TYPES.DYNAMIC_OBSERVABLE,
                transform: ({ propGetter }: DynamicObservableTransformConfig) => {
                    const ref = new Ref(propGetter);
                    this.observableRefs.push(ref);

                    return ref;
                },
            },
        );

        return projectedRemoteConfig;
    }

    public preflight(): void {
        this.subscriptions = this.observableRefs.reduce((acc, ref) => {
            ref.init();
            return [...acc, ref.get().subscribe()];
        }, []);
        this.promiseRefs.forEach(r => r.init());
    }

    public shutdown(): void {
        this.subscriptions.forEach(sub => sub.unsubscribe());
    }
}
