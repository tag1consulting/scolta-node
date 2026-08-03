/** Ported from tests/Service/AiServiceAdapterTest.php (1:1). */

import { describe, expect, it } from "vitest";
import * as prompts from "../../src/ai/prompts.js";
import { AiClient } from "../../src/ai/client.js";
import { AiServiceAdapter } from "../../src/ai/service.js";
import { ScoltaConfig } from "../../src/config.js";

// -- Custom overrides returned raw (no substitution) ------------------------

describe("AiServiceAdapter prompt resolution", () => {
  it("custom expand prompt returned raw", () => {
    const cfg = ScoltaConfig.fromObject({
      site_name: "Acme Corp",
      prompt_expand_query: "My custom expand prompt for {SITE_NAME}.",
    });
    const prompt = new AiServiceAdapter(cfg).getExpandPrompt();
    expect(prompt).toBe("My custom expand prompt for {SITE_NAME}.");
    expect(prompt).not.toContain("Acme Corp");
  });

  it("custom summarize prompt returned raw", () => {
    const cfg = ScoltaConfig.fromObject({
      site_name: "Acme Corp",
      prompt_summarize: "Custom summarize for {SITE_NAME}.",
    });
    expect(new AiServiceAdapter(cfg).getSummarizePrompt()).toBe("Custom summarize for {SITE_NAME}.");
  });

  it("custom follow-up prompt returned raw", () => {
    const cfg = ScoltaConfig.fromObject({
      site_name: "Acme Corp",
      prompt_follow_up: "Custom follow-up for {SITE_NAME}.",
    });
    expect(new AiServiceAdapter(cfg).getFollowUpPrompt()).toBe("Custom follow-up for {SITE_NAME}.");
  });

  it("default expand prompt contains site name", () => {
    const cfg = ScoltaConfig.fromObject({ site_name: "Acme Corp", site_description: "technology blog" });
    const prompt = new AiServiceAdapter(cfg).getExpandPrompt();
    expect(prompt).toContain("Acme Corp");
    expect(prompt).not.toContain("{SITE_NAME}");
    expect(prompt).not.toContain("{SITE_DESCRIPTION}");
  });

  it("default summarize prompt contains site name + description", () => {
    const cfg = ScoltaConfig.fromObject({ site_name: "Example Site", site_description: "news website" });
    const prompt = new AiServiceAdapter(cfg).getSummarizePrompt();
    expect(prompt).toContain("Example Site");
    expect(prompt).toContain("news website");
    expect(prompt).not.toContain("{SITE_NAME}");
  });

  it("default follow-up prompt contains site name", () => {
    const cfg = ScoltaConfig.fromObject({ site_name: "Widget World" });
    const prompt = new AiServiceAdapter(cfg).getFollowUpPrompt();
    expect(prompt).toContain("Widget World");
    expect(prompt).not.toContain("{SITE_NAME}");
  });

  it.each([
    ["prompt_expand_query", "getExpandPrompt"],
    ["prompt_summarize", "getSummarizePrompt"],
    ["prompt_follow_up", "getFollowUpPrompt"],
  ] as const)("empty override %s falls back to default", (key, getter) => {
    const cfg = ScoltaConfig.fromObject({ site_name: "Test Site", [key]: "" });
    const prompt = (new AiServiceAdapter(cfg) as any)[getter]() as string;
    expect(prompt).toContain("Test Site");
    expect(prompt).not.toContain("{SITE_NAME}");
  });

  it("resolvePrompt substitutes placeholders", () => {
    const cfg = ScoltaConfig.fromObject({ site_name: "My Blog", site_description: "a personal blog" });
    const resolved = new AiServiceAdapter(cfg).resolvePrompt(prompts.EXPAND_QUERY);
    expect(resolved).toContain("My Blog");
    expect(resolved).toContain("a personal blog");
    expect(resolved).not.toContain("{SITE_NAME}");
  });
});

describe("AiServiceAdapter framework path", () => {
  it("messageForOperation uses framework path when available", async () => {
    const cfg = ScoltaConfig.fromObject({ ai_expansion_model: "claude-haiku-4-5-20251001" });
    class Adapter extends AiServiceAdapter {
      protected override async tryFrameworkAi(): Promise<string | null> {
        return "framework-response";
      }
    }
    expect(await new Adapter(cfg).messageForOperation("expand_query", "sys", "user", 512)).toBe(
      "framework-response",
    );
  });

  it("ai_expansion_model defaults to empty", () => {
    expect(new ScoltaConfig().ai_expansion_model).toBe("");
  });

  it("ai_expansion_model not included in ai client config", () => {
    const cfg = ScoltaConfig.fromObject({
      ai_model: "claude-sonnet-4-5-20250929",
      ai_expansion_model: "claude-haiku-4-5-20251001",
    });
    const clientConfig = cfg.toAiClientConfig();
    expect(clientConfig["model"]).toBe("claude-sonnet-4-5-20250929");
    expect("expansion_model" in clientConfig).toBe(false);
    expect("ai_expansion_model" in clientConfig).toBe(false);
  });
});

// -- messageForOperation temperature pinning --------------------------------

