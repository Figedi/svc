import { share } from "rxjs/operators";
/* eslint-disable import/no-cycle */
import {
    RemoteConfigFn,
    onceRemoteRef,
    streamedRemoteRef,
    OnceRemoteRefTransformConfig,
    StreamedRemoteRefTransformConfig,
} from "./types";
import { ApplicationBuilder } from "../../ApplicationBuilder";
/* eslint-enable import/no-cycle */
import { RemoteConfigHandler } from "./RemoteConfigHandler";
import { remapTree } from "../../utils";
import { OnceRemoteConfigValue } from "./OnceRemoteConfigValue";
import { StreamedRemoteConfigValue } from "./StreamedRemoteConfigValue";

const REF_TYPES = {
    STREAMED_REMOTE: 3,
    ONCE_REMOTE: 4,
};

export const setRemoteConfig = <Config, RemoteConfig, ProjectedRemoteConfig>(
    appBuilder: ApplicationBuilder<Config, RemoteConfig>,
    envFn: RemoteConfigFn<RemoteConfig, Config, ProjectedRemoteConfig>,
): ApplicationBuilder<Config, ProjectedRemoteConfig> => {
    const { projections, source, reloading } = envFn(appBuilder.buildResolveArgs(appBuilder.container));
    source.setContext(appBuilder.appContext);
    appBuilder.servicesWithLifecycleHandlers.push(source);

    if (!(reloading || projections)) {
        throw new Error(`Please define at least 'projections' or 'reloading' for remote-config`);
    }

    const stream$ = source.stream().pipe(share());

    if (reloading && reloading.reactsOn) {
        reloading.strategy.setContext(appBuilder.appContext);
        const handler = new RemoteConfigHandler(stream$, reloading.reactsOn, reloading.strategy.execute);
        appBuilder.servicesWithLifecycleHandlers.push(handler);
    }
    const projectionConfig = projections ? projections({ once: onceRemoteRef, streamed: streamedRemoteRef }) : {};

    // eslint-disable-next-line no-param-reassign
    appBuilder.remoteConfig = remapTree(
        projectionConfig,
        {
            // eslint-disable-next-line no-underscore-dangle
            predicate: value => !!value && value.__type === REF_TYPES.ONCE_REMOTE,
            transform: ({ propGetter }: OnceRemoteRefTransformConfig<RemoteConfig>) => {
                const remoteConfigValue = new OnceRemoteConfigValue(stream$, propGetter);
                appBuilder.servicesWithLifecycleHandlers.push(remoteConfigValue);
                return remoteConfigValue;
            },
        },
        {
            // eslint-disable-next-line no-underscore-dangle
            predicate: value => !!value && value.__type === REF_TYPES.STREAMED_REMOTE,
            transform: ({ propGetter }: StreamedRemoteRefTransformConfig<RemoteConfig>) => {
                const remoteConfigValue = new StreamedRemoteConfigValue(stream$, propGetter);
                appBuilder.servicesWithLifecycleHandlers.push(remoteConfigValue);
                return remoteConfigValue;
            },
        },
    );

    return (appBuilder as any) as ApplicationBuilder<Config, ProjectedRemoteConfig>;
};
