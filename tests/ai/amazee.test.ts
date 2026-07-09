/**
 * Amazee subsystem tests (mocked HTTP).
 *
 * Covers the auto-provisioning contract (fires only when there is no explicit
 * key AND no stored credentials; idempotent), model resolution, the budget
 * decorator, and the AmazeeAiService client-resolution + budget conversion.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCacheDriver } from "../../src/cache.js";
import { ScoltaConfig } from "../../src/config.js";
import { AiClient } from "../../src/ai/client.js";
import { ApiKeyMissingError } from "../../src/errors.js";
import {
  AmazeeClient,
  AmazeeModelResolver,
  AutoProvisioner,
  BudgetAwareProviderDecorator,
  AmazeeBudgetExceededException,
  KeyExpiryRecovery,
  MemoryConfigStorage,
} from "../../src/ai/amazee/index.js";
import { AmazeeAiService } from "../../src/ai/amazee-service.js";

type Responder = (url: string, init: RequestInit | undefined) => { status?: number; json?: unknown };

/** A real AmazeeClient over a mocked fetch routed by URL. */
function amazeeClient(responder: Responder): AmazeeClient {
  const fetchImpl: typeof fetch = async (url, init) => {
    const r = responder(String(url), init);
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  };
  return new AmazeeClient("https://api.amazee.ai", fetchImpl);
}

const TRIAL = {
  key: { litellm_token: "lt-token", litellm_api_url: "https://llm.amazee.ai", region: "eu" },
};
const MODELS = {
  data: [
    { model_name: "claude-haiku-3-5" },
    { model_name: "claude-sonnet-4-5" },
    { model_name: "claude-sonnet-3-5" },
  ],
};

function provisioningResponder(): Responder {
  return (url) => {
    if (url.includes("/auth/generate-trial-access")) return { json: TRIAL };
    if (url.includes("/model/info")) return { json: MODELS };
    throw new Error(`unexpected amazee URL ${url}`);
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AutoProvisioner.ensureAiAvailable", () => {
  it("provisions a trial when there is no explicit key and no stored creds", async () => {
    const storage = new MemoryConfigStorage();
    const models: string[] = [];
    const provisioned = await AutoProvisioner.ensureAiAvailable(storage, {
      hasExplicitApiKey: false,
      client: amazeeClient(provisioningResponder()),
      onModelsResolved: (a, e) => {
        models.push(a, e);
        storage.storeModels(a, e);
      },
    });
    expect(provisioned).toBe(true);
    expect(storage.load()).toEqual({
      litellm_token: "lt-token",
      litellm_api_url: "https://llm.amazee.ai",
      region: "eu",
    });
    // Highest-version sonnet/haiku resolved and stored.
    expect(models).toEqual(["claude-sonnet-4-5", "claude-haiku-3-5"]);
    expect(storage.storedModels()).toEqual({
      ai_model: "claude-sonnet-4-5",
      ai_expansion_model: "claude-haiku-3-5",
    });
  });

  it("is a no-op when an explicit key is configured", async () => {
    const storage = new MemoryConfigStorage();
    const client = amazeeClient(() => {
      throw new Error("must not call Amazee with an explicit key");
    });
    const provisioned = await AutoProvisioner.ensureAiAvailable(storage, {
      hasExplicitApiKey: true,
      client,
    });
    expect(provisioned).toBe(false);
    expect(storage.load()).toBeNull();
  });

  it("is a no-op (idempotent) when credentials AND a model are already stored", async () => {
    const storage = new MemoryConfigStorage();
    storage.store("existing", "https://existing.example", "eu");
    storage.storeModels("claude-sonnet-4-5", "claude-haiku-3-5");
    let called = false;
    const client = amazeeClient(() => {
      called = true;
      return { json: TRIAL };
    });
    const provisioned = await AutoProvisioner.ensureAiAvailable(storage, { client });
    expect(provisioned).toBe(false);
    expect(called).toBe(false);
  });

  it("self-heals an incomplete provision by re-resolving models against the stored key", async () => {
    // Credentials stored, but no model resolved (a provision whose /model/info
    // call failed). This must NOT stay a permanent no-op: re-resolve against the
    // stored key, without provisioning a new trial.
    const storage = new MemoryConfigStorage();
    storage.store("stored-tok", "https://llm.amazee.ai", "eu");
    let trialCalls = 0;
    const client = amazeeClient((url) => {
      if (url.includes("/auth/generate-trial-access")) {
        trialCalls += 1;
        return { json: TRIAL };
      }
      if (url.includes("/model/info")) return { json: MODELS };
      throw new Error(`unexpected amazee URL ${url}`);
    });

    const provisioned = await AutoProvisioner.ensureAiAvailable(storage, {
      client,
      onModelsResolved: (a, e) => storage.storeModels(a, e),
    });

    expect(provisioned).toBe(false); // not a new trial — a model-only heal
    expect(trialCalls).toBe(0); // never provisioned a new trial
    expect(storage.storedModels()).toEqual({
      ai_model: "claude-sonnet-4-5",
      ai_expansion_model: "claude-haiku-3-5",
    });
  });

  it("returns false (degrades) when the Amazee API errors", async () => {
    const storage = new MemoryConfigStorage();
    const client = amazeeClient(() => ({ status: 500, json: { detail: "boom" } }));
    const provisioned = await AutoProvisioner.ensureAiAvailable(storage, { client });
    expect(provisioned).toBe(false);
    expect(storage.load()).toBeNull();
  });
});

