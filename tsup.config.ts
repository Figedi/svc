import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts", "src/k8s/index.ts", "src/logger/index.ts", "src/app/index.ts"],
    format: ["cjs", "esm"],
    outDir: "dist",
    sourcemap: false,
    dts: true,
    shims: true,
    clean: true,
    treeshake: true,
});
