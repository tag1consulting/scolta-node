/**
 * Streaming Pagefind format writer (port of `StreamingFormatWriter`).
 *
 * The writer actually used in build/finalize — the primary parity target.
 * Accepts pages and terms one at a time (terms MUST arrive in ascending order,
 * as produced by the N-way streaming merge), flushing fragments immediately and
 * index chunks at ~40 KB to bound memory.
 */

import * as path from "node:path";
import { CborEncoder } from "./cbor.js";
import * as pf from "./pf-common.js";
import type { ChunkMeta, IndexPage, TermEntry } from "./pf-common.js";
import { SupportedVersions } from "./supported-versions.js";

const DEFAULT_FLUSH_BYTES = 40_000;

export class StreamingFormatWriter {
  private readonly cbor: CborEncoder;
  private readonly pagefindVersion: string;
  private readonly flushBytes: number;

  private outputDir = "";
  private buildDir = "";
  private pageMeta = new Map<number, { fragmentHash: string; wordCount: number }>();
  private filterData = new Map<string, Map<string, number[]>>();
  private collectedMetaFields = new Map<string, boolean>([["title", true]]);
  private sortFields = new Map<string, Map<number, string>>();
  private chunkItems: Buffer[] = [];
  private chunkWordList: string[] = [];
  private chunkSize = 0;
  private indexChunkMeta: ChunkMeta[] = [];

  constructor(cbor?: CborEncoder, pagefindVersion = "", flushBytes?: number) {
    this.cbor = cbor ?? new CborEncoder();
    this.pagefindVersion = pagefindVersion;
    this.flushBytes = flushBytes ?? DEFAULT_FLUSH_BYTES;
  }

  private version(): string {
    return this.pagefindVersion || SupportedVersions.getVersionForMetadata();
  }

  beginWrite(outputDir: string): void {
    this.outputDir = outputDir;
    this.buildDir = path.join(outputDir, ".scolta-building");
    this.pageMeta = new Map();
    this.filterData = new Map();
    this.sortFields = new Map();
    this.collectedMetaFields = new Map([["title", true]]);
    this.chunkItems = [];
    this.chunkWordList = [];
    this.chunkSize = 0;
    this.indexChunkMeta = [];
    pf.ensureDir(this.buildDir);
    pf.ensureDir(path.join(this.buildDir, "index"));
    pf.ensureDir(path.join(this.buildDir, "fragment"));
  }

  writePage(pageNum: number, pageData: IndexPage): void {
    const fragment = pf.fragmentJson(pageData);
    const h = pf.hash10(Buffer.from(String(pageNum) + pageData.url, "utf-8"));
    pf.writeGz(path.join(this.buildDir, "fragment", `${h}.pf_fragment`), fragment);

    this.pageMeta.set(pageNum, { fragmentHash: h, wordCount: Math.trunc(Number(pageData.wordCount)) });

    for (const [name, value] of Object.entries(pageData.filters ?? {})) {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        let byValue = this.filterData.get(name);
        if (byValue === undefined) {
          byValue = new Map();
          this.filterData.set(name, byValue);
        }
        let list = byValue.get(String(v));
        if (list === undefined) {
          list = [];
          byValue.set(String(v), list);
        }
        list.push(pageNum);
      }
    }

    const sortableData: Record<string, string> = { ...(pageData.sortable ?? {}) };
    if (pageData.date && !("date" in sortableData)) {
      sortableData["date"] = pageData.date;
    }
    for (const [field, value] of Object.entries(sortableData)) {
      let byPage = this.sortFields.get(field);
      if (byPage === undefined) {
        byPage = new Map();
        this.sortFields.set(field, byPage);
      }
      byPage.set(pageNum, String(value));
    }

    for (const key of Object.keys(pageData.meta ?? {})) {
      if (key !== "url") {
        this.collectedMetaFields.set(key, true);
      }
    }
  }

  writeTerm(term: string, termData: TermEntry): void {
    const encoded = pf.encodeWordEntry(this.cbor, term, termData);
    const pageCount = termData.pages.size;
    const estimated = term.length * 2 + pageCount * 20;

    if (this.chunkSize + estimated > this.flushBytes && this.chunkItems.length > 0) {
      this.flushIndexChunk();
    }

    this.chunkWordList.push(term);
    this.chunkItems.push(encoded);
    this.chunkSize += estimated;
  }

  endWrite(): void {
    this.flushIndexChunk();

    const filterCbor = pf.buildFilterIndex(this.cbor, this.filterData);
    const filterHashes = new Map<string, string>();
    if (filterCbor.size > 0) {
      pf.ensureDir(path.join(this.buildDir, "filter"));
      for (const [name, data] of filterCbor) {
        const h = pf.hash10(data);
        pf.writeGz(path.join(this.buildDir, "filter", `${h}.pf_filter`), data);
        filterHashes.set(name, h);
      }
    }

    const metaFields = [...this.collectedMetaFields.keys()];
    const sortsCbor = pf.buildSortsArray(this.cbor, this.sortFields);
    const pagesMeta: [string, number][] = [...this.pageMeta.values()].map((m) => [
      m.fragmentHash,
      m.wordCount,
    ]);

    const metaCbor = pf.buildMetadata(
      this.cbor,
      this.version(),
      pagesMeta,
      this.indexChunkMeta,
      filterHashes,
      sortsCbor,
      metaFields,
    );
    const metaHash = pf.hash10(metaCbor);
    pf.writeGz(path.join(this.buildDir, `pagefind.${metaHash}.pf_meta`), metaCbor);

    pf.writeEntryJson(this.buildDir, this.version(), metaHash, this.pageMeta.size);
    pf.copyAssets(this.buildDir);
  }

  private flushIndexChunk(): void {
    if (this.chunkItems.length === 0) {
      return;
    }
    const inner = this.cbor.encodeArray(this.chunkItems);
    const cborData = this.cbor.encodeArray([inner]);
    const h = pf.hash10(Buffer.from(this.chunkWordList.join(","), "utf-8"));
    pf.writeGz(path.join(this.buildDir, "index", `${h}.pf_index`), cborData);
    this.indexChunkMeta.push({
      from: this.chunkWordList[0]!,
      to: this.chunkWordList[this.chunkWordList.length - 1]!,
      hash: h,
    });
    this.chunkItems = [];
    this.chunkWordList = [];
    this.chunkSize = 0;
  }
}
