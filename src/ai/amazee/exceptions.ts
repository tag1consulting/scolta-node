/**
 * Amazee exception types.
 *
 * Port of `scolta.ai.amazee.exceptions` (which itself mirrors the PHP
 * `AiProvider\Amazee` exceptions).
 */

/** The Amazee.ai API returned an error or an unexpected response. */
export class AmazeeApiException extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 0) {
    super(message);
    this.name = "AmazeeApiException";
    this.statusCode = statusCode;
  }

  getStatusCode(): number {
    return this.statusCode;
  }
}

/** The account's AI budget has been exhausted (HTTP 429, budget message). */
export class AmazeeBudgetExceededException extends Error {
  constructor(previous?: unknown) {
    super("Amazee.ai AI budget has been exceeded. Upgrade your plan to continue.");
    this.name = "AmazeeBudgetExceededException";
    if (previous !== undefined) {
      this.cause = previous;
    }
  }
}
