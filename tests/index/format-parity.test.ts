/**
 * Parity Gate #3 — CBOR / format-writer (the byte/structural heart).
 *
 * Proofs against the real scolta-php writers (golden in
 * tests/fixtures/index_parity.json, regenerable via parity/index_harness.php):
 *
 * 1. Writer isolation (PRIMARY, stemmer-independent): feed the Python/TS writers
 *    the IDENTICAL PHP-built {index, pages} and assert decoded word postings,
 *    fragments, filters and pf_meta match the golden. Any difference is the
 *    writer's — this is the CBOR/delta/hashing/chunking proof.
 * 2. Controlled corpus -> byte-exact: build from a small corpus with the TS
 *    builder and assert every uncompressed payload matches PHP byte-for-byte.
 *    Gated on stemmer parity (see Phase 4 note): with the non-canonical default
 *    Snowball backend this is documented-skipped where stems diverge.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContentItem } from "../../src/content.js";
import { InvertedIndexBuilder } from "../../src/index/inverted-index-builder.js";
import { PagefindFormatWriter } from "../../src/index/format-writer.js";
import type { IndexPage, InvertedIndex, PageEntry, TermEntry } from "../../src/index/pf-common.js";
import { Stemmer } from "../../src/index/stemmer.js";
import { StreamingFormatWriter } from "../../src/index/streaming-format-writer.js";
import { Tokenizer } from "../../src/index/tokenizer.js";
import { decodeFragment, decodePfFile } from "../support/cbor-decoder.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const golden = JSON.parse(fs.readFileSync(path.join(fixtures, "index_parity.json"), "utf-8"));

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scolta-fmt-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function toMapObj(v: unknown): Record<string, unknown> {
  return Array.isArray(v) || v === null || v === undefined ? {} : (v as Record<string, unknown>);
}

function convEntry(v: any): PageEntry {
  const positions = new Map<number, number[]>();
  if (!Array.isArray(v.positions)) {
    for (const [w, p] of Object.entries(v.positions as Record<string, number[]>)) {
      positions.set(Number(w), (p as number[]).map(Number));
    }
  }
  return { positions, metaPositions: (v.meta_positions as number[]).map(Number) };
}

function loadPhpIndex(): { index: InvertedIndex; pages: Map<number, IndexPage> } {
  const raw = golden.php_built;
  const index: InvertedIndex = new Map();
  for (const [word, entries] of Object.entries(raw.index as Record<string, any>)) {
    const ni: TermEntry = { pages: new Map(), variants: new Map() };
    if (Array.isArray(entries)) {
      entries.forEach((v, pn) => ni.pages.set(pn, convEntry(v)));
    } else {
      for (const [k, v] of Object.entries(entries)) {
        if (k === "_variants") {
          for (const [orig, pgs] of Object.entries(v as Record<string, number[]>)) {
            ni.variants.set(orig, (pgs as number[]).map(Number));
          }
        } else {
          ni.pages.set(Number(k), convEntry(v));
        }
      }
    }
    index.set(word, ni);
  }

  const pages = new Map<number, IndexPage>();
  const rawPages = raw.pages;
  const entries: [number, any][] = Array.isArray(rawPages)
    ? rawPages.map((p: any, i: number) => [i, p])
    : Object.entries(rawPages).map(([k, v]) => [Number(k), v]);
  for (const [pn, page] of entries) {
    pages.set(pn, {
      id: page.id,
      url: page.url,
      title: page.title,
      content: page.content,
      wordCount: page.wordCount,
      date: page.date,
      filters: toMapObj(page.filters) as Record<string, string | string[]>,
      meta: toMapObj(page.meta) as Record<string, string>,
      sortable: toMapObj(page.sortable) as Record<string, string>,
      hash: page.hash,
    });
  }
  return { index, pages };
}

function listFiles(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => path.join(dir, f)) : [];
}

function decodeStructure(buildDir: string): any {
  const words: Record<string, unknown> = {};
  for (const f of listFiles(path.join(buildDir, "index"))) {
    const chunk = decodePfFile(f) as any[];
    for (const [word, pages, variants] of chunk[0] as any[]) {
      words[word] = { pages, variants };
    }
  }

  const fragments: Record<string, unknown> = {};
  for (const f of listFiles(path.join(buildDir, "fragment"))) {
    const j = decodeFragment(f);
    fragments[j["url"] as string] = j;
  }

  const filters: Record<string, unknown> = {};
  for (const f of listFiles(path.join(buildDir, "filter"))) {
    const d = decodePfFile(f) as any[];
    const vals: Record<string, number[]> = {};
    for (const [value, pages] of d[1] as any[]) {
      vals[value] = [...(pages as number[])].sort((a, b) => a - b);
    }
    filters[d[0]] = sortObject(vals);
  }

  const metaFile = listFiles(buildDir).find((f) => /pagefind\..*\.pf_meta$/.test(f))!;
  const meta = decodePfFile(metaFile) as any[];
  const sorts: Record<string, unknown> = {};
  for (const [field, indices] of meta[4] as any[]) sorts[field] = indices;
  const metaOut = {
    version: meta[0],
    pages: meta[1],
    sorts,
    metaFields: meta[5],
    pageCount: (meta[1] as unknown[]).length,
    chunkCount: (meta[2] as unknown[]).length,
  };
  const entry = JSON.parse(fs.readFileSync(path.join(buildDir, "pagefind-entry.json"), "utf-8"));
  return { words: sortObject(words), fragments: sortObject(fragments), filters: sortObject(filters), meta: metaOut, entry };
}

function sortObject<T>(o: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k]!;
  return out;
}

function assertStructure(got: any, g: any): void {
  expect(new Set(Object.keys(got.words))).toEqual(new Set(Object.keys(g.words)));
  for (const term of Object.keys(g.words)) {
    expect(got.words[term], `posting mismatch for ${term}`).toEqual(g.words[term]);
  }
  expect(got.fragments).toEqual(g.fragments);
  expect(got.filters).toEqual(g.filters);
  expect(got.meta.version).toBe(g.meta.version);
  expect(got.meta.metaFields).toEqual(g.meta.metaFields);
  expect(got.meta.sorts).toEqual(g.meta.sorts);
  expect(got.meta.pageCount).toBe(g.meta.pageCount);
  expect(got.meta.pages).toEqual(g.meta.pages);
}

describe("Gate #3 — writer isolation (stemmer-independent)", () => {
  it("streaming writer parity", () => {
    const { index, pages } = loadPhpIndex();
    const out = path.join(tmp, "s");
    const w = new StreamingFormatWriter();
    w.beginWrite(out);
    for (const pn of [...pages.keys()].sort((a, b) => a - b)) w.writePage(pn, pages.get(pn)!);
    for (const term of [...index.keys()].sort()) w.writeTerm(term, index.get(term)!);
    w.endWrite();
    assertStructure(decodeStructure(path.join(out, ".scolta-building")), golden.recipes_streaming);
  });

  it("buffered writer parity", () => {
    const { index, pages } = loadPhpIndex();
    const out = path.join(tmp, "b");
    new PagefindFormatWriter().write(index, pages, out);
    assertStructure(decodeStructure(path.join(out, ".scolta-building")), golden.recipes_buffered);
  });
});

describe("Gate #3 — controlled corpus byte parity", () => {
  it("byte-exact payloads + entry.json", () => {
    const g = golden.controlled_streaming;
    const items = g.items.map(
      (i: any) =>
        new ContentItem({
          id: i.id,
          title: i.title,
          bodyHtml: i.body_html,
          url: i.url,
          date: i.date,
          siteName: i.site_name,
          language: i.language,
          filters: Array.isArray(i.filters) ? {} : i.filters,
          metadata: Array.isArray(i.metadata) ? {} : i.metadata,
          sortable: Array.isArray(i.sortable) ? {} : i.sortable,
        }),
    );
    const built = new InvertedIndexBuilder(new Tokenizer(), new Stemmer("en")).build(items);
    const out = path.join(tmp, "c");
    const w = new StreamingFormatWriter();
    w.beginWrite(out);
    for (const pn of [...built.pages.keys()].sort((a, b) => a - b)) w.writePage(pn, built.pages.get(pn)!);
    for (const term of [...built.index.keys()].sort()) w.writeTerm(term, built.index.get(term)!);
    w.endWrite();

    const bd = path.join(out, ".scolta-building");
    const assetFiles = new Set(["pagefind.js", "pagefind-worker.js", "wasm.en.pagefind", "wasm.unknown.pagefind"]);
    const payloads: Record<string, string> = {};
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (assetFiles.has(entry.name) || entry.name === "pagefind-entry.json") continue;
        let raw = gunzipSync(fs.readFileSync(full));
        if (raw.subarray(0, 12).toString("latin1") === "pagefind_dcd") raw = raw.subarray(12);
        payloads[path.relative(bd, full)] = raw.toString("hex");
      }
    };
    walk(bd);

    expect(payloads).toEqual(g.payloads);
    const entry = JSON.parse(fs.readFileSync(path.join(bd, "pagefind-entry.json"), "utf-8"));
    expect(entry).toEqual(g.entry);
  });
});
