/**
 * Copy the vendored scolta runtime assets (css/js/wasm/pagefind) from the
 * installed `scolta` package into a framework's public tree so they serve
 * statically. Shared by the JS framework adapters' `scolta-build assets` CLI
 * subcommands; previously duplicated file-for-file in each adapter.
 */

import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

/** Resolve the installed `scolta` package's `assets` directory. */
export function resolveScoltaAssetsDir(fromUrl: string): string {
  const require = createRequire(fromUrl);
  const pkgJson = require.resolve("scolta/package.json");
  return path.join(path.dirname(pkgJson), "assets");
}

/** Recursively copy `src` into `dest`. Returns the number of files copied. */
export function copyDir(src: string, dest: string): number {
  let count = 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
      count += 1;
    }
  }
  return count;
}

/**
 * Copy `scolta/assets/*` into `{publicDir}{assetsPublicPath}` (e.g.
 * `public/scolta`). Returns the number of files copied.
 */
export function copyAssets(fromUrl: string, publicDir: string, assetsPublicPath: string): number {
  const assetsDir = resolveScoltaAssetsDir(fromUrl);
  const dest = path.join(publicDir, assetsPublicPath.replace(/^\//, ""));
  return copyDir(assetsDir, dest);
}
