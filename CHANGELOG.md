# Changelog

## Unreleased

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
