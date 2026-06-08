/** MemoryBudget + MemoryBudgetConfig tests (ported from the PHP behaviour). */

import { describe, expect, it } from "vitest";
import { MemoryBudget } from "../../src/index/memory-budget.js";
import { MemoryBudgetConfig } from "../../src/index/memory-budget-config.js";

describe("MemoryBudget", () => {
  it("named profiles", () => {
    expect(MemoryBudget.conservative().chunkSize()).toBe(50);
    expect(MemoryBudget.balanced().chunkSize()).toBe(200);
    expect(MemoryBudget.aggressive().chunkSize()).toBe(500);
    expect(MemoryBudget.default().profile).toBe("conservative");
  });

  it("fromString", () => {
    expect(MemoryBudget.fromString("balanced").profile).toBe("balanced");
    expect(MemoryBudget.fromString("AGGRESSIVE").profile).toBe("aggressive");
    expect(MemoryBudget.fromString("256M").profile).toBe("balanced");
    expect(MemoryBudget.fromString("1G").profile).toBe("aggressive");
    expect(MemoryBudget.fromString("10M").profile).toBe("conservative");
  });

  it("fromBytes thresholds", () => {
    expect(MemoryBudget.fromBytes(1024 * 1024 * 1024).profile).toBe("aggressive");
    expect(MemoryBudget.fromBytes(256 * 1024 * 1024).profile).toBe("balanced");
    expect(MemoryBudget.fromBytes(64 * 1024 * 1024).profile).toBe("conservative");
  });

  it("withChunkSize overrides chunk size and raises fan-in floor", () => {
    const b = MemoryBudget.conservative().withChunkSize(300);
    expect(b.chunkSize()).toBe(300);
    expect(b.mergeOpenFileHandles()).toBe(300);
  });

  it("fromOptions applies chunk size override", () => {
    expect(MemoryBudget.fromOptions("balanced", 42).chunkSize()).toBe(42);
    expect(MemoryBudget.fromOptions("balanced").chunkSize()).toBe(200);
  });
});

describe("MemoryBudgetConfig", () => {
  it("load + toMemoryBudget", () => {
    const cfg = MemoryBudgetConfig.load({ profile: "balanced", chunk_size: 100 });
    expect(cfg.profile()).toBe("balanced");
    expect(cfg.toMemoryBudget().chunkSize()).toBe(100);
  });

  it("invalid profile falls back to conservative", () => {
    expect(MemoryBudgetConfig.load({ profile: "bogus!!!" }).profile()).toBe("conservative");
  });

  it("validate flags bad values", () => {
    expect(new MemoryBudgetConfig("conservative").validate()).toEqual([]);
    expect(new MemoryBudgetConfig("nope!", -1, 0).validate().length).toBeGreaterThan(0);
  });

  it("custom bytes round-trips to budget", () => {
    const cfg = MemoryBudgetConfig.load({ profile: "conservative", custom_bytes: 1024 * 1024 * 1024 });
    expect(cfg.toMemoryBudget().profile).toBe("aggressive");
  });
});
