/** Vendored-asset copy tests, lifted with the code from the adapter suites. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyAssets, copyDir, resolveScoltaAssetsDir } from "../../src/adapter/assets.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scolta-assets-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("copyDir", () => {
  it("copies a tree recursively and counts files", () => {
    const src = path.join(tmp, "src");
    fs.mkdirSync(path.join(src, "css"), { recursive: true });
    fs.mkdirSync(path.join(src, "wasm"), { recursive: true });
    fs.writeFileSync(path.join(src, "css", "scolta.css"), "body{}");
    fs.writeFileSync(path.join(src, "wasm", "scolta_core.js"), "//glue");
    fs.writeFileSync(path.join(src, "top.txt"), "x");

    const dest = path.join(tmp, "dest");
    expect(copyDir(src, dest)).toBe(3);
    expect(fs.readFileSync(path.join(dest, "css", "scolta.css"), "utf-8")).toBe("body{}");
    expect(fs.existsSync(path.join(dest, "wasm", "scolta_core.js"))).toBe(true);
  });
});

describe("resolveScoltaAssetsDir / copyAssets", () => {
  // Resolving "scolta/package.json" from inside this repo is a Node package
  // self-reference (the package.json `name` + `exports` make it valid).
  it("resolves the package assets directory", () => {
    const dir = resolveScoltaAssetsDir(import.meta.url);
    expect(path.basename(dir)).toBe("assets");
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("copies assets under {publicDir}/{assetsPublicPath}", () => {
    const publicDir = path.join(tmp, "public");
    const count = copyAssets(import.meta.url, publicDir, "/scolta");
    expect(count).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(publicDir, "scolta"))).toBe(true);
  });
});
