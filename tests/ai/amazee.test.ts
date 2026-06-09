/**
 * Amazee subsystem tests (mocked HTTP).
 *
 * Covers the auto-provisioning contract (fires only when there is no explicit
 * key AND no stored credentials; idempotent), model resolution, the budget
 * decorator, and the AmazeeAiService client-resolution + budget conversion.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ScoltaConfig } from "../../src/config.js";
import { AiClient } from "../../src/ai/client.js";
import {
  AmazeeClient,
  AmazeeModelResolver,
  AutoProvisioner,
  BudgetAwareProviderDecorator,
  AmazeeBudgetExceededException,
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
});
