import { cpSync } from "node:fs";
import { defineConfig } from "tsup";

// The two entries build as SEPARATE configs on purpose: a shared multi-entry
// build makes rollup-dts split the declarations into a common chunk, and the
// chunked re-exports turn interfaces into `declare const X: typeof X` values —
// downstream `ai.AiServiceLike`-style type usage then fails to compile. One
// config per entry keeps each .d.ts self-contained (at the cost of some
// duplicated JS in adapter.{js,cjs}, which is small glue code).
const shared = {
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  target: "node20",
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
} satisfies Parameters<typeof defineConfig>[0];

export default defineConfig([
  {
    ...shared,
    entry: { index: "src/index.ts" },
    clean: true,
    // The default stemmer backend is Pagefind's pagefind_stem crate compiled to
    // WASM, loaded at runtime via a relative require. Ship the vendored module
    // next to the bundle so that require resolves in the published package.
    onSuccess: () => {
      cpSync("src/index/stemmer-wasm", "dist/stemmer-wasm", { recursive: true });
      return Promise.resolve();
    },
  },
  {
    ...shared,
    entry: { adapter: "src/adapter/index.ts" },
    clean: false,
  },
]);
