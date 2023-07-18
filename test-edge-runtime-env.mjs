import { EdgeRuntime } from "edge-runtime";
import { readFile } from "node:fs/promises";

const runtime = new EdgeRuntime();
// @todo import.meta.require + export not working yet
const bundleContent = await readFile("./dist/index.bun.mjs", "utf-8");

const sanitized = bundleContent
    // HAX, bun does some random stuff which likely will not exist in the end-bundle
    .replace(/var __require = \([^)]*\) => \{[\s\S]*?\}/g, "")
    .replace(/export\s*{(?:[\s\S]*?)};/g, "");
const result = await runtime.evaluate(`
${sanitized}; 

ApplicationBuilder.create({
    bindProcessSignals: false,
})
    .setEnv(({ $env }) => ({
        a: {
            deep: {
                fileVal: $env.file(
                    ({ app }) => app.rootPath +  '/resources/example.json',
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
            console.log('hello from command' + config.serviceName);
        },
    }))
    .run();
`);

console.log(result);
