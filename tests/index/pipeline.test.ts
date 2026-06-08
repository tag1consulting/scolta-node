/**
 * End-to-end build pipeline: full build -> valid index, resume ≡ uninterrupted,
 * tiny chunk ≡ single chunk. Plus DTO/coordinator unit behaviour and chunk-io /
 * merger round-trips.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContentItem } from "../../src/content.js";
import { BuildIntent, BuildIntentFactory } from "../../src/index/build-intent.js";
import { StatusReport } from "../../src/index/build-result.js";
import { BuildCoordinator } from "../../src/index/coordinator.js";
import { ChunkReader, ChunkWriter } from "../../src/index/chunk-io.js";
import { InvertedIndexBuilder } from "../../src/index/inverted-index-builder.js";
import { IndexMerger } from "../../src/index/merger.js";
import { MemoryBudget } from "../../src/index/memory-budget.js";
import { NullProgressReporter } from "../../src/index/progress.js";
import { Stemmer } from "../../src/index/stemmer.js";
import { Tokenizer } from "../../src/index/tokenizer.js";
import { IndexBuildOrchestrator } from "../../src/index/orchestrator.js";
import { decodePfFile } from "../support/cbor-decoder.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const silent = { info() {}, warn() {}, error() {} };

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scolta-pipe-"));
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

/** Decode the full index into a canonical, page-number-independent structure. */
function decodeWords(od: string): Record<string, unknown> {
  const dir = path.join(od, "pagefind", "index");
  const words: Record<string, unknown> = {};
  for (const f of fs.readdirSync(dir)) {
    const chunk = decodePfFile(path.join(dir, f)) as any[];
    for (const [word, pages, variants] of chunk[0] as any[]) {
      words[word] = { pages, variants };
    }
  }
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(words).sort()) sorted[k] = words[k];
  return sorted;
}

describe("full build", () => {
  it("produces a valid index over the recipe corpus", () => {
    const sd = path.join(tmp, "s");
    const od = path.join(tmp, "o");
    const report = new IndexBuildOrchestrator(sd, od).build(
      BuildIntent.fresh(20, MemoryBudget.default()),
      items(),
      silent,
    );
    expect(report.success).toBe(true);
    expect(report.pagesProcessed).toBe(20);
    // entry.json valid + 20 fragments.
    IndexBuildOrchestrator.verifyIndexComplete(od);
    const fragDir = path.join(od, "pagefind", "fragment");
    expect(fs.readdirSync(fragDir).filter((f) => f.endsWith(".pf_fragment")).length).toBe(20);
    // The built dir must be servable: the Pagefind runtime assets are copied in
    // (guards the copyAssets path-resolution regression caught in the E2E).
    for (const asset of ["pagefind.js", "wasm.en.pagefind"]) {
      expect(fs.existsSync(path.join(od, "pagefind", asset)), `missing runtime asset ${asset}`).toBe(true);
    }
    // A common recipe term resolves in the index.
    expect("recip" in decodeWords(od) || "recipe" in decodeWords(od)).toBe(true);
  });
});

describe("tiny chunk ≡ single chunk", () => {
  it("chunkSize 1 yields the same decoded index as one big chunk", () => {
    const list = items();
    const odBig = path.join(tmp, "big");
    new IndexBuildOrchestrator(path.join(tmp, "sbig"), odBig).build(
      BuildIntent.fresh(list.length, MemoryBudget.default().withChunkSize(100)),
      list,
      silent,
    );
    const odTiny = path.join(tmp, "tiny");
    new IndexBuildOrchestrator(path.join(tmp, "stiny"), odTiny).build(
      BuildIntent.fresh(list.length, MemoryBudget.default().withChunkSize(1)),
      list,
      silent,
    );
    expect(decodeWords(odTiny)).toEqual(decodeWords(odBig));
  });
});

describe("resume ≡ uninterrupted", () => {
  it("a memory-yield + resume equals a clean build", () => {
    const list = items();

    // Uninterrupted reference.
    const odRef = path.join(tmp, "ref");
    new IndexBuildOrchestrator(path.join(tmp, "sref"), odRef).build(
      BuildIntent.fresh(list.length, MemoryBudget.default().withChunkSize(5)),
      list,
      silent,
    );

    // Interrupted: probe always trips, so the build yields after the first
    // chunk (5 pages) with memory_abort.
    const sd = path.join(tmp, "s2");
    const od = path.join(tmp, "o2");
    const r1 = new IndexBuildOrchestrator(sd, od, { memoryPressureProbe: () => true }).build(
      BuildIntent.fresh(list.length, MemoryBudget.default().withChunkSize(5)),
      list,
      silent,
    );
    expect(r1.success).toBe(false);
    expect(r1.error).toBe("memory_abort");

    // Resume with the REMAINING pages (offset continues from pages_processed).
    const r2 = new IndexBuildOrchestrator(sd, od).build(
      BuildIntent.resume(MemoryBudget.default().withChunkSize(5)),
      list.slice(5),
      silent,
    );
    expect(r2.success).toBe(true);
    expect(decodeWords(od)).toEqual(decodeWords(odRef));
  });
});

