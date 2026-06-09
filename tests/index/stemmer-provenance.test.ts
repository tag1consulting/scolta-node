/**
 * Stemmer corpus drift guard.
 *
 * The stemmer corpus is the Pagefind query-stemmer oracle (generated from
 * `pagefind_stem` — see tests/fixtures/stemmer-corpus/PROVENANCE.md). This test
 * pins the fixtures to the sha256 manifest recorded in PROVENANCE.md, so a
 * silent re-baseline (e.g. regenerating against a different Pagefind stemmer
 * revision) fails until the manifest and the targeted-version table are updated
 * in the same commit. It is the cheap counterpart to the full-corpus parity
 * test: that one proves the binding still matches the oracle; this one proves
 * the oracle fixtures themselves have not moved without a paper trail.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const corpus = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "stemmer-corpus");
const LANGS = ["en", "fr", "de", "es", "ru"];

function manifest(): Record<string, { words: string; stems: string }> {
  const text = fs.readFileSync(path.join(corpus, "PROVENANCE.md"), "utf-8");
  const rows: Record<string, { words: string; stems: string }> = {};
  for (const line of text.split("\n")) {
    const m = line.match(
      /^\|\s*(en|fr|de|es|ru)\s*\|\s*`([0-9a-f]{64})`\s*\|\s*`([0-9a-f]{64})`\s*\|/,
    );
    if (m) rows[m[1]!] = { words: m[2]!, stems: m[3]! };
  }
  return rows;
}

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

describe("stemmer corpus provenance", () => {
  it("manifest lists every language", () => {
    expect(Object.keys(manifest()).sort()).toEqual([...LANGS].sort());
  });

  for (const lang of LANGS) {
    it(`${lang} fixtures match PROVENANCE.md`, () => {
      const m = manifest()[lang]!;
      expect(sha256(path.join(corpus, lang, "words.txt")), `${lang}/words.txt changed without updating PROVENANCE.md`).toBe(m.words);
      expect(
        sha256(path.join(corpus, lang, "expected-stems.txt")),
        `${lang}/expected-stems.txt changed without updating PROVENANCE.md — if you re-targeted a new Pagefind stemmer, update the version table too`,
      ).toBe(m.stems);
    });
  }
});
