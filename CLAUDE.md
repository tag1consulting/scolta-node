# scolta-node — porting conventions

This package is a faithful TypeScript port of `scolta-php` (`../scolta-php`),
following the completed `scolta-python` port (`../scolta-python`) as the
structural model. The PHP source is the reference for behaviour — read it
before porting each piece; read the Python equivalent when the PHP is
ambiguous.

## Ground rules

- **Parity over idiom.** Match observable behaviour of the PHP code. Where the
  Pagefind on-disk format is involved (CBOR, delta encoding, format writers,
  tokenizer boundaries, hashing), reproduce it exactly — the shared WASM rejects
  a non-conforming index. Internal-only formats (token cache, build chunks) use
  msgpack/JSON, not PHP `serialize()` parity.
- **The pure-TS indexer is the default** (`indexer: auto`). The Pagefind binary
  path is opt-in (`indexer: binary`), implemented on the official `pagefind`
  Node API loaded via dynamic `import()`, and falls back to the TS indexer when
  the package or its platform binary is unavailable — mirroring
  `IndexerResolver` exactly.
- **Reuse the WASM/JS/CSS assets verbatim** from `../scolta-php/assets/` via a
  fail-closed extension allowlist. Never ship `.sha256`, `.d.ts`, `.map`.
- **No AI attribution** anywhere (commits, comments, docs, CHANGELOGs).
- **Tests are ported for full regression intent** from `../scolta-php/tests/`
  (PHPUnit → vitest), using `../scolta-python/tests/` as the porting model.
  WASM/browser suites stay in `scolta-php`; the Amazee subsystem is deferred.

## Naming

- PHP camelCase methods → TS camelCase. Config wire keys stay **snake_case**
  (they cross the wire to `scolta.js`), exactly as PHP `fromArray` accepted
  snake_case. `fromObject` is the TS entry point.

## Layout

- `src/` — the binding (config, content, ai/, index/, html, export, …).
- `src/index/` — the full Pagefind in-process indexer subsystem.
- `tests/` — vitest mirror of `../scolta-php/tests/`.

## Toolchain

- npm for deps, vitest for tests, eslint (flat config) + `tsc --noEmit` for
  lint/types, tsup for the dual ESM/CJS build. Node floor 20.
- `pagefind` is an optional peer dependency used only by `indexer: binary`.
