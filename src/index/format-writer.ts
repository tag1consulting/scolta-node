/**
 * Buffered Pagefind format writer (port of `PagefindFormatWriter`).
 *
 * Serializes a merged inverted index + pages to the Pagefind on-disk format in
 * a single buffered pass (remap to 0-based page numbers, chunk, write fragments
 * / index / filter / meta / entry.json).
 *
 * Word order: lexicographic (canonical Rust-Pagefind / WASM order).
 */

import * as path from "node:path";
import { CborEncoder } from "./cbor.js";
import * as pf from "./pf-common.js";
import type { ChunkMeta, IndexPage, InvertedIndex, TermEntry } from "./pf-common.js";
import { SupportedVersions } from "./supported-versions.js";

const MAX_CHUNK_SIZE = 40000;

export class PagefindFormatWriter {
  private readonly cbor: CborEncoder;
  private readonly pagefindVersion: string;

  constructor(cbor?: CborEncoder, pagefindVersion = "") {
    this.cbor = cbor ?? new CborEncoder();
    this.pagefindVersion = pagefindVersion;
  }

  private version(): string {
    return this.pagefindVersion || SupportedVersions.getVersionForMetadata();
  }

  write(mergedIndex: InvertedIndex, pages: Map<number, IndexPage>, outputDir: string): void {
    const [pagesList, index] = PagefindFormatWriter.remapPageNumbers(pages, mergedIndex);

    const buildDir = path.join(outputDir, ".scolta-building");
    pf.ensureDir(buildDir);
    pf.ensureDir(path.join(buildDir, "index"));
    pf.ensureDir(path.join(buildDir, "fragment"));

    // Fragments.
    pagesList.forEach((page, pageNum) => {
      const fragment = pf.fragmentJson(page);
      const h = pf.hash10(Buffer.from(String(pageNum) + page.url, "utf-8"));
      page.fragmentHash = h;
      pf.writeGz(path.join(buildDir, "fragment", `${h}.pf_fragment`), fragment);
    });

    // Index chunks.
    const wordList = [...index.keys()].map(String).sort();
    const chunks = PagefindFormatWriter.chunkWords(wordList, index);
    const chunkMeta: ChunkMeta[] = [];
    for (const chunkWords of chunks) {
      const cborItems = chunkWords.map((w) => pf.encodeWordEntry(this.cbor, w, index.get(w)!));
      const inner = this.cbor.encodeArray(cborItems);
      const cborData = this.cbor.encodeArray([inner]);
      const h = pf.hash10(Buffer.from(chunkWords.join(","), "utf-8"));
      pf.writeGz(path.join(buildDir, "index", `${h}.pf_index`), cborData);
      chunkMeta.push({ from: chunkWords[0]!, to: chunkWords[chunkWords.length - 1]!, hash: h });
    }

    // Filter index.
    const filterData = PagefindFormatWriter.collectFilters(pagesList);
    const filterCbor = pf.buildFilterIndex(this.cbor, filterData);
    const filterHashes = new Map<string, string>();
    if (filterCbor.size > 0) {
      pf.ensureDir(path.join(buildDir, "filter"));
      for (const [name, data] of filterCbor) {
        const h = pf.hash10(data);
        pf.writeGz(path.join(buildDir, "filter", `${h}.pf_filter`), data);
        filterHashes.set(name, h);
      }
    }

    const metaFields = PagefindFormatWriter.collectMetaFields(pagesList);
    const sortsCbor = pf.buildSortsArray(this.cbor, PagefindFormatWriter.collectSorts(pagesList));
    const pagesMeta: [string, number][] = pagesList.map((p) => [p.fragmentHash ?? p.hash, p.wordCount]);

    const metaCbor = pf.buildMetadata(
      this.cbor,
      this.version(),
      pagesMeta,
      chunkMeta,
      filterHashes,
      sortsCbor,
      metaFields,
    );
    const metaHash = pf.hash10(metaCbor);
    pf.writeGz(path.join(buildDir, `pagefind.${metaHash}.pf_meta`), metaCbor);

    pf.writeEntryJson(buildDir, this.version(), metaHash, pagesList.length);
    pf.copyAssets(buildDir);
  }

  // -- helpers --

  static remapPageNumbers(
    pages: Map<number, IndexPage>,
    mergedIndex: InvertedIndex,
  ): [IndexPage[], InvertedIndex] {
    const originalKeys = [...pages.keys()];
    const mapping = new Map<number, number>();
    originalKeys.forEach((key, i) => mapping.set(key, i));
    const newPages = [...pages.values()];

    const newIndex: InvertedIndex = new Map();
    for (const [word, entry] of mergedIndex) {
      const ni: TermEntry = { pages: new Map(), variants: new Map() };
      for (const [variant, vpages] of entry.variants) {
        ni.variants.set(
          variant,
          vpages.map((p) => mapping.get(p) ?? p),
        );
      }
      for (const [pageNum, data] of entry.pages) {
        ni.pages.set(mapping.get(pageNum) ?? pageNum, data);
      }
      newIndex.set(word, ni);
    }
    return [newPages, newIndex];
  }

  static chunkWords(wordList: string[], index: InvertedIndex): string[][] {
    if (wordList.length === 0) {
      return [];
    }
    const chunks: string[][] = [];
    let current: string[] = [];
    let size = 0;
    for (const word of wordList) {
      const pageCount = index.get(word)!.pages.size;
      const estimated = word.length * 2 + pageCount * 20;
      if (size + estimated > MAX_CHUNK_SIZE && current.length > 0) {
        chunks.push(current);
        current = [];
        size = 0;
      }
      current.push(word);
      size += estimated;
    }
    if (current.length > 0) {
      chunks.push(current);
    }
    return chunks;
  }

  static collectFilters(pagesList: IndexPage[]): Map<string, Map<string, number[]>> {
    const filters = new Map<string, Map<string, number[]>>();
    pagesList.forEach((page, pageNum) => {
      for (const [name, value] of Object.entries(page.filters ?? {})) {
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) {
          let byValue = filters.get(name);
          if (byValue === undefined) {
            byValue = new Map();
            filters.set(name, byValue);
          }
          let list = byValue.get(String(v));
          if (list === undefined) {
            list = [];
            byValue.set(String(v), list);
          }
          list.push(pageNum);
        }
      }
    });
    return filters;
  }

  static collectMetaFields(pagesList: IndexPage[]): string[] {
    const fields = new Map<string, boolean>([["title", true]]);
    for (const page of pagesList) {
      for (const key of Object.keys(page.meta ?? {})) {
        if (key !== "url") {
          fields.set(key, true);
        }
      }
    }
    return [...fields.keys()];
  }

  static collectSorts(pagesList: IndexPage[]): Map<string, Map<number, string>> {
    const sortFields = new Map<string, Map<number, string>>();
    pagesList.forEach((page, pageNum) => {
      for (const [field, value] of Object.entries(page.sortable ?? {})) {
        let byPage = sortFields.get(field);
        if (byPage === undefined) {
          byPage = new Map();
          sortFields.set(field, byPage);
        }
        byPage.set(pageNum, String(value));
      }
    });
    return sortFields;
  }
}
