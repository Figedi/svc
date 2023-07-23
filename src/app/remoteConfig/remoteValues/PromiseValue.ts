export class PromiseValue<TReturn> {
    constructor(private factory: () => Promise<TReturn>) {}

    public get(): Promise<TReturn> {
        return this.factory();
    }
}
