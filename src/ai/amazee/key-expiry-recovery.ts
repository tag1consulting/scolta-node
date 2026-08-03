/**
 * Detects Amazee credential auth failures at call time and degrades cleanly.
 *
 * Port of `Tag1\Scolta\AiProvider\Amazee\KeyExpiryRecovery`. Amazee.ai
 * credentials are revoked server-side when their lifecycle ends, and the expiry
 * is NOT announced at issue time (verified against the live API:
 * `/auth/generate-trial-access` returns only `created_at`, and the LiteLLM key's
 * own `expires` is a year out while observed revocation is on the order of a
 * day) — so the only reliable signal is the auth failure the LiteLLM proxy
 * returns on the next inference call. Without this class that failure was
 * swallowed by the expand/summarize graceful-degrade path while
 * {@link AutoProvisioner.ensureAiAvailable} kept no-opping on the stored dead
 * credentials: AI stayed down fleet-wide with health reporting
 * `ai_configured: true` (django demo outage, 2026-06-09).
 *
 * On an auth-class failure this class leaves AI off and records two
 * cache-backed markers (any {@link CacheDriver}) so the rest of the system
 * reflects the real state across requests:
 *  - an auth-failure marker, recorded on every detected failure and read by
 *    health checks so "AI configured" stops implying "AI usable"; it ages out
 *    so a transient blip self-clears once calls succeed again;
 *  - an upgrade-needed marker, set when the stored credentials are no longer
 *    accepted, that persists until the admin re-authenticates. Adapter admin
 *    UIs read {@link isUpgradeNeeded} to prompt the admin to continue by
 *    entering an email, which runs the existing verification flow. On a
 *    successful re-authentication the adapter calls {@link clearUpgradeNeeded}.
 *
 * The stored credentials are never cleared and no new credentials are requested
 * on this path; recovery is a deliberate, admin-initiated step. Budget-
 * exhaustion errors are excluded — those belong to
 * {@link BudgetAwareProviderDecorator} and follow the budget path, not this one.
 *
 * Marker windows are enforced by timestamp comparison here rather than by
 * relying on the driver's TTL: the bundled {@link InMemoryCacheDriver} (the
 * natural choice in a long-running Node process) treats TTL as advisory, and
 * the semantics must hold for every driver.
 */

import type { CacheDriver } from "../../cache.js";
import { ApiKeyInvalidError } from "../../errors.js";
import type { Logger } from "../endpoint.js";
import { BudgetAwareProviderDecorator } from "./budget-decorator.js";
import type { ConfigStorage, StoredCredentials } from "./storage.js";

export interface KeyExpiryRecoveryOptions {
  /** Optional logger for auth-failure notices. */
  logger?: Logger;
}

export class KeyExpiryRecovery {
  /**
   * Cache key for the "last AI call failed authentication" marker.
   *
   * Health checks read this (see {@link KeyExpiryRecovery.isAuthFailingIn})
   * to report AI as unusable while the stored credentials are known-bad.
   */
  static readonly CACHE_KEY_AUTH_FAILURE = "scolta_amazee_auth_failure";

  /**
   * Cache key for the persistent "credentials no longer accepted, admin must
   * re-authenticate" marker.
   *
   * Unlike the auth-failure marker this does NOT age out on its own: once the
   * stored credentials stop being accepted, AI stays off until the admin
   * completes the email re-authentication flow and the adapter clears it via
   * {@link clearUpgradeNeeded}. Public so adapter admin UIs reference one
   * definition.
   *
   * @since 1.0.2
   */
  static readonly CACHE_KEY_UPGRADE_NEEDED = "scolta_amazee_upgrade_needed";

  /**
   * How long a recorded auth failure keeps health reporting AI unusable
   * before a fresh failing call must re-confirm it, in seconds.
   */
  private static readonly AUTH_FAILURE_TTL = 3600;

  /**
   * How long the upgrade-needed marker is retained, in seconds.
   *
   * Long enough to outlast any cache backend's practical eviction window so
   * the prompt does not disappear on its own; the marker is meant to be
   * cleared explicitly by {@link clearUpgradeNeeded} once the admin
   * re-authenticates, not to expire.
   */
  private static readonly UPGRADE_NEEDED_TTL = 31536000;

  /**
   * Message substrings that identify an auth-class failure from the LiteLLM
   * proxy. The proxy returns the expired/invalid-key error inside an HTTP
   * 400/401 body, which {@link AiClient} preserves in the error message chain
   * (a 401 additionally becomes {@link ApiKeyInvalidError}, matched by type).
   */
  private static readonly AUTH_FAILURE_MARKERS = [
    "expired_key",
    "invalid_api_key",
    "authentication error",
    "invalid proxy server token",
  ];

  private readonly logger?: Logger;

