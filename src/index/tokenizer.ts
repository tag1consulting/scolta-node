/**
 * Tokenize text for search indexing.
 *
 * Faithful port of `Tag1\Scolta\Index\Tokenizer`, which replicates Pagefind's
 * `pagefind/src/fossick/splitting.rs`: Unicode-aware lowercasing, diacritic
 * normalization (NFD strip marks NFC), word-boundary splitting, compound
 * handling (hyphens, camelCase), and CJK character (bigram) splitting.
 *
 * Parity-critical detail unique to JS: positions are **code-point** offsets, as
 * in the PHP (mb-based) and Python (str-based) references — NOT UTF-16 code-unit
 * offsets. JS `RegExp` match `.index` is a UTF-16 offset, so every word start is
 * converted to a code-point offset, and all intra-word offsets are computed on
 * code-point arrays. Without this, any astral character (emoji, some CJK) would
 * shift every subsequent token's position and break index parity.
 */

import type { Token } from "./token.js";

// Word boundary: runs of letters/numbers/emoji, plus internal apostrophe
// contractions (don't, it's). Identical to the PHP PCRE /u pattern.
const WORD = /[\p{L}\p{N}\p{Emoji_Presentation}]+(?:'[\p{L}]+)*/gu;

// CJK / Hiragana / Katakana / Hangul ranges (same set as the PHP pattern):
// CJK Unified, Ext-A, Compatibility Ideographs, Hiragana, Katakana, Hangul.
const CJK =
  /[一-鿿㐀-䶿豈-﫿぀-ゟ゠-ヿ가-힯]/u;
const CAMEL_DETECT = /[a-z][A-Z]/;
const CAMEL_SPLIT = /(?<=[a-z])(?=[A-Z])/;
const NONSPACING_MARK = /\p{Mn}/gu;

const PHP_TRIM = " \t\n\r\0\x0b";

function phpTrimEmpty(s: string): boolean {
  let start = 0;
  let end = s.length;
  while (start < end && PHP_TRIM.includes(s[start]!)) start++;
  while (end > start && PHP_TRIM.includes(s[end - 1]!)) end--;
  return start === end;
}

/** Count Unicode code points in a string (astral chars count once). */
function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export class Tokenizer {
  tokenize(text: string, startPosition = 0): Token[] {
    if (phpTrimEmpty(text)) {
      return [];
    }

    const tokens: Token[] = [];
    const lowerCache = new Map<string, string>();
    const normalizeCache = new Map<string, string>();

    // Convert each match's UTF-16 index to a code-point offset incrementally.
    let lastUtf16 = 0;
    let lastCp = 0;

    for (const m of text.matchAll(WORD)) {
      const utf16Index = m.index;
      lastCp += codePointLength(text.slice(lastUtf16, utf16Index));
      lastUtf16 = utf16Index;
      const word = m[0];
      const position = startPosition + lastCp;

      for (const [partOffset, part] of Tokenizer.splitCompound(word)) {
        if (part === "") {
          continue;
        }
        let lower = lowerCache.get(part);
        if (lower === undefined) {
          lower = part.toLowerCase();
          lowerCache.set(part, lower);
        }
        let normalized = normalizeCache.get(lower);
        if (normalized === undefined) {
          normalized = Tokenizer.normalize(lower);
          normalizeCache.set(lower, normalized);
        }
        if (normalized === "") {
          continue;
        }
        tokens.push({ stem: normalized, original: lower, position: position + partOffset });
      }
    }

    return tokens;
  }

  /** Strip diacritics via NFD -> remove nonspacing marks -> NFC. */
  static normalize(text: string): string {
    const nfd = text.normalize("NFD");
    const stripped = nfd.replace(NONSPACING_MARK, "");
    return stripped.normalize("NFC");
  }

  /**
   * Split compound words (hyphens, camelCase) and CJK into parts. Returns an
   * ordered Map of code-point offset -> part (insertion order matches PHP/Python).
   */
  static splitCompound(word: string): Map<number, string> {
    if (CJK.test(word)) {
      return Tokenizer.tokenizeMixedCjk(word);
    }

    // Hyphen: "mother-in-law" -> mother, in, law, motherinlaw (parts + join).
    if (word.includes("-")) {
      const parts = new Map<number, string>();
      let offset = 0;
      for (const segment of word.split("-")) {
        const segLen = codePointLength(segment);
        if (segLen >= 2) {
          parts.set(offset, segment);
        }
        offset += segLen + 1;
      }
      const compound = word.split("-").join("");
      if (codePointLength(compound) >= 3 && parts.size > 1) {
        parts.set(codePointLength(word) + 1, compound);
      }
      return parts.size > 0 ? parts : new Map([[0, word]]);
    }

    // camelCase: "myPageTitle" -> my, page, title (lowercased here).
    if (CAMEL_DETECT.test(word)) {
      const segments = word.split(CAMEL_SPLIT);
      if (segments.length > 1) {
        const parts = new Map<number, string>();
        let offset = 0;
        for (const segment of segments) {
          const lower = segment.toLowerCase();
          if (codePointLength(lower) >= 2) {
            parts.set(offset, lower);
          }
          offset += codePointLength(segment);
        }
        return parts.size > 0 ? parts : new Map([[0, word]]);
      }
    }

    return new Map([[0, word]]);
  }

  /**
   * Bigram-tokenize a word with CJK characters. Non-CJK runs emit one token;
   * CJK runs of length >= 2 emit overlapping bigrams; a single CJK character is
   * emitted as-is.
   */
  static tokenizeMixedCjk(word: string): Map<number, string> {
    const chars = [...word];
    const parts = new Map<number, string>();

    const flush = (startOffset: number, runChars: string[], isCjk: boolean): void => {
      const count = runChars.length;
      if (count === 0) {
        return;
      }
      if (!isCjk) {
        parts.set(startOffset, runChars.join(""));
      } else if (count === 1) {
        parts.set(startOffset, runChars[0]!);
      } else {
        for (let i = 0; i < count - 1; i++) {
          parts.set(startOffset + i, runChars[i]! + runChars[i + 1]!);
        }
      }
    };

    let runStart = 0;
    let runChars: string[] = [];
    let runIsCjk: boolean | null = null;

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]!;
      const isCjk = CJK.test(ch);
      if (runIsCjk === null) {
        runIsCjk = isCjk;
        runStart = i;
      }
      if (isCjk !== runIsCjk) {
        flush(runStart, runChars, runIsCjk);
        runStart = i;
        runChars = [];
        runIsCjk = isCjk;
      }
      runChars.push(ch);
    }

    flush(runStart, runChars, runIsCjk ?? false);
    return parts;
  }
}
