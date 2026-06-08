/**
 * InvertedIndexBuilder tests.
 *
 * Ports tests/Index/PageNumberingTest.php invariants (sequential / gap-free /
 * page-offset / valid-index-range), core builder behaviours, and a lightweight
 * posting-list validity check over the recipe corpus (self-consistent: index and
 * fragment re-stemming use the same Stemmer, so it holds regardless of backend).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContentItem } from "../../src/content.js";
import { InvertedIndexBuilder } from "../../src/index/inverted-index-builder.js";
import { Stemmer } from "../../src/index/stemmer.js";
import { StreamingFormatWriter } from "../../src/index/streaming-format-writer.js";
import { Tokenizer } from "../../src/index/tokenizer.js";
import { decodePfFile, decodeFragment } from "../support/cbor-decoder.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

function builder(): InvertedIndexBuilder {
  return new InvertedIndexBuilder(new Tokenizer(), new Stemmer("en"));
}

function item(id: string, body = ""): ContentItem {
  const b = body || `This is a sufficient body text for item ${id} to pass the minimum length check.`;
  return new ContentItem({ id, title: `Title for ${id}`, bodyHtml: `<p>${b}</p>`, url: `/${id}`, date: "2024-01-01" });
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scolta-iib-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("page numbering", () => {
  it("sequential pages", () => {
    const result = builder().build([item("item-0"), item("item-1"), item("item-2")]);
    expect([...result.pages.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it("skipped items do not gap page numbers", () => {
    const items = [
      item("item-a", "This is a sufficient body text to pass the minimum character length check."),
      new ContentItem({ id: "item-skip", title: "Short", bodyHtml: "<p>Too short</p>", url: "/skip", date: "2024-01-01" }),
      item("item-c", "Another sufficient body text for item c that passes the length requirement."),
    ];
    const result = builder().build(items);
    expect([...result.pages.keys()].sort((a, b) => a - b)).toEqual([0, 1]);
    expect(result.pages.size).toBe(2);
  });

  it("word entry page references are valid indices", () => {
    const items = [
      item("x", "The quick brown fox searches for information online quickly."),
      item("y", "The search engine processes all the searching queries carefully."),
      item("z", "No matching words here, completely unrelated content about databases."),
    ];
    const result = builder().build(items);
    const valid = new Set([...Array(result.pages.size).keys()]);
    for (const [word, entry] of result.index) {
      for (const pageNum of entry.pages.keys()) {
        expect(valid.has(pageNum), `word ${word} references invalid page ${pageNum}`).toBe(true);
      }
    }
  });

  it("page offset produces globally unique numbers", () => {
    const c0 = builder().build(
      [item("c0-a", "First chunk first item with adequate body text for indexing purposes here."), item("c0-b", "First chunk second item with adequate body text for indexing purposes here.")],
      0,
    );
    const offset = c0.pages.size;
    const c1 = builder().build(
      [item("c1-a", "Second chunk first item with adequate body text for indexing purposes here."), item("c1-b", "Second chunk second item with adequate body text for indexing purposes here.")],
      offset,
    );
    const allKeys = [...c0.pages.keys(), ...c1.pages.keys()];
    expect(allKeys.length).toBe(new Set(allKeys).size);
    expect([...allKeys].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });
});

describe("builder behaviours", () => {
  it("tokenizeItem skips short content", () => {
    expect(builder().tokenizeItem(new ContentItem({ id: "s", title: "T", bodyHtml: "<p>hi</p>", url: "/s", date: "2024-01-01" }))).toBeNull();
  });

  it("content field prefixes title", () => {
    const td = builder().tokenizeItem(item("a", "Body content here that is long enough to index properly."))!;
    expect(td.content.startsWith(td.cleanTitle + ". ")).toBe(true);
  });

  it("title tokens go to meta positions", () => {
    const it1 = new ContentItem({ id: "p", title: "Zucchini", bodyHtml: "<p>" + "filler word ".repeat(20) + "</p>", url: "/p", date: "2024-01-01" });
    const result = builder().build([it1]);
    expect(result.index.has("zucchini")).toBe(true);
    const entry = result.index.get("zucchini")!.pages.get(0)!;
    expect(entry.metaPositions.length).toBeGreaterThan(0);
    expect(entry.positions.size).toBe(0);
  });

  it("body tokens go to positions", () => {
    const it1 = new ContentItem({ id: "p", title: "Title", bodyHtml: "<p>" + "cucumber ".repeat(5) + "</p>", url: "/p", date: "2024-01-01" });
    const result = builder().build([it1]);
    const entry = result.index.get("cucumb")!.pages.get(0)!;
    expect(entry.positions.get(InvertedIndexBuilder.BODY_WEIGHT)).toBeTruthy();
  });

  it("word count is title plus body", () => {
    const td = builder().tokenizeItem(item("a", "one two three four five six seven eight nine ten."))!;
    expect(td.wordCount).toBe(td.titleTokens.length + td.bodyTokens.length);
  });
});

describe("posting-list validity (recipe corpus)", () => {
  it("indexed words appear in referenced fragments", () => {
    const tok = new Tokenizer();
    const stem = new Stemmer("en");
    const items: ContentItem[] = [];
    const files = fs.readdirSync(path.join(fixtures, "recipes")).filter((f) => f.endsWith(".html")).sort();
    files.forEach((f, i) => {
      const html = fs.readFileSync(path.join(fixtures, "recipes", f), "utf-8");
      const title = /<title>([\s\S]*?)<\/title>/.exec(html)![1]!;
      const url = /data-pagefind-meta="url:([^"]*)"/.exec(html)![1]!;
      items.push(new ContentItem({ id: String(i + 1), title, bodyHtml: html, url, date: "2024-01-01", siteName: "Recipes", language: "en" }));
    });

    const built = new InvertedIndexBuilder(tok, stem).build(items);
    const out = path.join(tmp, "idx");
    const w = new StreamingFormatWriter();
    w.beginWrite(out);
    for (const pn of [...built.pages.keys()].sort((a, b) => a - b)) w.writePage(pn, built.pages.get(pn)!);
    for (const term of [...built.index.keys()].sort()) w.writeTerm(term, built.index.get(term)!);
    w.endWrite();

    const bd = path.join(out, ".scolta-building");
    const fragStems = new Map<string, Set<string>>();
    for (const f of fs.readdirSync(path.join(bd, "fragment"))) {
      const j = decodeFragment(path.join(bd, "fragment", f));
      const text = (j["content"] as string) ?? "";
      const title = ((j["meta"] as Record<string, string>) ?? {})["title"] ?? "";
      const urlPath = ((j["url"] as string) ?? "").replace(/\.\w+$/, "");
      const urlText = urlPath.split("/").filter((s) => s).join(" ");
      const stems = new Set<string>();
      for (const src of [text, title, urlText]) {
        for (const t of tok.tokenize(src)) stems.add(stem.stem(t.stem));
      }
      fragStems.set(f.replace(/\.pf_fragment$/, ""), stems);
    }

    const metaFile = fs.readdirSync(bd).find((f) => /pagefind\..*\.pf_meta$/.test(f))!;
    const meta = decodePfFile(path.join(bd, metaFile)) as any[];
    const pagesMeta = meta[1] as [string, number][];

    const failures: [string, number][] = [];
    for (const f of fs.readdirSync(path.join(bd, "index"))) {
      const chunk = decodePfFile(path.join(bd, "index", f)) as any[];
      for (const [word, pageRefs] of chunk[0] as any[]) {
        let running = 0;
        for (const ref of pageRefs as any[]) {
          running += ref[0];
          const fragHash = pagesMeta[running]![0];
          if (!fragStems.get(fragHash)?.has(word)) failures.push([word, running]);
        }
      }
    }
    expect(failures, `${failures.length} indexed words not in fragments: ${JSON.stringify(failures.slice(0, 10))}`).toEqual([]);
  });
});
