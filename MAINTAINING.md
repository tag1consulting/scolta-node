# Maintaining scolta-node

The Node/TypeScript binding: a Pagefind index builder plus an AI proxy. It follows scolta-php closely,
using scolta-python as the structural model. Published on npm as `scolta`.

Everything true of more than one Scolta repo lives in
[scolta-core/MAINTAINING.md](https://github.com/tag1consulting/scolta-core/blob/main/MAINTAINING.md):
the version rules, the release order, the fleet checks, the rules every repo shares. How the browser
bundle is copied and checked is in
[scolta-core/ASSETS.md](https://github.com/tag1consulting/scolta-core/blob/main/ASSETS.md).

**What it is.** The Node binding. It depends on `scolta-core` (the vendored WASM). `scolta-next`,
`scolta-nuxt` and `scolta-astro` depend on this.

**Where the version lives.** `package.json`.

**Where it publishes.** npm, as `scolta` (the repo is `scolta-node`; the package is not). To confirm:
`npm install scolta` in a throwaway directory resolves from the registry, not a local path.

**CI checks.** One `test` job across Node 20 and 22, running `npm run build`, `npm test` (vitest),
`npm run typecheck` (`tsc --noEmit`), `npm run lint` (eslint),
`npm run check:publish` (publint plus are-the-types-wrong) and `npm run check:pack`
(`scripts/check-pack-contents.mjs`: the tarball must stay inside the `files` allowlist and under its
size cap). The job also checks out scolta-core and points `SCOLTA_CORE_PROMPTS` at its `src/prompts.rs`,
so the prompt-text identity gate runs instead of skipping. npm itself is pinned to the exact version that
generated the lockfiles; bump the pin in `ci.yml` and `release.yml` together, deliberately.

**On release day.** Release this first among the npm packages: the three adapters require `scolta@^X.Y.0`
and cannot ship ahead of it. Tag `vX.Y.Z`; the release workflow re-runs the build, the tests and both
publish guards, then `npm publish` through Trusted Publishing (OIDC), which attaches provenance
automatically. No long-lived npm token is involved.

**Watch out for.**

- This package carries the browser bundle at `assets/css`, `assets/js`, `assets/wasm` and
  `assets/pagefind`, re-vendored with `node scripts/vendor-assets.mjs` from a sibling `../scolta-php`
  checkout through a fail-closed extension allowlist. Never hand-edit an asset here.
- Nothing checks that copy against scolta-php. There is no `assets-in-sync` job here as there is in
  scolta-drupal and scolta-wp, so a stale bundle goes unnoticed until someone looks.
- The `file:` dependency trap: the published manifest must carry a semver. Use a symlink
  (`ln -s ../../scolta-node node_modules/scolta`) for local development, never a committed `file:` or
  `link:` entry, which also breaks `npm ci`. `check:pack` is what catches a leftover.
- The stemmer must match Pagefind's `pagefind_stem` exactly. `tools/stemmer-wasm` compiles the pinned
  crate and `tools/regenerate-stemmer-corpus.mjs` regenerates the golden corpus; the provenance is
  recorded under `tests/fixtures/stemmer-corpus/`. Bump the pin only alongside the other ports.
- `pagefind` is an optional peer dependency, used only by `indexer: binary`. The pure-TS indexer is the
  default and the binary path falls back to it.
