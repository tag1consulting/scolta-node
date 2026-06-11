# Changelog

## [Unreleased]

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
