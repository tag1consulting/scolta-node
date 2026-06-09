/**
 * Budget-aware AiClient decorator.
 *
 * Port of `scolta.ai.amazee.budget_decorator.BudgetAwareProviderDecorator`:
 * wraps an {@link AiClient} and rethrows budget-exhaustion errors (the LiteLLM
 * "Budget has been exceeded!" message) as {@link AmazeeBudgetExceededException}.
 */

import type { AiClient, ChatMessage } from "../client.js";
import { AmazeeBudgetExceededException } from "./exceptions.js";

export const BUDGET_MESSAGE = "Budget has been exceeded!";

export class BudgetAwareProviderDecorator {
  constructor(private readonly client: AiClient) {}

  async message(systemPrompt: string, userMessage: string, maxTokens = 1024, model?: string): Promise<string> {
    try {
      return await this.client.message(systemPrompt, userMessage, maxTokens, model);
    } catch (exc) {
      BudgetAwareProviderDecorator.rethrowIfBudgetExceeded(exc);
      throw exc;
    }
  }

  async conversation(
    systemPrompt: string,
    messages: ChatMessage[],
    maxTokens = 1024,
    model?: string,
  ): Promise<string> {
    try {
      return await this.client.conversation(systemPrompt, messages, maxTokens, model);
    } catch (exc) {
      BudgetAwareProviderDecorator.rethrowIfBudgetExceeded(exc);
      throw exc;
    }
  }

  getClient(): AiClient {
    return this.client;
  }

  private static rethrowIfBudgetExceeded(exc: unknown): void {
    let cause: unknown = exc;
    while (cause !== null && cause !== undefined) {
      if (cause instanceof Error && cause.message.includes(BUDGET_MESSAGE)) {
        throw new AmazeeBudgetExceededException(exc);
      }
      cause = cause instanceof Error ? cause.cause : null;
    }
  }
}
