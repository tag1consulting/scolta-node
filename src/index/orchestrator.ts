/**
 * The chunk-loop indexing pipeline (port of `IndexBuildOrchestrator`).
 *
 * prepare -> chunk-loop -> merge -> write -> atomic-swap -> verify, with
 * memory-yield exits (`memory_abort` mid-loop, `index_only_complete` after
 * indexing) and resume. The token cache makes rebuilds cheap; cross-build
 * caches live in their own subdir so a fresh-build cleanup never eats them.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ContentItem } from "../content.js";
import { FilesystemDriver, type StorageDriver } from "../storage.js";
import type { BuildIntent } from "./build-intent.js";
import { StatusReport } from "./build-result.js";
import { CachedContentReference } from "./cached-reference.js";
import { CborEncoder } from "./cbor.js";
import { BuildCoordinator } from "./coordinator.js";
import { contentHash } from "./fingerprint.js";
import { InvertedIndexBuilder, type ItemMeta, type TokenData } from "./inverted-index-builder.js";
import { MemoryBudget } from "./memory-budget.js";
import { MemoryTelemetry, type Logger, type MemoryTelemetryOptions } from "./memory-telemetry.js";
import { IndexMerger } from "./merger.js";
import { PageWordCache } from "./page-word-cache.js";
import { NullProgressReporter, type ProgressReporter } from "./progress.js";
import { Stemmer } from "./stemmer.js";
import { StreamingFormatWriter } from "./streaming-format-writer.js";
import { SupportedVersions } from "./supported-versions.js";
import { TimestampManifest } from "./timestamp-manifest.js";
import { Tokenizer } from "./tokenizer.js";

const VERSION = "1.0.0";
const CACHE_SUBDIR = "cache";

function proxy(page: ContentItem | CachedContentReference): ItemMeta {
  return {
    id: page.id,
    url: page.url,
    date: page.date,
    siteName: page.siteName,
    language: page.language,
    filters: page.filters,
    sortable: page.sortable,
  };
}

export interface OrchestratorOptions {
  hmacSecret?: string | null;
  language?: string;
  storage?: StorageDriver;
  memoryPressureProbe?: (() => boolean) | null;
  /** Test hook: inject memory closures into the telemetry. */
  telemetryOptions?: MemoryTelemetryOptions;
}

export class IndexBuildOrchestrator {
  readonly outputDir: string;
  private readonly outputDirWarning: string | null;
  private readonly hmacSecret: string | null;
  private readonly memoryPressureProbe: (() => boolean) | null;
  private readonly telemetryOptions: MemoryTelemetryOptions;
  readonly coordinator: BuildCoordinator;
  private readonly builder: InvertedIndexBuilder;
  private readonly merger: IndexMerger;
  private readonly storage: StorageDriver;
  private readonly cache: PageWordCache;
  private readonly tsManifest: TimestampManifest;

  constructor(stateDir: string, outputDir: string, opts: OrchestratorOptions = {}) {
    let normalized = outputDir.replace(/\/+$/, "");
    if (normalized.endsWith("/pagefind")) {
      normalized = normalized.slice(0, -"/pagefind".length);
      this.outputDirWarning =
        "[scolta] output_dir already ends with '/pagefind'. The '/pagefind' suffix is appended " +
        "automatically — set output_dir to the parent directory to silence this warning.";
    } else {
      this.outputDirWarning = null;
    }
    this.outputDir = normalized;

    this.hmacSecret = opts.hmacSecret ?? null;
    this.memoryPressureProbe = opts.memoryPressureProbe ?? null;
    this.telemetryOptions = opts.telemetryOptions ?? {};
    this.coordinator = new BuildCoordinator(stateDir, this.hmacSecret);
    this.builder = new InvertedIndexBuilder(new Tokenizer(), new Stemmer(opts.language ?? "en"));
    this.merger = new IndexMerger();
    this.storage = opts.storage ?? new FilesystemDriver();
    const cacheDir = path.join(stateDir, CACHE_SUBDIR);
    this.cache = new PageWordCache(cacheDir, this.storage, 50, MemoryBudget.default().tokenCacheChunkBytes());
    this.tsManifest = new TimestampManifest(cacheDir, this.storage);
  }

  getTimestampManifest(): TimestampManifest {
    return this.tsManifest;
  }

