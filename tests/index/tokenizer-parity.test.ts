/**
 * Parity Gate #2 (tokenizer half).
 *
 * Asserts the TS Tokenizer reproduces, token-for-token, the output of the real
 * PHP Tokenizer for 29 cases (diacritics/NFD, camelCase, hyphen/compound,
 * CJK/Hiragana/Katakana/Hangul bigrams, emoji, contractions, German ß,
 * apostrophes, real recipe prose). The golden was generated from scolta-php's
 * actual Tokenizer via parity/tokenizer_harness.php and committed.
 *
 * Each golden token is [stem(normalized), original, position]; positions are
 * code-point offsets.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Tokenizer } from "../../src/index/tokenizer.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const golden = JSON.parse(fs.readFileSync(path.join(fixtures, "tokenizer_parity.json"), "utf-8")) as {
  tokenizer_cases: Record<string, { input: string; start: number; tokens: [string, string, number][] }>;
};

describe("Tokenizer parity", () => {
  const tok = new Tokenizer();
  for (const name of Object.keys(golden.tokenizer_cases).sort()) {
    it(name, () => {
      const c = golden.tokenizer_cases[name]!;
      const got = tok.tokenize(c.input, c.start).map((t) => [t.stem, t.original, t.position]);
      expect(got).toEqual(c.tokens);
    });
  }
});
