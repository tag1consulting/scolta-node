/** Ported from tests/Index/DeltaEncoderTest.php (1:1). */

import { describe, expect, it } from "vitest";
import { DeltaEncoder } from "../../src/index/delta-encoder.js";

const ep = (m: Record<number, number[]>): number[] =>
  DeltaEncoder.encodePositions(new Map(Object.entries(m).map(([k, v]) => [Number(k), v])));

describe("DeltaEncoder.deltaEncode", () => {
  it("basic", () => expect(DeltaEncoder.deltaEncode([3, 7, 12, 15])).toEqual([3, 4, 5, 3]));
  it("empty", () => expect(DeltaEncoder.deltaEncode([])).toEqual([]));
  it("single", () => expect(DeltaEncoder.deltaEncode([42])).toEqual([42]));
  it("consecutive", () => expect(DeltaEncoder.deltaEncode([1, 2, 3])).toEqual([1, 1, 1]));
});

describe("DeltaEncoder.encodePositions", () => {
  it("default weight only", () => expect(ep({ 25: [5, 20, 35] })).toEqual([5, 15, 15]));
  it("multiple weights", () => expect(ep({ 25: [5, 20, 35], 50: [10, 15] })).toEqual([5, 15, 15, -51, 10, 5]));
  it("empty", () => expect(ep({})).toEqual([]));
  it("empty weight group filtered", () => expect(ep({ 25: [5], 50: [] })).toEqual([5]));
  it("non-default weight only", () => expect(ep({ 50: [10, 15] })).toEqual([-51, 10, 5]));
  it("single position per weight", () => expect(ep({ 25: [100], 75: [200] })).toEqual([100, -76, 200]));
  it("weight marker calculation", () => expect(ep({ 50: [10] })).toEqual([-51, 10]));
  it("multiple non-default weights sorted", () => expect(ep({ 75: [30], 50: [10] })).toEqual([-51, 10, -76, 30]));
});
