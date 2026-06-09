# stemmer-wasm — Pagefind's query stemmer, compiled to WASM

`scolta` builds a Pagefind index at publish time. Pagefind stems **queries** at
search time with its bundled WASM, which is the Rust crate
[`pagefind_stem`](https://crates.io/crates/pagefind_stem). If the binding's
build-time stems differ from Pagefind's runtime query stems, the index silently
misses those queries. So the binding must stem with `pagefind_stem` itself — not
an independent JS/Snowball port (every npm Snowball package is the older,
pre-3.0 algorithm and diverges, e.g. `added`→`ad` instead of `added`→`add`).

This crate compiles the exact `pagefind_stem` version the targeted Pagefind
release locks to a small WASM module exposing `stem(algorithm, word)`. The build
output is vendored at `../../src/index/stemmer-wasm/` and loaded by
`src/index/stemmer.ts` as the default backend.

## Version mapping

| Targeted Pagefind | `Cargo.lock` pins | Algorithm revision |
| --- | --- | --- |
| **1.5.0** | `pagefind_stem` **1.0.0** (checksum `8dfa810b…`) | modern Snowball (post-3.0 / 2024): `added`→`add` |

## Building / re-vendoring

Requires a Rust toolchain + `wasm-pack`:

```sh
cd tools/stemmer-wasm
wasm-pack build --target nodejs --release --out-dir pkg
cp pkg/stemmer_wasm.js pkg/stemmer_wasm_bg.wasm pkg/*.d.ts ../../src/index/stemmer-wasm/
```

`src/index/stemmer-wasm/package.json` marks that directory `commonjs` so the
wasm-pack Node glue loads correctly from this ESM package.

To re-target a newer Pagefind: read that tag's `Cargo.lock` for the
`pagefind_stem` version, bump the `=1.0.0` pin in `Cargo.toml`, rebuild and
re-vendor as above, then regenerate the corpus fixtures with
`node tools/regenerate-stemmer-corpus.mjs` and update
`tests/fixtures/stemmer-corpus/PROVENANCE.md`.

`pagefind_stem` is BSD-3 / MIT (Snowball lineage); `publish = false` — this crate
is a build tool, not part of the npm package.
