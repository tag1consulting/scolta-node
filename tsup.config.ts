import { cpSync } from "node:fs";
import { defineConfig } from "tsup";

// The adapter entry builds as a separate, SEQUENTIAL tsup pass (see the build
// script — a parallel config array would race this pass's clean against the
// other's output). Separate configs on purpose: a shared multi-entry build
// makes rollup-dts split the declarations into a common chunk, and the chunked
// re-exports turn interfaces into `declare const X: typeof X` values —
// downstream `ai.AiServiceLike`-style type usage then fails to compile.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node20",
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
  // The default stemmer backend is Pagefind's pagefind_stem crate compiled to
  // WASM, loaded at runtime via a relative require. Ship the vendored module
  // next to the bundle so that require resolves in the published package.
  onSuccess: () => {
    cpSync("src/index/stemmer-wasm", "dist/stemmer-wasm", { recursive: true });
    return Promise.resolve();
  },
});
