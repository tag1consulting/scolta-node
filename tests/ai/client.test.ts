/**
 * AiClient transport tests (mocked fetch).
 *
 * Mirrors the behaviour of the PHP AiClient (Guzzle): Anthropic vs
 * OpenAI-compatible request shaping, model selection, base_url path completion,
 * and HTTP error -> typed-error mapping.
 */

import { describe, expect, it } from "vitest";
import { AiClient, type AiClientConfig } from "../../src/ai/client.js";
import { ApiKeyInvalidError, ApiKeyMissingError, RateLimitError } from "../../src/errors.js";

interface Captured {
  url?: string;
  headers?: Record<string, string>;
  body?: any;
}

type ResponderResult = { status?: number; json?: unknown; body?: string; headers?: Record<string, string> };
type Responder = (captured: Captured) => ResponderResult;

function client(config: AiClientConfig, responder: Responder): { client: AiClient; captured: Captured } {
  const captured: Captured = {};
  const fetchImpl: typeof fetch = async (url, init) => {
    captured.url = String(url);
    captured.headers = (init?.headers as Record<string, string>) ?? {};
    captured.body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const r = responder(captured);
    const payload = r.body !== undefined ? r.body : JSON.stringify(r.json ?? {});
    return new Response(payload, { status: r.status ?? 200, headers: r.headers });
  };
  return { client: new AiClient(config, fetchImpl), captured };
}

describe("AiClient", () => {
  it("anthropic request shape", async () => {
    const { client: c, captured } = client(
      { provider: "anthropic", api_key: "sk-ant", model: "claude-x" },
      () => ({ json: { content: [{ text: "hello" }] } }),
    );
    const result = await c.message("system", "user msg", 256);
    expect(result).toBe("hello");
    expect(captured.url).toBe("https://api.anthropic.com/v1/messages");
    expect(captured.headers!["x-api-key"]).toBe("sk-ant");
    expect(captured.headers!["anthropic-version"]).toBe("2023-06-01");
    expect(captured.body.model).toBe("claude-x");
    expect(captured.body.system).toBe("system");
    expect(captured.body.max_tokens).toBe(256);
    expect(captured.body.messages).toEqual([{ role: "user", content: "user msg" }]);
  });

  it("openai request shape prepends system message", async () => {
    const { client: c, captured } = client(
      { provider: "openai", api_key: "sk-oai", model: "gpt-x" },
      () => ({ json: { choices: [{ message: { content: "hi" } }] } }),
    );
    const result = await c.message("sys", "u");
    expect(result).toBe("hi");
    expect(captured.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(captured.headers!["Authorization"]).toBe("Bearer sk-oai");
    expect(captured.body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(captured.body.messages[1]).toEqual({ role: "user", content: "u" });
  });

  it("openai base_url origin-only gets path appended", async () => {
    const { client: c, captured } = client(
      { provider: "openai", api_key: "k", base_url: "http://localhost:11434" },
      () => ({ json: { choices: [{ message: { content: "x" } }] } }),
    );
    await c.message("sys", "u");
    expect(captured.url).toBe("http://localhost:11434/v1/chat/completions");
  });

  it("openai base_url with path left untouched", async () => {
    const { client: c, captured } = client(
      { provider: "openai", api_key: "k", base_url: "http://gw/v1/chat/completions" },
      () => ({ json: { choices: [{ message: { content: "x" } }] } }),
    );
    await c.message("sys", "u");
    expect(captured.url).toBe("http://gw/v1/chat/completions");
  });

  it("model override per call", async () => {
    const { client: c, captured } = client(
      { api_key: "k", model: "default-model" },
      () => ({ json: { content: [{ text: "ok" }] } }),
    );
    await c.message("s", "u", 1024, "override-model");
    expect(captured.body.model).toBe("override-model");
  });

  it("missing api key raises before request", async () => {
    let called = false;
    const { client: c } = client({ api_key: "" }, () => {
      called = true;
      return {};
    });
    await expect(c.message("s", "u")).rejects.toBeInstanceOf(ApiKeyMissingError);
    expect(called).toBe(false);
  });

  it("401 maps to api key invalid", async () => {
    const { client: c } = client({ api_key: "k" }, () => ({ status: 401, json: { error: "bad" } }));
    await expect(c.message("s", "u")).rejects.toBeInstanceOf(ApiKeyInvalidError);
  });

  it("429 maps to rate limit with retry-after", async () => {
    const { client: c } = client({ api_key: "k" }, () => ({
      status: 429,
      headers: { "Retry-After": "42" },
      json: {},
    }));
    await expect(c.message("s", "u")).rejects.toMatchObject({ retryAfter: "42" });
  });

  it("429 without retry-after", async () => {
    const { client: c } = client({ api_key: "k" }, () => ({ status: 429, json: {} }));
    try {
      await c.message("s", "u");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect((e as RateLimitError).retryAfter).toBeNull();
    }
  });

  it("500 maps to a generic error", async () => {
    const { client: c } = client({ api_key: "k" }, () => ({ status: 500, json: {} }));
    await expect(c.message("s", "u")).rejects.toThrow();
  });

  it("malformed JSON raises error", async () => {
    const { client: c } = client({ api_key: "k" }, () => ({ body: "not json" }));
    await expect(c.message("s", "u")).rejects.toThrow(/malformed JSON/);
  });

  it("empty content returns empty string", async () => {
    const { client: c } = client({ api_key: "k" }, () => ({ json: {} }));
    expect(await c.message("s", "u")).toBe("");
  });

  it("conversation sends all messages (anthropic)", async () => {
    const { client: c, captured } = client({ api_key: "k" }, () => ({
      json: { content: [{ text: "r" }] },
    }));
    const msgs = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ];
    await c.conversation("sys", msgs);
    expect(captured.body.messages).toEqual(msgs);
  });
});
