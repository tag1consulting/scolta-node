/**
 * Merge partial index chunks into one inverted index (port of IndexMerger).
 *
 * merge() does a buffered full merge; mergeStreaming() does the memory-bounded
 * N-way heap merge used by the pipeline: stream pages from every chunk, then
 * heap-merge the alphabetically-sorted term streams (with a recursive pre-merge
 * pass when chunk count exceeds the open-file budget). Page numbers are globally
 * sequential across chunks, so only variant lists need unioning.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ChunkReader, writeTermRecords } from "./chunk-io.js";
import type { MemoryBudget } from "./memory-budget.js";
import type { IndexPage, InvertedIndex, TermEntry } from "./pf-common.js";
import type { PartialIndex } from "./inverted-index-builder.js";

/** Minimal binary min-heap keyed by (term, idx). */
class MinHeap {
  private a: [string, number][] = [];
  get size(): number {
    return this.a.length;
  }
  peek(): [string, number] | undefined {
    return this.a[0];
  }
  private less(i: number, j: number): boolean {
    const x = this.a[i]!;
    const y = this.a[j]!;
    return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
  }
  push(item: [string, number]): void {
    this.a.push(item);
    let i = this.a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(i, parent)) {
        [this.a[i], this.a[parent]] = [this.a[parent]!, this.a[i]!];
        i = parent;
      } else break;
    }
  }
  pop(): [string, number] | undefined {
    const top = this.a[0];
    const last = this.a.pop();
    if (this.a.length > 0 && last !== undefined) {
      this.a[0] = last;
      let i = 0;
      const n = this.a.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < n && this.less(l, smallest)) smallest = l;
        if (r < n && this.less(r, smallest)) smallest = r;
        if (smallest === i) break;
        [this.a[i], this.a[smallest]] = [this.a[smallest]!, this.a[i]!];
        i = smallest;
      }
    }
    return top;
  }
}

interface StreamWriterLike {
  writePage(pageNum: number, page: IndexPage): void;
  writeTerm(term: string, entry: TermEntry): void;
}

export class IndexMerger {
  merge(partials: PartialIndex[]): PartialIndex {
    const mergedIndex: InvertedIndex = new Map();
    const mergedPages = new Map<number, IndexPage>();

    for (const partial of partials) {
      for (const [pageNum, pageData] of partial.pages) {
        mergedPages.set(pageNum, pageData);
      }
      for (const [word, pageEntries] of partial.index) {
        let entry = mergedIndex.get(word);
        if (entry === undefined) {
          entry = { pages: new Map(), variants: new Map() };
          mergedIndex.set(word, entry);
        }
        for (const [variant, vpages] of pageEntries.variants) {
          const existing = entry.variants.get(variant) ?? [];
          entry.variants.set(variant, [...new Set([...existing, ...vpages])]);
        }
        for (const [pageNum, data] of pageEntries.pages) {
          const existingPage = entry.pages.get(pageNum);
          if (existingPage === undefined) {
            entry.pages.set(pageNum, data);
          } else {
            for (const [weight, positions] of data.positions) {
              const bucket = existingPage.positions.get(weight) ?? [];
              existingPage.positions.set(weight, [...new Set([...bucket, ...positions])].sort((a, b) => a - b));
            }
            if (data.metaPositions.length > 0) {
              existingPage.metaPositions = [...new Set([...existingPage.metaPositions, ...data.metaPositions])].sort(
                (a, b) => a - b,
              );
            }
          }
        }
      }
    }
    return { index: mergedIndex, pages: mergedPages };
  }

  mergeStreaming(chunkPaths: string[], writer: StreamWriterLike, budget?: MemoryBudget): void {
    // Phase 1: stream pages from all chunks (sequential, one handle).
    for (const p of chunkPaths) {
      for (const [pageNum, pageData] of new ChunkReader(p).openPages()) {
        writer.writePage(pageNum, pageData);
      }
    }

    // Phase 2: N-way term merge, with pre-merge fan-in reduction.
    const cap = budget ? budget.mergeOpenFileHandles() : null;
    const termPaths = cap !== null && chunkPaths.length > cap ? this.preMergeTerms(chunkPaths, cap) : chunkPaths;
    this.nWayTermMerge(termPaths, (term, entry) => writer.writeTerm(term, entry));
  }

  // -- helpers --

  private mergeEntries(allEntries: TermEntry[]): TermEntry {
    const merged: TermEntry = { pages: new Map(), variants: new Map() };
    for (const entry of allEntries) {
      for (const [variant, vpages] of entry.variants) {
        const existing = merged.variants.get(variant) ?? [];
        merged.variants.set(variant, [...new Set([...existing, ...vpages])]);
      }
      for (const [pageNum, data] of entry.pages) {
        merged.pages.set(pageNum, data); // globally-unique page numbers
      }
    }
    return merged;
  }

  private nWayTermMerge(chunkPaths: string[], writeTerm: (term: string, entry: TermEntry) => void): void {
    const iters = new Map<number, { it: Iterator<[string, TermEntry]>; cur: [string, TermEntry] }>();
    const heap = new MinHeap();
    chunkPaths.forEach((p, idx) => {
      const it = new ChunkReader(p).openIndex()[Symbol.iterator]();
      const first = it.next();
      if (!first.done) {
        iters.set(idx, { it, cur: first.value });
        heap.push([first.value[0], idx]);
      }
    });

    while (heap.size > 0) {
      const minTerm = heap.peek()![0];
      const allEntries: TermEntry[] = [];
      while (heap.size > 0 && heap.peek()![0] === minTerm) {
        const [, idx] = heap.pop()!;
        const state = iters.get(idx)!;
        allEntries.push(state.cur[1]);
        const nxt = state.it.next();
        if (!nxt.done) {
          state.cur = nxt.value;
          heap.push([nxt.value[0], idx]);
        }
      }
      writeTerm(minTerm, this.mergeEntries(allEntries));
    }
  }

  private preMergeTerms(chunkPaths: string[], cap: number): string[] {
    if (chunkPaths.length <= cap) return chunkPaths;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scolta-premerge-"));
    const outPaths: string[] = [];
    for (let i = 0; i < chunkPaths.length; i += cap) {
      const batch = chunkPaths.slice(i, i + cap);
      if (batch.length === 1) {
        outPaths.push(batch[0]!);
        continue;
      }
      const tmpPath = path.join(tmpDir, `premerge-${String(outPaths.length).padStart(3, "0")}.dat`);
      const records: [string, TermEntry][] = [];
      this.nWayTermMerge(batch, (term, merged) => records.push([term, merged]));
      writeTermRecords(tmpPath, records);
      outPaths.push(tmpPath);
    }
    return this.preMergeTerms(outPaths, cap);
  }
}
