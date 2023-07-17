export interface IReplicaService {
    runsInK8s(): Promise<boolean>;

    getNeighbourReplicaStatus(): Promise<{
        areNeighboursOlder?: boolean;
        areNeighboursUnhealthy?: boolean;
    }>;
    isOldestReplica(): Promise<boolean>;
}

export interface IReloadingStrategy {
    execute(): Promise<void>;
}

export interface IJsonDecryptor {
    decrypt(json: Record<string, any>): Promise<Record<string, any>>;
}

export const REMOTE_REF_TYPES = {
    STREAMED_REMOTE: 3,
    ONCE_REMOTE: 4,
} as const;
export const REMOTE_REF_SYMBOLS = {
    STREAMED_REMOTE: Symbol.for("@figedi/svc-transform-remote-streamed"),
    ONCE_REMOTE: Symbol.for("@figedi/svc-transform-remote-once"),
} as const;
