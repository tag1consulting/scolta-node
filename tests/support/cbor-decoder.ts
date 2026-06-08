/**
 * Minimal CBOR decoder for reading Pagefind index files in tests.
 *
 * Port of scolta-php's tests/Support/CborDecoder.php. Handles the CBOR types
 * Pagefind uses (major 0-5). Test-only.
 */

import * as fs from "node:fs";
import { gunzipSync } from "node:zlib";

class Decoder {
  private offset = 0;
  constructor(private readonly data: Buffer) {}

  decodeItem(): unknown {
    const byte = this.data[this.offset]!;
    this.offset += 1;
    const major = (byte >> 5) & 0x07;
    const additional = byte & 0x1f;
    const value = this.decodeAdditional(additional);
    if (major === 0) return value;
    if (major === 1) return -1 - value;
    if (major === 2 || major === 3) return this.readBytes(value, major === 3);
    if (major === 4) {
      const arr: unknown[] = [];
      for (let i = 0; i < value; i++) arr.push(this.decodeItem());
      return arr;
    }
    if (major === 5) {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < value; i++) {
        const k = this.decodeItem();
        obj[String(k)] = this.decodeItem();
      }
      return obj;
    }
    throw new Error(`Unsupported CBOR major type: ${major}`);
  }

  private decodeAdditional(additional: number): number {
    if (additional <= 23) return additional;
    if (additional === 24) {
      const v = this.data[this.offset]!;
      this.offset += 1;
      return v;
    }
    if (additional === 25) {
      const v = this.data.readUInt16BE(this.offset);
      this.offset += 2;
      return v;
    }
    if (additional === 26) {
      const v = this.data.readUInt32BE(this.offset);
      this.offset += 4;
      return v;
    }
    if (additional === 27) {
      const v = Number(this.data.readBigUInt64BE(this.offset));
      this.offset += 8;
      return v;
    }
    throw new Error(`Unsupported CBOR additional info: ${additional}`);
  }

  private readBytes(length: number, text: boolean): string | Buffer {
    const b = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return text ? b.toString("utf-8") : Buffer.from(b);
  }
}

export function decode(data: Buffer): unknown {
  return new Decoder(data).decodeItem();
}

/** Decode a Pagefind .pf file (gzipped, with pagefind_dcd delimiter). */
export function decodePfFile(filepath: string): unknown {
  const compressed = fs.readFileSync(filepath);
  let decompressed = gunzipSync(compressed);
  if (decompressed.subarray(0, 12).toString("latin1") === "pagefind_dcd") {
    decompressed = decompressed.subarray(12);
  }
  return decode(decompressed);
}

/** Decode a gzipped fragment file to its JSON object. */
export function decodeFragment(filepath: string): Record<string, unknown> {
  const compressed = fs.readFileSync(filepath);
  let raw = gunzipSync(compressed);
  if (raw.subarray(0, 12).toString("latin1") === "pagefind_dcd") {
    raw = raw.subarray(12);
  }
  return JSON.parse(raw.toString("utf-8"));
}
