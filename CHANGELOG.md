# Changelog

## [Unreleased]

### Added

- **npm pack-content guard (`scripts/check-pack-contents.mjs`, wired into CI as
  `npm run check:pack`).** Runs `npm pack --dry-run --json` and asserts every
  packed path falls inside an allowlist *derived at runtime from the
  package.json `files` field* (`dist/`, `assets/`, plus the listed root files
  and the always-included `package.json`), and that the unpacked size stays
  under a cap of ~2x the measured-good artifact (baseline 3,570,505 bytes /
  ~3.41 MB; cap 7,200,000 bytes). The `files` field is already a fail-closed
  publish allowlist; this is the regression test that keeps it true — a stray
  include, a loosened `files` entry, or bulky build output now fails loudly in
  CI instead of shipping to the registry, printing exactly which path leaked
  and pointing at the filter. Precedent: the scolta-wp ~13 MB zip incident and
  the WP.org dist-cruft review flags.

### Fixed

- **Auto-provisioned Amazee credentials stored without resolved model names no
  longer leave AI permanently broken (`src/ai/amazee/auto-provisioner.ts`,
  `src/ai/amazee-service.ts`).** Provisioning persists credentials and resolves
  model names as two non-atomic steps: `AmazeeTrialProvisioner.provision()`
  stores the token+url, then calls `/model/info`. When that call fails,
  `AmazeeClient.getAvailableModels()` swallows the error and returns `[]`, so no
  model name is stored — but `FilesystemConfigStorage.load()` requires only
  token+url, so the half-provisioned credentials read as valid.
  `AutoProvisioner.ensureAiAvailable()` short-circuited on stored credentials
  and never re-resolved, and `AmazeeAiService.buildClient()` fell back to the
  dated config default (`claude-sonnet-4-5-20250929`) — which the Amazee LiteLLM
  gateway rejects with HTTP 400 "Invalid model name", failing AI silently
  (summarize → `{}`, expand → unexpanded 200) with no self-recovery (outside
  `KeyExpiryRecovery`'s auth-only remit). Now: `ensureAiAvailable()` treats
  credentials-without-a-stored-model as an incomplete provision and re-resolves
  against the **already-stored key** (never a fresh trial, which would waste a
  server-limited allocation), and `buildClient()` degrades to the no-AI path
  (HTTP 200) when no model is resolvable instead of sending the dated default.
  A regression test drives the full provision → failed-resolution → degrade →
  self-heal sequence.

- **Re-vendored the browser bundle (`scolta.js`/`scolta.css`) from scolta-php
  `main`, picking up three client-side fixes that had not yet reached the Node
  binding.** scolta-php #217 stops the sub-word frequency guard from sizing its
  corpus with a match-all `pagefind.search(null)` (which downloaded the entire
  Pagefind word index — the Athenaeum AI-Overview latency stall); the guard now
  uses a cached-totals `subwordCorpusSize()` helper. scolta-php #210 fixes a
  silent sort drop on unmatched subjects (generic queries like "newest posts"
  now sort unscoped instead of being dropped) and tunes the sort-intent prompt.
  scolta-php #213 adds the auto topic-filter recall guard that *offers* a
  low-recall filter as a dismissable chip instead of applying it (the new
  `.scolta-filter-offer`/`.scolta-filter-apply` CSS). `assets/js/scolta.js` and
  `assets/css/scolta.css` are byte-identical to scolta-php's canonical assets.
  The SORT intent prompt block in `src/ai/intent-blocks.generated.ts` was
  re-synced byte-for-byte to the scolta-php #210 canonical text (the FILTER
  block was already in sync).

### Changed

- Update the README status section: 1.0.0 is published to npm (the section
  still said "In development").

## [1.0.1] - 2026-06-12

### Fixed

