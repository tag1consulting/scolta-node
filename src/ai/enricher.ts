/**
 * Prompt enrichment hook.
 *
 * Ports `Tag1\Scolta\Prompt\PromptEnricherInterface` and `NullEnricher`.
 * Allows site-specific context injection between prompt resolution and the LLM
 * call. The TS binding also accepts a plain async/sync function as an enricher
 * (the registerable hook the adapter exposes).
 */

export type PromptName = "expand_query" | "summarize" | "follow_up";

export interface PromptEnricher {
  /**
   * Enrich a resolved prompt before it is sent to the AI provider.
   * `promptName` is 'expand_query', 'summarize', or 'follow_up'.
   */
  enrich(resolvedPrompt: string, promptName: string, context?: Record<string, unknown>): string;
}

/** No-op enricher that passes the prompt through unchanged. */
export class NullEnricher implements PromptEnricher {
  enrich(resolvedPrompt: string, _promptName: string, _context?: Record<string, unknown>): string {
    return resolvedPrompt;
  }
}

export type EnricherFn = (
  resolvedPrompt: string,
  promptName: string,
  context?: Record<string, unknown>,
) => string;

/** Adapt a plain function into a {@link PromptEnricher}. */
export function functionEnricher(fn: EnricherFn): PromptEnricher {
  return { enrich: fn };
}
