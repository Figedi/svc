import { getVersion, ConfigRepository, getRootSchema } from "@figedi/svc-config";
import { setupStubbedKms } from "@figedi/sops/test";
import nock from "nock";
import { expect } from "chai";
import { assert, spy } from "sinon";
import { v1 } from "@google-cloud/kms";
import { take } from "rxjs/operators";

import {
    createStubbedConfigValues,
    createStubbedResponses,
    StubbedResponses,
    StubbedConfigValues,
} from "./shared.specFiles";
import { TestApplicationBuilder } from "../../TestApplicationBuilder";
import { KubernetesRollingUpdateStrategy } from "./KubernetesRollingUpdateStrategy";
import { PollingRemoteSource, MaxRetriesWithoutDataError } from "./PollingRemoteSource";
import { createStubbedLogger } from "../../../logger";
import { ApplicationBuilder } from "../../ApplicationBuilder";
import { ReactsOnFn } from "./types";
import { InvalidConfigWithoutDataError } from "./BaseRemoteSource";
import { sleep } from "../../utils";
import { assertInTestAppBuilder, assertErrorInTestAppBuilder } from "../../shared.specFiles/helpers";

const REMOTE_CONFIG_ENDPOINT = "http://localhost:8080"; // example endpoint, will never be executed due to nock

const PROJECTIONS = {
    logLevel: (config: ConfigRepository) => config.resources.configs.service["common.json"].logLevel,
};

const defaultReactsOnFn: ReactsOnFn<ConfigRepository> = () => false;

const createTestApplicationBuilder = (
    kmsClient: v1.KeyManagementServiceClient,
    reactsOn = defaultReactsOnFn,
    initialValue?: ConfigRepository,
    pollingIntervalMs = 5000,
) => {
    const app = ApplicationBuilder.create<ConfigRepository>({
        loggerFactory: createStubbedLogger,
    })
        .setEnv(() => ({
            serviceName: "example-svc",
            environmentName: "dev",
        }))
        .setRemoteConfig(({ config }) => ({
            source: new PollingRemoteSource({
                schema: getRootSchema(),
                serviceName: config.serviceName,
                fallback: initialValue,
                kmsManagementClientFactory: () => kmsClient,
                poll: {
                    pollingIntervalMs,
                    maxTriesWithoutValue: 2,
                    backoffBaseMs: 100,
                    endpoint: REMOTE_CONFIG_ENDPOINT,
                    version: getVersion(),
                },
            }),
            reloading: {
                reactsOn,
                strategy: new KubernetesRollingUpdateStrategy(),
            },
            projections: ({ once, streamed }) => ({
                onceValue: once(PROJECTIONS.logLevel),
                streamedValue: streamed(PROJECTIONS.logLevel),
            }),
        }));

    return {
        app,
        testApp: TestApplicationBuilder.mount(app),
    };
};