  constructor(
    private readonly storage: ConfigStorage,
    private readonly cache: CacheDriver,
    opts: KeyExpiryRecoveryOptions = {},
  ) {
    this.logger = opts.logger;
  }

  /**
   * Whether an error (anywhere in its `cause` chain) is an auth-class failure
   * of the stored Amazee credentials.
   *
   * Budget-exhaustion errors return false even though they also surface as
   * 4xx responses — they route to the budget path, never here.
   */
  static isAuthFailure(exc: unknown): boolean {
    if (BudgetAwareProviderDecorator.isBudgetError(exc)) {
      return false;
    }

    let cause: unknown = exc;
    while (cause !== null && cause !== undefined) {
      if (cause instanceof ApiKeyInvalidError) {
        return true;
      }
      if (cause instanceof Error) {
        const message = cause.message.toLowerCase();
        if (KeyExpiryRecovery.AUTH_FAILURE_MARKERS.some((marker) => message.includes(marker))) {
          return true;
        }
      }
      cause = cause instanceof Error ? cause.cause : null;
    }

    return false;
  }

  /**
   * Whether the given cache holds a live auth-failure marker.
   *
   * A cache-marker read only — never a live API call — so health checks can
   * call this on every request. Static so {@link HealthChecker} reads the same
   * marker without holding a recovery instance.
   */
  static isAuthFailingIn(cache: CacheDriver): boolean {
    const marker = cache.get(KeyExpiryRecovery.CACHE_KEY_AUTH_FAILURE);
    return typeof marker === "number" && KeyExpiryRecovery.nowSeconds() - marker < KeyExpiryRecovery.AUTH_FAILURE_TTL;
  }

  private static nowSeconds(): number {
    return Date.now() / 1000;
  }

  /**
   * Handle an AI call failure on the Amazee path.
   *
   * "The Amazee path" means a site whose operator opted in to Amazee.ai —
   * either by starting the free demo or by signing in to an account. Nothing
   * reaches this on a site that did not opt in, and nothing here mints a
   * replacement connection.
   *
   * For an auth-class failure (the stored credentials are no longer accepted)
   * this records the auth-failure marker so health reports AI as degraded,
   * sets the persistent upgrade-needed marker so admin UIs can prompt the admin
   * to re-authenticate, and leaves the stored credentials untouched. It always
   * returns false: there is nothing to retry, so the caller degrades gracefully
   * (unexpanded query / no summary). Non-auth errors are ignored and also
   * return false.
   */
  handleAuthFailure(exc: unknown): boolean {
    if (!KeyExpiryRecovery.isAuthFailure(exc)) {
      return false;
    }

    this.recordAuthFailure();
    this.flagUpgradeNeeded();

    this.logger?.error(
      "Scolta: stored Amazee credentials were not accepted; AI is off until re-authentication.",
    );

    return false;
  }

  /**
   * Mark the stored credentials as auth-failing so health reports AI as
   * unusable until calls succeed again or the marker ages out.
   */
  recordAuthFailure(): void {
    this.cache.set(
      KeyExpiryRecovery.CACHE_KEY_AUTH_FAILURE,
      KeyExpiryRecovery.nowSeconds(),
      KeyExpiryRecovery.AUTH_FAILURE_TTL,
    );
  }

  /** Whether the stored credentials are known to be auth-failing. */
  isAuthFailing(): boolean {
    return KeyExpiryRecovery.isAuthFailingIn(this.cache);
  }

  /**
   * Set the persistent upgrade-needed marker.
   *
   * @since 1.0.2
   */
  flagUpgradeNeeded(): void {
    this.cache.set(
      KeyExpiryRecovery.CACHE_KEY_UPGRADE_NEEDED,
      KeyExpiryRecovery.nowSeconds(),
      KeyExpiryRecovery.UPGRADE_NEEDED_TTL,
    );
  }

  /**
   * Whether the stored credentials need an admin re-authentication.
   *
   * Adapter admin UIs read this to show the "enter your email to continue"
   * prompt. Cache-marker read only — never a live API call.
   *
   * @since 1.0.2
   */
  isUpgradeNeeded(): boolean {
    return Boolean(this.cache.get(KeyExpiryRecovery.CACHE_KEY_UPGRADE_NEEDED));
  }

  /**
   * Clear the upgrade-needed marker after a successful re-authentication.
   *
   * Adapters call this once the admin has completed the email verification
   * flow and fresh credentials are in storage.
   *
   * @since 1.0.2
   */
  clearUpgradeNeeded(): void {
    this.cache.set(KeyExpiryRecovery.CACHE_KEY_UPGRADE_NEEDED, false, 1);
  }

  /**
   * The currently stored credentials, or null when none are stored.
   */
  credentials(): StoredCredentials | null {
    return this.storage.load();
  }
}