  build(
    intent: BuildIntent,
    pages: Iterable<ContentItem | CachedContentReference>,
    logger?: Logger,
    progress?: ProgressReporter,
    force = false,
  ): StatusReport {
    const log = logger ?? console;
    const prog = progress ?? new NullProgressReporter();
    if (this.outputDirWarning !== null) log.warn(this.outputDirWarning);
    log.info("[scolta] Using TS indexer.");
    const startTime = performance.now();
    const telemetry = new MemoryTelemetry(log, intent.memoryBudget, this.telemetryOptions);

    try {
      const manifest = this.coordinator.prepare(intent);
      telemetry.emit("build_start", { mode: intent.mode });

      const budget = intent.memoryBudget;
      const chunkSize = budget.chunkSize();
      const totalPages = intent.totalPages ?? Number(manifest["total_pages"] ?? 0);

      let startChunk = 0;
      let currentOffset = 0;
      if (intent.mode === "resume") {
        startChunk = Number(manifest["chunks_written"] ?? 0);
        currentOffset = Number(manifest["pages_processed"] ?? 0);
        log.info(`[scolta] Resuming from chunk ${startChunk}, page offset ${currentOffset}.`);
      }

      const totalChunks = totalPages > 0 ? Math.ceil(totalPages / chunkSize) : 1;
      prog.start(totalChunks, "Indexing");

      let chunk: { item: ItemMeta; tokenData: TokenData }[] = [];
      let chunkNum = startChunk;
      let pagesInRun = 0;

      for (const page of pages) {
        if (page instanceof CachedContentReference) {
          const tokenData = this.cache.get(page.contentHash);
          if (tokenData !== null) {
            this.tsManifest.markSeen(page.entityKey);
            chunk.push({ item: proxy(page), tokenData });
          }
        } else {
          const h = contentHash(page);
          let tokenData = force ? null : this.cache.get(h);
          if (tokenData === null) {
            tokenData = this.builder.tokenizeItem(page);
            if (tokenData !== null) this.cache.put(h, tokenData);
          }
          if (tokenData !== null) chunk.push({ item: proxy(page), tokenData });
        }

        if (chunk.length >= chunkSize) {
          const partial = this.builder.buildFromTokenData(chunk, currentOffset);
          currentOffset += partial.pages.size;
          pagesInRun += partial.pages.size;
          this.coordinator.commitChunk(chunkNum, partial);
          prog.advance(1, `Chunk ${chunkNum} (${pagesInRun} pages)`);
          chunkNum += 1;
          chunk = [];

          if (this.underMemoryPressure(telemetry)) {
            const committedChunks = this.coordinator.chunkFiles().length;
            const committedPages = this.coordinator.buildState().getPagesProcessed();
            this.cache.pruneAndSave();
            this.tsManifest.pruneAndSave();
            this.coordinator.releaseLockOnly();
            log.info(
              `[scolta] Memory pressure after chunk ${chunkNum - 1} — yielding for restart (${committedPages} pages committed).`,
            );
            return this.report(telemetry, budget, committedPages, committedChunks, startTime, false, "memory_abort");
          }
        }
      }

      if (chunk.length > 0) {
        const partial = this.builder.buildFromTokenData(chunk, currentOffset);
        pagesInRun += partial.pages.size;
        this.coordinator.commitChunk(chunkNum, partial);
        prog.advance(1, `Chunk ${chunkNum} (${pagesInRun} pages)`);
      }

      prog.finish(`${pagesInRun} pages indexed`);

      const limitBytes = telemetry.effectiveLimitBytes();
      const segmentBytes = telemetry.getCurrentRssBytes();
      if (limitBytes > 0 && segmentBytes >= Math.floor(limitBytes * 0.75)) {
        this.cache.pruneAndSave();
        this.tsManifest.pruneAndSave();
        this.coordinator.releaseLockOnly();
        log.warn("[scolta] RSS high after indexing. Merge deferred — run finalize to complete.");
        return this.report(telemetry, budget, pagesInRun, chunkNum, startTime, false, "index_only_complete");
      }

      const chunkFiles = this.coordinator.chunkFiles();
      const streamWriter = new StreamingFormatWriter(new CborEncoder(), "", budget.fragmentFlushBytes());
      streamWriter.beginWrite(this.outputDir);
      this.merger.mergeStreaming(chunkFiles, streamWriter, budget);
      streamWriter.endWrite();

      this.atomicSwap();

      const totalProcessed = this.coordinator.pagesProcessed();
      const pagesForReport = totalProcessed > 0 ? totalProcessed : pagesInRun;
      const chunksWritten = chunkFiles.length;

      this.verifyOutputHasFragments(pagesForReport);
      this.coordinator.release();
      this.cache.pruneAndSave();
      this.tsManifest.pruneAndSave();

      return this.report(telemetry, budget, pagesForReport, chunksWritten, startTime, true);
    } catch (exc) {
      try {
        this.coordinator.releaseLockOnly();
      } catch {
        /* ignore */
      }
      const isMemoryAbort = exc instanceof Error && exc.message.includes("exceeds safe threshold");
      let committedChunks = 0;
      let committedPages = 0;
      if (isMemoryAbort) {
        try {
          committedChunks = this.coordinator.chunkFiles().length;
          committedPages = this.coordinator.buildState().getPagesProcessed();
        } catch {
          /* ignore */
        }
      }
      return this.report(
        telemetry,
        intent.memoryBudget,
        committedPages,
        committedChunks,
        startTime,
        false,
        isMemoryAbort ? "memory_abort" : String(exc),
      );
    }
  }

