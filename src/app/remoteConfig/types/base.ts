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
