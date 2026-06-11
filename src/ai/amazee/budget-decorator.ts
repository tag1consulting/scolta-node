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

  /**
   * Whether an error (anywhere in its `cause` chain) is an Amazee
   * budget-exhaustion error — by message or by exception type.
   *
   * Port of the PHP `BudgetAwareProviderDecorator::isBudgetError()` helper:
   * the single classification API for budget errors, used by the decorator's
   * own rethrow path, {@link AmazeeAiService}, and {@link KeyExpiryRecovery}
   * (which must exclude budget errors from auth-failure recovery).
   */
  static isBudgetError(exc: unknown): boolean {
    let cause: unknown = exc;
    while (cause !== null && cause !== undefined) {
      if (cause instanceof AmazeeBudgetExceededException) {
        return true;
      }
      if (cause instanceof Error && cause.message.includes(BUDGET_MESSAGE)) {
        return true;
      }
      cause = cause instanceof Error ? cause.cause : null;
    }
    return false;
  }

  private static rethrowIfBudgetExceeded(exc: unknown): void {
    if (exc instanceof AmazeeBudgetExceededException) {
      return;
    }
    if (BudgetAwareProviderDecorator.isBudgetError(exc)) {
      throw new AmazeeBudgetExceededException(exc);
    }
  }
}
