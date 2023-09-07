import { lastValueFrom, type Observable, type Subscription } from "rxjs";
import { map, take, tap } from "rxjs/operators";
import type { ServiceWithLifecycleHandlers } from "../../types/service.js";
import type { IOnceRemoteConfigValue } from "./types.js";

export class OnceRemoteConfigValue<ParentSchema, Schema = ParentSchema>
    implements ServiceWithLifecycleHandlers, IOnceRemoteConfigValue<ParentSchema, Schema>
{
    private subscription?: Subscription;

    private output$!: Observable<Schema>;
    private lastValue?: Schema;

    constructor(
        private parentStream: Observable<ParentSchema>,
        private projection?: (parent: ParentSchema) => Schema,
    ) {
        this.init();
    }

    private init(): void {
        this.output$ = this.parentStream.pipe(
            take(1),
            map(config => (this.projection ? this.projection(config) : (config as any as Schema))),
            tap(value => {
                this.lastValue = value;
            }),
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

    public async get(): Promise<Schema> {
        if (this.lastValue) {
            return this.lastValue;
        }
        return lastValueFrom(this.output$);
    }
}
