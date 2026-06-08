/**
 * Framework-agnostic AI endpoint orchestration.
 *
 * Port of `Tag1\Scolta\Http\AiEndpointHandler`. Validation, caching, prompt
 * assembly (language/sort/filter instructions), response parsing and error
 * handling for the expand-query / summarize / follow-up endpoints. The AI
 * service is duck-typed: any object with getExpandPrompt / getSummarizePrompt /
 * getFollowUpPrompt / message / messageForOperation / conversation works.
 */

import { createHash } from "node:crypto";
import type { CacheDriver } from "../cache.js";
import { ApiKeyInvalidError, ApiKeyMissingError, RateLimitError } from "../errors.js";
import type { ChatMessage } from "./client.js";
import { NullEnricher, type PromptEnricher } from "./enricher.js";
import { FILTER_INTENT_BLOCK, SORT_INTENT_BLOCK } from "./intent-blocks.generated.js";

const FENCE_OPEN = /^```(?:json)?\s*/i;
const FENCE_CLOSE = /\s*```$/;

export interface AiServiceLike {
  getExpandPrompt(): string;
  getSummarizePrompt(): string;
  getFollowUpPrompt(): string;
  message(systemPrompt: string, userMessage: string, maxTokens?: number): Promise<string>;
  conversation(systemPrompt: string, messages: ChatMessage[], maxTokens?: number): Promise<string>;
  messageForOperation(
    operation: string,
    systemPrompt: string,
    userMessage: string,
    maxTokens?: number,
  ): Promise<string>;
}

export interface Logger {
  error(message: string, ...args: unknown[]): void;
}

export interface EndpointResult {
  ok: boolean;
  status?: number;
  error?: string;
  data?: unknown;
  limit?: number;
  retry_after?: string;
}

export interface AiEndpointHandlerOptions {
  aiService: AiServiceLike;
  cache: CacheDriver;
  generation: number;
  cacheTtl: number;
  maxFollowUps: number;
  promptEnricher?: PromptEnricher;
  aiLanguages?: string[];
  logger?: Logger;
  aiExpandQuery?: boolean;
  aiSummarize?: boolean;
  aiSummaryMaxTokens?: number;
  expandPrimaryWeight?: number;
  sortableFields?: string[];
  sortableFieldDescriptions?: Record<string, string>;
  filterFields?: string[];
  filterFieldDescriptions?: Record<string, string>;
}

interface ExpansionResult {
  terms: unknown[];
  sortHint: { field: string; direction: string } | null;
  subjectTerms: string[] | null;
  filterHint: Record<string, string> | null;
}

/** PHP intdiv: integer division truncated toward zero. */
function intdiv(a: number, b: number): number {
  const q = Math.floor(Math.abs(a) / Math.abs(b));
  return a < 0 !== b < 0 ? -q : q;
}

export class AiEndpointHandler {
  private readonly aiService: AiServiceLike;
  private readonly cache: CacheDriver;
  private readonly generation: number;
  private readonly cacheTtl: number;
  private readonly maxFollowUps: number;
  private readonly promptEnricher: PromptEnricher;
  private readonly aiLanguages: string[];
  private readonly logger: Logger;
  private readonly aiExpandQuery: boolean;
  private readonly aiSummarize: boolean;
  private readonly aiSummaryMaxTokens: number;
  private readonly expandPrimaryWeight: number;
  private readonly sortableFields: string[];
  private readonly sortableFieldDescriptions: Record<string, string>;
  private readonly filterFields: string[];
  private readonly filterFieldDescriptions: Record<string, string>;