describe("RemoteConfig", function RemoteConfigTest() {
    this.timeout(20000);
    let key: Buffer;
    let iv: Buffer;
    let kms: v1.KeyManagementServiceClient;
    let responses: StubbedResponses;
    let values: StubbedConfigValues;

    before(() => {
        const deps = setupStubbedKms("random-password");
        key = deps.key;
        iv = deps.iv;
        kms = deps.kms;
        values = createStubbedConfigValues(key, iv);
        responses = createStubbedResponses(values);
    });

    afterEach(() => {
        nock.cleanAll();
    });

    describe("core behaviour", () => {
        describe("no-initial-values", () => {
            it("fails whenever the remote-config source is unavailable", async () => {
                const { testApp } = createTestApplicationBuilder(kms);

                const scope = nock(REMOTE_CONFIG_ENDPOINT)
                    .get(/api\/v1\/configs/)
                    .reply(500);

                await assertErrorInTestAppBuilder(testApp, (error: Error) => {
                    expect(error).to.be.instanceOf(MaxRetriesWithoutDataError);
                });
                scope.done(); // will throw if not called
            });

            it("fails whenever a consumed config is invalid", async () => {
                const { testApp } = createTestApplicationBuilder(kms);

                const scope = nock(REMOTE_CONFIG_ENDPOINT)
                    .get(/api\/v1\/configs/)
                    .reply(200, responses.inCorrectValue);

                await assertErrorInTestAppBuilder(testApp, (error: Error) => {
                    expect(error).to.be.instanceOf(InvalidConfigWithoutDataError);
                });
                scope.done(); // will throw if not called
            });
        });

        describe("initial-values", () => {
            it("falls back to a given value whenever the remote-config source is unavailable", async () => {
                const { testApp } = createTestApplicationBuilder(kms, defaultReactsOnFn, values.initial);

                const scope = nock(REMOTE_CONFIG_ENDPOINT)
                    .get(/api\/v1\/configs/)
                    .reply(500);

                await assertInTestAppBuilder(testApp, async ({ remoteConfig }) => {
                    expect(typeof (await remoteConfig.onceValue.get())).to.equal("string");
                });
                scope.done(); // will throw if not called
            });

            it("falls back to a given value whenever a consumed config is invalid", async () => {
                const { testApp } = createTestApplicationBuilder(kms, defaultReactsOnFn, values.initial);

                const scope = nock(REMOTE_CONFIG_ENDPOINT)
                    .get(/api\/v1\/configs/)
                    .reply(200, responses.inCorrectValue);

                await assertInTestAppBuilder(testApp, async ({ remoteConfig }) => {
                    expect(await remoteConfig.onceValue.get()).to.equal(PROJECTIONS.logLevel(values.initial));
                });
                scope.done(); // will throw if not called
            });

            it("uses consumed values despite having initial-values when a consumed config is valid", async () => {
                const { testApp } = createTestApplicationBuilder(kms, defaultReactsOnFn, values.initial);

                const scope = nock(REMOTE_CONFIG_ENDPOINT)
                    .get(/api\/v1\/configs/)
                    .reply(200, responses.correctValueOnce);

                await assertInTestAppBuilder(testApp, async ({ remoteConfig }) => {
                    expect(await remoteConfig.onceValue.get()).to.equal(PROJECTIONS.logLevel(values.correctValueOnce));
                });
                scope.done(); // will throw if not called
            });
        });

        describe("subsequent-failure", () => {
            it("keeps an existing config-value whenever the remote-config source is unavailable", async () => {
                const { testApp } = createTestApplicationBuilder(kms, defaultReactsOnFn, undefined, 100);

                const scope = nock(REMOTE_CONFIG_ENDPOINT)
                    .get(/api\/v1\/configs/)
                    .reply(200, responses.correctValueOnce)
                    .get(/api\/v1\/configs/)
                    .reply(500);

                await assertInTestAppBuilder(testApp, async ({ remoteConfig }) => {
                    expect(await remoteConfig.onceValue.get()).to.equal(PROJECTIONS.logLevel(values.correctValueOnce));
                    await sleep(500, true);
                    expect(await remoteConfig.onceValue.get()).to.equal(PROJECTIONS.logLevel(values.correctValueOnce));
                });
                scope.done(); // will throw if not called
            });

            it("keeps an existing config-value whenever a consumed config is invalid", async () => {
                const { testApp } = createTestApplicationBuilder(kms, defaultReactsOnFn, undefined, 100);

                const scope = nock(REMOTE_CONFIG_ENDPOINT)
                    .get(/api\/v1\/configs/)
                    .reply(200, responses.correctValueOnce)
                    .get(/api\/v1\/configs/)
                    .reply(200, responses.inCorrectValue);

                await assertInTestAppBuilder(testApp, async ({ remoteConfig }) => {
                    expect(await remoteConfig.onceValue.get()).to.equal(PROJECTIONS.logLevel(values.correctValueOnce));
                    await sleep(500, true);
                    expect(await remoteConfig.onceValue.get()).to.equal(PROJECTIONS.logLevel(values.correctValueOnce));
                });
                scope.done(); // will throw if not called
            });
        });
    });

    describe("projections", () => {
        it("projects a consumed config to a user-defined structure", async () => {
            const { testApp } = createTestApplicationBuilder(kms);
            const scope = nock(REMOTE_CONFIG_ENDPOINT)
                .get(/api\/v1\/configs/)
                .reply(200, responses.initial);

            await assertInTestAppBuilder(testApp, async ({ remoteConfig }) => {
                expect(await remoteConfig.onceValue.get()).to.equal(PROJECTIONS.logLevel(values.initial));
            });
            scope.done(); // will throw if not called
        });

        it("projects an initial config to a user-defined structure", async () => {
            const { testApp } = createTestApplicationBuilder(kms, defaultReactsOnFn, values.initial);
            const scope = nock(REMOTE_CONFIG_ENDPOINT)
                .get(/api\/v1\/configs/)
                .reply(500);

            await assertInTestAppBuilder(testApp, async ({ remoteConfig }) => {
                expect(await remoteConfig.onceValue.get()).to.equal(PROJECTIONS.logLevel(values.initial));
            });
            scope.done(); // will throw if not called
        });

        it("projects subsequent values", async () => {
            const { testApp } = createTestApplicationBuilder(kms, defaultReactsOnFn, undefined, 100);
            const scope = nock(REMOTE_CONFIG_ENDPOINT)
                .get(/api\/v1\/configs/)
                .reply(200, responses.initial)
                .get(/api\/v1\/configs/)
                .reply(200, responses.initial)
                .get(/api\/v1\/configs/)
                .reply(200, responses.initial)
                .get(/api\/v1\/configs/)
                .reply(200, responses.correctValueStreamed);

            await assertInTestAppBuilder(
                testApp,
                async ({ remoteConfig }) => {
                    // subscribes to the stream until it finds the changed projection, which might come eventually
                    const streamedValue = await remoteConfig.streamedValue
                        .stream()
                        .pipe(take(1))
                        .toPromise();

                    expect(streamedValue).to.eq("streamed-debug");
                },
                10000,
            );
            scope.done(); // will throw if not called
        });
    });

    describe("reactions", () => {
        it("executes a reaction-handler whenever the reactsOn-predicate yields truthy results", async () => {
            const logLevelReactsOnFn: ReactsOnFn<ConfigRepository> = (_, newVal) => {
                return newVal.resources.configs.service["common.json"].logLevel === "info";
            };
            const reactsOnSpy = spy(logLevelReactsOnFn);
            const { testApp } = createTestApplicationBuilder(kms, reactsOnSpy);
            const scope = nock(REMOTE_CONFIG_ENDPOINT)
                .get(/api\/v1\/configs/)
                .reply(200, responses.initial);

            await assertInTestAppBuilder(testApp, async ({ remoteConfig }) => {
                expect(await remoteConfig.onceValue.get()).to.equal(PROJECTIONS.logLevel(values.initial));
            });
            scope.done(); // will throw if not called

            assert.calledOnce(reactsOnSpy);
            expect(reactsOnSpy.returned(true)).to.equal(true);
        });
    });
});