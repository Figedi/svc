const { ApplicationBuilder } = require("./dist/app/index");

process.env.A_DEEP_STR = "example_string";
process.env.A_DEEP_BOOL = "0";
process.env.A_DEEP_JSON = '{ "stringified": "json" }';

ApplicationBuilder.create({
    bindProcessSignals: false,
})
    .setEnv(({ $env }) => ({
        a: {
            deep: {
                fileVal: $env.file(
                    ({ app }) => `${app.rootPath}/resources/example.json`,
                    // for testability, the file is being parsed as json
                    fileContent => ({ parsedContent: JSON.parse(fileContent.toString("utf-8")) }),
                ),
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
