/** Health checks + setup diagnostics (ported from Health/*). */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScoltaConfig } from "../src/config.js";
import { HealthChecker, SetupCheck } from "../src/health.js";
import type { PagefindStatus } from "../src/index/pagefind.js";

const unavailableBinary = {
  status: async (): Promise<PagefindStatus> => ({ available: false, version: null, via: "none", message: "stub" }),
};
const availableBinary = {
  status: async (): Promise<PagefindStatus> => ({ available: true, version: "1.5.0", via: "node-api", message: "ok" }),
};

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scolta-health-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("HealthChecker", () => {
  it("degraded when no index and no key", async () => {
    const report = await new HealthChecker(new ScoltaConfig(), tmp, unavailableBinary).check();
    expect(report.status).toBe("degraded");
    expect(report.indexExists).toBe(false);
    expect(report.aiConfigured).toBe(false);
    expect(report.indexerActive).toBe("ts");
  });

  it("ok when index exists and key configured", async () => {
    fs.mkdirSync(path.join(tmp, "pagefind"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "pagefind", "pagefind.js"), "//");
    const config = ScoltaConfig.fromObject({ ai_api_key: "sk-x" });
    const report = await new HealthChecker(config, tmp, unavailableBinary).check();
    expect(report.status).toBe("ok");
    expect(report.indexExists).toBe(true);
    expect(report.aiConfigured).toBe(true);
  });

  it("reports binary upgrade unavailable when indexer=binary but Node API missing", async () => {
    const config = ScoltaConfig.fromObject({ indexer: "binary", ai_api_key: "sk-x" });
    fs.mkdirSync(path.join(tmp, "pagefind"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "pagefind", "pagefind.js"), "//");
    const report = await new HealthChecker(config, tmp, unavailableBinary).check();
    expect(report.indexerActive).toBe("ts");
    expect(report.indexerUpgradeAvailable).toBe(true);
    expect(report.indexerUpgradeMessage).toContain("Pagefind");
  });

  it("indexerActive binary when configured and available", async () => {
    const config = ScoltaConfig.fromObject({ indexer: "binary", ai_api_key: "sk-x" });
    fs.mkdirSync(path.join(tmp, "pagefind"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "pagefind", "pagefind.js"), "//");
    const report = await new HealthChecker(config, tmp, availableBinary).check();
    expect(report.indexerActive).toBe("binary");
  });
});

describe("SetupCheck", () => {
  it("reports node version, key, wasm, binary", async () => {
    const results = await SetupCheck.run({ aiApiKey: "sk-x", binary: unavailableBinary });
    const names = results.map((r) => r.name);
    expect(names).toContain("Node version");
    expect(names).toContain("AI API key");
    expect(names).toContain("Browser WASM");
    expect(names).toContain("Pagefind Node API");
    expect(results.find((r) => r.name === "Node version")!.status).toBe("pass");
    expect(results.find((r) => r.name === "Browser WASM")!.status).toBe("pass"); // vendored
  });

  it("Intl.Segmenter is available (full ICU)", () => {
    expect(SetupCheck.checkIntlSegmenter().level).toBe("ok");
  });

  it("output directory writable check", () => {
    expect(SetupCheck.checkOutputDirectoryWritable(tmp).level).toBe("ok");
  });

  it("exit code reflects failures", () => {
    expect(SetupCheck.exitCode([{ status: "pass" }, { status: "warn" }])).toBe(0);
    expect(SetupCheck.exitCode([{ status: "fail" }])).toBe(1);
    expect(SetupCheck.exitCode([{ level: "error" }])).toBe(1);
  });
});
