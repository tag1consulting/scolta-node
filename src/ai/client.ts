/**
 * Provider-agnostic AI client for LLM API calls.
 *
 * Port of `Tag1\Scolta\AiClient` on the global `fetch` (Guzzle → fetch is
 * ~1:1). Supports Anthropic's native API and any OpenAI-compatible
 * chat-completions endpoint (Ollama, LiteLLM and self-hosted gateways via the
 * OpenAI-compatible `base_url` path).
 */

import { AiTimeoutError, ApiKeyInvalidError, ApiKeyMissingError, RateLimitError } from "../errors.js";

export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_API_VERSION = "2023-06-01";
export const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

export interface AiClientConfig {
  provider?: string;
  api_key?: string;
  model?: string;
  api_version?: string;
  timeout?: number;
  base_url?: string;
}

export interface ChatMessage {
  role: string;
  content: string;
}

/** Injectable fetch, matching the global `fetch` signature. */
export type FetchLike = typeof fetch;

/**
 * Extract the response text from an Anthropic messages payload
 * (`{content: [{text}]}`), or "" when the shape doesn't match — preserving
 * the prior lenient behaviour without trusting the external shape.
 */
function extractAnthropicText(data: unknown): string {
  if (typeof data !== "object" || data === null) return "";
  const content = (data as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return "";
  const first: unknown = content[0];
  if (typeof first !== "object" || first === null) return "";
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

/**
 * Extract the response text from an OpenAI chat-completions payload
 * (`{choices: [{message: {content}}]}`), or "" when the shape doesn't match.
 */
function extractOpenaiText(data: unknown): string {
  if (typeof data !== "object" || data === null) return "";
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first: unknown = choices[0];
  if (typeof first !== "object" || first === null) return "";
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return "";
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}

export class AiClient {
  readonly provider: string;
  readonly apiKey: string;
  readonly model: string;
  readonly apiVersion: string;
  readonly timeout: number;
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(config: AiClientConfig, fetchImpl?: FetchLike) {
    this.provider = config.provider ?? "anthropic";
    this.apiKey = config.api_key ?? "";
    this.model = config.model ?? "claude-sonnet-4-5-20250929";
    this.apiVersion = config.api_version ?? ANTHROPIC_API_VERSION;
    this.timeout = Math.trunc(Number(config.timeout ?? 30));

    if (this.provider === "openai") {
      let baseUrl = config.base_url ?? OPENAI_API_URL;
      // If only a domain/origin is provided (no path), append the standard
      // OpenAI chat completions path — supports LiteLLM and other proxies that
      // return a base URL without a trailing API path.
      const path = AiClient.urlPath(baseUrl);
      if (path === "" || path === "/") {
        baseUrl = baseUrl.replace(/\/+$/, "") + "/v1/chat/completions";
      }
      this.baseUrl = baseUrl;
    } else {
      this.baseUrl = config.base_url ?? ANTHROPIC_API_URL;
    }

    this.fetchImpl = fetchImpl ?? fetch;
  }

  private static urlPath(url: string): string {
    try {
      return new URL(url).pathname || "/";
    } catch {
      return "/";
    }
  }

  /** Send a single-turn message and return the response text. */
  async message(
    systemPrompt: string,
    userMessage: string,
    maxTokens = 1024,
    model?: string,
    temperature?: number,
  ): Promise<string> {
    return this.sendRequest(
      systemPrompt,
      [{ role: "user", content: userMessage }],
      maxTokens,
      model,
      temperature,
    );
  }

  /** Send a multi-turn conversation and return the response text. */
  async conversation(
    systemPrompt: string,
    messages: ChatMessage[],
    maxTokens = 1024,
    model?: string,
    temperature?: number,
  ): Promise<string> {
    return this.sendRequest(systemPrompt, messages, maxTokens, model, temperature);
  }

  private async sendRequest(
    systemPrompt: string,
    messages: ChatMessage[],
    maxTokens: number,
    model?: string,
    temperature?: number,
  ): Promise<string> {
    if (!this.apiKey) {
      throw new ApiKeyMissingError(
        "Scolta AI API key not configured. Set the api_key in your platform's Scolta configuration.",
      );
    }

    const useModel = model || this.model;

    if (this.provider === "openai") {
      return this.sendOpenai(systemPrompt, messages, maxTokens, useModel, temperature);
    }
    return this.sendAnthropic(systemPrompt, messages, maxTokens, useModel, temperature);
  }

  private async sendAnthropic(
    systemPrompt: string,
    messages: ChatMessage[],
    maxTokens: number,
    model: string,
    temperature?: number,
  ): Promise<string> {
    const response = await this.post(this.baseUrl, {
      "x-api-key": this.apiKey,
      "anthropic-version": this.apiVersion,
      "Content-Type": "application/json",
    }, {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
      // Omit temperature entirely when undefined so the provider default
      // applies; `0` is a valid value, so guard on `!== undefined`.
      ...(temperature !== undefined ? { temperature } : {}),
    });
    const data = await this.parseJson(response);
    return extractAnthropicText(data);
  }

  private async sendOpenai(
    systemPrompt: string,
    messages: ChatMessage[],
    maxTokens: number,
    model: string,
    temperature?: number,
  ): Promise<string> {
    const allMessages = [{ role: "system", content: systemPrompt }, ...messages];
    const response = await this.post(this.baseUrl, {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    }, {
      model,
      max_tokens: maxTokens,
      messages: allMessages,
      // Omit temperature entirely when undefined so the provider default
      // applies; `0` is a valid value, so guard on `!== undefined`.
      ...(temperature !== undefined ? { temperature } : {}),
    });
    const data = await this.parseJson(response);
    return extractOpenaiText(data);
  }

  private async post(
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout * 1000),
      });
    } catch (exc) {
      // AbortSignal.timeout() rejects with a "TimeoutError" DOMException; an
      // externally aborted signal rejects with "AbortError". Surface both as
      // a typed timeout so callers can tell a slow provider from a broken one.
      if (exc instanceof Error && (exc.name === "TimeoutError" || exc.name === "AbortError")) {
        throw new AiTimeoutError(
          `Scolta AI API request timed out after ${this.timeout}s: ${String(exc)}`,
        );
      }
      throw new Error(`Scolta AI API request failed: ${String(exc)}`, { cause: exc });
    }

    if (!response.ok) {
      const status = response.status;
      if (status === 401) {
        throw new ApiKeyInvalidError(
          "Scolta AI API key is invalid or expired. Verify the key in your Scolta configuration.",
        );
      }
      if (status === 429) {
        const retryAfter = response.headers.get("Retry-After") || null;
        throw new RateLimitError("Scolta AI API rate limit reached.", retryAfter);
      }
      // Include a truncated body snippet, mirroring the PHP client (Guzzle
      // exception messages carry a response summary). The body is the only
      // place the LiteLLM proxy announces auth-class failures on non-401
      // statuses (e.g. HTTP 400 `expired_key` for a revoked Amazee trial
      // key), which KeyExpiryRecovery classifies by message marker.
      let detail = "";
      try {
        detail = (await response.text()).trim().slice(0, 500);
      } catch {
        // Body unreadable — fall back to the status-only message.
      }
      throw new Error(`Scolta AI API request failed: HTTP ${status}${detail !== "" ? ` ${detail}` : ""}`);
    }
    return response;
  }

  private async parseJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch (exc) {
      throw new Error(`Scolta AI API returned malformed JSON: ${String(exc)}`, { cause: exc });
    }
  }
}
