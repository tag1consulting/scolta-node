/** Test doubles ported from the PHP AiEndpointHandlerTest doubles. */

import type { CacheDriver } from "../../src/cache.js";
import {
  ApiKeyInvalidError,
  ApiKeyMissingError,
  RateLimitError,
} from "../../src/errors.js";
import type { AiServiceLike, Logger } from "../../src/ai/endpoint.js";
import type { ChatMessage } from "../../src/ai/client.js";
import type { PromptEnricher } from "../../src/ai/enricher.js";

export interface MockAiServiceOptions {
  response?: string;
  throwOnMessage?: boolean;
  throwOnConversation?: boolean;
  throwApiKeyMissing?: boolean;
  throwApiKeyInvalid?: boolean;
  throwRateLimit?: boolean;
  rateLimitRetryAfter?: string | null;
}

/** In-memory mock AI service implementing the duck-typed interface. */
export class MockAiService implements AiServiceLike {
  response: string;
  throwOnMessage: boolean;
  throwOnConversation: boolean;
  throwApiKeyMissing: boolean;
  throwApiKeyInvalid: boolean;
  throwRateLimit: boolean;
  rateLimitRetryAfter: string | null;
  callCount = 0;

  constructor(opts: MockAiServiceOptions = {}) {
    this.response = opts.response ?? "";
    this.throwOnMessage = opts.throwOnMessage ?? false;
    this.throwOnConversation = opts.throwOnConversation ?? false;
    this.throwApiKeyMissing = opts.throwApiKeyMissing ?? false;
    this.throwApiKeyInvalid = opts.throwApiKeyInvalid ?? false;
    this.throwRateLimit = opts.throwRateLimit ?? false;
    this.rateLimitRetryAfter = opts.rateLimitRetryAfter ?? null;
  }

  getExpandPrompt(): string {
    return "Expand the following search query.";
  }
  getSummarizePrompt(): string {
    return "Summarize the following search results.";
  }
  getFollowUpPrompt(): string {
    return "Continue the conversation.";
  }

  async message(_systemPrompt: string, _userMessage: string, _maxTokens?: number): Promise<string> {
    this.throwIfConfigured();
    this.callCount += 1;
    return this.response;
  }

  async messageForOperation(
    _operation: string,
    systemPrompt: string,
    userMessage: string,
    maxTokens?: number,
  ): Promise<string> {
    return this.message(systemPrompt, userMessage, maxTokens);
  }

  async conversation(
    _systemPrompt: string,
    _messages: ChatMessage[],
    _maxTokens?: number,
  ): Promise<string> {
    if (this.throwOnConversation) {
      throw new Error("AI service unavailable");
    }
    this.throwIfConfigured();
    this.callCount += 1;
    return this.response;
  }

  protected throwIfConfigured(): void {
    if (this.throwApiKeyMissing) {
      throw new ApiKeyMissingError("Scolta AI API key not configured.");
    }
    if (this.throwApiKeyInvalid) {
      throw new ApiKeyInvalidError("Scolta AI API key is invalid or expired.");
    }
    if (this.throwRateLimit) {
      throw new RateLimitError("Scolta AI API rate limit reached.", this.rateLimitRetryAfter);
    }
    if (this.throwOnMessage) {
      throw new Error("AI service unavailable");
    }
  }
}

/** Captures the system prompt passed to message()/conversation(). */
export class PromptCapturingAiService extends MockAiService {
  lastSystemPrompt: string | null = null;

  override async message(systemPrompt: string, userMessage: string, maxTokens?: number): Promise<string> {
    this.lastSystemPrompt = systemPrompt;
    return super.message(systemPrompt, userMessage, maxTokens);
  }

  override async conversation(
    systemPrompt: string,
    messages: ChatMessage[],
    maxTokens?: number,
  ): Promise<string> {
    this.lastSystemPrompt = systemPrompt;
    return super.conversation(systemPrompt, messages, maxTokens);
  }
}

/** Cache driver that tracks how many times get()/set() are called. */
export class TrackingCacheDriver implements CacheDriver {
  getCalls = 0;
  setCalls = 0;
  private store = new Map<string, unknown>();

  get(key: string): unknown {
    this.getCalls += 1;
    return this.store.has(key) ? this.store.get(key) : null;
  }

  set(key: string, value: unknown, _ttlSeconds: number): void {
    this.setCalls += 1;
    this.store.set(key, value);
  }
}

/** Spy enricher that records calls and prepends a prefix. */
export class SpyEnricher implements PromptEnricher {
  prefix: string;
  callCount = 0;
  lastPromptName: string | null = null;
  lastContext: Record<string, unknown> | undefined = undefined;
  lastResolvedPrompt: string | null = null;

  constructor(prefix = "") {
    this.prefix = prefix;
  }

  enrich(resolvedPrompt: string, promptName: string, context?: Record<string, unknown>): string {
    this.callCount += 1;
    this.lastResolvedPrompt = resolvedPrompt;
    this.lastPromptName = promptName;
    this.lastContext = context;
    return this.prefix + resolvedPrompt;
  }
}

/** Logger spy that records error() calls (duck-typed). */
export class SpyLogger implements Logger {
  errors: string[] = [];

  error(message: string, ..._args: unknown[]): void {
    this.errors.push(String(message));
  }
}
