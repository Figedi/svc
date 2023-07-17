import { Observable, Subscription } from "rxjs";
import { map } from "rxjs/operators";
import type { ServiceWithLifecycleHandlers } from "../../types/service";

export class StreamedRemoteConfigValue<ParentSchema, Schema = ParentSchema> implements ServiceWithLifecycleHandlers {
    private subscription?: Subscription;

    private output$!: Observable<Schema>;

    constructor(private parentStream: Observable<ParentSchema>, private projection?: (parent: ParentSchema) => Schema) {
        this.init();
    }

    private init(): void {
        this.output$ = this.parentStream.pipe(
            map(config => (this.projection ? this.projection(config) : (config as any as Schema))),
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

    public stream(): Observable<Schema> {
        return this.output$;
    }
}
