/** Ported from tests/Index/CborEncoderTest.php (1:1), plus a UTF-8 byte-length case. */

import { describe, expect, it } from "vitest";
import { CborEncoder } from "../../src/index/cbor.js";

const cbor = new CborEncoder();
const b = (...bytes: number[]): Buffer => Buffer.from(bytes);

describe("CborEncoder", () => {
  it("uint values", () => {
    expect(cbor.encodeUint(0)).toEqual(b(0x00));
    expect(cbor.encodeUint(1)).toEqual(b(0x01));
    expect(cbor.encodeUint(10)).toEqual(b(0x0a));
    expect(cbor.encodeUint(23)).toEqual(b(0x17));
    expect(cbor.encodeUint(24)).toEqual(b(0x18, 0x18));
    expect(cbor.encodeUint(100)).toEqual(b(0x18, 0x64));
    expect(cbor.encodeUint(1000)).toEqual(b(0x19, 0x03, 0xe8));
    expect(cbor.encodeUint(255)).toEqual(b(0x18, 0xff));
    expect(cbor.encodeUint(65535)).toEqual(b(0x19, 0xff, 0xff));
    expect(cbor.encodeUint(65536)).toEqual(b(0x1a, 0x00, 0x01, 0x00, 0x00));
  });

  it("negative ints", () => {
    expect(cbor.encodeNegInt(-1)).toEqual(b(0x20));
    expect(cbor.encodeNegInt(-10)).toEqual(b(0x29));
    expect(cbor.encodeNegInt(-100)).toEqual(b(0x38, 0x63));
  });

  it("strings", () => {
    expect(cbor.encodeString("")).toEqual(b(0x60));
    expect(cbor.encodeString("a")).toEqual(b(0x61, 0x61));
  });

  it("string uses utf-8 byte length", () => {
    const encoded = cbor.encodeString("世");
    expect(encoded).toEqual(Buffer.concat([b(0x63), Buffer.from("世")]));
    expect(encoded.length).toBe(4);
  });

  it("arrays", () => {
    expect(cbor.encodeArray([])).toEqual(b(0x80));
    expect(cbor.encodeArray([cbor.encodeUint(1), cbor.encodeUint(2), cbor.encodeUint(3)])).toEqual(
      b(0x83, 0x01, 0x02, 0x03),
    );
    const inner = cbor.encodeArray([cbor.encodeUint(1)]);
    expect(cbor.encodeArray([inner])).toEqual(b(0x81, 0x81, 0x01));
  });

  it("rejects bad inputs", () => {
    expect(() => cbor.encodeUint(-1)).toThrow();
    expect(() => cbor.encodeNegInt(0)).toThrow();
  });
});
