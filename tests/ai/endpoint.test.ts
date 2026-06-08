/** Ported from tests/Http/AiEndpointHandlerTest.php (1:1). */

import { describe, expect, it } from "vitest";
import { AiEndpointHandler, type AiEndpointHandlerOptions } from "../../src/ai/endpoint.js";
import { NullEnricher, type PromptEnricher } from "../../src/ai/enricher.js";
import { InMemoryCacheDriver } from "../../src/cache.js";
import {
  MockAiService,
  PromptCapturingAiService,
  SpyEnricher,
  SpyLogger,
  TrackingCacheDriver,
} from "./doubles.js";

function makeHandler(overrides: Partial<AiEndpointHandlerOptions> = {}): AiEndpointHandler {
  return new AiEndpointHandler({
    aiService: new MockAiService({ response: '["term1", "term2"]' }),
    cache: new InMemoryCacheDriver(),
    generation: 1,
    cacheTtl: 0,
    maxFollowUps: 3,
    promptEnricher: new NullEnricher(),
    logger: new SpyLogger(),
    aiLanguages: ["en"],
    aiExpandQuery: true,
    aiSummarize: true,
    sortableFields: [],
    sortableFieldDescriptions: {},
    filterFields: [],
    filterFieldDescriptions: {},
    ...overrides,
  });
}

// -- Validation -------------------------------------------------------------

