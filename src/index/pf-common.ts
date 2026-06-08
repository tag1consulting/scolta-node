/**
 * Shared helpers for the Pagefind format writers.
 *
 * Encapsulates the byte-level encoding shared by PagefindFormatWriter and
 * StreamingFormatWriter: word-entry CBOR, filter/sort/meta CBOR, the
 * `pagefind_dcd` gzip framing, hash-naming, and PHP-faithful JSON.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { CborEncoder } from "./cbor.js";
import { DeltaEncoder } from "./delta-encoder.js";

export const DELIMITER = Buffer.from("pagefind_dcd");

const NUMERIC = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/;

// -- shared index data structures -------------------------------------------

/** Per-page postings for one term. */
export interface PageEntry {
  /** weight -> body position list (capped) */
  positions: Map<number, number[]>;
  /** title/meta positions (field-marker -1) */
  metaPositions: number[];
}

/** One inverted-index term: page postings + spelling variants. */
export interface TermEntry {
  pages: Map<number, PageEntry>;
  variants: Map<string, number[]>;
}

export type InvertedIndex = Map<string, TermEntry>;

/** A page record carried through the writers. */
export interface IndexPage {
  id: string;
  url: string;
  title: string;
  content: string;
  wordCount: number;
  date: string;
  filters: Record<string, string | string[]>;
  meta: Record<string, string>;
  sortable: Record<string, string>;
  hash: string;
  fragmentHash?: string;
}

export interface ChunkMeta {
  from: string;
  to: string;
  hash: string;
}

// -- primitives -------------------------------------------------------------

/** Approximate PHP is_numeric for sort-field values. */
export function isNumeric(s: string): boolean {
  return NUMERIC.test(s);
}

/** json_encode(JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) equivalent. */
export function phpJson(obj: unknown): Buffer {
  return Buffer.from(JSON.stringify(obj), "utf-8");
}

export function hash10(data: Buffer): string {
  return "en_" + createHash("sha256").update(data).digest("hex").slice(0, 10);
}

export function writeGz(filePath: string, payload: Buffer): void {
  const compressed = gzipSync(Buffer.concat([DELIMITER, payload]), { level: 9 });
  fs.writeFileSync(filePath, compressed);
}

export function ensureDir(directory: string): void {
  fs.mkdirSync(directory, { recursive: true });
}

/** Build a fragment JSON payload (empty filters/meta serialize as {}). */
export function fragmentJson(page: IndexPage): Buffer {
  const filters = page.filters && Object.keys(page.filters).length > 0 ? page.filters : {};
  const meta = page.meta && Object.keys(page.meta).length > 0 ? page.meta : {};
  return phpJson({
    url: page.url,
    content: page.content ?? "",
    word_count: page.wordCount,
    filters,
    meta,
    anchors: [],
  });
}

/**
 * Encode one inverted-index word entry as CBOR.
 *
 * Page numbers delta-encoded; body positions carry the -25 weight marker;
 * title meta positions carry the -1 field marker (title = field index 0).
 */
export function encodeWordEntry(cbor: CborEncoder, word: string, entry: TermEntry): Buffer {
  const pageNums = [...entry.pages.keys()].sort((a, b) => a - b);
  const deltaPages = DeltaEncoder.deltaEncode(pageNums);

  const encodedPages: Buffer[] = [];
  pageNums.forEach((pageNum, idx) => {
    const pe = entry.pages.get(pageNum)!;
    const pageItems: Buffer[] = [cbor.encodeUint(deltaPages[idx]!)];

    const allBody: number[] = [];
    for (const positions of pe.positions.values()) {
      allBody.push(...[...positions].sort((a, b) => a - b));
    }
    allBody.sort((a, b) => a - b);

    const posItems: Buffer[] = [];
    if (allBody.length > 0) {
      posItems.push(cbor.encodeNegInt(-25));
      for (const dp of DeltaEncoder.deltaEncode(allBody)) {
        posItems.push(dp >= 0 ? cbor.encodeUint(dp) : cbor.encodeNegInt(dp));
      }
    }
    pageItems.push(cbor.encodeArray(posItems));

    const metaItems: Buffer[] = [];
    if (pe.metaPositions.length > 0) {
      const mpSorted = [...pe.metaPositions].sort((a, b) => a - b);
      metaItems.push(cbor.encodeNegInt(-1));
      for (const mp of DeltaEncoder.deltaEncode(mpSorted)) {
        metaItems.push(mp >= 0 ? cbor.encodeUint(mp) : cbor.encodeNegInt(mp));
      }
    }
    pageItems.push(cbor.encodeArray(metaItems));

    encodedPages.push(cbor.encodeArray(pageItems));
  });

  const encodedVariants: Buffer[] = [];
  for (const [form, variantPages] of entry.variants) {
    const variantPageEntries = variantPages.map((vp) =>
      cbor.encodeArray([cbor.encodeUint(vp), cbor.encodeArray([]), cbor.encodeArray([])]),
    );
    encodedVariants.push(
      cbor.encodeArray([cbor.encodeString(String(form)), cbor.encodeArray(variantPageEntries)]),
    );
  }

  return cbor.encodeArray([
    cbor.encodeString(word),
    cbor.encodeArray(encodedPages),
    cbor.encodeArray(encodedVariants),
  ]);
}

