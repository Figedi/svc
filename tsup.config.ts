import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts", "src/k8s/index.ts", "src/remoteConfig/index.ts"],
    format: ["cjs", "esm"],
    target: "es2022",

    outDir: "dist",
    sourcemap: false,
    dts: true,
    shims: false,
    clean: true,
    treeshake: true,
});
