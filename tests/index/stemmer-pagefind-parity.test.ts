/**
 * Stemmer ⇄ Pagefind parity guard (modern Snowball).
 *
 * Pagefind stems queries at runtime with its bundled WASM. For the Pagefind
 * version this project targets (1.5.0) that WASM is the crate `pagefind_stem`
 * 1.0.0 — published 2026-03-23, after the Snowball 3.0 / 2024 revision — so it
 * emits the *modern* Porter2 algorithm. The default backend here is that exact
 * crate compiled to WASM, so these tells must hold.
 *
 * The tells were read straight out of a `pagefind 1.5.0` build (it stores
 * `added`->`add`, `organic`->`organic`, `geologist`->`geolog`,
 * `organize`->`organiz`). They all DIFFER from the pre-3.0 npm Snowball output
 * (`ad` / `organ` / `geologist` / `organ`), so swapping back to an old backend
 * turns this red rather than silently shipping an index that misses those
 * queries.
 */

import { describe, expect, it } from "vitest";
import { Stemmer } from "../../src/index/stemmer.js";

// word -> modern (Snowball >=3.0 / pagefind_stem 1.0.0 / Pagefind 1.5.0) stem.
// Every pair differs from the old pre-3.0 output, so a backend swap fails loudly.
const PAGEFIND_MODERN: Record<string, string> = {
  added: "add", // old: "ad"
  adding: "add", // old: "ad"
  organic: "organic", // old: "organ"
  organically: "organic", // old: "organ"
  organize: "organiz", // old: "organ"
  organized: "organiz", // old: "organ"
  geologist: "geolog", // old: "geologist"
  geologists: "geolog", // old: "geologist"
  evening: "evening", // old: "even"
  lateral: "lateral", // old: "later"
  paste: "paste", // old: "past"
  pasted: "paste", // old: "past"
  universities: "universiti", // old: "univers"
  vying: "vie", // old: "vy"
};

// Control words: identical under old and modern Porter2 — prove the stemmer is
// still doing real work (not just echoing the input) on the pinned backend.
const CONTROL: Record<string, string> = {
  running: "run",
  fruitlessly: "fruitless",
  generously: "generous",
  national: "nation",
  communism: "communism",
};

describe("Stemmer ⇄ Pagefind parity (modern Porter2)", () => {
  it("Pagefind tells use modern Porter2", () => {
    const stemmer = new Stemmer("en");
    const mismatches: Record<string, string> = {};
    for (const [word, expected] of Object.entries(PAGEFIND_MODERN)) {
      const got = stemmer.stem(word);
      if (got !== expected) mismatches[word] = got;
    }
    expect(
      mismatches,
      `Stemmer drifted off the modern Porter2 Pagefind 1.5.0 uses — was the WASM backend swapped? Got: ${JSON.stringify(mismatches)}`,
    ).toEqual({});
  });

  it("control words stem identically in both algorithms", () => {
    const stemmer = new Stemmer("en");
    for (const [word, expected] of Object.entries(CONTROL)) {
      expect(stemmer.stem(word)).toBe(expected);
    }
  });

  // The canonical tells: modern -> 'add' / 'organic'; pre-3.0 -> 'ad' / 'organ'.
  it("added -> add (not ad)", () => expect(new Stemmer("en").stem("added")).toBe("add"));
  it("organic -> organic (not organ)", () =>
    expect(new Stemmer("en").stem("organic")).toBe("organic"));
});
