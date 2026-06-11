/**
 * Stemmer tests — Parity Gate #2 (stemmer half).
 *
 * Ports tests/Index/StemmerTest.php (1:1) plus the full-corpus parity gate.
 *
 * The corpus (en/fr/de/es/ru) is the Pagefind query-stemmer oracle: the output
 * of `pagefind_stem` 1.0.0, the crate Pagefind 1.5.0 stems queries with at
 * runtime (modern Snowball — `added` -> `add`, `organic` -> `organic`). The
 * default backend is that exact crate compiled to WASM, so this gate asserts
 * byte-exact parity rather than being skipped. See the fixtures' PROVENANCE.md.
 *
 * (History: this gate was previously skipped because every npm Snowball package
 * is the pre-3.0 algorithm — `added` -> `ad` — and diverges from Pagefind on a
 * minority of words per language. Compiling Pagefind's own crate to WASM removes
 * that gap entirely instead of chasing a matching JS port.)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __setWasmModulePathForTesting, Stemmer } from "../../src/index/stemmer.js";

const corpus = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "stemmer-corpus",
);
const LANGS = ["en", "fr", "de", "es", "ru"];

// The default WASM backend is Pagefind's own crate — assert byte-exact parity.
describe("full corpus parity (pagefind_stem WASM == Pagefind 1.5.0)", () => {
  for (const lang of LANGS) {
    it(lang, () => {
      const words = fs.readFileSync(path.join(corpus, lang, "words.txt"), "utf-8").split("\n");
      const expected = fs
        .readFileSync(path.join(corpus, lang, "expected-stems.txt"), "utf-8")
        .split("\n");
      expect(words.length).toBe(expected.length);
      const stemmer = new Stemmer(lang);
      const mismatches: [string, string, string][] = [];
      for (let i = 0; i < words.length; i++) {
        const got = stemmer.stem(words[i]!);
        if (got !== expected[i]) mismatches.push([words[i]!, expected[i]!, got]);
      }
      expect(mismatches, `${lang}: ${mismatches.length} mismatches e.g. ${JSON.stringify(mismatches.slice(0, 8))}`).toEqual([]);
    });
  }
});

// -- StemmerTest.php (1:1) — basic stems agreed across all backends ----------

describe("Stemmer (basic)", () => {
  it("english running -> run", () => expect(new Stemmer("en").stem("running")).toBe("run"));
  it("english walks -> walk", () => expect(new Stemmer("en").stem("walks")).toBe("walk"));
  it("english cats -> cat", () => expect(new Stemmer("en").stem("cats")).toBe("cat"));
  it("english computing -> comput", () => expect(new Stemmer("en").stem("computing")).toBe("comput"));

  it("unsupported language fallback", () => expect(new Stemmer("xx").stem("hello")).toBe("hello"));
  it("unsupported arabic fallback", () => expect(new Stemmer("ar").stem("hello")).toBe("hello"));
  it("unsupported polish fallback", () => expect(new Stemmer("pl").stem("test")).toBe("test"));

  it("french stemmer returns a string", () => {
    const r = new Stemmer("fr").stem("maisons");
    expect(typeof r).toBe("string");
    expect(r).toBeTruthy();
  });

  it("german stemmer returns a string", () => {
    expect(typeof new Stemmer("de").stem("Häuser")).toBe("string");
  });

  it("catalan stemmer returns a string", () => {
    const r = new Stemmer("ca").stem("casals");
    expect(typeof r).toBe("string");
    expect(r).toBeTruthy();
  });

  it("stem idempotent", () => {
    const s = new Stemmer("en");
    const stemmed = s.stem("running");
    expect(s.stem(stemmed)).toBe(stemmed);
  });

  it("stem consistent whether cached or recomputed", () => {
    const s = new Stemmer("en");
    for (const word of ["running", "cats", "computing", "walks", "testing", "indexing"]) {
      expect(s.stem(word)).toBe(s.stem(word));
    }
  });

  it("get supported languages (14)", () => {
    const langs = Stemmer.getSupportedLanguages();
    expect(langs).toContain("en");
    expect(langs).toContain("fr");
    expect(langs).toContain("ca");
    expect(langs.length).toBe(14);
  });
});

describe("WASM load failure", () => {
  afterEach(() => {
    __setWasmModulePathForTesting("./stemmer-wasm/stemmer_wasm.js");
  });

  it("falls back to identity stemming and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      __setWasmModulePathForTesting("./stemmer-wasm/does-not-exist.js");
      const s = new Stemmer("en");
      expect(s.stem("running")).toBe("running");
      expect(s.stem("added")).toBe("added");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toContain("identity stemming");
      // A second Stemmer doesn't retry the load or warn again.
      expect(new Stemmer("fr").stem("mangées")).toBe("mangées");
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("recovers once the module path is valid again", () => {
    __setWasmModulePathForTesting("./stemmer-wasm/stemmer_wasm.js");
    expect(new Stemmer("en").stem("running")).toBe("run");
  });
});