  finalize(budget: MemoryBudget, logger?: Logger): StatusReport {
    const log = logger ?? console;
    if (this.outputDirWarning !== null) log.warn(this.outputDirWarning);
    const telemetry = new MemoryTelemetry(log, budget, this.telemetryOptions);
    const startTime = performance.now();
    try {
      const chunkFiles = this.coordinator.chunkFiles();
      if (chunkFiles.length === 0) {
        return this.report(telemetry, budget, 0, 0, startTime, false, "No chunk files found in state directory.");
      }
      const streamWriter = new StreamingFormatWriter(new CborEncoder(), "", budget.fragmentFlushBytes());
      streamWriter.beginWrite(this.outputDir);
      this.merger.mergeStreaming(chunkFiles, streamWriter, budget);
      streamWriter.endWrite();
      this.atomicSwap();
      const pagesProcessed = this.coordinator.pagesProcessed();
      this.verifyOutputHasFragments(pagesProcessed);
      this.coordinator.release();
      return this.report(telemetry, budget, pagesProcessed, chunkFiles.length, startTime, true);
    } catch (exc) {
      try {
        this.coordinator.releaseLockOnly();
      } catch {
        /* ignore */
      }
      return this.report(telemetry, budget, 0, 0, startTime, false, String(exc));
    }
  }

  // -- helpers --

  private report(
    telemetry: MemoryTelemetry,
    budget: MemoryBudget,
    pages: number,
    chunks: number,
    startTime: number,
    success: boolean,
    error: string | null = null,
  ): StatusReport {
    return new StatusReport({
      version: VERSION,
      pagefindVersion: SupportedVersions.getVersionForMetadata(),
      resolvedIndexer: "ts",
      pagesProcessed: pages,
      chunksWritten: chunks,
      peakMemoryBytes: telemetry.getPeakRssBytes(),
      memoryBudgetBytes: budget.totalBudgetBytes(),
      durationSeconds: Math.round((performance.now() - startTime)) / 1000,
      outputDir: this.outputDir,
      success,
      error,
    });
  }

  private atomicSwap(): void {
    const buildDir = path.join(this.outputDir, ".scolta-building");
    const finalDir = path.join(this.outputDir, "pagefind");
    const oldDir = path.join(this.outputDir, ".scolta-old");
    const newDir = path.join(this.outputDir, ".scolta-new");

    if (!this.storage.exists(buildDir)) {
      throw new Error("Build directory does not exist: " + buildDir);
    }
    this.storage.move(buildDir, newDir);
    if (this.storage.exists(finalDir)) {
      this.storage.move(finalDir, oldDir);
    }
    this.storage.move(newDir, finalDir);
    if (this.storage.exists(oldDir)) {
      this.storage.deleteDirectory(oldDir);
    }
  }

  private underMemoryPressure(telemetry: MemoryTelemetry): boolean {
    if (this.memoryPressureProbe !== null) {
      return this.memoryPressureProbe();
    }
    const limit = telemetry.effectiveLimitBytes();
    if (limit <= 0) return false;
    return telemetry.getCurrentRssBytes() >= Math.floor(limit * 0.75);
  }

  private verifyOutputHasFragments(pagesProcessed: number): void {
    if (pagesProcessed === 0) return;
    const fragmentDir = path.join(this.outputDir, "pagefind", "fragment");
    const count =
      fs.existsSync(fragmentDir) && fs.statSync(fragmentDir).isDirectory()
        ? fs.readdirSync(fragmentDir).filter((f) => f.endsWith(".pf_fragment")).length
        : 0;
    if (count === 0) {
      throw new Error(
        `Build processed ${pagesProcessed} pages but the output index contains zero fragment files. ` +
          "The write may have failed silently. Check filesystem permissions and available space.",
      );
    }
    IndexBuildOrchestrator.verifyIndexComplete(this.outputDir);
  }

  static verifyIndexComplete(outputDir: string): void {
    const entryPath = path.join(outputDir, "pagefind", "pagefind-entry.json");
    if (!fs.existsSync(entryPath)) {
      throw new Error(
        `Index verification failed: pagefind-entry.json not found at ${entryPath}. Do not exit 0.`,
      );
    }
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(entryPath, "utf-8"));
    } catch (exc) {
      throw new Error(`Index verification failed: cannot read/parse ${entryPath}.`, { cause: exc });
    }
    if (!data || typeof data !== "object" || !("version" in data) || !("languages" in data)) {
      throw new Error(
        "Index verification failed: pagefind-entry.json is malformed (missing 'version' or 'languages').",
      );
    }
  }
}
