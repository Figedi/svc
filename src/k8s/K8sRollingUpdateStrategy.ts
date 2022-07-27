import { IReloadingStrategy, IReplicaService } from "../app/remoteConfig";
import { ServiceWithLifecycleHandlers } from "../app/types";
import { sleep } from "../app/utils";
import { Logger } from "../logger";

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
export class K8sRollingUpdateStrategy implements IReloadingStrategy, ServiceWithLifecycleHandlers {
    private static RESTART_SLEEP_TIME_RANGE_MS = 10000;

    constructor(private replicaService: IReplicaService, private logger: Logger) {}

    public preflight(): void {
        if (!this.replicaService || !this.logger) {
            throw new Error(`Preflight called before setContext(). This should never happen`);
        }
    }

    private async tryRestart(): Promise<void> {
        if (!(await this.replicaService.runsInK8s())) {
            this.logger.warn(`Received a restart-signal while not being in k8s, exiting...`);
            return;
        }
        const { areNeighboursOlder, areNeighboursUnhealthy } = await this.replicaService.getNeighbourReplicaStatus();

        if (areNeighboursOlder || areNeighboursUnhealthy) {
            this.logger.debug(
                { areNeighboursOlder, areNeighboursUnhealthy },
                `Waiting for restart until next leader is ready`,
            );

            await sleep(1000);
            setImmediate(() => this.tryRestart());
        } else {
            await sleep(Math.random() * K8sRollingUpdateStrategy.RESTART_SLEEP_TIME_RANGE_MS);
            this.logger.info(`Restarting service due to config-changes NOW`);
            process.exit(0);
        }
    }

    public execute = async (): Promise<void> => {
        this.logger.info(`Detected config-change. Will try to restart with respect of neighbouring pods`);
        return this.tryRestart();
    };
}
