/**
 * Minimal canonical CBOR encoder (port of `Tag1\Scolta\Index\CborEncoder`).
 *
 * RFC 8949 major types 0-4 only (uint, negint, text string, array), always
 * canonical (smallest) encoding. String lengths are UTF-8 *byte* lengths,
 * matching PHP's strlen — important for non-ASCII (CJK) terms.
 */

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export class CborEncoder {
  private static head(major: number, val: number): Buffer {
    if (val > MAX_SAFE) {
      throw new Error(`CBOR value ${val} exceeds Number.MAX_SAFE_INTEGER`);
    }
    const m = major << 5;
    if (val <= 23) {
      return Buffer.from([m | val]);
    }
    if (val <= 0xff) {
      return Buffer.from([m | 24, val]);
    }
    if (val <= 0xffff) {
      const b = Buffer.alloc(3);
      b[0] = m | 25;
      b.writeUInt16BE(val, 1);
      return b;
    }
    if (val <= 0xffffffff) {
      const b = Buffer.alloc(5);
      b[0] = m | 26;
      b.writeUInt32BE(val, 1);
      return b;
    }
    const b = Buffer.alloc(9);
    b[0] = m | 27;
    b.writeBigUInt64BE(BigInt(val), 1);
    return b;
  }

  encodeUint(n: number): Buffer {
    if (n < 0) {
      throw new Error("encodeUint requires non-negative integer");
    }
    return CborEncoder.head(0, n);
  }

  encodeNegInt(n: number): Buffer {
    if (n >= 0) {
      throw new Error("encodeNegInt requires negative integer");
    }
    return CborEncoder.head(1, -1 - n);
  }

  encodeString(s: string): Buffer {
    const b = Buffer.from(s, "utf-8");
    return Buffer.concat([CborEncoder.head(3, b.length), b]);
  }

  encodeArray(items: Buffer[]): Buffer {
    return Buffer.concat([CborEncoder.head(4, items.length), ...items]);
  }
}
