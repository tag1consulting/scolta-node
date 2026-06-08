/**
 * Cross-build entity timestamp manifest (port of `TimestampManifest`).
 *
 * Maps entity key -> {ts, items} so unchanged entities can be skipped. Lives in
 * the cross-build cache directory (separate from transient build state). Uses
 * msgpack (no parity constraint) instead of PHP serialize().
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { decode, encode } from "@msgpack/msgpack";
import type { StorageDriver } from "../storage.js";

const FILENAME = "timestamp-manifest.msgpack";

export interface TimestampEntry {
  ts: number;
  items: unknown[];
}

export class TimestampManifest {
  private data = new Map<string, TimestampEntry>();
  private seen = new Set<string>();
  private dirty = false;

  constructor(
    private readonly cacheDir: string,
    private readonly storage: StorageDriver,
  ) {
    this.loadFromDisk();
  }

  get(entityKey: string): TimestampEntry | null {
    return this.data.get(entityKey) ?? null;
  }

  put(entityKey: string, ts: number, items: unknown[]): void {
    this.data.set(entityKey, { ts, items });
    this.seen.add(entityKey);
    this.dirty = true;
  }

  markSeen(entityKey: string): void {
    this.seen.add(entityKey);
  }

  pruneAndSave(): void {
    for (const key of [...this.data.keys()]) {
      if (!this.seen.has(key)) {
        this.data.delete(key);
        this.dirty = true;
      }
    }
    if (this.dirty) {
      this.saveToDisk();
      this.dirty = false;
    }
  }

  isEmpty(): boolean {
    return this.data.size === 0;
  }

  count(): number {
    return this.data.size;
  }

  private filePath(): string {
    return path.join(this.cacheDir, FILENAME);
  }

  private loadFromDisk(): void {
    const p = this.filePath();
    if (!this.storage.exists(p)) return;
    try {
      const data = decode(fs.readFileSync(p)) as Record<string, TimestampEntry>;
      if (data && typeof data === "object") {
        this.data = new Map(Object.entries(data));
      }
    } catch {
      /* ignore unreadable cache */
    }
  }

  private saveToDisk(): void {
    this.storage.makeDirectory(this.cacheDir);
    const p = this.filePath();
    const tmp = `${p}.tmp.${process.pid}`;
    const obj: Record<string, TimestampEntry> = {};
    for (const [k, v] of this.data) obj[k] = v;
    fs.writeFileSync(tmp, Buffer.from(encode(obj)));
    fs.renameSync(tmp, p);
  }
}
