const { ApplicationBuilder } = require("./dist/index");

process.env.A_DEEP_STR = "example_string";
process.env.A_DEEP_BOOL = "0";
process.env.A_DEEP_JSON = '{ "stringified": "json" }';

ApplicationBuilder.create({
    bindProcessSignals: false,
})
    .addConfig(({ $env }) => ({
        a: {
            deep: {
                bool: $env.bool(),
                str: $env.str({ choices: ["example_string", "whatup"] }),
                json: $env.json(),
            },
        },
        serviceName: "example-svc",
        environmentName: "dev",
    }))
    .reconfigure({
        env: ({ $env }) => ({
            a: {
                deep: {
                    bool: $env.str(),
                },
            },
            serviceName: 42,
        }),
    })
    .registerDependency("dependencyA", () => ({ dependency: "value" }))

    .registerDefaultCommand("start", ({ config }) => ({
        info: {
            name: "test",
        },
        execute() {
            // eslint-disable-next-line no-console
            console.log(`hello from command ${config.serviceName}`);
        },
    }))
    .run();
