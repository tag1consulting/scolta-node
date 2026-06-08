/**
 * Snowball stemmer (port of `Tag1\Scolta\Index\Stemmer`).
 *
 * Stems words for 14 languages, memoized. The reference bindings (scolta-php via
 * wamania/php-stemmer, scolta-python via snowballstemmer) and scolta-core (Rust
 * rust-stemmers / the WASM) all agree on a single canonical Snowball variant —
 * e.g. English `added` -> `add`. The committed stemmer corpus encodes that
 * variant, and the on-disk index format parity (Gate #3) depends on it.
 *
 * The actual Snowball implementation is INJECTABLE via {@link setStemBackend}
 * so the parity-correct backend can be supplied without touching call sites.
 * See PARITY NOTE in stemmer-corpus.test.ts: the default `snowball-stemmers`
 * npm backend is an OLDER Snowball algorithm revision that diverges from the
 * canonical corpus on a minority of words across every language, so the
 * full-corpus parity gate is documented-skipped pending a canonical backend.
 */

import { newStemmer } from "snowball-stemmers";

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

/** Default backend: the `snowball-stemmers` npm package. */
function defaultBackendFactory(algorithm: string): StemBackend | null {
  const s = newStemmer(algorithm);
  return { stemWord: (word: string) => s.stem(word) };
}

let backendFactory: StemBackendFactory = defaultBackendFactory;

/**
 * Override the Snowball backend (e.g. a canonical modern-Snowball JS port).
 * Affects Stemmer instances created after the call.
 */
export function setStemBackend(factory: StemBackendFactory): void {
  backendFactory = factory;
}

/** Reset to the default `snowball-stemmers` backend. */
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
