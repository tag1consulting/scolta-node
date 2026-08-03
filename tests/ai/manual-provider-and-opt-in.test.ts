/**
 * The two policy invariants, asserted where this package decides them.
 *
 * **A — no default provider.** Nothing ships with an AI provider selected.
 * `ai_provider` is empty until somebody sets it, and while it is empty AI is
 * off: search still works, no provider is assumed, and Anthropic in particular
 * is not silently assumed.
 *
 * **B — Amazee is never auto-enabled.** In a headless framework the manual
 * opt-in is `ai_provider = "amazee"` written in configuration by a developer.
 * That value, and nothing else, permits establishing the free demo on first
 * use; it must be idempotent, and it must never fire when the provider is unset
 * or set to anything else.
 *
 * Every Amazee fetch here fails the test if it is called, so an unexpected
 * outbound call is a hard failure naming the URL rather than a swallowed error.
 *
 * Mirrors `tests/AiProvider/Amazee/ManualProviderAndOptInTest.php` in
 * scolta-php and `tests/ai/amazee/test_manual_provider_and_opt_in.py` in
 * scolta-python: the three cores share one contract.
 */

import { describe, expect, it } from "vitest";
import { ScoltaConfig } from "../../src/config.js";
import { AiClient } from "../../src/ai/client.js";
import { AiServiceAdapter } from "../../src/ai/service.js";
import { AmazeeAiService } from "../../src/ai/amazee-service.js";
import { ApiKeyMissingError } from "../../src/errors.js";
import { HealthChecker } from "../../src/health.js";
import {
  AmazeeAccountUpgrader,
  AmazeeClient,
  AmazeeConnectionSource,
  AmazeeTrialProvisioner,
  AutoProvisioner,
  MemoryConfigStorage,
} from "../../src/ai/amazee/index.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** An Amazee client whose every call fails the test, recording the URL first. */
function failOnCallClient(attempted: string[]): AmazeeClient {
  const fetchImpl: typeof fetch = async (url) => {
    attempted.push(String(url));
    throw new Error(`no outbound Amazee call expected, got ${String(url)}`);
  };
  return new AmazeeClient("https://api.amazee.ai", fetchImpl);
}

/** An Amazee client answering a fixed route table, recording request bodies. */
function scriptedClient(routes: Record<string, unknown>, bodies: string[] = []): AmazeeClient {
  const fetchImpl: typeof fetch = async (url, init) => {
    bodies.push(String(init?.body ?? ""));
    const match = Object.keys(routes).find((k) => String(url).includes(k));
    if (match === undefined) {
      throw new Error(`unexpected Amazee URL ${String(url)}`);
    }
    return new Response(JSON.stringify(routes[match]), { status: 200 });
  };
  return new AmazeeClient("https://api.amazee.ai", fetchImpl);
}

const TRIAL = {
  key: { litellm_token: "demo-tok", litellm_api_url: "https://llm.amazee.ai", region: "eu" },
};
const MODELS = { data: [{ model_name: "claude-sonnet-4-5" }, { model_name: "claude-haiku-3-5" }] };

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "scolta-optin-"));
}

/** A Pagefind probe that reports the binary absent, so health stays offline. */
const unavailableBinary = {
  status: async () => ({ available: false, version: null, via: "none" as const, message: "stub" }),
};

// -- Invariant A: no default provider ---------------------------------------

describe("no default AI provider", () => {
  it("ships with no provider selected", () => {
    expect(new ScoltaConfig().ai_provider).toBe("");
    expect(ScoltaConfig.fromObject({}).ai_provider).toBe("");
  });

  it("preserves a provider a site already chose", () => {
    // Going-forward only: removing the shipped default never rewrites a value
    // that is already there.
    for (const chosen of ["anthropic", "openai", "amazee"]) {
      expect(ScoltaConfig.fromObject({ ai_provider: chosen }).ai_provider).toBe(chosen);
    }
  });

  it("builds no AI client on any operation when nothing is selected", async () => {
    let builds = 0;

    class Adapter extends AiServiceAdapter {
      protected override createClient(): AiClient {
        builds += 1;
        throw new Error("an AI client was built with no provider selected");
      }
    }

    const adapter = new Adapter(ScoltaConfig.fromObject({}));

    for (const operation of ["expand_query", "summarize", "follow_up"]) {
      await expect(adapter.messageForOperation(operation, "sys", "user", 512)).rejects.toBeInstanceOf(
        ApiKeyMissingError,
      );
    }

    expect(builds).toBe(0);
  });

  it("refuses to construct an AiClient that assumes a provider", () => {
    expect(() => new AiClient({ api_key: "sk-test" })).toThrow(/No AI provider selected/);
  });

  it("reports AI off in health rather than assuming anthropic", async () => {
    const report = await new HealthChecker(ScoltaConfig.fromObject({}), tmpdir(), unavailableBinary).check();

    expect(report.aiProvider).toBe("");
    expect(report.aiProviderSelected).toBe(false);
    expect(report.aiConfigured).toBe(false);
    expect(report.aiUsable).toBe(false);
  });

  it("keeps AI off when a key exists but no provider was selected", async () => {
    // The case a coalescing default used to hide: a key set before anybody
    // chose a provider looked like a working Anthropic install.
    const report = await new HealthChecker(
      ScoltaConfig.fromObject({ ai_api_key: "sk-env" }),
      tmpdir(),
      unavailableBinary,
    ).check();

    expect(report.aiProvider).toBe("");
    expect(report.aiProviderSelected).toBe(false);
    expect(report.aiUsable).toBe(false);
  });
});