describe("AmazeeModelResolver", () => {
  it("picks the highest-version model in each family", () => {
    const resolver = new AmazeeModelResolver({} as AmazeeClient);
    const names = ["claude-sonnet-3-5", "claude-sonnet-4-5", "claude-haiku-3-5", "gpt-4"];
    expect(resolver.pickHighestVersion(names, "sonnet")).toBe("claude-sonnet-4-5");
    expect(resolver.pickHighestVersion(names, "haiku")).toBe("claude-haiku-3-5");
    expect(resolver.pickHighestVersion(names, "opus")).toBeNull();
  });
});

describe("BudgetAwareProviderDecorator", () => {
  it("converts a budget-exhaustion error to AmazeeBudgetExceededException", async () => {
    const failing = {
      message: async () => {
        throw new Error("litellm: Budget has been exceeded!");
      },
    } as unknown as AiClient;
    const decorator = new BudgetAwareProviderDecorator(failing);
    await expect(decorator.message("s", "u")).rejects.toBeInstanceOf(AmazeeBudgetExceededException);
  });

  it("passes through a non-budget error unchanged", async () => {
    const failing = {
      message: async () => {
        throw new Error("network down");
      },
    } as unknown as AiClient;
    const decorator = new BudgetAwareProviderDecorator(failing);
    await expect(decorator.message("s", "u")).rejects.toThrow("network down");
  });
});

