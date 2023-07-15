import { share } from "rxjs/operators";
import {
    RemoteConfigFn,
    onceRemoteRef,
    streamedRemoteRef,
    OnceRemoteRefTransformConfig,
    StreamedRemoteRefTransformConfig,
} from "./types";
import { RemoteConfigHandler } from "./RemoteConfigHandler";
import { remapTree, serviceWithPreflightOrShutdown } from "../utils";
import { StreamedRemoteConfigValue, OnceRemoteConfigValue } from "./remoteValues";
import { BaseRegisterFnArgs } from "../types";

const REF_TYPES = {
    STREAMED_REMOTE: 3,
    ONCE_REMOTE: 4,
};

// todo: make this lazily evaluated in order to support resolve here
export const setRemoteConfig = <Config, RemoteConfig, ProjectedRemoteConfig>(
    envFn: RemoteConfigFn<RemoteConfig, Config, ProjectedRemoteConfig>,
    buildBaseResolveArgs: () => BaseRegisterFnArgs<Config>,
    pushToLifecycleHandlers: (klass: any) => void,
): ProjectedRemoteConfig => {
    const { projections, source, reloading } = envFn(buildBaseResolveArgs());
    if (serviceWithPreflightOrShutdown(source)) {
        pushToLifecycleHandlers(source);
    }

    if (!(reloading || projections)) {
        throw new Error(`Please define at least 'projections' or 'reloading' for remote-config`);
    }

    const stream$ = source.stream().pipe(share());

    if (reloading && reloading.reactsOn) {
        const handler = new RemoteConfigHandler(stream$, reloading.reactsOn, reloading.strategy.execute);
        pushToLifecycleHandlers(handler);
    }
    const projectionConfig = projections ? projections({ once: onceRemoteRef, streamed: streamedRemoteRef }) : {};

    return remapTree(
        projectionConfig,
        {
            // eslint-disable-next-line no-underscore-dangle
            predicate: value => !!value && value.__type === REF_TYPES.ONCE_REMOTE,
            transform: ({ propGetter }: OnceRemoteRefTransformConfig<RemoteConfig>) => {
                const remoteConfigValue = new OnceRemoteConfigValue(stream$, propGetter);
                pushToLifecycleHandlers(remoteConfigValue);
                return remoteConfigValue;
            },
        },
        {
            // eslint-disable-next-line no-underscore-dangle
            predicate: value => !!value && value.__type === REF_TYPES.STREAMED_REMOTE,
            transform: ({ propGetter }: StreamedRemoteRefTransformConfig<RemoteConfig>) => {
                const remoteConfigValue = new StreamedRemoteConfigValue(stream$, propGetter);
                pushToLifecycleHandlers(remoteConfigValue);
                return remoteConfigValue;
            },
        },
    );
};
