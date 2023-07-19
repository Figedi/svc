import type { Observable } from "rxjs";

export interface IOnceRemoteConfigValue<ParentSchema, Schema = ParentSchema> {
    get(): Promise<Schema>;
}
export interface IStreamedRemoteConfigValue<ParentSchema, Schema = ParentSchema> {
    stream(): Observable<Schema>;
}
