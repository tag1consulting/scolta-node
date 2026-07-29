# Changelog

## [Unreleased]

### Changed
- **Re-vendored the browser bundle (`assets/js/scolta.js`) from scolta-php: the facet panel now counts the AI expansion instead of the typed query alone**
  ([tag1consulting/scolta-php#248](https://github.com/tag1consulting/scolta-php/pull/248)).
  The panel reported counts for the typed query while the results header and the list reported the typed query merged with every expansion query, so the two numbers described different sets and the panel was the wrong one. Every count read low, so filtering by a value returned more results than the count promised; and under the default `hideEmptyFacets` policy a value whose only matches came from expansion counted 0 and was **hidden entirely**, taking its whole filter group with it when every one of that dimension's values was expansion derived, which left the visitor unable to filter on content sitting in front of them in the list. Counts are now folded exactly once per typed query, when expansion lands, as `countsOf(typed ids) + countsOf(expansion ids \ typed ids)`, and both terms are still computed under structural dimensions only, so a page loaded with a facet already applied still counts every value of that dimension. Counts still do not move on a facet click, a sort or a load more. **No index rebuild is needed** and nothing on the Node side changed: with the `scolta.facets` artifact present the added pass counts by page id and loads no fragments at all, and its searches are served from the existing per-cycle search memo, so it adds zero Pagefind searches in the common case. Copied byte-identically from the canonical `scolta-php/assets/js/scolta.js`, verified with `cmp`.
- **Re-vendored the browser bundle (`assets/js/scolta.js`) from scolta-php: Scolta owns its facet index, so every search stops paying Pagefind's filter counter**
  ([tag1consulting/scolta-php#245](https://github.com/tag1consulting/scolta-php/pull/245)).
  **Adopting this requires a full search index rebuild**, so the index gains its
  new `scolta.facets` file. Until then facets keep working exactly as before,
  just as slowly: the bundle detects the missing artifact and falls back to
  `pagefind.filters()`, logging a console warning that names the rebuild as the
  fix. Root cause is upstream, in Pagefind 1.5's `SearchIndex::get_filters`,
  which counts by scanning the matched-result set linearly for every
  `(value, page)` posting in every **loaded** filter chunk, and is called twice
  per search — so once any chunk is loaded, every later search costs
  `matched results x loaded postings`, with no unload path short of
  `pagefind.destroy()`. Chunks were loaded two ways: `pagefind.filters()` at
  init loaded all of them, and naming a dimension in a search's filter object
  lazily fetched that dimension's chunk, so the first facet click made the cost
  permanent for the life of the page. The cost tracks postings, not distinct
  filter values: on a 109,308-page corpus a 440-value dimension carrying
  389,545 postings cost 2,478 ms while a 19-value one carrying 491,074 postings
  cost 3,014 ms. The bundle now reads the facet value lists, their totals and
  the per-query counts from `scolta.facets`, and applies the user's facet
  selection itself rather than handing it to Pagefind. Counts are computed over
  the full matched set and were validated against Pagefind's own output with
  zero mismatches across all 3,970 values in all ten dimensions. Keystroke to
  first results on that corpus: `photosynthesis` 525 -> 123 ms, `math`
  17,025 -> 228 ms, a six-word OR-fallback query 71,372 -> 1,058 ms, with
  result counts and every rendered facet count unchanged. Copied verbatim via
  `scripts/vendor-assets.mjs`; no Node-side code changed.
- **Re-vendored the browser bundle (`assets/js/scolta.js`) from scolta-php: every query stopped running its Pagefind search twice, and the result list no longer waits for the facet counts ([scolta-php#244](https://github.com/tag1consulting/scolta-php/pull/244)).** Two independent defects in the bundle, measured on a production-size Pagefind index (109,308 indexed pages, 3,970 distinct filter values across 10 dimensions). **(1)** The facet-count pass derives its filters by keeping only the structural dimensions out of the active ones, so with no user-facing facet applied — the common case — it issued a search byte-identical to the primary one, and on the OR-fallback path it re-ran a per-term search for every term the result path had just searched. That doubled the cost of every query, because once Pagefind's filter chunks are loaded every search also computes per-value counts across every distinct filter value (roughly 1.45 ms per matched result). Identical searches are now memoized for the duration of one search cycle, keyed on the query plus the resolved Pagefind options, so a search whose scope genuinely differs still runs and the facet counts are unchanged. **(2)** The results were rendered only after that second search returned (for the query `math`: finished in memory at 24,558 ms, painted at 35,626 ms). They now paint as soon as they are ready and the filter panel is re-rendered when the counts land, behind a staleness re-check so a superseded query's late counts never repaint the panel; the panel holds its last painted state during the gap rather than flashing. Keystroke to first results on that corpus: `fractions` 4,011 -> 2,075 ms, `math` 22,254 -> 11,083 ms, a six-word query that falls back to OR 93,255 -> 46,584 ms. Neither change alters what the facet counts contain or how many results are returned. Copied byte-identically from the canonical `scolta-php/assets/js/scolta.js`; nothing in this package changed behavior.
- **Re-vendored the browser bundle (`assets/js/scolta.js`) from scolta-php: `hideEmptyFacets` facet-visibility opt-out**
  ([tag1consulting/scolta-php#239](https://github.com/tag1consulting/scolta-php/pull/239)).
  The bundle now hides a facet value whose count is zero for the current query
  by default (dropping a filter group whose values are all zero); an active
  value stays visible so it can be unchecked. A site can restore the prior
  show-disabled behavior by setting `window.scolta.hideEmptyFacets = false`.
  Copied verbatim via `scripts/vendor-assets.mjs`. The Node-side config surface
  for the opt-out is added below under **Added**; when this entry was first
  written the bundle shipped without one, so the only way to reach the opt-out
  was to set the global by hand.
- **Re-vendored the browser bundle (`assets/js/scolta.js`) and the bundled
  scolta-core WASM from scolta-php: specificity-weighted ranking, co-occurrence
  ranking, and the non-seeding-load fix**
  ([tag1consulting/scolta-php#237](https://github.com/tag1consulting/scolta-php/pull/237),
  [#238](https://github.com/tag1consulting/scolta-php/pull/238),
  issue [#156](https://github.com/tag1consulting/scolta-php/issues/156)).
  Each partial-match sub-query is now weighted by how rare its term is in the
  corpus, so a match on a rare intent-bearing term outranks a match on a
  ubiquitous one. On top of that, a document that agrees with several query and
  expansion terms now outranks one matching a single strong term, and the
  co-occurrence path no longer loads full documents for non-seeding terms (typed
  words and agreement-only phrase sub-words) — their agreement is decided from
  result ids and the seeded documents are joined by Pagefind entry id, which
  removes the discarded loads that had inflated the per-query loaded-document
  count. The assets are a verbatim copy of the canonical scolta-php source; no
  behaviour is implemented in this package.
- **Re-vendored the browser bundle (`assets/js/scolta.js`) from scolta-php:
  Pagefind index chunks are now preloaded while the user types**
  ([tag1consulting/scolta-php#232](https://github.com/tag1consulting/scolta-php/pull/232),
  issue [#191](https://github.com/tag1consulting/scolta-php/issues/191)).
  Scolta runs no search until Enter or the search button, so every submitted
  search also paid for fetching the alphabetical index chunk(s) for the typed
  term. The search input now hands the term to `pagefind.preload()` — the
  chunk-resolution half of a search, which bails out before scoring — so the
  search that fires on submit finds the chunk already resolved. Guarded by a
  150 ms trailing debounce, a 2-character floor, a repeat-term skip, and a
  feature-detect on `preload` (index builds from Pagefind releases that predate
  it are unaffected); failures are swallowed, so a cache warm can never break
  the search box. Copied byte-identically from the canonical source; no
  Node-side code changed.

### Added
- **Search as you type: ten config keys and the browser-config emission for them (`src/config.ts`, `docs/CONFIG_REFERENCE.md`, re-vendored `assets/js/scolta.js` + `assets/css/scolta.css`; [tag1consulting/scolta-php#247](https://github.com/tag1consulting/scolta-php/pull/247)).** The re-vendored bundle populates a suggestions dropdown while a visitor types, merging their own recent searches ahead of content suggestions; the full pipeline — AI query expansion, the AI summary, follow-ups — still runs only on Enter, on the search button, or on selecting a suggestion. **On by default and no index rebuild is needed**: suggestions read the index that already exists. Ten new fields with `FIELD_KINDS` entries and defaults byte-equal to the bundle's own fallbacks: `sayt_enabled` (`true`), `sayt_min_chars` (`2`, counted in graphemes by the browser so an emoji is one character; CJK sites commonly want `1`), `sayt_debounce_ms` (`150`), `sayt_max_suggestions` (`6`), `sayt_recent_searches` (`true`, one `localStorage` key, nothing read or written when off), `sayt_max_recent` (`3`), `sayt_expand` (`true`), `sayt_expand_per_minute` (`6`), `sayt_expansion_delay_ms` (`500`) and `sayt_suggestion_action` (`navigate` or `search`). `sayt_enabled: false` restores the pre-1.1.0 widget exactly: no dropdown node, no combobox ARIA roles on the input, no browser storage access, no suggest searches. The per-minute cap exists because SAYT expansions share the platform's AI flood budget with committed searches, so an unbudgeted suggest path would spend a visitor's whole allowance on prefixes and starve the search they actually ran; over the cap the dropdown degrades to keyword-only suggestions. All ten are emitted top-level by `toBrowserConfig()`, not as scoring keys — `toJsScoringConfig()` stays at exactly 40 — with `sayt_suggestion_action` passed through a new `normalizedSaytSuggestionAction()` so an unrecognized configured value crosses to the browser as `navigate` rather than as itself, matching `ScoltaConfig::normalizedSaytSuggestionAction()` in scolta-php. The six integer fields use the existing int handling unchanged, so a numeric string coerces and a fractional value truncates; that is a known and deliberate difference from scolta-python, which raises on non-integer input, and it predates SAYT. The existing browser-config parity guard needed no change: it reads the vendored bundle for `instanceConfig.<key>` and would have failed in both directions — forward on a key the bundle reads and this package did not emit, and reverse on an emitted key a stale bundle never reads, which is why the re-vendor and the emission land together. Covered by `tests/config.test.ts` (every default byte-equal to the bundle fallback, all ten emitted top-level and absent from `scoring`, snake_case mapping for all ten, PHP falsy-string semantics on the booleans, int coercion and truncation, a non-numeric int keeping its default and warning once, absent keys keeping defaults, and the unknown-action clamp) and by the `docs/CONFIG_REFERENCE.md` drift guard, which now documents all ten.

- **`hide_empty_facets` config field, so the facet-visibility opt-out is
  reachable from Node (`src/config.ts`, `docs/CONFIG_REFERENCE.md`).** The
  vendored bundle has read `instanceConfig.hideEmptyFacets` since it was
  re-vendored, but this package emitted no such key, and the bundle treats an
  absent key as "hide" (only a literal `false` disables it), so the opt-out was
  unreachable through config: a caller had to set `window.scolta.hideEmptyFacets`
  by hand after the fact. New `hide_empty_facets` field (bool, default `true`)
  with a `FIELD_KINDS` entry, emitted top-level from `toBrowserConfig()` and not
  nested under `scoring`, matching scolta-php's key order. The `FIELD_KINDS`
  entry is load-bearing, not decorative: `fromObject()` gates incoming keys
  against that map and silently drops anything absent from it, so a class field
  without an entry would be settable-looking and inert.
- **Eight missing scoring tunables, closing the emitter gap against the browser
  (`src/config.ts`, `docs/CONFIG_REFERENCE.md`).** `toJsScoringConfig()` emitted
  32 keys while `scolta.js` reads 40. The eight absent fields were the six
  specificity knobs (`specificity_weighting` `true`, `specificity_floor` `0.15`,
  `specificity_strong_match` `0.55`, `specificity_cooccurrence` `0.9`,
  `specificity_agreement_gate` `0.45`, `specificity_agreement_decay` `1.0`) and
  the two filter-hint recall-guard knobs (`filter_hint_min_results` `5`,
  `filter_hint_min_ratio` `0.1`). All eight could therefore only ever take their
  hardcoded JS fallbacks. Defaults are byte-equal to those fallbacks, so this is
  a pure reachability change with no ranking movement;
  `specificity_cooccurrence: 0` reproduces the prior maximum-only merge exactly.
  String coercion comes free from `coerce()` once the `FIELD_KINDS` entry exists,
  including PHP falsy semantics for the boolean (only `""` and `"0"` are false).
- **A browser-config parity guard, so a key the bundle reads can no longer be
  settable from nowhere (`tests/browser-config-parity.test.ts`).** Root cause of
  all nine gaps above: nothing asserted that the config this package emits covers
  what `scolta.js` reads off it, so a browser-side read could exist with no
  corresponding config field and CI stayed green, because an unsettable key
  silently falls back to its hardcoded JS default and the feature merely appears
  not to work. The new test parses the vendored `assets/js/scolta.js` for every
  key the browser consumes (top-level `instanceConfig.<key>` reads, the `scoring`
  sub-keys in the config return literals, the `endpoints` sub-keys) and diffs that
  set against `toBrowserConfig()` in both directions, recursing one level so a
  missing `scoring` or `endpoints` sub-key cannot hide behind a passing top-level
  check. Four forward-allowlisted keys (`currentLanguage`, `allowedLinkDomains`,
  `disclaimer`, `priority_pages`) each carry their justification as a code
  comment; the reverse allowlist is empty, as this package emits nothing the
  browser does not read. Three tripwire assertions on the extracted counts run
  before any diff, so a reformat of the bundle that breaks the extraction fails
  loudly instead of passing while asserting nothing. Ported from scolta-php's
  reference implementation.
- **Optional `temperature` parameter on `AiClient.message()` and
  `AiClient.conversation()` (`src/ai/client.ts`).** When provided it is emitted
  as the `temperature` field on the request body for both the Anthropic and
  OpenAI-compatible paths; when omitted the field is absent entirely so the
  provider default applies and existing request bodies are unchanged. The guard
  is `temperature !== undefined`, so a `temperature` of `0` is sent verbatim.
  `AiServiceAdapter.messageForOperation()` now pins `temperature` to `0` for the
  `expand_query` operation only, giving deterministic query expansion; summarize
  and follow_up stay on the provider default. Ported from
  tag1consulting/scolta-php#230.

### Fixed

- **Prompt templates re-synced from scolta-core: `expand_query` rule 17
  (`src/ai/prompts.generated.ts`).** Picks up rule 17 (QUALITY / EXPERIENCE →
  CONCRETE INSTANCES), which stops a query naming a feeling or judgment rather
  than a topic ("scary moment", "inspiring story") from being expanded into
  synonyms of the adjective ("frightening experience", "terrifying incident").
  Authors narrate a tense episode by describing the concrete thing that went
  wrong, the malfunction or the alarm or the aborted attempt, and almost never
  label it "scary", so the synonym expansion shared no vocabulary with the pages
  that answer the query. The rule expands such a query into the concrete events,
  systems, or situations that embody the quality in prose and reconciles the
  preamble term cap ("up to 6 concrete instances"); rule 15 still bounds it,
  with its fallback held concrete so it cannot license the genre labels the rule
  bans. The rule covers every valence, not only things that went wrong: the
  funny and inspiring cases are named explicitly and their vocabulary ("amusing
  story", "uplifting narrative") banned, after the model was observed restating
  the adjective on exactly those queries; its examples are marked as
  illustrations rather than a term bank, after it was observed emitting them
  verbatim for an unrelated corpus.
  Byte-identity with scolta-core is enforced by
  `tests/ai/prompt-identity.test.ts`.
- **The prompt-identity parity gate no longer skips itself in CI
  (`.github/workflows/ci.yml`, `tests/ai/prompt-identity.test.ts`).** The gate
  resolves scolta-core through `SCOLTA_CORE_PROMPTS`, falling back to an
  umbrella-checkout sibling path. CI set neither: it never checked out
  scolta-core and never set the variable, so on every runner the sibling path
  was absent, `shouldSkip` was true, and all three identity cases skipped while
  the job reported green. This package's prompt copy had therefore never been
  gated in CI. The `test` job now checks out `tag1consulting/scolta-core` at
  `main` and points the variable at it, mirroring scolta-php's workflow, and an
  unreachable canonical source is now a failure under CI rather than a skip. A
  skip stays legitimate off CI, where a published-package checkout has no
  scolta-core sibling.
- **Prompt templates re-synced from scolta-core (`src/ai/prompts.generated.ts`).** Picks up expand_query rule 16 (NAMED ENTITY / EVENT → DEFINING DETAILS), which stops identifier/proper-noun queries from being expanded into terms that all keep the entity anchor and therefore match nothing, and the rewritten summarize/follow_up grounding rules, which forbid the model from claiming the collection lacks content it cannot see. Byte-identity with scolta-core is enforced by `tests/ai/prompt-identity.test.ts`.

## [1.0.1] - 2026-07-10

### Added

- **`Referer: scolta-node` header on Amazee control-plane requests
  (`src/ai/amazee/client.ts`).** The `post`/`get` helpers that hit
  `api.amazee.ai` now send `Referer: scolta-node` so the Amazee backend can
  attribute control-plane traffic to this SDK. Port of @dan2k3k4's
  tag1consulting/scolta-php#203 (issue tag1consulting/scolta-php#202) with the
  package-specific value. The per-tenant LiteLLM calls are unchanged. Covered by
  a test asserting the header on a POST and a GET.
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

- **Improved handling of expired or revoked Amazee.ai credentials
  (`src/ai/amazee/key-expiry-recovery.ts`, `src/ai/amazee/auto-provisioner.ts`,
  `src/ai/amazee-service.ts`).** When the stored credentials are no longer
  accepted, auth-class failures are now detected, AI degrades cleanly (never
  silently) and the site is flagged for admin re-authentication (a new
  persistent upgrade-needed marker adapters can read); AI health status more
  accurately reflects credential state. The model-resolution self-heal is
  unchanged.
- Update the README status section: 1.0.0 is published to npm (the section
  still said "In development").
- **The release workflow now runs the publish-surface guards before
  `npm publish` (`.github/workflows/release.yml`).** `check:publish` (publint +
  are-the-types-wrong) and `check:pack` (pack-content allowlist + size cap)
  previously gated only `ci.yml` on PRs, never the release workflow that
  actually publishes — so a tagged commit could publish a tarball the PR gate
  would have rejected. Both guards now run after `build`/`test` and before
  `npm publish`, gating the published tarball the same way CI gates PRs.
- **Pinned npm to `11.17.0` in the release workflow to match CI
  (`.github/workflows/release.yml`).** The release job installed `npm@latest`
  while `ci.yml` pins `npm@11.17.0` (the version that generated the fleet's
  lockfiles); an unpinned npm could resolve or regenerate the tree differently
  than CI validated. `11.17.0` still satisfies Trusted Publishing's `>= 11.5.1`
  floor.
- eslint moved to `recommendedTypeChecked` (projectService) so
  `no-floating-promises`/`no-misused-promises` actually run;
  `no-explicit-any` back at warn; all surfaced fallout fixed (typed
  `PagefindModule` for the optional-peer dynamic import, `unknown`-narrowed
  `JSON.parse` sites, Amazee error details no longer stringify as
  `[object Object]`, `Number.isFinite` guard on the Node-version check).
- vitest 1.6 -> 3.2.6 (dev-only; pulls vite 7 / patched esbuild for the
  GHSA-67mh-4wv8-2f99 dev-server advisory).
- package metadata: `repository`/`bugs` fields added.

### Fixed

- **Amazee credentials stored without resolved model names no
  longer leave AI permanently broken (`src/ai/amazee/auto-provisioner.ts`,
  `src/ai/amazee-service.ts`).** Storing the credentials and resolving
  model names are two non-atomic steps: `AmazeeTrialProvisioner.provision()`
  stores the token+url, then calls `/model/info`. When that call fails,
  `AmazeeClient.getAvailableModels()` swallows the error and returns `[]`, so no
  model name is stored — but `FilesystemConfigStorage.load()` requires only
  token+url, so the credentials read as valid.
  `AutoProvisioner.ensureAiAvailable()` short-circuited on stored credentials
  and never re-resolved, and `AmazeeAiService.buildClient()` fell back to the
  dated config default (`claude-sonnet-4-5-20250929`) — which the Amazee LiteLLM
  gateway rejects with HTTP 400 "Invalid model name", failing AI silently
  (summarize → `{}`, expand → unexpanded 200) with no self-healing (outside
  `KeyExpiryRecovery`'s auth-only remit). Now: `ensureAiAvailable()` treats
  credentials-without-a-stored-model as incomplete and re-resolves
  against the **already-stored key** (credentials are never re-issued), and
  `buildClient()` degrades to the no-AI path (HTTP 200) when no model is
  resolvable instead of sending the dated default. A regression test drives the
  full store → failed-resolution → degrade → self-heal sequence.
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
- **Invalid-number config warnings are no longer permanently suppressed across
  config reloads (`src/config.ts`).** The `warnedInvalidNumbers` dedupe set was
  module-global and never reset, so it grew for the process lifetime: a config
  reloaded with a bad numeric value never re-warned, and the warning path was
  untestable in isolation (the first test to hit it silenced it for the rest of
  the run). The set is now reset at the start of each `ScoltaConfig.fromObject`
  call, so the warning still fires once per field within a load but re-warns on
  the next (re)load. A regression test asserts a second load re-warns.
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
  `FilesystemConfigStorage` keeps the stored Amazee credentials exactly
  there, so every index rebuild removed them. `cleanup()` now removes only the
  build's own transients (`lock`, `manifest.json`, `chunk-NNN.dat`, and their
  `.tmp` leftovers), so stored credentials survive index rebuilds where they
  previously did not (this affects scolta-next and scolta-nuxt identically,
  since both pass the same `stateDir` to the orchestrator and the storage). This
  is a deliberate
  deviation from the PHP reference's delete-every-file sweep: in PHP the
  Amazee credentials live in CMS config (CMI, WP options, DB rows), never as
  files in the state dir, so the sweep was harmless there. Tests pin the
  ownership rule: own transients removed, the credentials file and foreign
  files/subdirectories spared.
- **Health no longer reports a working Amazee-configured install as
  degraded, and "configured" no longer implies "usable" (`src/health.ts`).**
  `HealthChecker` checked only the explicit `ai_api_key`, but installs that
  store their credentials in the Amazee `ConfigStorage` reported
  `status: degraded` forever even when perfectly working (the inverse
  of the php/python expired-key lie from the 2026-06-09/10 regression). The
  checker now accepts an optional Amazee credential store and cache:
  `aiConfigured` means an explicit key OR stored Amazee credentials are
  present, and the new `aiUsable` / `aiAuthFailing` report fields additionally
  require no recorded call-time auth failure (the `KeyExpiryRecovery` cache
  marker — never a live API call per health request). Configured-but-unusable
  now drives `status: degraded`; without the new constructor arguments,
  behavior is unchanged. Mirrors scolta-php #211's health semantics.
- **Amazee credential auth-failure detection and clean degradation
  (`src/ai/amazee/key-expiry-recovery.ts`,
  `AmazeeAiService.setKeyExpiryRecovery()`, `src/ai/client.ts`).** Port of the
  scolta-php #211 fix: Amazee credentials are revoked server-side when their
  lifecycle ends, the expiry is not announced at issue time, and nothing
  detected the resulting per-call auth failures —
  `AutoProvisioner.ensureAiAvailable()` no-ops whenever credentials are stored
  (now documented as deliberate), so AI stayed down fleet-wide while the
  endpoint handler silently degraded expand/summarize. `KeyExpiryRecovery`
  classifies auth-class failures (`ApiKeyInvalidError`, or
  `expired_key`/`invalid_api_key`/auth-error markers anywhere in the `cause`
  chain; budget-exhaustion errors are explicitly excluded and keep routing to
  the budget path). On a detected failure it records a cache-backed auth-failure
  marker (`CACHE_KEY_AUTH_FAILURE`; ages out after `AUTH_FAILURE_TTL` so a
  transient blip clears itself once calls succeed) and a persistent
  upgrade-needed marker (`CACHE_KEY_UPGRADE_NEEDED`, retained until cleared
  explicitly), so the state survives across requests; the stored credentials are
  left untouched and no replacement is requested — windows are enforced by
  timestamp comparison, since `CacheDriver` TTLs are advisory.
  `AmazeeAiService.setKeyExpiryRecovery()` wires detection into all three AI
  call paths: on an auth failure the adapter records the state and lets the
  request degrade gracefully (never over an explicit user key), and adapter
  admin UIs read `KeyExpiryRecovery.isUpgradeNeeded()` to prompt the admin to
  re-authenticate, calling `clearUpgradeNeeded()` once that succeeds. `AiClient`
  now includes a truncated response body in non-401 HTTP error messages — the
  LiteLLM proxy announces `expired_key` in a 400 body, which the status-only
  message discarded (the PHP client's Guzzle messages always carried it). Also
  adds the PHP-parity `BudgetAwareProviderDecorator.isBudgetError()` static
  helper, now the single budget-error classification used by the decorator,
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