/** filterData: {name: {value: [pageNums]}} -> {name: cbor bytes}. */
export function buildFilterIndex(
  cbor: CborEncoder,
  filterData: Map<string, Map<string, number[]>>,
): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  for (const [name, values] of filterData) {
    const valueTuples: Buffer[] = [];
    for (const [value, pageNums] of values) {
      valueTuples.push(
        cbor.encodeArray([
          cbor.encodeString(String(value)),
          cbor.encodeArray(pageNums.map((p) => cbor.encodeUint(p))),
        ]),
      );
    }
    result.set(name, cbor.encodeArray([cbor.encodeString(name), cbor.encodeArray(valueTuples)]));
  }
  return result;
}

/** sortFields: {field: {pageNum: valueStr}} -> CBOR for pf_meta[4]. */
export function buildSortsArray(
  cbor: CborEncoder,
  sortFields: Map<string, Map<number, string>>,
): Buffer {
  if (sortFields.size === 0) {
    return cbor.encodeArray([]);
  }

  const sortItems: Buffer[] = [];
  for (const [field, pageValues] of sortFields) {
    const items = [...pageValues.entries()];
    const allNumeric = items.every(([, v]) => isNumeric(v));
    if (allNumeric) {
      items.sort((a, b) => Number(a[1]) - Number(b[1]));
    } else {
      items.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    }
    const sortedIndices = items.map(([p]) => cbor.encodeUint(p));
    sortItems.push(cbor.encodeArray([cbor.encodeString(field), cbor.encodeArray(sortedIndices)]));
  }
  return cbor.encodeArray(sortItems);
}

/** Build pf_meta CBOR: [version, pages, index_chunks, filters, sorts, meta_fields]. */
export function buildMetadata(
  cbor: CborEncoder,
  version: string,
  pagesMeta: [string, number][],
  chunkMeta: ChunkMeta[],
  filterHashes: Map<string, string>,
  sortsCbor: Buffer,
  metaFields: string[],
): Buffer {
  const pageItems = pagesMeta.map(([h, wc]) =>
    cbor.encodeArray([cbor.encodeString(h), cbor.encodeUint(wc)]),
  );
  const chunkItems = chunkMeta.map((c) =>
    cbor.encodeArray([cbor.encodeString(c.from), cbor.encodeString(c.to), cbor.encodeString(c.hash)]),
  );
  const filterItems = [...filterHashes.entries()].map(([name, h]) =>
    cbor.encodeArray([cbor.encodeString(name), cbor.encodeString(h)]),
  );
  const metaFieldItems = metaFields.map((f) => cbor.encodeString(f));

  return cbor.encodeArray([
    cbor.encodeString(version),
    cbor.encodeArray(pageItems),
    cbor.encodeArray(chunkItems),
    cbor.encodeArray(filterItems),
    sortsCbor,
    cbor.encodeArray(metaFieldItems),
  ]);
}

/** Copy bundled pagefind runtime assets into the build dir if vendored. */
/**
 * Locate the vendored `assets/pagefind` directory by walking up from this
 * module. The module's depth differs between the `src/` layout (tests:
 * src/index/) and the bundled `dist/` layout, so a fixed `../..` is wrong in one
 * of them — walk up until `assets/pagefind/pagefind.js` is found.
 */
function findPagefindAssetsDir(): string | null {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "assets", "pagefind");
    if (fs.existsSync(path.join(candidate, "pagefind.js"))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function copyAssets(buildDir: string): void {
  const assetsDir = findPagefindAssetsDir();
  if (assetsDir === null) return;
  for (const asset of ["pagefind.js", "pagefind-worker.js", "wasm.en.pagefind", "wasm.unknown.pagefind"]) {
    const src = path.join(assetsDir, asset);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(buildDir, asset));
    }
  }
}

export function writeEntryJson(
  buildDir: string,
  version: string,
  metaHash: string,
  pageCount: number,
): void {
  const entry = {
    version,
    languages: {
      en: { hash: metaHash, wasm: "en", page_count: pageCount },
    },
    include_characters: [] as string[],
  };
  fs.writeFileSync(path.join(buildDir, "pagefind-entry.json"), JSON.stringify(entry, null, 4));
}
