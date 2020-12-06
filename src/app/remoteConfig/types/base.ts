export interface IReplicaService {
    runsInCloud: boolean;

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
