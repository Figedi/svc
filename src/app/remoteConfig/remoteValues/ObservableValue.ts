import type { Observable } from "rxjs";

export class ObservableValue<TReturn> {
    constructor(private factory: () => Observable<TReturn>) {}

    public stream(): Observable<TReturn> {
        return this.factory();
    }
}