// -- Invariant B: Amazee is never auto-enabled -------------------------------

describe("the Amazee opt-in gate", () => {
  it("makes no outbound call and stores nothing with no provider selected", async () => {
    const attempted: string[] = [];
    const storage = new MemoryConfigStorage();
    const service = new AmazeeAiService(ScoltaConfig.fromObject({}), storage, {
      amazeeClient: failOnCallClient(attempted),
    });

    await expect(service.message("sys", "user")).rejects.toBeTruthy();

    expect(attempted).toEqual([]);
    expect(storage.load()).toBeNull();
  });

  it("makes no outbound call for a non-Amazee provider, even with no key", async () => {
    const attempted: string[] = [];
    const storage = new MemoryConfigStorage();
    const service = new AmazeeAiService(
      ScoltaConfig.fromObject({ ai_provider: "anthropic" }),
      storage,
      { amazeeClient: failOnCallClient(attempted) },
    );

    await expect(service.message("sys", "user")).rejects.toBeTruthy();

    expect(attempted).toEqual([]);
    expect(storage.load()).toBeNull();
  });

  it("establishes the demo once when a developer set ai_provider = amazee", async () => {
    const storage = new MemoryConfigStorage();
    let trialCalls = 0;
    const fetchImpl: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes("/auth/generate-trial-access")) {
        trialCalls += 1;
        return new Response(JSON.stringify(TRIAL), { status: 200 });
      }
      if (u.includes("/model/info")) {
        return new Response(JSON.stringify(MODELS), { status: 200 });
      }
      throw new Error(`unexpected Amazee URL ${u}`);
    };

    const service = new AmazeeAiService(ScoltaConfig.fromObject({ ai_provider: "amazee" }), storage, {
      amazeeClient: new AmazeeClient("https://api.amazee.ai", fetchImpl),
    });

    // Two calls; the AI request itself fails (no AI backend is mocked), which is
    // irrelevant — what is asserted is the provisioning side effect.
    await service.message("sys", "user").catch(() => undefined);
    await service.message("sys", "user").catch(() => undefined);

    expect(trialCalls).toBe(1); // idempotent
    expect(storage.load()?.litellm_token).toBe("demo-tok");
    expect(storage.loadConnectionSource?.()).toBe(AmazeeConnectionSource.Demo);
  });

  it("never mints from the self-heal guard, on any entry path", async () => {
    const attempted: string[] = [];
    const storage = new MemoryConfigStorage();
    const models: string[] = [];

    const result = await AutoProvisioner.ensureAiAvailable(storage, {
      hasExplicitApiKey: false,
      client: failOnCallClient(attempted),
      onModelsResolved: (a, e) => models.push(a, e),
    });

    expect(result).toBe(false);
    expect(storage.load()).toBeNull();
    expect(models).toEqual([]);
    expect(attempted).toEqual([]);
  });

  it("self-heals against the stored key without minting", async () => {
    const storage = new MemoryConfigStorage();
    storage.store("stored-tok", "https://llm.amazee.ai", "eu");
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      seen.push(String(url));
      return new Response(JSON.stringify(MODELS), { status: 200 });
    };

    await AutoProvisioner.ensureAiAvailable(storage, {
      client: new AmazeeClient("https://api.amazee.ai", fetchImpl),
      onModelsResolved: (a, e) => storage.storeModels(a, e),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("/model/info");
    expect(storage.load()?.litellm_token).toBe("stored-tok");
  });
});

// -- Provenance: recorded at connect time, never guessed ---------------------

describe("Amazee connection provenance", () => {
  it("records the demo, and sends no email", async () => {
    const storage = new MemoryConfigStorage();
    const bodies: string[] = [];
    const client = scriptedClient({ "/auth/generate-trial-access": TRIAL }, bodies);

    await new AmazeeTrialProvisioner(client, storage).provision();

    expect(storage.loadConnectionSource?.()).toBe(AmazeeConnectionSource.Demo);
    // Trying the demo costs the operator no input at all.
    expect(bodies[0]).toContain('"email":""');
  });

  it("records the account, replacing a demo's mark", async () => {
    const storage = new MemoryConfigStorage();
    storage.store("demo-tok", "https://llm.amazee.ai", "eu");
    storage.storeConnectionSource?.(AmazeeConnectionSource.Demo);

    const client = scriptedClient({
      "/private-ai-keys": {
        litellm_token: "account-tok",
        litellm_api_url: "https://ch.amazee.ai",
        region: "ch",
      },
    });

    await new AmazeeAccountUpgrader(client, storage).upgrade("session", "ch");

    expect(storage.loadConnectionSource?.()).toBe(AmazeeConnectionSource.Account);
    expect(storage.load()?.litellm_token).toBe("account-tok");
  });

  it("drops provenance when credentials are cleared", () => {
    // A stale mark left behind would be paired with the next connection, which
    // is a guess wearing a recorded fact's clothes.
    const storage = new MemoryConfigStorage();
    storage.store("tok", "https://llm.amazee.ai", "eu");
    storage.storeConnectionSource?.(AmazeeConnectionSource.Demo);

    storage.clear();

    expect(storage.loadConnectionSource?.()).toBeUndefined();
    expect(storage.load()).toBeNull();
  });

  it("has no connection source that implies automatic provisioning", () => {
    for (const source of Object.values(AmazeeConnectionSource)) {
      for (const banned of ["auto", "automatic", "free trial"]) {
        expect(source.toLowerCase()).not.toContain(banned);
      }
    }
  });
});
