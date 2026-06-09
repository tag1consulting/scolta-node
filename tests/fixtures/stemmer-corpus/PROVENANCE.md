# Stemmer corpus provenance

These fixtures are the **Pagefind query-stemmer oracle**, not this binding's own
output. Pagefind stems queries at runtime with the Rust crate `pagefind_stem`;
the `expected-stems.txt` files are that crate's output over `words.txt`, and the
full-corpus parity test asserts the TS binding reproduces them exactly. The
binding's default backend is that same crate compiled to WASM
(`tools/stemmer-wasm`, vendored at `src/index/stemmer-wasm/`), so the comparison
is binding-vs-Pagefind, not binding-vs-itself.

## Targeted Pagefind release

| Field | Value |
| --- | --- |
| Pagefind version | **1.5.0** (the version the scolta packages bundle/serve) |
| Stemmer crate (from Pagefind 1.5.0 `Cargo.lock`) | `pagefind_stem` **1.0.0** |
| crates.io checksum | `8dfa810b158f3ac364e5acd43ca4a6020a6e729d40c15ce1bed1d911237a52e5` |
| Algorithm revision | modern Snowball (post-3.0 / 2024): `added`→`add`, `organic`→`organic`, `geologist`→`geolog`, `organize`→`organiz` |

`pagefind_stem` 0.2.0 (2022) was the pre-3.0 algorithm (`added`→`ad`); the 1.0.0
release (2026-03-23) moved to the revised algorithm. No npm Snowball package
reproduces it, which is why the backend is the crate compiled to WASM.

To re-target a newer Pagefind: read that tag's `Cargo.lock` for the
`pagefind_stem` version, bump the pin in `tools/stemmer-wasm/Cargo.toml`,
rebuild the WASM (`tools/stemmer-wasm/README.md`), then
`node tools/regenerate-stemmer-corpus.mjs` and update the table + manifest below.

## sha256 manifest (drift guard)

`stemmer-provenance.test.ts` asserts the committed fixtures still hash to these
values. A mismatch means the corpus was regenerated (e.g. against a new Pagefind
stemmer revision) — update this manifest and the version table in the same
commit so the move is explicit, never silent.

| lang | words.txt | expected-stems.txt |
| --- | --- | --- |
| en | `9e44b83e85d8b9c41ed40a0dd0d17a3ca9e7eb3a04683992982e7834f96ebc0f` | `8bb926ad62d3f4bb067f530ae754cee26ecd48de56192629af4dba32c34991a6` |
| fr | `fb2857ae44de1a8d12f72d16813aa97466262ae631d78103f06ad4c9601b2bc3` | `2f605406a1176a52e1397d99088c02faaf6268b17b86595f69d0fe423e9d1d6b` |
| de | `f680b1d49eb56bd6145a0ca03484fa489f0c79073ec406e80fef71d924c475af` | `69b037544dc17974fc3430b93e0d3a1a51a478064929437ac5ab77c8c6638771` |
| es | `55f4f3f9b89a7bd6245e9f13bd3508b31b90fc334b123ef76112df37f8506a1d` | `a0fd6ba25c008f65fadaa5708f218663ee808ee23625f365f1033f1bba41baf6` |
| ru | `6e4cd2ed5c908fe3d4cabaa74a088d9043cb626417c1eadc2c157cafbf9772a0` | `c6265f9071e41b24590d567ea69181f5781790930907c77b28044f1d71b1bab3` |
