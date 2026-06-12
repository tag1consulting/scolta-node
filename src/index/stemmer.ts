/**
 * Snowball stemmer (port of `Tag1\Scolta\Index\Stemmer`).
 *
 * Stems words for 14 languages, memoized. The build-time stems must match what
 * Pagefind stems *queries* with at runtime, or an index silently misses those
 * queries. Pagefind 1.5.0's bundled WASM is the crate `pagefind_stem` 1.0.0
 * (published 2026-03-23, after the Snowball 3.0 / 2024 revision), so it emits
 * the *modern* Porter2 stems — `added` -> `add`, `organic` -> `organic`,
 * `geologist` -> `geolog`, `organize` -> `organiz`.
 *
 * The default backend is that exact crate compiled to WASM (`stemmer-wasm/`,
 * built from `tools/stemmer-wasm`, pinned to `pagefind_stem =1.0.0`), so the
 * binding reproduces Pagefind 1.5.0's output byte-for-byte across the full
 * corpus — see `tests/fixtures/stemmer-corpus/PROVENANCE.md`. No npm Snowball
 * package matches: they are all the pre-3.0 algorithm (`added` -> `ad`). The
 * backend stays INJECTABLE via {@link setStemBackend} for testing/overrides.
 */

import { createRequire } from "node:module";

export interface StemBackend {
  stemWord(word: string): string;
}

/** A factory turning a Snowball algorithm name into a backend (or null). */
export type StemBackendFactory = (algorithm: string) => StemBackend | null;

// Language code -> Snowball algorithm name.
const LANGUAGE_MAP: Record<string, string> = {
  ca: "catalan",
  da: "danish",
  de: "german",
  en: "english",
  es: "spanish",
  fi: "finnish",
  fr: "french",
  it: "italian",
  nl: "dutch",
  no: "norwegian",
  pt: "portuguese",
  ro: "romanian",
  ru: "russian",
  sv: "swedish",
};

const CACHE_MAX_ENTRIES = 100_000;

/** The `stem(algorithm, word)` export of the vendored `pagefind_stem` WASM. */
interface StemWasm {
  stem(algorithm: string, word: string): string;
}

let wasm: StemWasm | null = null;
let wasmLoadFailed = false;
let wasmModulePath = "./stemmer-wasm/stemmer_wasm.js";

/**
 * Load the vendored WASM lazily — importing `scolta` shouldn't pay for it.
 *
 * Returns null (after warning once) when the vendored module is missing or
 * corrupt: stemming then degrades to identity instead of every `stem()` call
 * throwing the raw require error.
 */
function loadWasm(): StemWasm | null {
  if (wasm === null && !wasmLoadFailed) {
    try {
      const require = createRequire(import.meta.url);
      wasm = require(wasmModulePath) as StemWasm;
    } catch (exc) {
      wasmLoadFailed = true;
      console.warn(
        `Scolta: failed to load the vendored stemmer WASM (${String(exc)}); ` +
          "falling back to identity stemming — built stems may not match Pagefind query stems.",
      );
    }
  }
  return wasm;
}

/** Default backend: Pagefind's own `pagefind_stem` 1.0.0 crate, compiled to WASM. */
function defaultBackendFactory(algorithm: string): StemBackend | null {
  const w = loadWasm();
  return w === null ? null : { stemWord: (word: string) => w.stem(algorithm, word) };
}

/** Test-only: repoint the WASM loader and reset its memoized state. */
export function __setWasmModulePathForTesting(modulePath: string): void {
  wasmModulePath = modulePath;
  wasm = null;
  wasmLoadFailed = false;
}

let backendFactory: StemBackendFactory = defaultBackendFactory;

/**
 * Override the Snowball backend. Affects Stemmer instances created after the
 * call. Intended for tests; the default WASM backend is the parity-correct one.
 */
export function setStemBackend(factory: StemBackendFactory): void {
  backendFactory = factory;
}

/** Reset to the default `pagefind_stem` WASM backend. */
export function resetStemBackend(): void {
  backendFactory = defaultBackendFactory;
}

export class Stemmer {
  private readonly backend: StemBackend | null;
  private readonly cache = new Map<string, string>();

  constructor(language = "en") {
    const algo = LANGUAGE_MAP[language];
    this.backend = algo !== undefined ? backendFactory(algo) : null;
  }

  /** Stem a word to its root form (unchanged for unsupported languages). */
  stem(word: string): string {
    const cached = this.cache.get(word);
    if (cached !== undefined) {
      return cached;
    }

    const result = this.backend === null ? word : this.backend.stemWord(word);

    if (this.cache.size < CACHE_MAX_ENTRIES) {
      this.cache.set(word, result);
    }

    return result;
  }

  static getSupportedLanguages(): string[] {
    return Object.keys(LANGUAGE_MAP);
  }
}