- **`require("scolta")` crashed at module load — the CJS half of the dual
  build has been unusable since 1.0.0.** Every `import.meta.url` in the CJS
  bundle compiled to a property of an empty object (`var import_meta = {}`),
  so the top-level assets-dir constant in `src/health.ts` ran
  `fileURLToPath(undefined)` during `require()`. Had loading gotten further,
  the stemmer's `createRequire(import.meta.url)` would have thrown into its
  load guard and **silently degraded to identity stemming** (mismatching
  Pagefind's query stems), and `pf-common`'s assets-dir walk would have thrown
  from `copyAssets`. attw stayed green throughout because it validates
  resolution, not runtime. Root cause: the tsup builds lacked the
  `import.meta` shim for the CJS format; `shims: true` (both build passes) now
  derives `import.meta.url` from `__filename`. New tests load
  `dist/index.cjs` / `dist/adapter.cjs` through a real `require()` and assert
  behaviour — actual stem output, actually-copied pagefind assets, a passing
  browser-WASM SetupCheck — not absence of exceptions; 4 of 5 fail against an
  unshimmed build.
- **Path traversal in content export.** `ContentExporter.urlToExportPath()`
  never rejected `..` segments and the writer plus both delete paths joined
  the result straight onto the output dir — an item url/id carrying `../`
  (reachable via remote content sources, e.g. a JSON:API mapping) could write
  or unlink files outside the export tree. Every derived path is resolved and
  required to stay inside the output directory: the writer throws on escape,
  the deletes treat an escaping path as not-found, and `deleteById`'s
  tampered-manifest path is covered.
- **Non-numeric config values no longer poison browser ranking.** `fromObject`
  coerced int/float fields with `Number(value)`, so a CMS value like `"high"`
  stored `NaN` and emitted it into `window.scolta.scoring`, silently breaking
  scoring in the browser. On NaN the effective default (base or preset) is
  kept, with a once-per-field warning. (PHP coerces `(float)"junk"` to `0.0`,
  so the NaN passthrough was already a divergence, not parity.)
- **Stemmer WASM load failure no longer throws raw from every `stem()` call.**
  A missing/corrupt vendored `stemmer-wasm/` module threw the bare require
  error; the load is now guarded — warn once, fall back to identity stemming —
  and the loader path is injectable for tests.
- **Timeouts are a typed error.** `AiClient.post()` flattened
  `AbortSignal.timeout()` rejections into the generic request-failure Error;
  they now surface as `AiTimeoutError` so callers can tell a slow provider
  from a misconfigured one. The Anthropic/OpenAI response bodies are also read
  through explicit `unknown` narrowing instead of `as any` chains (same
  lenient empty-string behaviour on shape mismatch).
- **CJS consumers resolved ESM-flavoured types.** The exports map pointed both
  the `import` and `require` conditions at the single `.d.ts` under
  `"type": "module"` (attw "masquerading as ESM"); each condition now resolves
  its own types file (`.d.cts` for `require`), with `typesVersions` covering
  node10-style subpath resolution.
- **`BuildState.cleanup()` no longer deletes files the build does not own —
  in particular `amazee-credentials.json` (`src/index/build-state.ts`).** The
  fresh-build cleanup deleted every regular file at the state-dir root, and
  `FilesystemConfigStorage` keeps the provisioned Amazee credentials exactly
  there: every index rebuild silently de-provisioned AI, so the next call
  re-provisioned a new trial key — churning trial accounts and re-widening
  the expiry exposure window the key-expiry recovery below exists to close
  (this affects scolta-next and scolta-nuxt identically, since both pass the
  same `stateDir` to the orchestrator and the storage). `cleanup()` now
  removes only the build's own transients (`lock`, `manifest.json`,
  `chunk-NNN.dat`, and their `.tmp` leftovers). This is a deliberate
  deviation from the PHP reference's delete-every-file sweep: in PHP the
  Amazee credentials live in CMS config (CMI, WP options, DB rows), never as
  files in the state dir, so the sweep was harmless there. Tests pin the
  ownership rule: own transients removed, the credentials file and foreign
  files/subdirectories spared.
- **Health no longer reports a working Amazee-provisioned install as
  degraded, and "configured" no longer implies "usable" (`src/health.ts`).**
  `HealthChecker` checked only the explicit `ai_api_key`, but auto-provisioned
  installs store their credentials in the Amazee `ConfigStorage` — so a
  perfectly working install reported `status: degraded` forever (the inverse
  of the php/python expired-key lie from the 2026-06-09/10 regression). The
  checker now accepts an optional Amazee credential store and cache:
  `aiConfigured` means an explicit key OR stored Amazee credentials are
  present, and the new `aiUsable` / `aiAuthFailing` report fields additionally
  require no recorded call-time auth failure (the `KeyExpiryRecovery` cache
  marker — never a live API call per health request). Configured-but-unusable
  now drives `status: degraded`; without the new constructor arguments,
  behavior is unchanged. Mirrors scolta-php #211's health semantics.
