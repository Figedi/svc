import { join } from "node:path";
import { IReplicaService } from "./types";
import { Logger } from "../../logger";

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
    static create(logger: Logger, opts: Record<string, any>): IReplicaService {
        const runsInK8s = !!process.env.KUBERNETES_SERVICE_HOST;
        if (runsInK8s) {
            // eslint-disable-next-line import/no-dynamic-require
            return require(join(__dirname, "../../k8s/K8sReplicaService")).K8sReplicaService(logger, opts);
        }
        return new BaseReplicaService();
    }
}
