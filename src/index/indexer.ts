/**
 * TS indexer facade (port of `PhpIndexer` -> `TsIndexer`).
 *
 * Thin orchestration over BuildCoordinator / InvertedIndexBuilder / IndexMerger
 * / PageWordCache with the per-chunk processing API queue-based adapters use
 * (processChunk + finalize). New code should prefer IndexBuildOrchestrator.build.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ContentItem } from "../content.js";
import { FilesystemDriver, type StorageDriver } from "../storage.js";
import { BuildIntent } from "./build-intent.js";
import type { BuildResult } from "./build-result.js";
import { CborEncoder } from "./cbor.js";
import { BuildCoordinator } from "./coordinator.js";
import { computeFingerprint, contentHash } from "./fingerprint.js";
import { InvertedIndexBuilder, type ItemMeta, type TokenData } from "./inverted-index-builder.js";
import { MemoryBudget } from "./memory-budget.js";
import { IndexMerger } from "./merger.js";
import { IndexBuildOrchestrator } from "./orchestrator.js";
import { PageWordCache } from "./page-word-cache.js";
import { Stemmer } from "./stemmer.js";
import { StreamingFormatWriter } from "./streaming-format-writer.js";
import { Tokenizer } from "./tokenizer.js";

const CACHE_SUBDIR = "cache";

function proxy(item: ContentItem): ItemMeta {
  return {
    id: item.id,
    url: item.url,
    date: item.date,
    siteName: item.siteName,
    language: item.language,
    filters: item.filters,
    sortable: item.sortable,
  };
}

export class TsIndexer {
  private readonly storage: StorageDriver;
  readonly coordinator: BuildCoordinator;
  private readonly budget: MemoryBudget;
  private readonly builder: InvertedIndexBuilder;
  private readonly merger: IndexMerger;
  private readonly cache: PageWordCache;
  private currentPageOffset = 0;
  private prepared = false;

  constructor(
    private readonly stateDir: string,
    readonly outputDir: string,
    opts: { hmacSecret?: string | null; language?: string; storage?: StorageDriver; budget?: MemoryBudget } = {},
  ) {
    this.storage = opts.storage ?? new FilesystemDriver();
    this.coordinator = new BuildCoordinator(stateDir, opts.hmacSecret ?? null);
    this.budget = opts.budget ?? MemoryBudget.default();
    this.builder = new InvertedIndexBuilder(new Tokenizer(), new Stemmer(opts.language ?? "en"));
    this.merger = new IndexMerger();
    this.cache = new PageWordCache(
      path.join(stateDir, CACHE_SUBDIR),
      this.storage,
      this.budget.chunkSize(),
      this.budget.tokenCacheChunkBytes(),
    );
  }

  static contentHash(item: ContentItem): string {
    return contentHash(item);
  }

  static computeFingerprint(items: ContentItem[]): string {
    return computeFingerprint(items);
  }

  processChunk(items: ContentItem[], chunkNumber: number, totalPages?: number, force = false): number {
    if (!this.prepared) {
      const intent = BuildIntent.fresh(totalPages ?? items.length, this.budget, { language: "en" });
      this.coordinator.prepare(intent);
      this.prepared = true;
    }
    const partial = this.builder.buildFromTokenData(this.tokenizeItems(items, force), this.currentPageOffset);
    this.currentPageOffset += partial.pages.size;
    this.coordinator.commitChunk(chunkNumber, partial);
    return partial.pages.size;
  }

  private tokenizeItems(items: ContentItem[], force: boolean): { item: ItemMeta; tokenData: TokenData }[] {
    const out: { item: ItemMeta; tokenData: TokenData }[] = [];
    for (const item of items) {
      const h = contentHash(item);
      let tokenData = force ? null : this.cache.get(h);
      if (tokenData === null) {
        tokenData = this.builder.tokenizeItem(item);
        if (tokenData !== null) this.cache.put(h, tokenData);
      }
      if (tokenData !== null) out.push({ item: proxy(item), tokenData });
    }
    return out;
  }

  finalize(): BuildResult {
    const startTime = performance.now();
    try {
      const chunkFiles = this.coordinator.chunkFiles();
      if (chunkFiles.length === 0) {
        return { success: false, message: "No chunks to merge", pageCount: 0, fileCount: 0, elapsedSeconds: 0, error: "No chunk files found in state directory" };
      }
      const writer = new StreamingFormatWriter(new CborEncoder(), "", this.budget.fragmentFlushBytes());
      writer.beginWrite(this.outputDir);
      this.merger.mergeStreaming(chunkFiles, writer, this.budget);
      writer.endWrite();
      const pageCount = this.coordinator.pagesProcessed();
      this.atomicSwap();
      IndexBuildOrchestrator.verifyIndexComplete(this.outputDir);
      const fileCount = TsIndexer.countFiles(path.join(this.outputDir, "pagefind"));
      this.coordinator.release();
      this.prepared = false;
      this.cache.pruneAndSave();
      return {
        success: true,
        message: `Built index for ${pageCount} pages (${fileCount} files)`,
        pageCount,
        fileCount,
        elapsedSeconds: Math.round(performance.now() - startTime) / 1000,
      };
    } catch (exc) {
      this.coordinator.releaseLockOnly();
      return { success: false, message: "Build failed", pageCount: 0, fileCount: 0, elapsedSeconds: Math.round(performance.now() - startTime) / 1000, error: String(exc) };
    }
  }

  shouldBuild(items: ContentItem[]): string | null {
    const fingerprint = computeFingerprint(items);
    const stateFile = path.join(this.outputDir, ".scolta-state");
    if (this.storage.exists(stateFile) && this.storage.get(stateFile).trim() === fingerprint) {
      return null;
    }
    return fingerprint;
  }

  private atomicSwap(): void {
    const buildDir = path.join(this.outputDir, ".scolta-building");
    const finalDir = path.join(this.outputDir, "pagefind");
    const oldDir = path.join(this.outputDir, ".scolta-old");
    const newDir = path.join(this.outputDir, ".scolta-new");
    if (!this.storage.exists(buildDir)) throw new Error("Build directory does not exist");
    this.storage.move(buildDir, newDir);
    if (this.storage.exists(finalDir)) this.storage.move(finalDir, oldDir);
    this.storage.move(newDir, finalDir);
    if (this.storage.exists(oldDir)) this.storage.deleteDirectory(oldDir);
  }

  private static countFiles(directory: string): number {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return 0;
    let count = 0;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) count += TsIndexer.countFiles(full);
      else count += 1;
    }
    return count;
  }
}