describe("validation", () => {
  it("expand query rejects empty string", async () => {
    const r = await makeHandler().handleExpandQuery("");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it("expand query rejects over max length", async () => {
    const r = await makeHandler().handleExpandQuery("a".repeat(501));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it("expand query accepts max length", async () => {
    const h = makeHandler({ aiService: new MockAiService({ response: '["t1","t2","t3"]' }) });
    expect((await h.handleExpandQuery("a".repeat(500))).ok).toBe(true);
  });

  it("summarize rejects empty query", async () => {
    const r = await makeHandler().handleSummarize("", "some context");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it("summarize rejects over max context", async () => {
    const r = await makeHandler().handleSummarize("query", "x".repeat(100001));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it("follow up rejects empty messages", async () => {
    const r = await makeHandler().handleFollowUp([]);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it("follow up rejects when limit reached", async () => {
    const h = makeHandler({ maxFollowUps: 2 });
    const messages = [
      { role: "user", content: "initial question" },
      { role: "assistant", content: "first reply" },
      { role: "user", content: "follow-up 1" },
      { role: "assistant", content: "reply 1" },
      { role: "user", content: "follow-up 2" },
      { role: "assistant", content: "reply 2" },
      { role: "user", content: "follow-up 3 — too many" },
    ];
    const r = await h.handleFollowUp(messages);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(429);
  });

  it("follow up counts correctly", async () => {
    const h = makeHandler({ aiService: new MockAiService({ response: "follow up response" }), maxFollowUps: 2 });
    const r = await h.handleFollowUp([
      { role: "user", content: "initial question" },
      { role: "assistant", content: "first reply" },
      { role: "user", content: "follow-up 1" },
    ]);
    expect(r.ok).toBe(true);
    expect((r.data as any).remaining).toBe(1);
  });

  it("max follow ups zero blocks immediately", async () => {
    const h = makeHandler({ maxFollowUps: 0 });
    const r = await h.handleFollowUp([
      { role: "user", content: "initial question" },
      { role: "assistant", content: "first reply" },
      { role: "user", content: "follow-up attempt" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(429);
  });
});

// -- Caching ----------------------------------------------------------------

describe("caching", () => {
  it("expand query returns cached result", async () => {
    const cache = new InMemoryCacheDriver();
    const ai = new MockAiService({ response: "should not be called" });
    const h = makeHandler({ aiService: ai, cache, cacheTtl: 3600 });
    cache.set(h.cacheKey("expand", "test query"), { terms: ["cached term"], expand_primary_weight: 0.5 }, 3600);
    const r = await h.handleExpandQuery("test query");
    expect(r.ok).toBe(true);
    expect((r.data as any).terms).toEqual(["cached term"]);
    expect(ai.callCount).toBe(0);
  });

  it("expand query stores result in cache", async () => {
    const cache = new InMemoryCacheDriver();
    const ai = new MockAiService({ response: '["e1","e2","e3"]' });
    const h = makeHandler({ aiService: ai, cache, cacheTtl: 3600 });
    await h.handleExpandQuery("store test");
    expect(cache.get(h.cacheKey("expand", "store test"))).not.toBeNull();
  });

  it("summarize uses cache with generation", async () => {
    const cache = new InMemoryCacheDriver();
    const ai = new MockAiService({ response: "should not be called" });
    const h = makeHandler({ aiService: ai, cache, cacheTtl: 3600, generation: 5 });
    cache.set(h.cacheKey("summarize", "query", "context"), { summary: "cached summary" }, 3600);
    const r = await h.handleSummarize("query", "context");
    expect(r.ok).toBe(true);
    expect((r.data as any).summary).toBe("cached summary");
    expect(ai.callCount).toBe(0);
  });

  it("cache key includes generation", () => {
    const k1 = makeHandler({ generation: 1 }).cacheKey("expand", "test");
    const k2 = makeHandler({ generation: 2 }).cacheKey("expand", "test");
    expect(k1).not.toBe(k2);
    expect(k1).toContain("_1_");
    expect(k2).toContain("_2_");
  });

  it("cache ttl zero never reads cache", async () => {
    const cache = new TrackingCacheDriver();
    const h = makeHandler({ aiService: new MockAiService({ response: '["t1","t2"]' }), cache, cacheTtl: 0 });
    await h.handleExpandQuery("test query");
    expect(cache.getCalls).toBe(0);
  });

  it("cache ttl zero never writes cache", async () => {
    const cache = new TrackingCacheDriver();
    const h = makeHandler({ aiService: new MockAiService({ response: '["t1","t2"]' }), cache, cacheTtl: 0 });
    await h.handleExpandQuery("test query");
    expect(cache.setCalls).toBe(0);
  });
});

// -- Response parsing -------------------------------------------------------

describe("response parsing", () => {
  it("strips code fences", () => {
    expect(makeHandler().parseExpansionResponse('```json\n["t1","t2","t3"]\n```', "original")).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
  });

  it("handles raw json", () => {
    expect(makeHandler().parseExpansionResponse('["alpha","beta","gamma"]', "original")).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("handles object format", () => {
    expect(makeHandler().parseExpansionResponse('{"terms":["alpha","beta","gamma"]}', "original")).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("falls back on invalid json", () => {
    expect(makeHandler().parseExpansionResponse("this is not json at all", "original query")).toEqual([
      "original query",
    ]);
  });

  it("falls back on single term", () => {
    expect(makeHandler().parseExpansionResponse('["only_one"]', "original")).toEqual(["original"]);
  });
});

// -- Sort hint --------------------------------------------------------------

describe("sort hint", () => {
  it("parsed from object format", async () => {
    const ai = new MockAiService({
      response: '{"terms":["gem","gemstone","rock"],"sort":{"field":"price","direction":"desc"}}',
    });
    const r = await makeHandler({ aiService: ai, sortableFields: ["price", "date"] }).handleExpandQuery(
      "most expensive stone",
    );
    expect((r.data as any).sort_hint).toEqual({ field: "price", direction: "desc" });
  });

  it("absent when llm omits it", async () => {
    const ai = new MockAiService({ response: '{"terms":["gem","gemstone","mineral"]}' });
    const r = await makeHandler({ aiService: ai, sortableFields: ["price"] }).handleExpandQuery("blue stones");
    expect("sort_hint" in (r.data as object)).toBe(false);
  });

  it("absent when no sortable fields configured", async () => {
    const ai = new MockAiService({
      response: '{"terms":["gem","rock","mineral"],"sort":{"field":"price","direction":"desc"}}',
    });
    const r = await makeHandler({ aiService: ai, sortableFields: [] }).handleExpandQuery("most expensive stone");
    expect("sort_hint" in (r.data as object)).toBe(false);
  });

  it("ignored when field not in sortable list", async () => {
    const ai = new MockAiService({
      response: '{"terms":["gem","rock"],"sort":{"field":"unknown_field","direction":"desc"}}',
    });
    const r = await makeHandler({ aiService: ai, sortableFields: ["price", "date"] }).handleExpandQuery("x");
    expect("sort_hint" in (r.data as object)).toBe(false);
  });

  it("ignored when direction invalid", async () => {
    const ai = new MockAiService({
      response: '{"terms":["gem","rock"],"sort":{"field":"price","direction":"invalid"}}',
    });
    const r = await makeHandler({ aiService: ai, sortableFields: ["price"] }).handleExpandQuery("x");
    expect("sort_hint" in (r.data as object)).toBe(false);
  });

  it("ignored when sort is not an object", async () => {
    const ai = new MockAiService({ response: '{"terms":["gem","rock"],"sort":"price:desc"}' });
    const r = await makeHandler({ aiService: ai, sortableFields: ["price"] }).handleExpandQuery("x");
    expect("sort_hint" in (r.data as object)).toBe(false);
  });

  it("asc direction allowed", async () => {
    const ai = new MockAiService({
      response: '{"terms":["affordable","budget"],"sort":{"field":"price","direction":"asc"}}',
    });
    const r = await makeHandler({ aiService: ai, sortableFields: ["price"] }).handleExpandQuery("cheapest stone");
    expect((r.data as any).sort_hint).toEqual({ field: "price", direction: "asc" });
  });

  it("survives cache round trip", async () => {
    const cache = new InMemoryCacheDriver();
    const ai = new MockAiService({
      response: '{"terms":["gem","rock"],"sort":{"field":"price","direction":"desc"}}',
    });
    const h = makeHandler({ aiService: ai, cache, cacheTtl: 3600, sortableFields: ["price"] });
    const r1 = await h.handleExpandQuery("most expensive stone");
    const h2 = makeHandler({
      aiService: new MockAiService({ response: "should not be called" }),
      cache,
      cacheTtl: 3600,
      sortableFields: ["price"],
    });
    const r2 = await h2.handleExpandQuery("most expensive stone");
    expect(r1.data).toEqual(r2.data);
    expect((r2.data as any).sort_hint).toEqual({ field: "price", direction: "desc" });
  });
});

// -- Sort prompt content ----------------------------------------------------

describe("sort prompt content", () => {
  it("prompt contains ascending price patterns", async () => {
    const ai = new PromptCapturingAiService({ response: '{"terms":["gem"]}' });
    await makeHandler({ aiService: ai, sortableFields: ["price"] }).handleExpandQuery("cheapest crystals");
    for (const needle of ["cheapest", "lowest price", "most affordable", "least expensive", "budget"]) {
      expect(ai.lastSystemPrompt).toContain(needle);
    }
  });

  it("prompt specifies asc direction for cheapest patterns", async () => {
    const ai = new PromptCapturingAiService({ response: '{"terms":["gem"]}' });
    await makeHandler({ aiService: ai, sortableFields: ["price"] }).handleExpandQuery("cheapest crystals");
    expect(ai.lastSystemPrompt).toContain("Price/cost (asc)");
    expect(ai.lastSystemPrompt).toContain("direction asc");
  });

  it("sortable fields appended to prompt when configured", async () => {
    const ai = new PromptCapturingAiService({ response: '{"terms":["gem","rock","mineral"]}' });
    await makeHandler({ aiService: ai, sortableFields: ["price", "date", "rating"] }).handleExpandQuery("q");
    expect(ai.lastSystemPrompt).toContain("- price");
    expect(ai.lastSystemPrompt).toContain("- date");
    expect(ai.lastSystemPrompt).toContain("- rating");
    expect(ai.lastSystemPrompt).toContain("SORT INTENT");
  });

  it("sortable fields not appended when empty", async () => {
    const ai = new PromptCapturingAiService({ response: '{"terms":["gem","rock","mineral"]}' });
    await makeHandler({ aiService: ai, sortableFields: [] }).handleExpandQuery("q");
    expect(ai.lastSystemPrompt).not.toContain("SORT INTENT");
  });

  it("sortable fields with descriptions appear in prompt", async () => {
    const ai = new PromptCapturingAiService({ response: '{"terms":["gem","rock"]}' });
    await makeHandler({
      aiService: ai,
      sortableFields: ["price", "word_count"],
      sortableFieldDescriptions: {
        price: "Product price in store currency",
        word_count: "Article length in words",
      },
    }).handleExpandQuery("test");
    expect(ai.lastSystemPrompt).toContain("- price: Product price in store currency");
    expect(ai.lastSystemPrompt).toContain("- word_count: Article length in words");
  });
});

// -- Subject terms ----------------------------------------------------------

describe("subject terms", () => {
  it("parsed when present with sort", async () => {
    const ai = new MockAiService({
      response:
        '{"terms":["gem","gemstone"],"sort":{"field":"price","direction":"desc"},"subject_terms":["tooth"]}',
    });
    const r = await makeHandler({ aiService: ai, sortableFields: ["price"] }).handleExpandQuery(
      "most expensive tooth",
    );
    expect((r.data as any).subject_terms).toEqual(["tooth"]);
    expect("sort_hint" in (r.data as object)).toBe(true);
  });

  it("absent when only sort intent (empty array)", async () => {
    const ai = new MockAiService({
      response:
        '{"terms":["high price","costly"],"sort":{"field":"price","direction":"desc"},"subject_terms":[]}',
    });
    const r = await makeHandler({ aiService: ai, sortableFields: ["price"] }).handleExpandQuery("most expensive");
    expect("subject_terms" in (r.data as object)).toBe(false);
  });

  it("malformed not-array ignored", async () => {
    const ai = new MockAiService({
      response:
        '{"terms":["gem","rock"],"sort":{"field":"price","direction":"desc"},"subject_terms":"tooth"}',
    });
    const r = await makeHandler({ aiService: ai, sortableFields: ["price"] }).handleExpandQuery("x");
    expect("subject_terms" in (r.data as object)).toBe(false);
  });

  it("filters non-string entries", async () => {
    const ai = new MockAiService({
      response:
        '{"terms":["gem","rock"],"sort":{"field":"price","direction":"desc"},"subject_terms":["tooth",null,42,"fossil"]}',
    });
    const r = await makeHandler({ aiService: ai, sortableFields: ["price"] }).handleExpandQuery("x");
    expect((r.data as any).subject_terms).toEqual(["tooth", "fossil"]);
  });
});

// -- Filter hint ------------------------------------------------------------

describe("filter hint", () => {
  it("parsed from object format", async () => {
    const ai = new MockAiService({ response: '{"terms":["water","hydrology"],"filters":{"topic":"Science"}}' });
    const r = await makeHandler({ aiService: ai, filterFields: ["topic", "era"] }).handleExpandQuery("x");
    expect((r.data as any).filter_hint).toEqual({ topic: "Science" });
  });

  it("multiple dimensions", async () => {
    const ai = new MockAiService({
      response: '{"terms":["roman","engineering"],"filters":{"topic":"History","era":"Ancient"}}',
    });
    const r = await makeHandler({ aiService: ai, filterFields: ["topic", "era"] }).handleExpandQuery("x");
    expect((r.data as any).filter_hint).toEqual({ topic: "History", era: "Ancient" });
  });

  it("absent when no filter fields configured", async () => {
    const ai = new MockAiService({ response: '{"terms":["water","aqua"],"filters":{"topic":"Science"}}' });
    const r = await makeHandler({ aiService: ai, filterFields: [] }).handleExpandQuery("x");
    expect("filter_hint" in (r.data as object)).toBe(false);
  });

  it("invalid dimension rejected", async () => {
    const ai = new MockAiService({ response: '{"terms":["water","aqua"],"filters":{"unknown_dim":"Science"}}' });
    const r = await makeHandler({ aiService: ai, filterFields: ["topic", "era"] }).handleExpandQuery("x");
    expect("filter_hint" in (r.data as object)).toBe(false);
  });

  it("malformed ignored", async () => {
    const ai = new MockAiService({ response: '{"terms":["water","aqua"],"filters":"invalid"}' });
    const r = await makeHandler({ aiService: ai, filterFields: ["topic"] }).handleExpandQuery("x");
    expect("filter_hint" in (r.data as object)).toBe(false);
  });

  it("filter and sort coexist", async () => {
    const ai = new MockAiService({
      response:
        '{"terms":["science","articles"],"sort":{"field":"date","direction":"desc"},"filters":{"topic":"Science"}}',
    });
    const r = await makeHandler({
      aiService: ai,
      sortableFields: ["date"],
      filterFields: ["topic"],
    }).handleExpandQuery("newest Science articles");
    expect((r.data as any).sort_hint).toEqual({ field: "date", direction: "desc" });
    expect((r.data as any).filter_hint).toEqual({ topic: "Science" });
  });

  it("filter fields instruction appears when configured", async () => {
    const ai = new PromptCapturingAiService({ response: '{"terms":["gem","rock"]}' });
    await makeHandler({
      aiService: ai,
      filterFields: ["topic", "era"],
      filterFieldDescriptions: { topic: "Subject area (Science, History, etc.)", era: "Historical period" },
    }).handleExpandQuery("test");
    expect(ai.lastSystemPrompt).toContain("FILTER INTENT");
    expect(ai.lastSystemPrompt).toContain("- topic: Subject area (Science, History, etc.)");
    expect(ai.lastSystemPrompt).toContain("- era: Historical period");
  });
});

// -- Error paths ------------------------------------------------------------

describe("error paths", () => {
  function loggingHandler(aiService: MockAiService): { h: AiEndpointHandler; logger: SpyLogger } {
    const logger = new SpyLogger();
    const h = new AiEndpointHandler({
      aiService,
      cache: new InMemoryCacheDriver(),
      generation: 1,
      cacheTtl: 0,
      maxFollowUps: 3,
      logger,
    });
    return { h, logger };
  }

  it("expand query degrades to unexpanded on ai exception", async () => {
    const { h, logger } = loggingHandler(new MockAiService({ response: "", throwOnMessage: true }));
    const r = await h.handleExpandQuery("test query");
    expect(r.ok).toBe(true);
    expect(r.status).toBeUndefined();
    expect((r.data as any).terms).toEqual(["test query"]);
    expect(logger.errors.length).toBeGreaterThan(0);
  });

  it("summarize degrades to no summary on ai exception", async () => {
    const { h, logger } = loggingHandler(new MockAiService({ response: "", throwOnMessage: true }));
    const r = await h.handleSummarize("test", "some context");
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({});
    expect(logger.errors.length).toBeGreaterThan(0);
  });

  it("follow up returns 503 on ai exception", async () => {
    const h = makeHandler({ aiService: new MockAiService({ response: "", throwOnConversation: true }) });
    const r = await h.handleFollowUp([{ role: "user", content: "hello" }]);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
  });

  it("expand degrades on invalid api key", async () => {
    const { h, logger } = loggingHandler(new MockAiService({ response: "", throwApiKeyInvalid: true }));
    const r = await h.handleExpandQuery("test query");
    expect(r.ok).toBe(true);
    expect((r.data as any).terms).toEqual(["test query"]);
    expect(logger.errors.length).toBeGreaterThan(0);
  });

  it("follow up returns 401 on invalid api key", async () => {
    const h = makeHandler({ aiService: new MockAiService({ response: "", throwApiKeyInvalid: true }) });
    const r = await h.handleFollowUp([{ role: "user", content: "hello" }]);
    expect(r.status).toBe(401);
  });

  it("expand degrades on rate limit", async () => {
    const { h, logger } = loggingHandler(new MockAiService({ response: "", throwRateLimit: true }));
    const r = await h.handleExpandQuery("test query");
    expect(r.ok).toBe(true);
    expect((r.data as any).terms).toEqual(["test query"]);
    expect(logger.errors.length).toBeGreaterThan(0);
  });

  it("follow up returns 429 on rate limit", async () => {
    const h = makeHandler({ aiService: new MockAiService({ response: "", throwRateLimit: true }) });
    expect((await h.handleFollowUp([{ role: "user", content: "hello" }])).status).toBe(429);
  });

  it("follow up rate limit includes retry_after when present", async () => {
    const h = makeHandler({
      aiService: new MockAiService({ response: "", throwRateLimit: true, rateLimitRetryAfter: "60" }),
    });
    const r = await h.handleFollowUp([{ role: "user", content: "hello" }]);
    expect(r.status).toBe(429);
    expect(r.retry_after).toBe("60");
  });

  it("follow up rate limit omits retry_after when absent", async () => {
    const h = makeHandler({
      aiService: new MockAiService({ response: "", throwRateLimit: true, rateLimitRetryAfter: null }),
    });
    const r = await h.handleFollowUp([{ role: "user", content: "hello" }]);
    expect(r.status).toBe(429);
    expect("retry_after" in r).toBe(false);
  });
});

// -- No API key: graceful degradation ---------------------------------------

describe("no api key degradation", () => {
  it("summarize returns 200 empty data", async () => {
    const r = await makeHandler({ aiService: new MockAiService({ throwApiKeyMissing: true }) }).handleSummarize(
      "test query",
      "some context",
    );
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({});
    expect(r.status).toBeUndefined();
  });

  it("expand returns 200 with original query", async () => {
    const r = await makeHandler({ aiService: new MockAiService({ throwApiKeyMissing: true }) }).handleExpandQuery(
      "my search query",
    );
    expect(r.ok).toBe(true);
    expect((r.data as any).terms).toEqual(["my search query"]);
    expect(r.status).toBeUndefined();
  });

  it("follow up returns 200 empty response", async () => {
    const r = await makeHandler({ aiService: new MockAiService({ throwApiKeyMissing: true }) }).handleFollowUp([
      { role: "user", content: "hello" },
    ]);
    expect(r.ok).toBe(true);
    expect((r.data as any).response).toBe("");
    expect((r.data as any).remaining).toBe(0);
  });

  it("missing key does not log", async () => {
    const logger = new SpyLogger();
    const h = new AiEndpointHandler({
      aiService: new MockAiService({ throwApiKeyMissing: true }),
      cache: new InMemoryCacheDriver(),
      generation: 1,
      cacheTtl: 0,
      maxFollowUps: 3,
      logger,
    });
    await h.handleExpandQuery("test query");
    await h.handleSummarize("test", "context");
    expect(logger.errors.length).toBe(0);
  });

  it("expand handles empty ai response", async () => {
    const h = makeHandler({ aiService: new MockAiService({ response: "" }) });
    const r = await h.handleExpandQuery("test query");
    expect(r.ok).toBe(true);
    expect((r.data as any).terms).toEqual(["test query"]);
  });

  it("expand response includes expand_primary_weight", async () => {
    const h = new AiEndpointHandler({
      aiService: new MockAiService({ response: '["t1","t2"]' }),
      cache: new InMemoryCacheDriver(),
      generation: 1,
      cacheTtl: 0,
      maxFollowUps: 3,
      expandPrimaryWeight: 0.8,
    });
    const r = await h.handleExpandQuery("test query");
    expect(Array.isArray((r.data as any).terms)).toBe(true);
    expect((r.data as any).expand_primary_weight).toBe(0.8);
  });
});

// -- Prompt enrichment ------------------------------------------------------

describe("prompt enrichment", () => {
  it("null enricher passes through unchanged", () => {
    const original = "You are a helpful search assistant.";
    expect(new NullEnricher().enrich(original, "summarize", { query: "test" })).toBe(original);
  });

  it("expand calls enricher before ai service", async () => {
    const enricher = new SpyEnricher("ENRICHED: ");
    const ai = new PromptCapturingAiService({ response: '["t1","t2","t3"]' });
    const r = await makeHandler({ aiService: ai, promptEnricher: enricher }).handleExpandQuery("test query");
    expect(r.ok).toBe(true);
    expect(enricher.callCount).toBe(1);
    expect(enricher.lastPromptName).toBe("expand_query");
    expect(enricher.lastContext).toEqual({ query: "test query" });
    expect(ai.lastSystemPrompt!.startsWith("ENRICHED: ")).toBe(true);
  });

  it("summarize calls enricher before ai service", async () => {
    const enricher = new SpyEnricher("ENRICHED: ");
    const ai = new PromptCapturingAiService({ response: "A helpful summary." });
    await makeHandler({ aiService: ai, promptEnricher: enricher }).handleSummarize("test query", "some context");
    expect(enricher.lastPromptName).toBe("summarize");
    expect(enricher.lastContext).toEqual({ query: "test query", context: "some context" });
    expect(ai.lastSystemPrompt!.startsWith("ENRICHED: ")).toBe(true);
  });

  it("follow up calls enricher before ai service", async () => {
    const enricher = new SpyEnricher("ENRICHED: ");
    const ai = new PromptCapturingAiService({ response: "follow up response" });
    const messages = [{ role: "user", content: "hello" }];
    await makeHandler({ aiService: ai, promptEnricher: enricher }).handleFollowUp(messages);
    expect(enricher.lastPromptName).toBe("follow_up");
    expect(enricher.lastContext).toEqual({ messages });
    expect(ai.lastSystemPrompt!.startsWith("ENRICHED: ")).toBe(true);
  });

  it("custom enricher modifies prompt", async () => {
    const enricher: PromptEnricher = {
      enrich: (p) => p + "\n\nAlways mention our return policy.",
    };
    const ai = new PromptCapturingAiService({ response: '["t1","t2"]' });
    await makeHandler({ aiService: ai, promptEnricher: enricher }).handleExpandQuery("pricing");
    expect(ai.lastSystemPrompt).toContain("Always mention our return policy.");
  });

  it("default enricher is null enricher", async () => {
    const ai = new PromptCapturingAiService({ response: '["t1","t2"]' });
    const h = new AiEndpointHandler({
      aiService: ai,
      cache: new InMemoryCacheDriver(),
      generation: 1,
      cacheTtl: 0,
      maxFollowUps: 3,
    });
    await h.handleExpandQuery("test");
    expect(ai.lastSystemPrompt).toBe("Expand the following search query.");
  });
});

// -- Language instruction ---------------------------------------------------

describe("language instruction", () => {
  it("single language does not add instruction", async () => {
    const ai = new PromptCapturingAiService({ response: "A helpful summary." });
    await makeHandler({ aiService: ai, aiLanguages: ["en"] }).handleSummarize("test query", "some context");
    expect(ai.lastSystemPrompt).not.toContain("supported languages");
  });

  it("multiple languages add instruction to summarize", async () => {
    const ai = new PromptCapturingAiService({ response: "A helpful summary." });
    await makeHandler({ aiService: ai, aiLanguages: ["en", "es", "fr"] }).handleSummarize("q", "ctx");
    expect(ai.lastSystemPrompt).toContain("en, es, fr");
    expect(ai.lastSystemPrompt).toContain("Respond in the same language");
    expect(ai.lastSystemPrompt).toContain("Otherwise respond in en");
  });

  it("multiple languages add instruction to expand query", async () => {
    const ai = new PromptCapturingAiService({ response: '["t1","t2","t3"]' });
    await makeHandler({ aiService: ai, aiLanguages: ["en", "de"] }).handleExpandQuery("test query");
    expect(ai.lastSystemPrompt).toContain("en, de");
    expect(ai.lastSystemPrompt).toContain("Return expansion terms");
  });

  it("multiple languages add instruction to follow up", async () => {
    const ai = new PromptCapturingAiService({ response: "follow up response" });
    await makeHandler({ aiService: ai, aiLanguages: ["en", "ja"] }).handleFollowUp([
      { role: "user", content: "hello" },
    ]);
    expect(ai.lastSystemPrompt).toContain("en, ja");
    expect(ai.lastSystemPrompt).toContain("Respond in the same language");
  });
});

// -- Feature toggles --------------------------------------------------------

describe("feature toggles", () => {
  it("expand query disabled returns 404", async () => {
    const r = await makeHandler({ aiExpandQuery: false }).handleExpandQuery("test query");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.error).toBe("Feature disabled");
  });

  it("expand query disabled does not call ai service", async () => {
    const ai = new MockAiService({ response: '["t1","t2"]' });
    await makeHandler({ aiService: ai, aiExpandQuery: false }).handleExpandQuery("test query");
    expect(ai.callCount).toBe(0);
  });

  it("summarize disabled returns 404", async () => {
    const r = await makeHandler({ aiSummarize: false }).handleSummarize("test query", "some context");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
  });

  it("follow up unaffected by expand query toggle", async () => {
    const ai = new MockAiService({ response: "follow up response" });
    const r = await makeHandler({ aiService: ai, aiExpandQuery: false, aiSummarize: false }).handleFollowUp([
      { role: "user", content: "hello" },
    ]);
    expect(r.ok).toBe(true);
    expect(ai.callCount).toBe(1);
  });
});
