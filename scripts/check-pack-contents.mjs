#!/usr/bin/env node
// Regression guard for the npm publish surface.
//
// package.json's `files` field is already a fail-closed allowlist of what
// ships to npm. This script is the test that keeps it honest: it runs
// `npm pack --dry-run --json` and asserts every packed path falls inside the
// set DERIVED from that same `files` field (plus package.json, which npm
// always includes). A stray include, a loosened `files` entry, or build
// output landing somewhere unexpected fails loudly in CI instead of shipping
// to the registry.
//
// History: scolta-wp once shipped a ~13 MB plugin zip stuffed with build
// cruft, and the WP.org review flagged dist-cruft in the distributed package.
// The fix in every binding is the same — enumerate what we own and fail
// closed on anything else. This is that guard for the Node package.
//
// The allowlist is NOT hardcoded here: it is read from package.json `files`
// at runtime, so editing `files` automatically re-derives the guard. The one
// thing you cannot do silently is widen the published surface.
//
// Run locally: `node scripts/check-pack-contents.mjs`
// (build dist/ first — `npm run build` — so the dry-run sees real output.)

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Measured against the current good artifact (`npm pack --dry-run --json`,
// scolta@1.0.1 on 2026-06-14): unpackedSize = 3_570_505 bytes (~3.41 MB).
// Cap set at roughly 2x the measured value so ordinary growth (a few KB of
// dist/, re-vendored assets) passes, but a bulk regression — a vendored
// node_modules tree, an unminified map dump, the whole Pagefind index — trips
// it. Bump this deliberately, with a fresh measurement, when dist/assets grow.
const MEASURED_UNPACKED_BYTES = 3_570_505;
const MAX_UNPACKED_BYTES = 7_200_000; // ~2x measured (~6.87 MB)

function fail(msg) {
  console.error(`\n[pack-guard] FAIL: ${msg}`);
  console.error(
    "[pack-guard] The publish surface is defined by the `files` field in " +
      "package.json. Fix it there (or add a .npmignore) — this guard lives " +
      "in scripts/check-pack-contents.mjs.\n",
  );
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const filesField = pkg.files;
if (!Array.isArray(filesField) || filesField.length === 0) {
  fail("package.json has no `files` array — refusing to publish an open surface.");
}

// Derive the allowlist from `files`. An entry that names a directory on disk
// (or has no file extension) becomes a path PREFIX (`dist` -> `dist/`); an
// entry that is a file becomes an exact match. npm always includes
// package.json, LICENSE/README-by-convention regardless of `files`, but we
// only special-case package.json (the rest are listed explicitly in `files`).
const allowedPrefixes = [];
const allowedExact = new Set(["package.json"]);

for (const entry of filesField) {
  const normalized = entry.replace(/^\.\//, "").replace(/\/+$/, "");
  const abs = join(repoRoot, normalized);
  let isDir = false;
  try {
    isDir = statSync(abs).isDirectory();
  } catch {
    // Not present on disk (e.g. a glob, or not built). Treat extensionless
    // entries as directory prefixes, dotted entries as exact files.
    isDir = !/\.[^/]+$/.test(normalized);
  }
  if (isDir) {
    allowedPrefixes.push(normalized + "/");
  } else {
    allowedExact.add(normalized);
  }
}

console.log("[pack-guard] derived allowlist from package.json `files`:");
console.log("  prefixes:", allowedPrefixes.join(", ") || "(none)");
console.log("  exact   :", [...allowedExact].sort().join(", "));

const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const meta = JSON.parse(raw)[0];
const packed = meta.files.map((f) => f.path);

const leaked = packed.filter((p) => {
  if (allowedExact.has(p)) return false;
  return !allowedPrefixes.some((prefix) => p.startsWith(prefix));
});

if (leaked.length > 0) {
  console.error("[pack-guard] paths packed but NOT in the derived allowlist:");
  for (const p of leaked) console.error(`  - ${p}`);
  fail(
    `${leaked.length} path(s) outside the \`files\` allowlist would ship to npm`,
  );
}

const unpacked = meta.unpackedSize;
console.log(
  `[pack-guard] ${packed.length} files, unpacked ${unpacked} bytes ` +
    `(${(unpacked / 1024 / 1024).toFixed(2)} MB); ` +
    `measured baseline ${MEASURED_UNPACKED_BYTES}, cap ${MAX_UNPACKED_BYTES}.`,
);

if (unpacked > MAX_UNPACKED_BYTES) {
  fail(
    `unpacked size ${unpacked} bytes exceeds cap ${MAX_UNPACKED_BYTES} ` +
      `(~2x the ${MEASURED_UNPACKED_BYTES}-byte baseline). Something bulky ` +
      `leaked into dist/ or assets/.`,
  );
}

console.log("[pack-guard] OK — publish surface is within the `files` allowlist and size cap.");
