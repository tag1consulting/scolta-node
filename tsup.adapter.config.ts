import { defineConfig } from "tsup";

// Second tsup pass for the scolta/adapter subpath — see tsup.config.ts for
// why this is a separate sequential build.
export default defineConfig({
  entry: { adapter: "src/adapter/index.ts" },
  format: ["esm", "cjs"],
  // import.meta.url is empty ({}) in the CJS output without this: the shim
  // derives it from __filename, so the assets-dir/stemmer-WASM resolution
  // works under require() too. Without it, require("scolta") crashed at
  // module load (fileURLToPath(undefined) in the top-level ASSETS const).
  shims: true,
  dts: true,
  clean: false,
  sourcemap: true,
  target: "node20",
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
