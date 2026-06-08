/**
 * Ported from tests/Index/IndexerResolverTest.php.
 *
 * Design rule: auto/unknown -> TS; binary -> binary if the Pagefind Node API is
 * present, else fall back to TS with a logged notice. (JS uses the Node API
 * probe, not a CLI binary resolver.)
 */

import { describe, expect, it } from "vitest";
import { IndexerResolver, type BinaryProbe } from "../../src/index/resolver.js";
import type { PagefindStatus } from "../../src/index/pagefind.js";

class SpyLogger {
  records: string[] = [];
  info(msg: string): void {
    this.records.push(msg);
  }
}

function probe(available: boolean): BinaryProbe {
  return {
    isAvailable: async () => available,
    status: async (): Promise<PagefindStatus> => ({
      available,
      version: available ? "1.5.0" : null,
      via: available ? "node-api" : "none",
      message: available ? "available" : "Pagefind Node API not available (stub).",
    }),
  };
}

describe("IndexerResolver", () => {
  it("ts mode returns ts", async () => {
    const log = new SpyLogger();
    expect(await new IndexerResolver(probe(false), log).resolve("ts")).toBe("ts");
    expect(log.records[0]).toContain("Using TS indexer");
  });

  it("binary mode with available binary", async () => {
    const log = new SpyLogger();
    expect(await new IndexerResolver(probe(true), log).resolve("binary")).toBe("binary");
    expect(log.records[0]).toContain("Using binary indexer");
  });

  it("binary mode missing falls back to ts", async () => {
    const log = new SpyLogger();
    expect(await new IndexerResolver(probe(false), log).resolve("binary")).toBe("ts");
    expect(log.records[0]).toContain("Falling back to TS indexer");
    expect(log.records[0]).toContain("binary not available");
  });

  it("auto mode returns ts", async () => {
    expect(await new IndexerResolver(probe(false), new SpyLogger()).resolve("auto")).toBe("ts");
  });

  it("auto mode with available binary still ts", async () => {
    const log = new SpyLogger();
    expect(await new IndexerResolver(probe(true), log).resolve("auto")).toBe("ts");
    expect(log.records[0]).toContain("Using TS indexer");
  });

  it("unknown mode returns ts", async () => {
    expect(await new IndexerResolver(probe(false), new SpyLogger()).resolve("nonsense")).toBe("ts");
  });
});