/** Records the arguments of the last message() call. */
class RecordingClient extends AiClient {
  lastModel: string | undefined = undefined;
  lastTemperature: number | undefined = undefined;
  constructor() {
    super({ provider: "anthropic" });
  }
  override async message(
    _systemPrompt: string,
    _userMessage: string,
    _maxTokens?: number,
    model?: string,
    temperature?: number,
  ): Promise<string> {
    this.lastModel = model;
    this.lastTemperature = temperature;
    return "recorded";
  }
}

class RecordingAdapter extends AiServiceAdapter {
  readonly recorder = new RecordingClient();
  protected override getClient(): AiClient {
    return this.recorder;
  }
}

describe("AiServiceAdapter messageForOperation temperature", () => {
  it("pins temperature 0 for expand_query", async () => {
    const adapter = new RecordingAdapter(ScoltaConfig.fromObject({ ai_provider: "anthropic" }));
    await adapter.messageForOperation("expand_query", "sys", "user");
    expect(adapter.recorder.lastTemperature).toBe(0);
  });

  it("leaves temperature undefined for summarize", async () => {
    const adapter = new RecordingAdapter(ScoltaConfig.fromObject({ ai_provider: "anthropic" }));
    await adapter.messageForOperation("summarize", "sys", "user");
    expect(adapter.recorder.lastTemperature).toBeUndefined();
  });

  it("leaves temperature undefined for follow_up", async () => {
    const adapter = new RecordingAdapter(ScoltaConfig.fromObject({ ai_provider: "anthropic" }));
    await adapter.messageForOperation("follow_up", "sys", "user");
    expect(adapter.recorder.lastTemperature).toBeUndefined();
  });
});

// -- handlePossibleBudgetException hook -------------------------------------

class ThrowingClient extends AiClient {
  private toThrow: unknown;
  constructor(toThrow: unknown) {
    super({ provider: "anthropic" });
    this.toThrow = toThrow;
  }
  override async message(): Promise<string> {
    throw this.toThrow;
  }
  override async conversation(): Promise<string> {
    throw this.toThrow;
  }
}

class HookAdapter extends AiServiceAdapter {
  hookCalls = 0;
  hookArg: unknown = null;
  private stub: AiClient;
  constructor(config: ScoltaConfig, stub: AiClient) {
    super(config);
    this.stub = stub;
  }
  protected override getClient(): AiClient {
    return this.stub;
  }
  protected override handlePossibleBudgetException(exc: unknown): void {
    this.hookCalls += 1;
    this.hookArg = exc;
  }
}

describe("AiServiceAdapter budget hook", () => {
  it("message invokes budget hook on client exception", async () => {
    const original = new Error("Budget has been exceeded!");
    const adapter = new HookAdapter(ScoltaConfig.fromObject({ ai_provider: "anthropic" }), new ThrowingClient(original));
    await expect(adapter.message("sys", "user")).rejects.toBe(original);
    expect(adapter.hookCalls).toBe(1);
    expect(adapter.hookArg).toBe(original);
  });

  it("conversation invokes budget hook on client exception", async () => {
    const original = new Error("Budget has been exceeded!");
    const adapter = new HookAdapter(ScoltaConfig.fromObject({ ai_provider: "anthropic" }), new ThrowingClient(original));
    await expect(adapter.conversation("sys", [{ role: "user", content: "hi" }])).rejects.toBe(original);
    expect(adapter.hookCalls).toBe(1);
  });

  it("messageForOperation invokes budget hook on client exception", async () => {
    const original = new Error("Budget has been exceeded!");
    const adapter = new HookAdapter(ScoltaConfig.fromObject({ ai_provider: "anthropic" }), new ThrowingClient(original));
    await expect(adapter.messageForOperation("expand_query", "sys", "user")).rejects.toBe(original);
    expect(adapter.hookCalls).toBe(1);
  });

  it("default hook is no-op and exception propagates", async () => {
    const original = new Error("some unrelated client failure");
    class Adapter extends AiServiceAdapter {
      private stub: AiClient;
      constructor(config: ScoltaConfig, stub: AiClient) {
        super(config);
        this.stub = stub;
      }
      protected override getClient(): AiClient {
        return this.stub;
      }
    }
    const adapter = new Adapter(ScoltaConfig.fromObject({ ai_provider: "anthropic" }), new ThrowingClient(original));
    await expect(adapter.message("sys", "user")).rejects.toThrow(/some unrelated client failure/);
  });

  it("hook may replace the exception", async () => {
    const original = new Error("Budget has been exceeded!");
    class Adapter extends AiServiceAdapter {
      private stub: AiClient;
      constructor(config: ScoltaConfig, stub: AiClient) {
        super(config);
        this.stub = stub;
      }
      protected override getClient(): AiClient {
        return this.stub;
      }
      protected override handlePossibleBudgetException(exc: unknown): void {
        throw new TypeError("converted: " + String((exc as Error).message));
      }
    }
    const adapter = new Adapter(ScoltaConfig.fromObject({ ai_provider: "anthropic" }), new ThrowingClient(original));
    await expect(adapter.message("sys", "user")).rejects.toThrow(/converted: Budget has been exceeded!/);
  });
});
