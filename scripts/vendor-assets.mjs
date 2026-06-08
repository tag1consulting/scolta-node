#!/usr/bin/env node
/**
 * Vendor the shared runtime assets from ../scolta-php/assets via a FAIL-CLOSED
 * extension allowlist. Only *.css/*.js/*.wasm/*.pagefind from css/js/wasm/
 * pagefind subdirs are copied; sidecars (*.sha256, *.d.ts, *.map, *.log) and
 * anything else are never shipped. The assets are language-independent (the
 * scoring engine is scolta-core compiled to WASM, run in the browser), so they
 * are reused verbatim — never regenerated or hand-edited here.
 */
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SUBDIRS = ["css", "js", "wasm", "pagefind"];
const ALLOW = /\.(css|js|wasm|pagefind)$/;
const DENY = /\.(sha256|d\.ts|map|log)$/;

/** Copy allowlisted assets from `src` into `dest`; return the relative paths copied. */
export function vendor(src, dest) {
  const copied = [];
  for (const sub of SUBDIRS) {
    const srcDir = join(src, sub);
    let entries;
    try {
      entries = readdirSync(srcDir);
    } catch {
      continue;
    }
    mkdirSync(join(dest, sub), { recursive: true });
    for (const name of entries) {
      const f = join(srcDir, name);
      if (!statSync(f).isFile()) continue;
      if (DENY.test(name) || !ALLOW.test(name)) continue;
      copyFileSync(f, join(dest, sub, name));
      copied.push(`${sub}/${name}`);
    }
  }
  return copied;
}

// CLI entry: vendor from the sibling scolta-php into this package's assets/.
if (import.meta.url === `file://${process.argv[1]}`) {
  const here = dirname(fileURLToPath(import.meta.url));
  const copied = vendor(join(here, "..", "..", "scolta-php", "assets"), join(here, "..", "assets"));
  console.log(`Vendored ${copied.length} runtime assets`);
}
