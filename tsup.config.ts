import { cpSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
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
  onSuccess: async () => {
    cpSync("src/index/stemmer-wasm", "dist/stemmer-wasm", { recursive: true });
  },
});
