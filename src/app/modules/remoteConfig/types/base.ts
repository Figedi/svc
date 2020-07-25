import { K8sReplicaService } from "../K8sReplicaService";
import { Logger } from "../../../../logger";

export type AppContext = {
    logger: Logger;
    environmentName: string;
    k8s: K8sReplicaService;
};
