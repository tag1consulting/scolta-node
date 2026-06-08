/**
 * Asset vendoring: the runtime bundle is present and no sidecar/checksum files
 * leaked. The vendoring is fail-closed by extension allowlist.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain .mjs script, no type declarations
import { vendor } from "../scripts/vendor-assets.mjs";

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets");

const EXPECTED_RUNTIME = [
  "css/scolta.css",
  "js/scolta.js",
  "wasm/scolta_core.js",
  "wasm/scolta_core_bg.wasm",
  "pagefind/pagefind.js",
  "pagefind/pagefind-worker.js",
  "pagefind/wasm.en.pagefind",
  "pagefind/wasm.unknown.pagefind",
];

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

describe("vendored assets", () => {
  it("runtime assets present", () => {
    for (const rel of EXPECTED_RUNTIME) {
      expect(fs.existsSync(path.join(ASSETS, rel)), `missing runtime asset: ${rel}`).toBe(true);
    }
  });

  it("no sidecar/checksum files leaked", () => {
    const leaked = walk(ASSETS).filter((f) => /\.(sha256|d\.ts|map|log)$/.test(f));
    expect(leaked).toEqual([]);
  });

  it("only allowed extensions present", () => {
    for (const f of walk(ASSETS)) {
      expect(/\.(css|js|wasm|pagefind)$/.test(f), `unexpected asset extension: ${f}`).toBe(true);
    }
  });

  it("vendoring allowlist is fail-closed", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scolta-vendor-"));
    try {
      const src = path.join(tmp, "assets");
      fs.mkdirSync(path.join(src, "js"), { recursive: true });
      fs.mkdirSync(path.join(src, "wasm"), { recursive: true });
      fs.writeFileSync(path.join(src, "js", "scolta.js"), "ok");
      fs.writeFileSync(path.join(src, "js", "scolta.js.sha256"), "deadbeef");
      fs.writeFileSync(path.join(src, "wasm", "core.wasm"), Buffer.from([0]));
      fs.writeFileSync(path.join(src, "wasm", "core.d.ts"), "types");
      fs.writeFileSync(path.join(src, "wasm", "core.js.map"), "map");
      const dst = path.join(tmp, "out");
      const copied: string[] = vendor(src, dst);
      expect(new Set(copied)).toEqual(new Set(["js/scolta.js", "wasm/core.wasm"]));
      expect(walk(dst).filter((f) => /\.(sha256|d\.ts|map)$/.test(f))).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
