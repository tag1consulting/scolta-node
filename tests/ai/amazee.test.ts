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

  it("is a no-op (idempotent) when credentials are already stored", async () => {
    const storage = new MemoryConfigStorage();
    storage.store("existing", "https://existing.example", "eu");
    let called = false;
    const client = amazeeClient(() => {
      called = true;
      return { json: TRIAL };
    });
    const provisioned = await AutoProvisioner.ensureAiAvailable(storage, { client });
    expect(provisioned).toBe(false);
    expect(called).toBe(false);
  });

  it("returns false (degrades) when the Amazee API errors", async () => {
    const storage = new MemoryConfigStorage();
    const client = amazeeClient(() => ({ status: 500, json: { detail: "boom" } }));
    const provisioned = await AutoProvisioner.ensureAiAvailable(storage, { client });
    expect(provisioned).toBe(false);
    expect(storage.load()).toBeNull();
  });
});

describe("AutoProvisioner.reprovision", () => {
  // The expired-key recovery entry point: unlike ensureAiAvailable(), stored
  // credentials must NOT short-circuit — they are known-bad when this runs.

  it("replaces stored (known-bad) credentials with a fresh trial", async () => {
    const storage = new MemoryConfigStorage();
    storage.store("expired-tok", "https://old.amazee.ai", "eu");

    const provisioned = await AutoProvisioner.reprovision(storage, {
      client: amazeeClient(provisioningResponder()),
    });

    expect(provisioned).toBe(true);
    expect(storage.load()).toEqual({
      litellm_token: "lt-token",
      litellm_api_url: "https://llm.amazee.ai",
      region: "eu",
    });
  });

  it("returns false on an API error, with the known-bad credentials cleared", async () => {
    const storage = new MemoryConfigStorage();
    storage.store("expired-tok", "https://old.amazee.ai", "eu");

    const provisioned = await AutoProvisioner.reprovision(storage, {
      client: amazeeClient(() => ({ status: 500, json: { detail: "boom" } })),
    });

    expect(provisioned).toBe(false);
    // Cleared is correct: the creds were known-bad, and an empty store lets
    // ensureAiAvailable() retry on the next lazy-init pass.
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
  // Key-expiry recovery — an expired Amazee trial key triggers a guarded
  // re-provision and exactly one retry with the fresh credentials.
  //
  // Regression (django demo, 2026-06-09): expired key → every call 400
  // expired_key → expand silently echoed the query while ensureAiAvailable
  // no-opped on the stored dead credentials.
  // -------------------------------------------------------------------------

  const EXPIRED_KEY_BODY = JSON.stringify({
    error: { message: "Authentication Error - Expired Key. Key Expired. code: expired_key" },
  });

  /** Storage pre-seeded with stored-but-revoked trial credentials. */
  function expiredStorage(): MemoryConfigStorage {
    const storage = new MemoryConfigStorage();
    storage.store("expired-tok", "https://llm.amazee.ai", "eu");
    return storage;
  }

  /** A counting provisioning responder, so "exactly once" is assertable. */
  function countingProvisioner(): { client: AmazeeClient; calls: () => number } {
    let calls = 0;
    const responder = provisioningResponder();
    return {
      client: amazeeClient((url, init) => {
        calls += 1;
        return responder(url, init);
      }),
      calls: () => calls,
    };
  }

  it("re-provisions once and retries with the fresh credentials on an expired key", async () => {
    const storage = expiredStorage();
    const bearers: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const bearer = (init.headers as Record<string, string>)["Authorization"] ?? "";
      bearers.push(bearer);
      if (bearer === "Bearer expired-tok") {
        return new Response(EXPIRED_KEY_BODY, { status: 400 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "recovered" } }] }), { status: 200 });
    });

    const provisioner = countingProvisioner();
    const service = new AmazeeAiService(config(), storage, { amazeeClient: provisioner.client });
    service.setKeyExpiryRecovery(
      new KeyExpiryRecovery(storage, new InMemoryCacheDriver(), { client: provisioner.client }),
    );

    expect(await service.message("system", "user")).toBe("recovered");
    // Retry was made with a client rebuilt from the fresh credentials.
    expect(bearers).toEqual(["Bearer expired-tok", "Bearer lt-token"]);
    // Fresh credentials stored for subsequent requests; provisioned exactly
    // once (trial + model info).
    expect(storage.load()?.litellm_token).toBe("lt-token");
    expect(provisioner.calls()).toBe(2);

    // Subsequent calls use the recovered client directly — no more failures.
    expect(await service.message("system", "again")).toBe("recovered");
    expect(provisioner.calls()).toBe(2);
  });

  it("recovers on the conversation path too", async () => {
    const storage = expiredStorage();
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const bearer = (init.headers as Record<string, string>)["Authorization"] ?? "";
      if (bearer === "Bearer expired-tok") {
        return new Response(EXPIRED_KEY_BODY, { status: 400 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "recovered" } }] }), { status: 200 });
    });

    const provisioner = countingProvisioner();
    const service = new AmazeeAiService(config(), storage, { amazeeClient: provisioner.client });
    service.setKeyExpiryRecovery(
      new KeyExpiryRecovery(storage, new InMemoryCacheDriver(), { client: provisioner.client }),
    );

    expect(await service.conversation("system", [{ role: "user", content: "hi" }])).toBe("recovered");
  });

  it("a budget error never triggers re-provisioning", async () => {
    // Budget exhaustion must route to the budget path, not re-provisioning: a
    // fresh trial key would reset the spend ceiling, which is the upgrade
    // flow's job. The throwing Amazee client makes any provisioning call fail
    // the test.
    const storage = expiredStorage();
    vi.stubGlobal("fetch", async () => {
      throw new Error("Budget has been exceeded!");
    });
    const amazee = amazeeClient(() => {
      throw new Error("must not re-provision on a budget error");
    });

    const service = new AmazeeAiService(config(), storage, { amazeeClient: amazee });
    service.setKeyExpiryRecovery(new KeyExpiryRecovery(storage, new InMemoryCacheDriver(), { client: amazee }));

    await expect(service.message("system", "user")).rejects.toBeInstanceOf(AmazeeBudgetExceededException);
    expect(storage.load()?.litellm_token).toBe("expired-tok"); // storage untouched
  });

  it("an auth failure without recovery wired propagates unchanged", async () => {
    const storage = expiredStorage();
    vi.stubGlobal("fetch", async () => new Response(EXPIRED_KEY_BODY, { status: 400 }));
    const amazee = amazeeClient(() => {
      throw new Error("must not provision without recovery wired");
    });

    const service = new AmazeeAiService(config(), storage, { amazeeClient: amazee });

    await expect(service.message("system", "user")).rejects.toThrow(/expired_key/);
    expect(storage.load()?.litellm_token).toBe("expired-tok");
  });

  it("never re-provisions over an explicit user key, even with recovery wired", async () => {
    // An explicit key failing auth is the user's key to fix — replacing it
    // with an Amazee trial behind their back would mask the misconfiguration.
    const storage = new MemoryConfigStorage();
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    const amazee = amazeeClient(() => {
      throw new Error("must not provision over an explicit key");
    });

    const service = new AmazeeAiService(
      config({ ai_provider: "anthropic", ai_api_key: "sk-ant-user" }),
      storage,
      { amazeeClient: amazee },
    );
    service.setKeyExpiryRecovery(new KeyExpiryRecovery(storage, new InMemoryCacheDriver(), { client: amazee }));

    await expect(service.message("system", "user")).rejects.toThrow(/invalid or expired/);
    expect(storage.load()).toBeNull();
  });
});
