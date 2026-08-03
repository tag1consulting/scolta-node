# scolta

AI-powered search with Pagefind — the Node/TypeScript language binding.

Scolta is a scoring, ranking, and AI layer over [Pagefind](https://pagefind.app),
a static client-side search engine. This package does the server-side work:
turn application content into a Pagefind index, proxy AI calls, serve the
browser assets, and expose configuration. The in-browser scoring engine
(`scolta-core`, Rust→WASM) and the vanilla-JS widget (`scolta.js`) are shared
verbatim across every language binding.

It is a faithful port of [`scolta-php`](../scolta-php), tracking the
[`scolta-python`](../scolta-python) port for structure.

## Indexers

- **`indexer: auto` (default)** — a pure-TypeScript reimplementation of
  Pagefind's on-disk index format. Builds and maintains the index in-process,
  with an input-side token cache so a one-page edit re-tokenizes only that page.
  Runs anywhere Node ≥ 20 runs, including runtimes that forbid native binaries.
- **`indexer: binary` (opt-in)** — uses the official `pagefind` npm package's
  programmatic Node API. Requires `pagefind` to be installed (optional peer
  dependency). Falls back to the TS indexer with a logged notice when the
  package or its platform binary is unavailable.

## Selecting an AI provider is always manual

Scolta ships with **no AI provider selected**. `ai_provider` is empty until
somebody sets it, and while it is empty AI features are simply off: search
works, no provider is assumed, and Anthropic in particular is not silently
assumed. There is no default anywhere.

This package has no admin UI, so **setting `ai_provider` in code or env is the
manual opt-in**. It is a going-forward rule: a site that already persisted a
provider keeps it, and nothing rewrites an existing value.

**Amazee.ai is never enabled on its own.** Setting `ai_provider = "amazee"` is
what permits `AmazeeAiService` to establish the free demo connection on first
use — an explicit choice a developer wrote down, the same act as clicking "Try
the demo" in a CMS admin. With the provider unset or set to anything else, no
credential is provisioned and no outbound Amazee call is made, on any request or
startup path. First-use provisioning is idempotent; an explicit `ai_api_key`
always wins and suppresses Amazee entirely.

`AutoProvisioner.ensureAiAvailable()` — whose name predates the policy —
establishes nothing: it only re-resolves gateway model names against a key
already on disk. A connection is established solely by an explicit
`AmazeeTrialProvisioner.provision()` call (the free demo, no email required) or
by `AmazeeAccountUpgrader` (the email → verification code → region flow that
attaches an amazee.ai account). Amazee support is email-only, mirroring
amazee.ai's own `ai_provider_amazeeio` module; there is no paste-your-API-key
path.

Because there is no admin UI here, there is also no in-app recovery when a
connection's credit runs out: AI degrades and `/health` reports it. Re-authing
is an explicit ops action — set your own credentials, or run the provisioning
path again after connecting an account.

Which action established a connection is **recorded** when it happens, via the
optional `storeConnectionSource` / `loadConnectionSource` on `ConfigStorage`, so
a surface can report a demo or an account from a stored fact instead of a guess.
Credentials with no recorded origin claim nothing.

## Status

Stable — published to npm as [`scolta`](https://www.npmjs.com/package/scolta). See `CHANGELOG.md` for release history.

## Tests

```sh
npm install
npm test          # vitest
npm run lint      # eslint
npm run typecheck # tsc --noEmit
```
