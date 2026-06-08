/**
 * Centralised AiEndpointHandler construction for platform controllers.
 *
 * Port of `Tag1\Scolta\Http\AiControllerTrait`. The PHP/Python version is an
 * abstract mixin; in TS a factory function is more idiomatic — the adapter
 * supplies the platform cache driver, cache generation, and prompt enricher,
 * then calls this instead of constructing the handler inline.
 */

import type { CacheDriver } from "../cache.js";
import type { ScoltaConfig } from "../config.js";
import { AiEndpointHandler, type AiServiceLike, type Logger } from "./endpoint.js";
import type { PromptEnricher } from "./enricher.js";

export interface ControllerDeps {
  cache: CacheDriver;
  generation: number;
  promptEnricher?: PromptEnricher;
  logger?: Logger;
}

export function createAiEndpointHandler(
  aiService: AiServiceLike,
  config: ScoltaConfig,
  deps: ControllerDeps,
): AiEndpointHandler {
  return new AiEndpointHandler({
    aiService,
    cache: deps.cache,
    generation: deps.generation,
    cacheTtl: config.cache_ttl,
    maxFollowUps: config.max_follow_ups,
    promptEnricher: deps.promptEnricher,
    logger: deps.logger,
    aiLanguages: config.ai_languages,
    aiExpandQuery: config.ai_expand_query,
    aiSummarize: config.ai_summarize,
    aiSummaryMaxTokens: config.ai_summary_max_tokens,
    expandPrimaryWeight: config.expand_primary_weight,
    sortableFields: config.sortable_fields,
    sortableFieldDescriptions: config.sortable_field_descriptions,
    filterFields: config.filter_fields,
    filterFieldDescriptions: config.filter_field_descriptions,
  });
}