  constructor(opts: AiEndpointHandlerOptions) {
    this.aiService = opts.aiService;
    this.cache = opts.cache;
    this.generation = opts.generation;
    this.cacheTtl = opts.cacheTtl;
    this.maxFollowUps = opts.maxFollowUps;
    this.promptEnricher = opts.promptEnricher ?? new NullEnricher();
    this.aiLanguages = opts.aiLanguages ?? ["en"];
    this.logger = opts.logger ?? console;
    this.aiExpandQuery = opts.aiExpandQuery ?? true;
    this.aiSummarize = opts.aiSummarize ?? true;
    this.aiSummaryMaxTokens = opts.aiSummaryMaxTokens ?? 1024;
    this.expandPrimaryWeight = opts.expandPrimaryWeight ?? 0.5;
    this.sortableFields = opts.sortableFields ?? [];
    this.sortableFieldDescriptions = opts.sortableFieldDescriptions ?? {};
    this.filterFields = opts.filterFields ?? [];
    this.filterFieldDescriptions = opts.filterFieldDescriptions ?? {};
  }

  // -- expand query ---------------------------------------------------------

  async handleExpandQuery(query: string): Promise<EndpointResult> {
    if (!this.aiExpandQuery) {
      return { ok: false, status: 404, error: "Feature disabled" };
    }

    query = query.trim();
    if (query === "" || query.length > 500) {
      return { ok: false, status: 400, error: "Invalid query" };
    }

    const cacheKey = this.cacheKey("expand", query);
    if (this.cacheTtl > 0) {
      const cached = this.cache.get(cacheKey);
      if (cached !== null && cached !== undefined) {
        return { ok: true, data: cached };
      }
    }

    try {
      let systemPrompt = this.promptEnricher.enrich(this.aiService.getExpandPrompt(), "expand_query", {
        query,
      });
      systemPrompt = this.appendLanguageInstruction(systemPrompt, "expand_query");
      systemPrompt = this.appendSortableFieldsInstruction(systemPrompt);
      systemPrompt = this.appendFilterFieldsInstruction(systemPrompt);

      const response = await this.aiService.messageForOperation(
        "expand_query",
        systemPrompt,
        "Expand this search query: " + query,
        512,
      );

      const parsed = this.parseExpansionResult(response, query);
      const payload: Record<string, unknown> = {
        terms: parsed.terms,
        expand_primary_weight: this.expandPrimaryWeight,
      };
      if (parsed.sortHint !== null) payload["sort_hint"] = parsed.sortHint;
      if (parsed.subjectTerms !== null) payload["subject_terms"] = parsed.subjectTerms;
      if (parsed.filterHint !== null) payload["filter_hint"] = parsed.filterHint;

      if (this.cacheTtl > 0) {
        this.cache.set(cacheKey, payload, this.cacheTtl);
      }

      return { ok: true, data: payload };
    } catch (exc) {
      if (exc instanceof ApiKeyMissingError) {
        // AI is unconfigured — an expected state, degrade silently (no log).
        return {
          ok: true,
          data: { terms: [query], expand_primary_weight: this.expandPrimaryWeight },
        };
      }
      // Query expansion is a non-essential enhancement. Any provider failure
      // degrades to unexpanded search (HTTP 200). The underlying error is
      // logged so genuine provider/config outages stay diagnosable.
      this.logger.error("Scolta query expansion failed, serving unexpanded results: %s", exc);
      return {
        ok: true,
        data: { terms: [query], expand_primary_weight: this.expandPrimaryWeight },
      };
    }
  }

  // -- summarize ------------------------------------------------------------

