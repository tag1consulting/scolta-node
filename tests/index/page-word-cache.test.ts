/**
 * Phase 7 — token cache efficiency (the "maintain the index" proof).
 *
 * The PageWordCache lives in its own cache subdir, so a fresh-build cleanup
 * never evicts it. These tests prove: a no-change rebuild re-tokenizes zero
 * pages, a one-page edit re-tokenizes exactly one, and a deleted page leaves
 * the index. Plus PageWordCache unit behaviour.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContentItem } from "../../src/content.js";
import { BuildIntent } from "../../src/index/build-intent.js";
import { InvertedIndexBuilder } from "../../src/index/inverted-index-builder.js";
import { MemoryBudget } from "../../src/index/memory-budget.js";
import { IndexBuildOrchestrator } from "../../src/index/orchestrator.js";
import { PageWordCache } from "../../src/index/page-word-cache.js";
import { token } from "../../src/index/token.js";
import { FilesystemDriver } from "../../src/storage.js";
import { decodeFragment } from "../support/cbor-decoder.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const silent = { info() {}, warn() {}, error() {} };

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scolta-pwc-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function items(): ContentItem[] {
  const files = fs.readdirSync(path.join(fixtures, "recipes")).filter((f) => f.endsWith(".html")).sort();
  return files.map((f, i) => {
    const h = fs.readFileSync(path.join(fixtures, "recipes", f), "utf-8");
    return new ContentItem({
      id: String(i + 1),
      title: /<title>([\s\S]*?)<\/title>/.exec(h)![1]!,
      bodyHtml: h,
      url: /data-pagefind-meta="url:([^"]*)"/.exec(h)![1]!,
      date: "2024-01-01",
      siteName: "Recipes",
      language: "en",
    });
  });
}

function buildWithCount(sd: string, od: string, list: ContentItem[], calls: string[]): void {
  const orch = new IndexBuildOrchestrator(sd, od);
  const proto = InvertedIndexBuilder.prototype;
  const original = proto.tokenizeItem;
  proto.tokenizeItem = function (item: ContentItem) {
    calls.push(item.id);
    return original.call(this, item);
  };
  try {
    orch.build(BuildIntent.fresh(list.length, MemoryBudget.default()), list, silent);
  } finally {
    proto.tokenizeItem = original;
  }
}

function urls(od: string): Set<string> {
  const dir = path.join(od, "pagefind", "fragment");
  const out = new Set<string>();
  for (const f of fs.readdirSync(dir)) {
    out.add(decodeFragment(path.join(dir, f))["url"] as string);
  }
  return out;
}

describe("token cache efficiency", () => {
  it("no-change rebuild re-tokenizes zero", () => {
    const sd = path.join(tmp, "s");
    const od = path.join(tmp, "o");
    const list = items();

    const first: string[] = [];
    buildWithCount(sd, od, list, first);
    expect(first.length).toBe(20); // cold cache: all tokenized

    const second: string[] = [];
    buildWithCount(sd, od, list, second);
    expect(second).toEqual([]); // warm cache: zero re-tokenizations
  });

  it("one-page edit re-tokenizes one", () => {
    const sd = path.join(tmp, "s");
    const od = path.join(tmp, "o");
    const list = items();
    buildWithCount(sd, od, list, []);

    const edited = [...list];
    edited[7] = edited[7]!.cloneWith({ bodyHtml: edited[7]!.bodyHtml + "<p>newly added paragraph text</p>" });

    const calls: string[] = [];
    buildWithCount(sd, od, edited, calls);
    expect(calls).toEqual([edited[7]!.id]);
  });

  it("deleted page absent from index", () => {
    const sd = path.join(tmp, "s");
    const od = path.join(tmp, "o");
    const list = items();
    buildWithCount(sd, od, list, []);
    const removedUrl = list[3]!.url;

    const remaining = list.filter((it) => it.id !== list[3]!.id);
    buildWithCount(sd, od, remaining, []);

    const u = urls(od);
    expect(u.has(removedUrl)).toBe(false);
    expect(u.size).toBe(19);
  });
});

describe("PageWordCache unit", () => {
  const td = (content = "hello world content") => ({
    titleTokens: [token("title", "title", 0)],
    bodyTokens: [token("hello", "hello", 1), token("world", "world", 2)],
    urlTokens: [],
    wordCount: 3,
    cleanTitle: "Title",
    content,
  });

  it("put/get round trip", () => {
    const cache = new PageWordCache(path.join(tmp, "c"), new FilesystemDriver());
    cache.put("h1", td());
    const got = cache.get("h1")!;
    expect(got.content).toBe("hello world content");
    expect(got.bodyTokens.map((t) => t.stem)).toEqual(["hello", "world"]);
  });

  it("survives reopen", () => {
    const cdir = path.join(tmp, "c");
    const cache = new PageWordCache(cdir, new FilesystemDriver());
    cache.put("h1", td());
    cache.pruneAndSave();
    expect(new PageWordCache(cdir, new FilesystemDriver()).get("h1")).not.toBeNull();
  });

  it("prune drops unseen", () => {
    const cdir = path.join(tmp, "c");
    const c1 = new PageWordCache(cdir, new FilesystemDriver());
    c1.put("keep", td());
    c1.put("drop", td());
    c1.pruneAndSave();
    const c2 = new PageWordCache(cdir, new FilesystemDriver());
    expect(c2.get("keep")).not.toBeNull();
    c2.pruneAndSave();
    const c3 = new PageWordCache(cdir, new FilesystemDriver());
    expect(c3.get("keep")).not.toBeNull();
    expect(c3.get("drop")).toBeNull();
  });

  it("flush at chunk size", () => {
    const cdir = path.join(tmp, "c");
    const cache = new PageWordCache(cdir, new FilesystemDriver(), 2);
    for (let i = 0; i < 5; i++) cache.put(`h${i}`, td());
    cache.pruneAndSave();
    const reopened = new PageWordCache(cdir, new FilesystemDriver());
    for (let i = 0; i < 5; i++) expect(reopened.get(`h${i}`)).not.toBeNull();
  });
});