describe("AmazeeAiService", () => {
  function config(overrides: Record<string, unknown> = {}): ScoltaConfig {
    return ScoltaConfig.fromObject({ ai_provider: "amazee", site_name: "Test", ...overrides });
  }

  it("auto-provisions and drives the LiteLLM gateway when no key is set", async () => {
    const storage = new MemoryConfigStorage();
    const completions: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      completions.push(String(url));
      const body = JSON.parse(String(init.body));
      // OpenAI-compatible completion shape.
      return new Response(
        JSON.stringify({ choices: [{ message: { content: `model=${body.model}` } }] }),
        { status: 200 },
      );
    });

    const service = new AmazeeAiService(config(), storage, {
      amazeeClient: amazeeClient(provisioningResponder()),
    });

    const summary = await service.message("system", "user");
    expect(summary).toBe("model=claude-sonnet-4-5");
    // Provisioning persisted credentials exactly once.
    expect(storage.load()?.litellm_token).toBe("lt-token");
    // The completion went to the LiteLLM gateway, not Anthropic.
    expect(completions[0]).toContain("llm.amazee.ai");

    // expand_query uses the resolved haiku expansion model.
    const expanded = await service.messageForOperation("expand_query", "system", "user");
    expect(expanded).toBe("model=claude-haiku-3-5");
  });

  it("self-heals a model-less provision instead of sending the gateway the dated default", async () => {
    // Regression: a provision whose /model/info call fails stores credentials
    // with no resolved model. The service used to fall back to the dated config
    // default (claude-sonnet-4-5-20250929), which the Amazee gateway rejects
    // with HTTP 400, breaking AI permanently and silently. It must instead
    // degrade (HTTP 200 path) and self-heal once /model/info recovers.
    const storage = new MemoryConfigStorage();
    const gatewayModels: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      gatewayModels.push(body.model);
      if (body.model === "claude-sonnet-4-5-20250929") {
        // Exactly what the real gateway does with the dated name.
        return new Response(JSON.stringify({ error: { message: "Invalid model name" } }), { status: 400 });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: `model=${body.model}` } }] }),
        { status: 200 },
      );
    });

    let trialCalls = 0;
    let modelInfoEmpty = true;
    const amazee = amazeeClient((url) => {
      if (url.includes("/auth/generate-trial-access")) {
        trialCalls += 1;
        return { json: TRIAL };
      }
      if (url.includes("/model/info")) return { json: modelInfoEmpty ? { data: [] } : MODELS };
      throw new Error(`unexpected amazee URL ${url}`);
    });

    // Phase 1: provision stores creds, but /model/info returns nothing.
    const service1 = new AmazeeAiService(config(), storage, { amazeeClient: amazee });
    await expect(service1.message("system", "user")).rejects.toBeInstanceOf(ApiKeyMissingError);
    expect(storage.load()?.litellm_token).toBe("lt-token");
    expect(storage.storedModels().ai_model).toBeUndefined();
    // The dated default was NEVER sent to the gateway — it degraded first.
    expect(gatewayModels).toEqual([]);

    // Phase 2: /model/info recovers. A fresh service over the SAME storage (no
    // manual clear) self-heals — re-resolving against the stored key (no new
    // trial), then driving the gateway with the real model.
    modelInfoEmpty = false;
    const service2 = new AmazeeAiService(config(), storage, { amazeeClient: amazee });
    expect(await service2.message("system", "user")).toBe("model=claude-sonnet-4-5");
    expect(storage.storedModels().ai_model).toBe("claude-sonnet-4-5");
    expect(gatewayModels).toEqual(["claude-sonnet-4-5"]); // only the resolved model, never the dated default
    expect(trialCalls).toBe(1); // healed by re-resolving, not by burning a new trial
  });

  it("uses the explicit key as-is and never provisions", async () => {
    const storage = new MemoryConfigStorage();
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ content: [{ text: "hi" }] }), { status: 200 });
    });
    const amazee = amazeeClient(() => {
      throw new Error("must not provision when a key is set");
    });

    const service = new AmazeeAiService(
      config({ ai_provider: "anthropic", ai_api_key: "sk-ant-test" }),
      storage,
      { amazeeClient: amazee },
    );

    expect(await service.message("system", "user")).toBe("hi");
    expect(storage.load()).toBeNull();
    expect(urls.every((u) => u.includes("api.anthropic.com"))).toBe(true);
  });

  it("converts a budget-exhaustion error to AmazeeBudgetExceededException", async () => {
    const storage = new MemoryConfigStorage();
    vi.stubGlobal("fetch", async () => {
      throw new Error("Budget has been exceeded!");
    });
    const service = new AmazeeAiService(config(), storage, {
      amazeeClient: amazeeClient(provisioningResponder()),
    });
    await expect(service.message("system", "user")).rejects.toBeInstanceOf(AmazeeBudgetExceededException);
  });

  // -------------------------------------------------------------------------
  // Expired-credential handling — when the stored Amazee credentials are no
  // longer accepted, AI turns off cleanly and the site is flagged for admin
  // re-authentication. The stored credentials are left in place and no
  // replacement credentials are requested on this path.
  //
  // Regression (django demo, 2026-06-09): expired key → every call 400
  // expired_key → expand silently echoed the query while ensureAiAvailable
  // no-opped on the stored dead credentials.
  // -------------------------------------------------------------------------

  const EXPIRED_KEY_BODY = JSON.stringify({
    error: { message: "Authentication Error - Expired Key. Key Expired. code: expired_key" },
  });

  /**
   * Storage pre-seeded with stored-but-revoked trial credentials. A real
   * provisioned trial resolved its models at provision time, so the seed
   * includes them — the call then reaches the gateway with a valid model and
   * fails on the expired *key* (auth), which is what this path keys off.
   */
  function expiredStorage(): MemoryConfigStorage {
    const storage = new MemoryConfigStorage();
    storage.store("expired-tok", "https://llm.amazee.ai", "eu");
    storage.storeModels("claude-sonnet-4-5", "claude-haiku-3-5");
    return storage;
  }

  /** A control-plane client that fails the test if any request reaches it. */
  function unusedControlPlane(reason: string): AmazeeClient {
    return amazeeClient(() => {
      throw new Error(reason);
    });
  }

  it("degrades and flags for re-authentication on an expired key, leaving credentials in place", async () => {
    const storage = expiredStorage();
    vi.stubGlobal("fetch", async () => new Response(EXPIRED_KEY_BODY, { status: 400 }));
    const amazee = unusedControlPlane("must not request replacement credentials on an auth failure");

    const recovery = new KeyExpiryRecovery(storage, new InMemoryCacheDriver());
    const service = new AmazeeAiService(config(), storage, { amazeeClient: amazee });
    service.setKeyExpiryRecovery(recovery);

    // Nothing to retry: the original failure propagates and the endpoint layer
    // degrades it to unexpanded/no-summary (HTTP 200).
    await expect(service.message("system", "user")).rejects.toThrow(/expired_key/);

    expect(storage.load()?.litellm_token).toBe("expired-tok"); // credentials intact
    expect(recovery.isAuthFailing()).toBe(true); // health reports AI degraded
    expect(recovery.isUpgradeNeeded()).toBe(true); // site flagged for re-authentication
  });

  it("degrades on the conversation path too", async () => {
    const storage = expiredStorage();
    vi.stubGlobal("fetch", async () => new Response(EXPIRED_KEY_BODY, { status: 400 }));
    const amazee = unusedControlPlane("must not request replacement credentials on an auth failure");

    const recovery = new KeyExpiryRecovery(storage, new InMemoryCacheDriver());
    const service = new AmazeeAiService(config(), storage, { amazeeClient: amazee });
    service.setKeyExpiryRecovery(recovery);

    await expect(service.conversation("system", [{ role: "user", content: "hi" }])).rejects.toThrow(/expired_key/);
    expect(recovery.isUpgradeNeeded()).toBe(true);
  });

  it("routes a budget error to the budget path, not credential handling", async () => {
    // Budget exhaustion must route to the budget path: it is not an auth-class
    // failure and must not mark credentials as failing or flag for re-auth.
    const storage = expiredStorage();
    vi.stubGlobal("fetch", async () => {
      throw new Error("Budget has been exceeded!");
    });
    const amazee = unusedControlPlane("must not touch the control plane on a budget error");

    const recovery = new KeyExpiryRecovery(storage, new InMemoryCacheDriver());
    const service = new AmazeeAiService(config(), storage, { amazeeClient: amazee });
    service.setKeyExpiryRecovery(recovery);

    await expect(service.message("system", "user")).rejects.toBeInstanceOf(AmazeeBudgetExceededException);
    expect(storage.load()?.litellm_token).toBe("expired-tok"); // storage untouched
    expect(recovery.isAuthFailing()).toBe(false);
    expect(recovery.isUpgradeNeeded()).toBe(false);
  });

  it("an auth failure without recovery wired propagates unchanged", async () => {
    const storage = expiredStorage();
    vi.stubGlobal("fetch", async () => new Response(EXPIRED_KEY_BODY, { status: 400 }));
    const amazee = unusedControlPlane("must not touch the control plane without recovery wired");

    const service = new AmazeeAiService(config(), storage, { amazeeClient: amazee });

    await expect(service.message("system", "user")).rejects.toThrow(/expired_key/);
    expect(storage.load()?.litellm_token).toBe("expired-tok");
  });

  it("never records a failure over an explicit user key, even with recovery wired", async () => {
    // An explicit key failing auth is the user's key to fix — flagging the
    // Amazee re-authentication prompt would misattribute the misconfiguration.
    const storage = new MemoryConfigStorage();
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    const amazee = unusedControlPlane("must not touch the control plane over an explicit key");

    const recovery = new KeyExpiryRecovery(storage, new InMemoryCacheDriver());
    const service = new AmazeeAiService(
      config({ ai_provider: "anthropic", ai_api_key: "sk-ant-user" }),
      storage,
      { amazeeClient: amazee },
    );
    service.setKeyExpiryRecovery(recovery);

    await expect(service.message("system", "user")).rejects.toThrow(/invalid or expired/);
    expect(storage.load()).toBeNull();
    expect(recovery.isAuthFailing()).toBe(false);
    expect(recovery.isUpgradeNeeded()).toBe(false);
  });
});

describe("AmazeeClient control-plane headers", () => {
  it("sends Referer: scolta-node on control-plane POST and GET requests", async () => {
    const seen: Record<string, string | undefined> = {};
    const fetchImpl: typeof fetch = async (url, init) => {
      const method = init?.method ?? "GET";
      seen[method] = (init?.headers as Record<string, string>)?.["Referer"];
      const u = String(url);
      if (u.includes("/auth/generate-trial-access")) {
        return new Response(JSON.stringify({
          key: { litellm_token: "lt", litellm_api_url: "https://llm.amazee.ai", region: "eu" },
        }), { status: 200 });
      }
      if (u.includes("/regions")) return new Response(JSON.stringify({ regions: [] }), { status: 200 });
      return new Response("{}", { status: 404 });
    };
    const client = new AmazeeClient("https://api.amazee.ai", fetchImpl);
    await client.provisionTrial();
    await client.listRegions("sess-token");
    expect(seen["POST"]).toBe("scolta-node");
    expect(seen["GET"]).toBe("scolta-node");
  });
});
