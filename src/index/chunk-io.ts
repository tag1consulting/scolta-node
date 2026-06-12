/**
 * Transient build-chunk v2 I/O (port of ChunkWriter / ChunkReader).
 *
 * Format:
 *     {JSON header}\n
 *     [page records:  4-byte LE length + msgpack payload] x page_count
 *     [term records:  4-byte LE length + msgpack payload] x term_count (sorted)
 *     \x00\x00\x00\x00  (end-of-records sentinel)
 *     {JSON footer with crc32 (+ optional hmac)}\n
 *
 * Records use msgpack (not PHP serialize) — internal only, no parity
 * constraint. Terms are written alphabetically so the N-way streaming merge can
 * consume them. TermEntry Maps are flattened to plain arrays for serialization.
 */

import { createHmac } from "node:crypto";
import * as fs from "node:fs";
import { decode, encode } from "@msgpack/msgpack";
import type { IndexPage, PageEntry, TermEntry } from "./pf-common.js";
import type { PartialIndex } from "./inverted-index-builder.js";

const SENTINEL = Buffer.from([0, 0, 0, 0]);

// -- standard CRC32 (Node 20 has no zlib.crc32) -----------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer, seed = 0): number {
  let crc = (seed ^ -1) >>> 0;
  for (let i = 0; i < buf.length; i++) {
    crc = (CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ -1) >>> 0;
}

function hex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, "0");
}

// -- term serialization (Maps <-> plain) ------------------------------------

interface SerTermEntry {
  p: [number, { po: [number, number[]][]; m: number[] }][];
  v: [string, number[]][];
}

function serializeTerm(te: TermEntry): SerTermEntry {
  return {
    p: [...te.pages.entries()].map(([pn, pe]) => [pn, { po: [...pe.positions.entries()], m: pe.metaPositions }]),
    v: [...te.variants.entries()],
  };
}

function deserializeTerm(s: SerTermEntry): TermEntry {
  const pages = new Map<number, PageEntry>();
  for (const [pn, pe] of s.p) {
    pages.set(pn, { positions: new Map(pe.po), metaPositions: pe.m });
  }
  return { pages, variants: new Map(s.v) };
}

function pack(obj: unknown): Buffer {
  return Buffer.from(encode(obj));
}

function unpack(data: Buffer): unknown {
  return decode(data);
}

export class ChunkWriter {
  write(path: string, partial: PartialIndex, hmacSecret: string | null = null): void {
    const pages = partial.pages;
    const index = partial.index;
    const terms = [...index.keys()].sort();

    const chunks: Buffer[] = [];
    const header = JSON.stringify({ v: 2, page_count: pages.size, term_count: terms.length });
    chunks.push(Buffer.from(header + "\n", "utf-8"));

    const hmacCtx = hmacSecret ? createHmac("sha256", hmacSecret) : null;
    let crc = 0;

    const emit = (payload: Buffer): void => {
      const length = Buffer.alloc(4);
      length.writeUInt32LE(payload.length, 0);
      chunks.push(length, payload);
      if (hmacCtx) {
        hmacCtx.update(length);
        hmacCtx.update(payload);
      }
      crc = crc32(length, crc);
      crc = crc32(payload, crc);
    };

    for (const [pageNum, pageData] of pages) {
      emit(pack([pageNum, pageData]));
    }
    for (const term of terms) {
      emit(pack([term, serializeTerm(index.get(term)!)]));
    }

    chunks.push(SENTINEL);
    const footer = { hmac: hmacCtx ? hmacCtx.digest("hex") : "", crc32: hex8(crc) };
    chunks.push(Buffer.from(JSON.stringify(footer) + "\n", "utf-8"));

    fs.writeFileSync(path, Buffer.concat(chunks));
  }
}

interface ChunkHeader {
  pageCount: number;
  termCount: number;
}

export class ChunkReader {
  constructor(private readonly path: string) {}

  private parse(): { buf: Buffer; header: ChunkHeader; bodyStart: number } {
    const buf = fs.readFileSync(this.path);
    const nl = buf.indexOf(0x0a);
    if (nl === -1) throw new Error(`Cannot read chunk header: ${this.path}`);
    if (buf[0] !== 0x7b) {
      throw new Error(
        `Chunk is not in v2 streaming format (first byte is not '{'). ` +
          `Delete the state directory and re-run a fresh build: ${this.path}`,
      );
    }
    const parsed: unknown = JSON.parse(buf.subarray(0, nl).toString("utf-8"));
    const header =
      parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    if (Number(header["v"] ?? 0) !== 2) {
      throw new Error(`Malformed or unsupported chunk header in: ${this.path}`);
    }
    return {
      buf,
      header: {
        pageCount: Number(header["page_count"] ?? 0),
        termCount: Number(header["term_count"] ?? 0),
      },
      bodyStart: nl + 1,
    };
  }

