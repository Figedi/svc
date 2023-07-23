import { filter, concatMap, pairwise, startWith } from "rxjs/operators";
import type { Observable, Subscription } from "rxjs";
import type { ServiceWithLifecycleHandlers } from "../types/service";

export class RemoteConfigHandler<ParentSchema> implements ServiceWithLifecycleHandlers {
    private subscription?: Subscription;
    private output$!: Observable<void>;

    constructor(
        private parentStream: Observable<ParentSchema>,
        private predicateFn: (oldValue: ParentSchema | undefined, newValue: ParentSchema) => boolean,
        private triggerFn: (newValue: ParentSchema) => Promise<void>,
    ) {
        this.init();
    }

    private init(): void {
        // skips the first value being consumed as it should never trigger reloading
        this.output$ = this.parentStream.pipe(
            startWith(undefined),
            pairwise(),
            filter(([oldValue, newValue]) => !!newValue && this.predicateFn(oldValue, newValue!)),
            concatMap(([, newValue]) => this.triggerFn(newValue!)),
        );
    }

    public preflight(): void {
        this.subscription = this.output$.subscribe();
    }

    public shutdown(): void {
        if (this.subscription) {
            this.subscription.unsubscribe();
        }
    }
}
