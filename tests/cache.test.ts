/** Tests for the cache drivers (ported from Cache/NullCacheDriver.php behaviour). */

import { describe, expect, it } from "vitest";
import { InMemoryCacheDriver, NullCacheDriver } from "../src/cache.js";

describe("cache drivers", () => {
  it("null driver get returns null", () => {
    const d = new NullCacheDriver();
    d.set("k", "v", 60);
    expect(d.get("k")).toBeNull();
  });

  it("in-memory driver roundtrip", () => {
    const d = new InMemoryCacheDriver();
    expect(d.get("missing")).toBeNull();
    d.set("k", { a: 1 }, 60);
    expect(d.get("k")).toEqual({ a: 1 });
  });
});
