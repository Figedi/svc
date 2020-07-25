import { ServiceWithLifecycleHandlers } from "../../types/service";
import { K8sReplicaService } from "./K8sReplicaService";
import { Logger } from "../../../logger";
import { AppContext } from "./types/base";
import { sleep } from "../../utils";

export interface K8sReloadingStrategy {
    execute(): Promise<void>;
    setContext(context: AppContext): void;
}

/**
 * Reloading-strategy to gracefully restart a pod with neighbouring replicas.
 * This emulates a rollingUpdate from K8s by inspecting other replicas about
 * their state.
 *
 * A given pod may only restart if:
 * - its the oldest pod (determined by the startTime)
 * - other replicas are healthy
 *
 * @todo if in shutdown-mode, the service should stop accepting http requests (through readiness probes)
 */
export class KubernetesRollingUpdateStrategy implements K8sReloadingStrategy, ServiceWithLifecycleHandlers {
    private static RESTART_SLEEP_TIME_RANGE_MS = 10000;
    private k8sReplicaService!: K8sReplicaService;
    private logger!: Logger;

    public setContext({ logger, k8s }: AppContext): void {
        this.logger = logger;
        this.k8sReplicaService = k8s;
    }

    public preflight(): void {
        if (!this.k8sReplicaService || !this.logger) {
            throw new Error(`Preflight called before setContext(). This should never happen`);
        }
    }

    private async tryRestart(): Promise<void> {
        if (!this.k8sReplicaService.isInK8s) {
            this.logger.warn(`Received a restart-signal while not being in k8s, exiting...`);
            return;
        }
        const { areNeighboursOlder, areNeighboursUnhealthy } = await this.k8sReplicaService.getNeighbourReplicaStatus();

        if (areNeighboursOlder || areNeighboursUnhealthy) {
            this.logger.debug(
                { areNeighboursOlder, areNeighboursUnhealthy },
                `Waiting for restart until next leader is ready`,
            );

            await sleep(1000);
            setImmediate(() => this.tryRestart());
        } else {
            await sleep(Math.random() * KubernetesRollingUpdateStrategy.RESTART_SLEEP_TIME_RANGE_MS);
            this.logger.info(`Restarting service due to config-changes NOW`);
            process.exit(0);
        }
    }

    public execute = async (): Promise<void> => {
        this.logger.info(`Detected config-change. Will try to restart with respect of neighbouring pods`);
        return this.tryRestart();
    };
}