  async handleSummarize(query: string, context: string): Promise<EndpointResult> {
    if (!this.aiSummarize) {
      return { ok: false, status: 404, error: "Feature disabled" };
    }

    query = query.trim();
    context = context.trim();

    if (query === "" || query.length > 500) {
      return { ok: false, status: 400, error: "Invalid query" };
    }
    // Client truncates to 49,000; this is a safety net.
    if (context === "" || context.length > 100000) {
      return { ok: false, status: 400, error: "Invalid context" };
    }

    const cacheKey = this.cacheKey("summarize", query, context);
    if (this.cacheTtl > 0) {
      const cached = this.cache.get(cacheKey);
      if (cached !== null && cached !== undefined) {
        return { ok: true, data: cached };
      }
    }

    const userMessage = `Search query: ${query}\n\nSearch result excerpts:\n${context}`;

    try {
      let systemPrompt = this.promptEnricher.enrich(this.aiService.getSummarizePrompt(), "summarize", {
        query,
        context,
      });
      systemPrompt = this.appendLanguageInstruction(systemPrompt, "summarize");

      const summary = await this.aiService.message(systemPrompt, userMessage, this.aiSummaryMaxTokens);
      const result = { summary };

      if (this.cacheTtl > 0) {
        this.cache.set(cacheKey, result, this.cacheTtl);
      }

      return { ok: true, data: result };
    } catch (exc) {
      if (exc instanceof ApiKeyMissingError) {
        return { ok: true, data: {} };
      }
      // Summarization is non-essential; degrade to "no summary" (HTTP 200).
      this.logger.error("Scolta summarization failed, serving results without a summary: %s", exc);
      return { ok: true, data: {} };
    }
  }

  // -- follow up ------------------------------------------------------------

  async handleFollowUp(messages: ChatMessage[]): Promise<EndpointResult> {
    if (!Array.isArray(messages) || messages.length === 0) {
      return { ok: false, status: 400, error: "Messages required" };
    }

    for (const msg of messages) {
      if (!msg || !msg.role || !msg.content) {
        return { ok: false, status: 400, error: "Invalid message format" };
      }
      if (msg.role !== "user" && msg.role !== "assistant") {
        return { ok: false, status: 400, error: "Invalid role" };
      }
    }

    if (messages[messages.length - 1]!.role !== "user") {
      return { ok: false, status: 400, error: "Last message must be from user" };
    }

    const followUpsSoFar = intdiv(messages.length - 2, 2);
    if (followUpsSoFar >= this.maxFollowUps) {
      return { ok: false, status: 429, error: "Follow-up limit reached", limit: this.maxFollowUps };
    }

    try {
      let systemPrompt = this.promptEnricher.enrich(this.aiService.getFollowUpPrompt(), "follow_up", {
        messages,
      });
      systemPrompt = this.appendLanguageInstruction(systemPrompt, "follow_up");

      const response = await this.aiService.conversation(systemPrompt, messages, 512);
      const remaining = this.maxFollowUps - followUpsSoFar - 1;

      return { ok: true, data: { response, remaining: Math.max(0, remaining) } };
    } catch (exc) {
      if (exc instanceof ApiKeyMissingError) {
        return { ok: true, data: { response: "", remaining: 0 } };
      }
      if (exc instanceof ApiKeyInvalidError) {
        this.logger.error("Scolta follow-up failed: invalid API key: %s", exc);
        return { ok: false, status: 401, error: "AI API key is invalid or expired" };
      }
      if (exc instanceof RateLimitError) {
        const result: EndpointResult = { ok: false, status: 429, error: "AI API rate limit reached" };
        if (exc.retryAfter !== null) {
          result.retry_after = exc.retryAfter;
        }
        return result;
      }
      this.logger.error("Scolta follow-up failed: %s", exc);
      return { ok: false, status: 503, error: "Follow-up unavailable" };
    }
  }

  // -- prompt assembly ------------------------------------------------------

  private appendLanguageInstruction(prompt: string, promptType: string): string {
    if (this.aiLanguages.length <= 1) {
      return prompt;
    }
    const languages = this.aiLanguages.join(", ");
    const primary = this.aiLanguages[0];
    if (promptType === "expand_query") {
      prompt +=
        `\n\nReturn expansion terms in the same language as the original query ` +
        `if it matches one of these supported languages: ${languages}. ` +
        `Otherwise return terms in ${primary}.`;
    } else {
      prompt +=
        `\n\nRespond in the same language as the user's query if it matches one ` +
        `of these supported languages: ${languages}. Otherwise respond in ${primary}.`;
    }
    return prompt;
  }

