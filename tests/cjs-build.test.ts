/**
 * CJS build smoke tests — the dual-format bundle's require() path.
 *
 * Without tsup's import.meta shim, every `import.meta.url` compiles to a
 * property of an EMPTY object in the CJS output: require("scolta") crashed at
 * module load (the top-level ASSETS const ran fileURLToPath(undefined)), and
 * had it gotten further, the stemmer's createRequire(import.meta.url) would
 * have thrown into its load guard — silently degrading to identity stemming
 * rather than failing. So these tests assert REAL behaviour (actual stems,
 * actually-copied files), never just "no exception".
 *
 * Requires `npm run build` first (the local/CI gate builds before testing).
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const distCjs = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.cjs");

describe("dist/index.cjs (require() path)", () => {
  it("the bundle exists and require() succeeds", () => {
    expect(fs.existsSync(distCjs), "dist missing — run `npm run build` before the test gate").toBe(
      true,
    );
    expect(() => require(distCjs)).not.toThrow();
  });

  it("the stemmer WASM genuinely loads — real stems, no identity fallback", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const scolta = require(distCjs) as typeof import("../src/index.js");
      const stemmer = new scolta.index.Stemmer("en");
      // Identity fallback would return the words unchanged and warn once.
      expect(stemmer.stem("running")).toBe("run");
      expect(stemmer.stem("added")).toBe("add");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("copyAssets resolves the vendored pagefind assets dir and copies files", () => {
    const scolta = require(distCjs) as typeof import("../src/index.js");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scolta-cjs-"));
    try {
      scolta.index.copyAssets(tmp);
      expect(fs.existsSync(path.join(tmp, "pagefind.js"))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("SetupCheck finds the packaged browser WASM via the module-relative assets dir", async () => {
    const scolta = require(distCjs) as typeof import("../src/index.js");
    const results = await scolta.SetupCheck.run({
      binary: { status: async () => ({ available: false, version: null, via: "none", message: "" }) },
    });
    const wasm = results.find((r) => r.name === "Browser WASM");
    expect(wasm?.status).toBe("pass");
  });
});

describe("dist/adapter.cjs (require() path)", () => {
  it("requires cleanly and the helpers work", () => {
    const adapterPath = path.join(path.dirname(distCjs), "adapter.cjs");
    expect(fs.existsSync(adapterPath)).toBe(true);
    const adapter = require(adapterPath) as typeof import("../src/adapter/index.js");
    expect(adapter.exportPathToUrl("about/index.html")).toBe("/about/");
    expect(adapter.buildWindowScolta({})["container"]).toBe("#scolta-search");
  });
});