- **Amazee trial-key expiry detection and guarded re-provisioning
  (`src/ai/amazee/key-expiry-recovery.ts`, `AutoProvisioner.reprovision()`,
  `AmazeeAiService.setKeyExpiryRecovery()`, `src/ai/client.ts`).** Port of the
  scolta-php #211 fix: Amazee trial keys are revoked server-side when the
  trial ends, the expiry is not announced at provisioning time, and nothing
  detected the resulting per-call auth failures —
  `AutoProvisioner.ensureAiAvailable()` no-ops whenever credentials are stored
  (now documented as deliberate), so AI stayed down fleet-wide while the
  endpoint handler silently degraded expand/summarize. `KeyExpiryRecovery`
  classifies auth-class failures (`ApiKeyInvalidError`, or
  `expired_key`/`invalid_api_key`/auth-error markers anywhere in the `cause`
  chain; budget-exhaustion errors are explicitly excluded and keep routing to
  the budget path) and runs a cache-guarded one-attempt-per-window re-provision
  (default 600s; the guard is set *before* the attempt so a failed attempt also
  waits out the window — windows are enforced by timestamp comparison, since
  `CacheDriver` TTLs are advisory). `AutoProvisioner.reprovision()` bypasses
  the stored-credentials no-op (clear, then provision fresh);
  `AmazeeAiService.setKeyExpiryRecovery()` wires recovery into all three AI
  call paths with exactly one retry on a client rebuilt from the fresh
  credentials (never over an explicit user key). `AiClient` now includes a
  truncated response body in non-401 HTTP error messages — the LiteLLM proxy
  announces `expired_key` in a 400 body, which the status-only message
  discarded (the PHP client's Guzzle messages always carried it). Also adds
  the PHP-parity `BudgetAwareProviderDecorator.isBudgetError()` static helper,
  now the single budget-error classification used by the decorator,
  `AmazeeAiService`, and `KeyExpiryRecovery`.

### Added

- **`scolta/adapter` subpath** — the helpers every JS framework adapter
  (scolta-next/scolta-nuxt/scolta-astro) had duplicated file-for-file:
  the static-output crawl (`exportPathToUrl` + `crawlStaticHtml`), the
  vendored-asset copy (`resolveScoltaAssetsDir`/`copyDir`/`copyAssets`),
  the `window.scolta` bootstrap (`buildWindowScolta`), and the default
  AI-service wiring (`defaultAiService` + `endpointResultToResponse`).
  Built as its own sequential tsup pass: a shared multi-entry build makes
  rollup-dts split declarations into a chunk whose re-exports become
  `declare const X: typeof X` values — downstream `ai.AiServiceLike`-style
  type usage then fails to compile — and a parallel config array races one
  pass's `clean` against the other's output.
- **CI and tag-triggered releases.** `.github/workflows/ci.yml` (PRs + main;
  Node 20/22 matrix; `npm ci`, build, test, typecheck, lint,
  `check:publish`) and `.github/workflows/release.yml` (`v*.*.*` tags publish
  to npm via OIDC Trusted Publishing — no long-lived token, automatic
  provenance).
- **Publish-shape gate.** `check:publish` runs publint +
  `@arethetypeswrong/cli` against the packed tarball; part of the local and
  CI gates.

### Changed

- eslint moved to `recommendedTypeChecked` (projectService) so
  `no-floating-promises`/`no-misused-promises` actually run;
  `no-explicit-any` back at warn; all surfaced fallout fixed (typed
  `PagefindModule` for the optional-peer dynamic import, `unknown`-narrowed
  `JSON.parse` sites, Amazee error details no longer stringify as
  `[object Object]`, `Number.isFinite` guard on the Node-version check).
- vitest 1.6 -> 3.2.6 (dev-only; pulls vite 7 / patched esbuild for the
  GHSA-67mh-4wv8-2f99 dev-server advisory).
- package metadata: `repository`/`bugs` fields added.

## [1.0.0] - 2026-06-09

- **Stem with Pagefind's own stemmer so a built index matches Pagefind's query
  stems.** Pagefind stems queries at runtime with the crate `pagefind_stem`;
  Pagefind 1.5.0 (the version the scolta packages bundle) locks `pagefind_stem`
  1.0.0, published 2026-03-23 after the Snowball 3.0 (2024) revision, so it emits
  the modern algorithm (`added`→`add`, `organic`→`organic`, `geologist`→`geolog`,
  `organize`→`organiz`). The previous default backend, `snowball-stemmers`, is the
  pre-3.0 algorithm (`added`→`ad`) and diverges from a Pagefind 1.5.0 index on
  dozens-to-thousands of words per language, so the full-corpus parity gate had to
  be skipped. No npm Snowball package reproduces `pagefind_stem`, so the default
  backend is now that exact crate compiled to WASM (`tools/stemmer-wasm`, pinned
  `pagefind_stem =1.0.0`, vendored at `src/index/stemmer-wasm/`); `snowball-stemmers`
  is dropped. The full-corpus parity test is un-skipped and now asserts byte-exact
  parity against the oracle, rather than being compared to the binding's own
  backend output. Adds `stemmer-pagefind-parity.test.ts` (modern tells),
  `stemmer-provenance.test.ts` + `tests/fixtures/stemmer-corpus/PROVENANCE.md`
  (sha256 drift guard).

- Add the Amazee.ai auto-provisioning subsystem (`ai/amazee/`): control-plane
  client, trial provisioner, idempotent auto-provisioner, model resolver,
  budget decorator, account upgrader, and a filesystem credential store — a
  faithful port of the Python/PHP subsystem. New `AmazeeAiService` provisions a
  free LiteLLM trial on first use when no `ai_api_key` is set (an explicit key
  always wins) and drives the OpenAI-compatible client against the gateway.
- Initial TypeScript port of `scolta-php`: pure-TS Pagefind indexer (default),
  binary-path adapter over the `pagefind` Node API (opt-in), AI client and
  endpoint handler, HTML cleaning, tokenizer/stemmer, and configuration.