  private appendSortableFieldsInstruction(prompt: string): string {
    if (this.sortableFields.length === 0) {
      return prompt;
    }
    const fieldLines: string[] = [];
    for (const field of this.sortableFields) {
      const desc = this.sortableFieldDescriptions[field] ?? "";
      fieldLines.push(desc !== "" ? `- ${field}: ${desc}` : `- ${field}`);
    }
    const fieldList = fieldLines.join("\n");
    prompt += SORT_INTENT_BLOCK;
    return prompt.split("{FIELD_LIST}").join(fieldList);
  }

  private appendFilterFieldsInstruction(prompt: string): string {
    if (this.filterFields.length === 0) {
      return prompt;
    }
    const fieldLines: string[] = [];
    for (const field of this.filterFields) {
      const desc = this.filterFieldDescriptions[field] ?? "";
      fieldLines.push(desc !== "" ? `- ${field}: ${desc}` : `- ${field}`);
    }
    const fieldList = fieldLines.join("\n");
    prompt += FILTER_INTENT_BLOCK;
    return prompt.split("{FILTER_LIST}").join(fieldList);
  }

  // -- response parsing -----------------------------------------------------

  parseExpansionResponse(response: string, originalQuery: string): unknown[] {
    return this.parseExpansionResult(response, originalQuery).terms;
  }

  private parseExpansionResult(response: string, originalQuery: string): ExpansionResult {
    let cleaned = response.trim();
    cleaned = cleaned.replace(FENCE_OPEN, "");
    cleaned = cleaned.replace(FENCE_CLOSE, "");
    cleaned = cleaned.trim();

    let decoded: unknown;
    try {
      decoded = JSON.parse(cleaned);
    } catch {
      decoded = null;
    }

    if (decoded !== null && typeof decoded === "object" && !Array.isArray(decoded)) {
      const obj = decoded as Record<string, unknown>;
      if (Array.isArray(obj["terms"])) {
        const rawTerms = obj["terms"] as unknown[];
        const terms = rawTerms.length >= 2 ? rawTerms : [originalQuery];
        return {
          terms,
          sortHint: this.extractSortHint(obj["sort"]),
          subjectTerms: this.extractSubjectTerms(obj["subject_terms"]),
          filterHint: this.extractFilterHint(obj["filters"]),
        };
      }
    }

    if (Array.isArray(decoded) && decoded.length >= 2) {
      return { terms: decoded, sortHint: null, subjectTerms: null, filterHint: null };
    }

    return { terms: [originalQuery], sortHint: null, subjectTerms: null, filterHint: null };
  }

  private extractSubjectTerms(raw: unknown): string[] | null {
    if (!Array.isArray(raw)) {
      return null;
    }
    const filtered = raw.filter((v): v is string => typeof v === "string" && v !== "");
    return filtered.length > 0 ? filtered : null;
  }

  private extractSortHint(raw: unknown): { field: string; direction: string } | null {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    const obj = raw as Record<string, unknown>;
    const field = obj["field"];
    const direction = obj["direction"];
    if (typeof field !== "string" || field === "") return null;
    if (direction !== "asc" && direction !== "desc") return null;
    if (this.sortableFields.length === 0 || !this.sortableFields.includes(field)) return null;
    return { field, direction };
  }

  private extractFilterHint(raw: unknown): Record<string, string> | null {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    const obj = raw as Record<string, unknown>;
    const validated: Record<string, string> = {};
    for (const [dimension, value] of Object.entries(obj)) {
      if (dimension === "") continue;
      if (typeof value !== "string" || value === "") continue;
      if (this.filterFields.length === 0 || !this.filterFields.includes(dimension)) continue;
      validated[dimension] = value;
    }
    return Object.keys(validated).length > 0 ? validated : null;
  }

  // -- cache key ------------------------------------------------------------

  cacheKey(action: string, ...parts: string[]): string {
    const hashInput = parts.join("|").toLowerCase();
    const digest = createHash("sha256").update(hashInput, "utf-8").digest("hex");
    return `scolta_${action}_${this.generation}_${digest}`;
  }
}
