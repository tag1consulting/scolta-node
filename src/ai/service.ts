/**
 * Base AI service adapter.
 *
 * Port of `Tag1\Scolta\Service\AiServiceAdapter`. Provides the shared dual-path
 * AI routing (try a platform-native AI integration first, fall back to the
 * built-in {@link AiClient}), prompt resolution, lazy client instantiation, and
 * the budget-exception hook.
 */

import type { ScoltaConfig } from "../config.js";
import { AiClient, type ChatMessage } from "./client.js";
import * as prompts from "./prompts.js";

export class AiServiceAdapter {
  protected readonly config: ScoltaConfig;
  private client: AiClient | null = null;

  constructor(config: ScoltaConfig) {
    this.config = config;
  }

  getConfig(): ScoltaConfig {
    return this.config;
  }

  // -- public AI calls ------------------------------------------------------

  async message(systemPrompt: string, userMessage: string, maxTokens = 512): Promise<string> {
    try {
      const result = await this.tryFrameworkAi(systemPrompt, userMessage, maxTokens);
      if (result !== null) {
        return result;
      }
      return await this.getClient().message(systemPrompt, userMessage, maxTokens);
    } catch (exc) {
      this.handlePossibleBudgetException(exc);
      throw exc;
    }
  }

  async conversation(systemPrompt: string, messages: ChatMessage[], maxTokens = 512): Promise<string> {
    try {
      const result = await this.tryFrameworkConversation(systemPrompt, messages, maxTokens);
      if (result !== null) {
        return result;
      }
      return await this.getClient().conversation(systemPrompt, messages, maxTokens);
    } catch (exc) {
      this.handlePossibleBudgetException(exc);
      throw exc;
    }
  }

  async messageForOperation(
    operation: string,
    systemPrompt: string,
    userMessage: string,
    maxTokens = 512,
  ): Promise<string> {
    try {
      const result = await this.tryFrameworkAi(systemPrompt, userMessage, maxTokens);
      if (result !== null) {
        return result;
      }
      const model =
        operation === "expand_query" && this.config.ai_expansion_model !== ""
          ? this.config.ai_expansion_model
          : undefined;
      return await this.getClient().message(systemPrompt, userMessage, maxTokens, model);
    } catch (exc) {
      this.handlePossibleBudgetException(exc);
      throw exc;
    }
  }

  // -- prompt resolution ----------------------------------------------------

  getExpandPrompt(): string {
    if (this.config.prompt_expand_query) {
      return this.config.prompt_expand_query;
    }
    return this.resolvePrompt(prompts.EXPAND_QUERY);
  }

  getSummarizePrompt(): string {
    if (this.config.prompt_summarize) {
      return this.config.prompt_summarize;
    }
    return this.resolvePrompt(prompts.SUMMARIZE);
  }

  getFollowUpPrompt(): string {
    if (this.config.prompt_follow_up) {
      return this.config.prompt_follow_up;
    }
    return this.resolvePrompt(prompts.FOLLOW_UP);
  }

  resolvePrompt(template: string): string {
    return prompts.resolve(template, this.config.site_name, this.config.site_description);
  }

  // -- overridable hooks ----------------------------------------------------

  protected getClient(): AiClient {
    if (this.client === null) {
      this.client = this.createClient();
    }
    return this.client;
  }

  protected createClient(): AiClient {
    return new AiClient(this.config.toAiClientConfig());
  }

  /** Override to route through a platform AI layer; null falls back. */
  protected async tryFrameworkAi(
    _systemPrompt: string,
    _userMessage: string,
    _maxTokens: number,
  ): Promise<string | null> {
    return null;
  }

  /** Override to route through a platform AI layer; null falls back. */
  protected async tryFrameworkConversation(
    _systemPrompt: string,
    _messages: ChatMessage[],
    _maxTokens: number,
  ): Promise<string | null> {
    return null;
  }

  /**
   * No-op by default. Platform adapters override to convert/notify on
   * budget-exhaustion errors before the original exception propagates.
   */
  protected handlePossibleBudgetException(_exc: unknown): void {
    // intentionally empty
  }
}
