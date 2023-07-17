import { share } from "rxjs/operators";
import {
    BaseRemoteConfig,
    OnceRemoteRefTransformConfig,
    StreamedRemoteRefTransformConfig,
    onceRemoteRef,
    streamedRemoteRef,
    REMOTE_REF_TYPES,
} from "./types";
import { RemoteConfigHandler } from "./RemoteConfigHandler";
import { remapTree, serviceWithPreflightOrShutdown } from "../utils";
import { StreamedRemoteConfigValue, OnceRemoteConfigValue } from "./remoteValues";

export type IBuildRemoteConfigParams<TRemoteConfig, TProjectedRemoteConfig> = (
    remoteConfig: BaseRemoteConfig<TRemoteConfig, TProjectedRemoteConfig>,
) => TRemoteConfigFactoryResult<TProjectedRemoteConfig>;

export type TRemoteConfigFactoryResult<TProjectedRemoteConfig> = {
    lifecycleArtefacts: any[];
    remoteConfig: TProjectedRemoteConfig;
};
export const remoteConfigFactory = <TRemoteConfig, TProjectedRemoteConfig>(
    remoteConfig: BaseRemoteConfig<TRemoteConfig, TProjectedRemoteConfig>,
): TRemoteConfigFactoryResult<TProjectedRemoteConfig> => {
    const lifecycleArtefacts: any[] = [];
    const { projections, source, reloading } = remoteConfig;

    if (serviceWithPreflightOrShutdown(source)) {
        lifecycleArtefacts.push(source);
    }

    if (!(reloading || projections)) {
        throw new Error(`Please define at least 'projections' or 'reloading' for remote-config`);
    }

    const stream$ = source.stream().pipe(share());

    if (reloading && reloading.reactsOn) {
        const handler = new RemoteConfigHandler(stream$, reloading.reactsOn, reloading.strategy.execute);
        if (serviceWithPreflightOrShutdown(handler)) {
            lifecycleArtefacts.push(handler);
        }
    }
    const projectionConfig = projections ? projections({ once: onceRemoteRef, streamed: streamedRemoteRef }) : {};

    const projectedRemoteConfig = remapTree(
        projectionConfig,
        {
            // eslint-disable-next-line no-underscore-dangle
            predicate: value => !!value && value.__type === REMOTE_REF_TYPES.ONCE_REMOTE,
            transform: ({ propGetter }: OnceRemoteRefTransformConfig<TRemoteConfig>) => {
                const remoteConfigValue = new OnceRemoteConfigValue(stream$, propGetter);
                if (serviceWithPreflightOrShutdown(remoteConfigValue)) {
                    lifecycleArtefacts.push(remoteConfigValue);
                }
                return remoteConfigValue;
            },
        },
        {
            // eslint-disable-next-line no-underscore-dangle
            predicate: value => !!value && value.__type === REMOTE_REF_TYPES.STREAMED_REMOTE,
            transform: ({ propGetter }: StreamedRemoteRefTransformConfig<TRemoteConfig>) => {
                const remoteConfigValue = new StreamedRemoteConfigValue(stream$, propGetter);
                if (serviceWithPreflightOrShutdown(remoteConfigValue)) {
                    lifecycleArtefacts.push(remoteConfigValue);
                }
                return remoteConfigValue;
            },
        },
    ) as TProjectedRemoteConfig;

    return { lifecycleArtefacts, remoteConfig: projectedRemoteConfig };
};
