/**
 * Chunked forward token cache (port of `PageWordCache`).
 *
 * Content-hash -> token-data forward index so unchanged pages skip HTML
 * cleaning and tokenization on rebuilds — the "maintain the index efficiently"
 * layer.
 *
 * Architecture: an in-memory manifest (hash -> chunk number), one loaded data
 * chunk at a time, and a write buffer flushed at chunk_size entries or a byte
 * cap. `pruneAndSave()` drops unseen hashes and deletes orphaned chunk files.
 * Stored with msgpack (no parity constraint); tokens flattened to
 * [stem, original, position]. Lives in its own cache directory so a fresh-build
 * cleanup never eats it.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { decode, encode } from "@msgpack/msgpack";
import type { StorageDriver } from "../storage.js";
import type { TokenData } from "./inverted-index-builder.js";
import { token as makeToken } from "./token.js";

const MANIFEST_FILENAME = "token-cache-manifest.msgpack";
const CHUNK_DIR = "token-cache";

type PackedToken = [string, string, number];
interface PackedTokenData {
  t: PackedToken[];
  b: PackedToken[];
  u: PackedToken[];
  wc: number;
  ct: string;
  c: string;
}

function packTokenData(td: TokenData): PackedTokenData {
  const f = (tks: TokenData["titleTokens"]): PackedToken[] =>
    tks.map((tk) => [tk.stem, tk.original, tk.position]);
  return { t: f(td.titleTokens), b: f(td.bodyTokens), u: f(td.urlTokens), wc: td.wordCount, ct: td.cleanTitle, c: td.content };
}

function unpackTokenData(d: PackedTokenData): TokenData {
  const f = (arr: PackedToken[]): TokenData["titleTokens"] => arr.map(([s, o, p]) => makeToken(s, o, p));
  return { titleTokens: f(d.t), bodyTokens: f(d.b), urlTokens: f(d.u), wordCount: d.wc, cleanTitle: d.ct, content: d.c };
}

export class PageWordCache {
  private readonly chunkSize: number;
  private readonly maxWriteBufferBytes: number;
  private manifest = new Map<string, number>();
  private usedKeys = new Set<string>();
  private loadedChunk: { number: number; entries: Map<string, TokenData> } | null = null;
  private writeBuffer = new Map<string, TokenData>();
  private writeBufferBytes = 0;
  private nextChunkNumber = 0;

  constructor(
    private readonly cacheDir: string,
    private readonly storage: StorageDriver,
    chunkSize = 50,
    maxWriteBufferBytes = 4 * 1024 * 1024,
  ) {
    this.chunkSize = Math.max(1, chunkSize);
    this.maxWriteBufferBytes = Math.max(0, maxWriteBufferBytes);
    this.loadManifest();
  }

  get(contentHash: string): TokenData | null {
    this.usedKeys.add(contentHash);
    if (this.writeBuffer.has(contentHash)) {
      return this.writeBuffer.get(contentHash)!;
    }
    if (!this.manifest.has(contentHash)) {
      return null;
    }
    const chunkNumber = this.manifest.get(contentHash)!;
    if (this.loadedChunk === null || this.loadedChunk.number !== chunkNumber) {
      this.loadedChunk = null;
      const entries = this.loadChunkFile(chunkNumber);
      if (entries === null) {
        this.removeChunkFromManifest(chunkNumber);
        return null;
      }
      this.loadedChunk = { number: chunkNumber, entries };
    }
    return this.loadedChunk.entries.get(contentHash) ?? null;
  }

  put(contentHash: string, tokenData: TokenData): void {
    this.usedKeys.add(contentHash);
    this.writeBuffer.set(contentHash, tokenData);
    if (this.maxWriteBufferBytes > 0) {
      this.writeBufferBytes += PageWordCache.estimateBytes(tokenData);
    }
    if (
      this.writeBuffer.size >= this.chunkSize ||
      (this.maxWriteBufferBytes > 0 && this.writeBufferBytes >= this.maxWriteBufferBytes)
    ) {
      this.flushWriteBuffer();
    }
  }

  pruneAndSave(): void {
    if (this.writeBuffer.size > 0) {
      this.flushWriteBuffer();
    }
    this.loadedChunk = null;
    if (this.usedKeys.size > 0) {
      for (const k of [...this.manifest.keys()]) {
        if (!this.usedKeys.has(k)) this.manifest.delete(k);
      }
    }
    const liveChunks = new Set(this.manifest.values());
    const chunkDir = path.join(this.cacheDir, CHUNK_DIR);
    if (this.storage.exists(chunkDir)) {
      for (const f of fs.readdirSync(chunkDir)) {
        const m = /chunk-(\d+)\.msgpack$/.exec(f);
        if (m && !liveChunks.has(parseInt(m[1]!, 10))) {
          this.storage.delete(path.join(chunkDir, f));
        }
      }
    }
    this.saveManifest();
  }

  // -- internal --

  private loadManifest(): void {
    const p = path.join(this.cacheDir, MANIFEST_FILENAME);
    if (!this.storage.exists(p)) return;
    let data: unknown;
    try {
      data = decode(fs.readFileSync(p));
    } catch {
      return;
    }
    if (data && typeof data === "object" && !Array.isArray(data)) {
      this.manifest = new Map(Object.entries(data as Record<string, number>));
      if (this.manifest.size > 0) {
        this.nextChunkNumber = Math.max(...this.manifest.values()) + 1;
      }
    }
  }

  private loadChunkFile(chunkNumber: number): Map<string, TokenData> | null {
    const p = this.chunkFilePath(chunkNumber);
    if (!this.storage.exists(p)) return null;
    let data: unknown;
    try {
      data = decode(fs.readFileSync(p));
    } catch {
      return null;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const out = new Map<string, TokenData>();
    for (const [h, d] of Object.entries(data as Record<string, PackedTokenData>)) {
      out.set(h, unpackTokenData(d));
    }
    return out;
  }

  private writeChunkFile(chunkNumber: number, entries: Map<string, TokenData>): void {
    const chunkDir = path.join(this.cacheDir, CHUNK_DIR);
    this.storage.makeDirectory(chunkDir);
    const p = this.chunkFilePath(chunkNumber);
    const tmp = `${p}.tmp.${process.pid}`;
    const packed: Record<string, PackedTokenData> = {};
    for (const [h, td] of entries) packed[h] = packTokenData(td);
    fs.writeFileSync(tmp, Buffer.from(encode(packed)));
    fs.renameSync(tmp, p);
  }

  private chunkFilePath(chunkNumber: number): string {
    return path.join(this.cacheDir, CHUNK_DIR, `chunk-${String(chunkNumber).padStart(6, "0")}.msgpack`);
  }

  private flushWriteBuffer(): void {
    if (this.writeBuffer.size === 0) return;
    const chunkNumber = this.nextChunkNumber;
    this.nextChunkNumber += 1;
    this.writeChunkFile(chunkNumber, this.writeBuffer);
    for (const h of this.writeBuffer.keys()) {
      this.manifest.set(h, chunkNumber);
    }
    this.writeBuffer = new Map();
    this.writeBufferBytes = 0;
  }

  private static estimateBytes(td: TokenData): number {
    const tokenCount = td.titleTokens.length + td.bodyTokens.length + td.urlTokens.length;
    return tokenCount * 80 + td.content.length;
  }

  private saveManifest(): void {
    this.storage.makeDirectory(this.cacheDir);
    const p = path.join(this.cacheDir, MANIFEST_FILENAME);
    const tmp = `${p}.tmp.${process.pid}`;
    const obj: Record<string, number> = {};
    for (const [k, v] of this.manifest) obj[k] = v;
    fs.writeFileSync(tmp, Buffer.from(encode(obj)));
    fs.renameSync(tmp, p);
  }

  private removeChunkFromManifest(chunkNumber: number): void {
    for (const [k, v] of [...this.manifest.entries()]) {
      if (v === chunkNumber) this.manifest.delete(k);
    }
  }
}
