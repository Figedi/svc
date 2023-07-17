import type { KubeConfig, CoreV1Api } from "@kubernetes/client-node";
import { hostname } from "os";
import type { IReplicaService } from "../app/remoteConfig";
import type { Logger } from "../logger";

interface K8sReplicaServiceOpts {
    namespace: string; // the namespace the svc is deployed in, e.g. 'dev'
    commonLabel: string; // a label which is the same for all replicas, e.g. 'subservice'
}

export class K8sReplicaService implements IReplicaService {
    private k8sApi?: CoreV1Api;
    private kubeconfig?: KubeConfig;
    public projectId?: string;
    public serviceAccountPath?: string;

    constructor(private logger: Logger, private opts: K8sReplicaServiceOpts) {
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
        } catch (e) {
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

    private async getModule() {
        if (this.kubeconfig) {
            return;
        }
        // eslint-disable-next-line import/no-extraneous-dependencies
        const mod = await import("@kubernetes/client-node");

        this.kubeconfig = new mod.KubeConfig();
        this.kubeconfig.loadFromDefault();
        if (this.kubeconfig.getCurrentCluster()) {
            this.k8sApi = this.kubeconfig.makeApiClient(mod.CoreV1Api);
        }
    }

    public async runsInK8s(): Promise<boolean> {
        await this.getModule();
        return !!this.k8sApi;
    }

    public async getNeighbourReplicaStatus(): Promise<{
        areNeighboursOlder?: boolean;
        areNeighboursUnhealthy?: boolean;
    }> {
        await this.getModule();
        // todo: return either types
        if (!this.k8sApi) {
            return {};
        }
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
