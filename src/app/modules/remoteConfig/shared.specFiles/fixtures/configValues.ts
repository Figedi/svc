import { set, cloneDeep } from "lodash";
import { getFallback, getVersion, SecretsConfiguration } from "@figedi/svc-config";
import { encryptJson } from "@figedi/sops/test";

const modifyVersion = (semverVersion: string, patchFn: (major: number, minor: number, patch: number) => string) => {
    const [major, minor, patch] = semverVersion.split(".").map(parseInt);

    return `v${patchFn(major, minor, patch)}`;
};

export const createStubbedConfigValues = (key: Buffer, iv: Buffer): any => {
    const fallbackValue = getFallback();
    const defaultSecrets: SecretsConfiguration = {
        apiKeys: {
            stripeApiKey: "stripe-api-key",
            mapBoxApiKey: "mapbox-api-key",
        },
    };

    const encryptedSecrets = encryptJson(key, iv, defaultSecrets);
    // sets the initial-values with a stubbed version of secrets, which is signed with the test-key
    const INITIAL_VALUE = set(cloneDeep(fallbackValue), "resources.configs", {
        ...fallbackValue.resources.configs,
        "secrets.enc.json": encryptedSecrets,
    });

    return {
        initial: INITIAL_VALUE,
        correctValueOnce: set(cloneDeep(INITIAL_VALUE), "resources.configs.service", {
            "common.json": { ...INITIAL_VALUE.resources.configs.service["common.json"], logLevel: "debug" },
        }),
        correctValueStreamed: set(cloneDeep(INITIAL_VALUE), "resources.configs.service", {
            "common.json": { ...INITIAL_VALUE.resources.configs.service["common.json"], logLevel: "streamed-debug" },
        }),
        inCorrectValue: set(cloneDeep(INITIAL_VALUE), "resources.configs.service", {
            "undefined.json": { the: "thing" },
        }),
    };
};

export type StubbedConfigValues = ReturnType<typeof createStubbedConfigValues>;

export const createStubbedResponses = (configValues: StubbedConfigValues): any => ({
    initial: {
        id: getVersion(),
        commit: "some-commit",
        files: configValues.initial,
    },
    correctValueOnce: {
        id: modifyVersion(getVersion(), (ma, mi, pa) => `${ma}.${mi + 1}.${pa}`),
        commit: "some-commit1",
        files: configValues.correctValueOnce,
    },

    correctValueStreamed: {
        id: modifyVersion(getVersion(), (ma, mi, pa) => `${ma}.${mi + 2}.${pa}`),
        commit: "some-commit2",
        files: configValues.correctValueStreamed,
    },
    inCorrectValue: {
        id: modifyVersion(getVersion(), (ma, mi, pa) => `${ma}.${mi + 3}.${pa}`),
        commit: "some-commit3",
        files: configValues.inCorrectValue,
    },
});

export type StubbedResponses = ReturnType<typeof createStubbedResponses>;
