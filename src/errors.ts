/**
 * Exception types, ported 1:1 from `Tag1\Scolta\Exception`.
 */

/**
 * Raised when an AI operation is attempted without an API key configured.
 *
 * Callers that catch this should degrade gracefully — returning an empty/null
 * response rather than a server error — because the missing key is an expected
 * configuration state rather than a transient failure.
 */
export class ApiKeyMissingError extends Error {
  constructor(message = "") {
    super(message);
    this.name = "ApiKeyMissingError";
  }
}

/**
 * Raised when the AI provider rejects the configured API key (HTTP 401).
 *
 * Callers should return a 401 response with an admin-visible message so site
 * administrators can distinguish a bad key from a transient failure.
 */
export class ApiKeyInvalidError extends Error {
  constructor(message = "") {
    super(message);
    this.name = "ApiKeyInvalidError";
  }
}

/**
 * Raised when an AI API request exceeds the configured timeout (or its
 * AbortSignal fires).
 *
 * Distinct from the generic request-failure Error so callers can tell a slow
 * provider from a misconfigured one.
 */
export class AiTimeoutError extends Error {
  constructor(message = "") {
    super(message);
    this.name = "AiTimeoutError";
  }
}

/**
 * Raised when the AI provider responds with HTTP 429 (rate limited).
 *
 * Callers should return a 429 response and include the `retryAfter` value as a
 * header so clients know when to retry.
 */
export class RateLimitError extends Error {
  readonly retryAfter: string | null;

  constructor(message = "", retryAfter: string | null = null) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}