describe("build DTOs + coordinator", () => {
  it("build intent modes", () => {
    const b = MemoryBudget.default();
    expect(BuildIntent.fresh(10, b).mode).toBe("fresh");
    expect(BuildIntent.fresh(10, b).isFresh()).toBe(true);
    expect(BuildIntent.restart(10, b).isFresh()).toBe(true);
    expect(BuildIntent.resume(b).mode).toBe("resume");
    expect(BuildIntent.resume(b).isFresh()).toBe(false);
    expect(BuildIntent.resume(b).totalPages).toBeNull();
  });

  it("build intent factory", () => {
    const b = MemoryBudget.default();
    expect(BuildIntentFactory.fromFlags(true, false, 5, b).mode).toBe("resume");
    expect(BuildIntentFactory.fromFlags(false, true, 5, b).mode).toBe("restart");
    expect(BuildIntentFactory.fromFlags(false, false, 5, b).mode).toBe("fresh");
  });

  it("status report to build result", () => {
    const sr = new StatusReport({
      version: "1.0.0",
      pagefindVersion: "1.5.0",
      resolvedIndexer: "ts",
      pagesProcessed: 42,
      chunksWritten: 3,
      peakMemoryBytes: 50 * 1024 * 1024,
      memoryBudgetBytes: 96 * 1024 * 1024,
      durationSeconds: 1.5,
      outputDir: "/out",
      success: true,
    });
    const br = sr.toBuildResult();
    expect(br.success).toBe(true);
    expect(br.pageCount).toBe(42);
    expect(br.message).toContain("42 pages");
  });

  it("null progress reporter is noop", () => {
    const r = new NullProgressReporter();
    r.start(5, "x");
    r.advance(1, "y");
    r.finish("done");
  });

  it("coordinator prepare fresh then resume", () => {
    const b = MemoryBudget.default();
    const sd = path.join(tmp, "co");
    const c = new BuildCoordinator(sd);
    c.prepare(BuildIntent.fresh(2, b));
    c.commitChunk(0, { pages: new Map([[0, {} as any]]), index: new Map() });
    c.releaseLockOnly();
    const manifest = new BuildCoordinator(sd).prepare(BuildIntent.resume(b));
    expect(manifest["chunks_written"]).toBe(1);
  });

  it("coordinator resume without state raises", () => {
    expect(() => new BuildCoordinator(path.join(tmp, "none")).prepare(BuildIntent.resume(MemoryBudget.default()))).toThrow(
      /No resumable build/,
    );
  });

  it("coordinator fresh rejected when running", () => {
    const b = MemoryBudget.default();
    const sd = path.join(tmp, "run");
    new BuildCoordinator(sd).prepare(BuildIntent.fresh(1, b));
    expect(() => new BuildCoordinator(sd).prepare(BuildIntent.fresh(1, b))).toThrow(/already running/);
  });
});

describe("chunk-io + merger round-trips", () => {
  it("chunk write/read round-trips pages and terms + crc", () => {
    const built = new InvertedIndexBuilder(new Tokenizer(), new Stemmer("en")).build(items().slice(0, 3));
    const p = path.join(tmp, "chunk-000.dat");
    new ChunkWriter().write(p, built);
    expect(new ChunkReader(p).verifyCrc32()).toBe(true);
    const pages = new Map([...new ChunkReader(p).openPages()]);
    const index = new Map([...new ChunkReader(p).openIndex()]);
    expect(pages.size).toBe(built.pages.size);
    expect(index.size).toBe(built.index.size);
  });

  it("hmac verification round-trips", () => {
    const built = new InvertedIndexBuilder(new Tokenizer(), new Stemmer("en")).build(items().slice(0, 2));
    const p = path.join(tmp, "chunk-h.dat");
    new ChunkWriter().write(p, built, "secret");
    expect(new ChunkReader(p).verifyHmac("secret")).toBe(true);
    expect(new ChunkReader(p).verifyHmac("wrong")).toBe(false);
  });

  it("merge of two partials unions the vocabulary", () => {
    const builder = new InvertedIndexBuilder(new Tokenizer(), new Stemmer("en"));
    const a = builder.build(items().slice(0, 2), 0);
    const b = builder.build(items().slice(2, 4), a.pages.size);
    const merged = new IndexMerger().merge([a, b]);
    expect(merged.pages.size).toBe(a.pages.size + b.pages.size);
    expect(merged.index.size).toBeGreaterThanOrEqual(Math.max(a.index.size, b.index.size));
  });
});
