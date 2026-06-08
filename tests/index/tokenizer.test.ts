/**
 * Tokenizer unit tests — Parity Gate #2.
 *
 * Ports tests/Index/TokenizerTest.php and tests/Tokenizer/CjkBigramTest.php
 * (1:1). The full-token-stream golden gate is in tokenizer-parity.test.ts.
 */

import { describe, expect, it } from "vitest";
import { Tokenizer } from "../../src/index/tokenizer.js";

const tok = new Tokenizer();
const stems = (text: string): string[] => tok.tokenize(text).map((t) => t.stem);

describe("Tokenizer (TokenizerTest.php)", () => {
  it("basic words", () => {
    expect(tok.tokenize("Hello World").map((t) => t.stem)).toEqual(["hello", "world"]);
  });

  it("diacritic normalization", () => {
    const tokens = tok.tokenize("café");
    expect(tokens.length).toBe(1);
    expect(tokens[0]!.stem).toBe("cafe");
    expect(tokens[0]!.original).toBe("café");
  });

  it("hyphen splitting", () => {
    const s = stems("mother-in-law");
    expect(s).toContain("mother");
    expect(s).toContain("in");
    expect(s).toContain("law");
  });

  it("camel case splitting", () => {
    const s = stems("myPage");
    expect(s).toContain("my");
    expect(s).toContain("page");
  });

  it("numbers", () => {
    expect(stems("123abc")).toContain("123abc");
  });

  it("empty input", () => {
    expect(tok.tokenize("")).toEqual([]);
  });

  it("whitespace only", () => {
    expect(tok.tokenize("   ")).toEqual([]);
  });

  it("position tracking", () => {
    const tokens = tok.tokenize("hello world");
    expect(tokens[0]!.position).toBe(0);
    expect(tokens[1]!.position).toBe(6);
  });

  it("start position offset", () => {
    expect(tok.tokenize("hello", 100)[0]!.position).toBe(100);
  });

  it("punctuation stripped", () => {
    const s = stems("hello, world!");
    expect(s).toContain("hello");
    expect(s).toContain("world");
  });

  it("multiple spaces", () => {
    expect(stems("hello   world")).toEqual(["hello", "world"]);
  });

  it("unicode lowercasing", () => {
    expect(tok.tokenize("ÜBER")[0]!.stem).toBe("uber");
  });

  it("cjk splitting", () => {
    const tokens = tok.tokenize("你好世界");
    expect(tokens.length).toBe(3);
    const s = tokens.map((t) => t.stem);
    expect(s).toContain("你好");
    expect(s).toContain("好世");
    expect(s).toContain("世界");
  });

  it("mixed content", () => {
    expect(tok.tokenize("Hello café 123").length).toBeGreaterThanOrEqual(3);
  });
});

describe("Tokenizer CJK bigrams (CjkBigramTest.php)", () => {
  it("pure cjk four chars", () => {
    const s = stems("人工智能");
    expect(s).toContain("人工");
    expect(s).toContain("工智");
    expect(s).toContain("智能");
    for (const single of ["人", "工", "智", "能"]) {
      expect(s).not.toContain(single);
    }
  });

  it("single cjk char emitted alone", () => {
    expect(stems("猫")).toEqual(["猫"]);
  });

  it("mixed latin-cjk-latin", () => {
    const s = stems("Hello人工智能World");
    expect(s).toContain("hello");
    expect(s).toContain("人工");
    expect(s).toContain("工智");
    expect(s).toContain("智能");
    expect(s).toContain("world");
  });

  it("hiragana bigrams", () => {
    const s = stems("おはよう");
    expect(s).toContain("おは");
    expect(s).toContain("はよ");
    expect(s).toContain("よう");
    for (const single of ["お", "は", "よ", "う"]) {
      expect(s).not.toContain(single);
    }
  });

  it("korean bigrams", () => {
    const s = stems("안녕하세요");
    expect(s).toContain("안녕");
    expect(s).toContain("녕하");
    expect(s).toContain("하세");
    expect(s).toContain("세요");
  });

  it("two cjk chars", () => {
    const s = stems("日本");
    expect(s).toContain("日本");
    expect(s.length).toBe(1);
  });

  it("pure latin", () => {
    expect(stems("hello world")).toEqual(["hello", "world"]);
  });

  it("russian unaffected", () => {
    const s = stems("физика");
    expect(s.length).toBeGreaterThan(0);
    for (const stem of s) {
      expect(stem.length).toBeGreaterThan(1);
    }
  });
});