  *openPages(): Generator<[number, IndexPage]> {
    const { buf, header, bodyStart } = this.parse();
    let off = bodyStart;
    for (let i = 0; i < header.pageCount; i++) {
      const len = buf.readUInt32LE(off);
      off += 4;
      const payload = buf.subarray(off, off + len);
      off += len;
      const [pageNum, pageData] = unpack(Buffer.from(payload)) as [number, IndexPage];
      yield [Number(pageNum), pageData];
    }
  }

  *openIndex(): Generator<[string, TermEntry]> {
    const { buf, header, bodyStart } = this.parse();
    let off = bodyStart;
    for (let i = 0; i < header.pageCount; i++) {
      const len = buf.readUInt32LE(off);
      off += 4 + len;
    }
    while (off + 4 <= buf.length) {
      const len = buf.readUInt32LE(off);
      off += 4;
      if (len === 0) break;
      const payload = buf.subarray(off, off + len);
      off += len;
      const record = unpack(Buffer.from(payload)) as [string, SerTermEntry];
      yield [String(record[0]), deserializeTerm(record[1])];
    }
  }

  verifyCrc32(): boolean {
    try {
      const { buf, bodyStart } = this.parse();
      // CRC covers every record (pages + terms) from bodyStart to the sentinel.
      let crc = 0;
      let p = bodyStart;
      while (p + 4 <= buf.length) {
        const len = buf.readUInt32LE(p);
        if (len === 0) {
          p += 4;
          break;
        }
        const lenBuf = buf.subarray(p, p + 4);
        const payload = buf.subarray(p + 4, p + 4 + len);
        crc = crc32(Buffer.from(lenBuf), crc);
        crc = crc32(Buffer.from(payload), crc);
        p += 4 + len;
      }
      const footerNl = buf.indexOf(0x0a, p);
      const footer: unknown = JSON.parse(
        buf.subarray(p, footerNl === -1 ? undefined : footerNl).toString("utf-8"),
      );
      if (footer === null || typeof footer !== "object") return false;
      if (!("crc32" in footer)) return true;
      return hex8(crc) === (footer as Record<string, unknown>)["crc32"];
    } catch {
      return false;
    }
  }

  verifyHmac(hmacSecret: string): boolean {
    try {
      const { buf, bodyStart } = this.parse();
      const ctx = createHmac("sha256", hmacSecret);
      let p = bodyStart;
      while (p + 4 <= buf.length) {
        const len = buf.readUInt32LE(p);
        if (len === 0) {
          p += 4;
          break;
        }
        ctx.update(buf.subarray(p, p + 4));
        ctx.update(buf.subarray(p + 4, p + 4 + len));
        p += 4 + len;
      }
      const footerNl = buf.indexOf(0x0a, p);
      const footer: unknown = JSON.parse(
        buf.subarray(p, footerNl === -1 ? undefined : footerNl).toString("utf-8"),
      );
      if (footer === null || typeof footer !== "object") return false;
      return (
        "hmac" in footer && (footer as Record<string, unknown>)["hmac"] === ctx.digest("hex")
      );
    } catch {
      return false;
    }
  }
}

/**
 * Write a terms-only chunk file (page_count 0) for the merger's pre-merge
 * fan-in pass. Same v2 format so ChunkReader.openIndex can consume it.
 */
export function writeTermRecords(filePath: string, records: [string, TermEntry][]): void {
  const chunks: Buffer[] = [];
  chunks.push(Buffer.from(JSON.stringify({ v: 2, page_count: 0, term_count: 0 }) + "\n", "utf-8"));
  let crc = 0;
  for (const [term, te] of records) {
    const payload = pack([term, serializeTerm(te)]);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(payload.length, 0);
    chunks.push(length, payload);
    crc = crc32(length, crc);
    crc = crc32(payload, crc);
  }
  chunks.push(SENTINEL);
  chunks.push(Buffer.from(JSON.stringify({ hmac: "", crc32: hex8(crc) }) + "\n", "utf-8"));
  fs.writeFileSync(filePath, Buffer.concat(chunks));
}

export { serializeTerm, deserializeTerm };
