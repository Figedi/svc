import type { IReplicaService } from "./types/index.js";
import type { Logger } from "../../logger/index.js";

export class BaseReplicaService implements IReplicaService {
    public async runsInK8s(): Promise<boolean> {
        return false;
    }

    public async getNeighbourReplicaStatus(): Promise<{
        areNeighboursOlder?: boolean;
        areNeighboursUnhealthy?: boolean;
    }> {
        return { areNeighboursOlder: false, areNeighboursUnhealthy: false };
    }

    public async isOldestReplica(): Promise<boolean> {
        return true;
    }
}

export class ReplicaServiceFactory {
    static async create(logger: Logger, opts: Record<string, any>): Promise<IReplicaService> {
        const runsInK8s = !!process.env.KUBERNETES_SERVICE_HOST;
        if (runsInK8s) {
            const mod = await import("../../k8s/K8sReplicaService.js");
            return new mod.K8sReplicaService(logger, opts as any);
        }
        return new BaseReplicaService();
    }
}
