/**
 * `scolta/adapter` — helpers shared by the JS framework adapters
 * (scolta-next / scolta-nuxt / scolta-astro).
 *
 * The adapters' convention is that shared logic lives in `scolta`; this
 * subpath collects the glue they had each duplicated: the static-output
 * crawl, the vendored-asset copy, the `window.scolta` bootstrap, and the
 * default AI-service wiring with its HTTP response mapping.
 */

export { exportPathToUrl, crawlStaticHtml } from "./crawl.js";
export { resolveScoltaAssetsDir, copyDir, copyAssets } from "./assets.js";
export { buildWindowScolta, type BootstrapOptions } from "./bootstrap.js";
export { defaultAiService, endpointResultToResponse } from "./ai-service.js";
