import { defineConfig } from "tsup";

// Second tsup pass for the scolta/adapter subpath — see tsup.config.ts for
// why this is a separate sequential build.
export default defineConfig({
  entry: { adapter: "src/adapter/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  clean: false,
  sourcemap: true,
  target: "node20",
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
