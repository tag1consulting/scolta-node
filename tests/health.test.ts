/** Health checks + setup diagnostics (ported from Health/*). */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KeyExpiryRecovery, MemoryConfigStorage } from "../src/ai/amazee/index.js";
import { InMemoryCacheDriver } from "../src/cache.js";
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
    const config = ScoltaConfig.fromObject({ ai_provider: "anthropic", ai_api_key: "sk-x" });
    const report = await new HealthChecker(config, tmp, unavailableBinary).check();
    expect(report.status).toBe("ok");
    expect(report.indexExists).toBe(true);
    expect(report.aiConfigured).toBe(true);
  });

  it("reports binary upgrade unavailable when indexer=binary but Node API missing", async () => {
    const config = ScoltaConfig.fromObject({ ai_provider: "anthropic", indexer: "binary", ai_api_key: "sk-x" });
    fs.mkdirSync(path.join(tmp, "pagefind"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "pagefind", "pagefind.js"), "//");
    const report = await new HealthChecker(config, tmp, unavailableBinary).check();
    expect(report.indexerActive).toBe("ts");
    expect(report.indexerUpgradeAvailable).toBe(true);
    expect(report.indexerUpgradeMessage).toContain("Pagefind");
  });

  it("indexerActive binary when configured and available", async () => {
    const config = ScoltaConfig.fromObject({ ai_provider: "anthropic", indexer: "binary", ai_api_key: "sk-x" });
    fs.mkdirSync(path.join(tmp, "pagefind"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "pagefind", "pagefind.js"), "//");
    const report = await new HealthChecker(config, tmp, availableBinary).check();
    expect(report.indexerActive).toBe("binary");
  });
});

describe("HealthChecker AI usability", () => {
  // Regression (P2, 2026-06-09/10 family): aiConfigured checked only the
  // explicit ai_api_key, so an install running happily on Amazee
  // auto-provisioned credentials reported "degraded" forever — the inverse of
  // the php/python lie (configured-while-broken). And per scolta-php #211,
  // "configured" must not imply "usable": stored credentials can be
  // expired/revoked server-side.

  function writeIndex(): void {
    fs.mkdirSync(path.join(tmp, "pagefind"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "pagefind", "pagefind.js"), "//");
  }

  it("amazee-connected install (no explicit key, stored creds) is configured + usable, not degraded", async () => {
    writeIndex();
    const storage = new MemoryConfigStorage();
    storage.store("lt-token", "https://llm.amazee.ai", "eu");

    // A site with stored Amazee credentials selected a provider to get them:
    // "amazee" in configuration is the opt-in that permitted the connection.
    const report = await new HealthChecker(
      ScoltaConfig.fromObject({ ai_provider: "amazee" }),
      tmp,
      unavailableBinary,
      storage,
      new InMemoryCacheDriver(),
    ).check();

    expect(report.aiConfigured).toBe(true);
    expect(report.aiUsable).toBe(true);
    expect(report.aiAuthFailing).toBe(false);
    expect(report.status).toBe("ok");
  });

  it("explicit key behaves as before: configured + usable", async () => {
    writeIndex();
    const config = ScoltaConfig.fromObject({ ai_provider: "anthropic", ai_api_key: "sk-x" });

    const report = await new HealthChecker(
      config,
      tmp,
      unavailableBinary,
      new MemoryConfigStorage(),
      new InMemoryCacheDriver(),
    ).check();

    expect(report.aiConfigured).toBe(true);
    expect(report.aiUsable).toBe(true);
    expect(report.aiAuthFailing).toBe(false);
    expect(report.status).toBe("ok");
  });

  it("neither explicit key nor stored creds: not configured, not usable, degraded", async () => {
    writeIndex();

    const report = await new HealthChecker(
      new ScoltaConfig(),
      tmp,
      unavailableBinary,
      new MemoryConfigStorage(),
      new InMemoryCacheDriver(),
    ).check();

    expect(report.aiConfigured).toBe(false);
    expect(report.aiUsable).toBe(false);
    expect(report.aiAuthFailing).toBe(false);
    expect(report.status).toBe("degraded");
  });

  it("stored-but-auth-failing creds (marker set): configured stays true, not usable, degraded", async () => {
    writeIndex();
    const storage = new MemoryConfigStorage();
    storage.store("lt-expired", "https://llm.amazee.ai", "eu");
    const cache = new InMemoryCacheDriver();
    cache.set(KeyExpiryRecovery.CACHE_KEY_AUTH_FAILURE, Date.now() / 1000, 3600);

    const report = await new HealthChecker(new ScoltaConfig(), tmp, unavailableBinary, storage, cache).check();

    expect(report.aiConfigured).toBe(true); // credentials ARE present
    expect(report.aiAuthFailing).toBe(true);
    expect(report.aiUsable).toBe(false); // known-expired creds must not report usable
    expect(report.status).toBe("degraded");
  });

  it("a cleared auth-failure marker restores usable", async () => {
    writeIndex();
    const cache = new InMemoryCacheDriver();
    // KeyExpiryRecovery clears the marker by overwriting it with false.
    cache.set(KeyExpiryRecovery.CACHE_KEY_AUTH_FAILURE, false, 1);

    const report = await new HealthChecker(
      ScoltaConfig.fromObject({ ai_provider: "anthropic", ai_api_key: "sk-recovered" }),
      tmp,
      unavailableBinary,
      null,
      cache,
    ).check();

    expect(report.aiUsable).toBe(true);
    expect(report.aiAuthFailing).toBe(false);
    expect(report.status).toBe("ok");
  });

  it("without storage or cache wired, behavior is unchanged (explicit key only, usable mirrors configured)", async () => {
    writeIndex();

    const withKey = await new HealthChecker(
      ScoltaConfig.fromObject({ ai_provider: "anthropic", ai_api_key: "sk-x" }),
      tmp,
      unavailableBinary,
    ).check();
    expect(withKey.aiConfigured).toBe(true);
    expect(withKey.aiUsable).toBe(true);
    expect(withKey.aiAuthFailing).toBe(false);
    expect(withKey.status).toBe("ok");

    const withoutKey = await new HealthChecker(new ScoltaConfig(), tmp, unavailableBinary).check();
    expect(withoutKey.aiConfigured).toBe(false);
    expect(withoutKey.aiUsable).toBe(false);
    expect(withoutKey.status).toBe("degraded");
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
