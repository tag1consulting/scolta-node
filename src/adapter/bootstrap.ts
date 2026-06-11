/**
 * Pure helper that builds the `window.scolta` bootstrap object from the
 * resolved browser config. Extracted from the adapter mount components so it
 * is unit-testable without a DOM — it must reflect the SAVED config (Release
 * Gate family 4). Previously duplicated in each JS framework adapter.
 */

export interface BootstrapOptions {
  /** Public path the vendored assets are served from (default /scolta). */
  assetsPath?: string;
  /** Override the pagefind.js path (default derived from config). */
  pagefindPath?: string;
  /** DOM id of the mount container (default scolta-search). */
  containerId?: string;
}

export function buildWindowScolta(
  browserConfig: Record<string, unknown>,
  opts: BootstrapOptions = {},
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...browserConfig };
  if (opts.pagefindPath) {
    result["pagefindPath"] = opts.pagefindPath;
  }
  // scolta.js auto-init bails unless window.scolta.container names the mount
  // point, and it loads WASM via `import(wasmPath)` where wasmPath must be the
  // full glue-module path (…/wasm/scolta_core.js), not the directory. Mirror
  // the Django/WP/Laravel adapters so the browser widget actually mounts.
  result["container"] = `#${opts.containerId ?? "scolta-search"}`;
  if (opts.assetsPath && !result["wasmPath"]) {
    result["wasmPath"] = `${opts.assetsPath.replace(/\/$/, "")}/wasm/scolta_core.js`;
  }
  return result;
}
