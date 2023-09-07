import type { KubeConfig, CoreV1Api } from "@kubernetes/client-node";
import { hostname } from "node:os";
import type { IReplicaService } from "../app/remoteConfig/index.js";
import type { Logger } from "../logger/index.js";

interface K8sReplicaServiceOpts {
    namespace: string; // the namespace the svc is deployed in, e.g. 'dev'
    commonLabel: string; // a label which is the same for all replicas, e.g. 'subservice'
    k8sApi: CoreV1Api;
    k8sConfig: KubeConfig;
}

export class K8sReplicaService implements IReplicaService {
    private k8sApi!: CoreV1Api;
    private k8sConfig!: KubeConfig;
    public projectId?: string;
    public serviceAccountPath?: string;

    constructor(
        private logger: Logger,
        private opts: K8sReplicaServiceOpts,
    ) {
        this.k8sApi = opts.k8sApi;
        this.k8sConfig = opts.k8sConfig;
        this.init();
    }

    private inferProjectId(): string | undefined {
        if (process.env.GCLOUD_PROJECT_ID) {
            return process.env.GCLOUD_PROJECT_ID;
        }
        if (!process.env.KUBERNETES_SERVICE_ACCOUNT_PATH) {
            return undefined;
        }
        try {
            // eslint-disable-next-line import/no-dynamic-require
            return require(process.env.KUBERNETES_SERVICE_ACCOUNT_PATH).project_id;
        } catch (e: any) {
            this.logger.error({ error: e }, `Error while inferring projectId from serviceAccount: ${e.message}`);
            return undefined;
        }
    }

    private inferServiceAccountPath(): string | undefined {
        return process.env.KUBERNETES_SERVICE_ACCOUNT_PATH;
    }

    private init() {
        this.serviceAccountPath = this.inferServiceAccountPath();
        this.projectId = this.inferProjectId();
    }

    public async runsInK8s(): Promise<boolean> {
        return !!this.k8sConfig.getCurrentCluster();
    }

    public async getNeighbourReplicaStatus(): Promise<{
        areNeighboursOlder?: boolean;
        areNeighboursUnhealthy?: boolean;
    }> {
        const podList = await this.k8sApi.listNamespacedPod({ namespace: this.opts.namespace });

        const selfName = hostname();

        const [ownPod] = podList.items.filter(item => item.metadata && item.metadata.name === selfName);
        if (!ownPod) {
            return {};
        }
        const ownCommonLabelValue = ownPod.metadata?.labels?.[this.opts.commonLabel];
        if (!ownCommonLabelValue) {
            this.logger.warn(`Did not find label '${this.opts.commonLabel}' in pod-description, refusing to restart`);
            return {};
        }
        const neighbouringPods = podList.items.filter(
            item =>
                item.metadata?.name !== selfName &&
                item.metadata?.labels?.[this.opts.commonLabel] === ownCommonLabelValue &&
                !!item.status?.startTime,
        );

        const startTime = ownPod.status?.startTime;

        if (!startTime) {
            this.logger.warn(`No startTime found in pod-status, refusing to restart`);
            return {};
        }
        const areNeighboursOlder = neighbouringPods.some(pod => pod.status!.startTime! < startTime);
        const areNeighboursUnhealthy = neighbouringPods.some(pod => pod.status?.phase !== "Running");
        return {
            areNeighboursOlder,
            areNeighboursUnhealthy,
        };
    }

    public async isOldestReplica(): Promise<boolean> {
        const { areNeighboursOlder } = await this.getNeighbourReplicaStatus();
        return !areNeighboursOlder;
    }
}
