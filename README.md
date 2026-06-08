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

## Status

In development — see `CHANGELOG.md`.

## Tests

```sh
npm install
npm test          # vitest
npm run lint      # eslint
npm run typecheck # tsc --noEmit
```
