/**
 * Expired Amazee trial-key detection and guarded re-provisioning.
 *
 * Port of `Tag1\Scolta\AiProvider\Amazee\KeyExpiryRecovery` (scolta-php #211).
 * Amazee.ai trial keys are revoked server-side when the trial lifecycle ends,
 * and the expiry is NOT announced at provisioning time (verified against the
 * live API for the PHP fix: `/auth/generate-trial-access` returns only
 * `created_at`, and the LiteLLM key's own `expires` is a year out while
 * observed trial revocation is on the order of a day) — so the only reliable
 * signal is the auth failure the LiteLLM proxy returns on the next inference
 * call. Without this class that failure was swallowed by the expand/summarize
 * graceful-degrade path while `AutoProvisioner.ensureAiAvailable()` kept
 * no-opping on the stored dead credentials (django demo outage, 2026-06-09).
 *
 * Two cache-backed markers (any {@link CacheDriver}) coordinate recovery:
 *  - an auth-failure marker, recorded on every detected failure and read by
 *    health checks so "AI configured" stops implying "AI usable";
 *  - a re-provision-attempt marker, so a fleet of failing requests triggers
 *    exactly one re-provision attempt per window instead of hammering the
 *    provisioning API in a loop.
 *
 * Marker windows are enforced by timestamp comparison here rather than by
 * relying on the driver's TTL: the bundled {@link InMemoryCacheDriver} (the
 * natural choice in a long-running Node process) treats TTL as advisory, and
 * the semantics must hold for every driver.
 *
 * Budget-exhaustion errors are explicitly excluded — those belong to
 * {@link BudgetAwareProviderDecorator} and must not trigger re-provisioning
 * (a re-provisioned trial key would reset the spend ceiling, which is the
 * upgrade flow's job, not an error-recovery side effect).
 */

import type { CacheDriver } from "../../cache.js";
import { ApiKeyInvalidError } from "../../errors.js";
import type { Logger } from "../endpoint.js";
import { AutoProvisioner } from "./auto-provisioner.js";
import { BudgetAwareProviderDecorator } from "./budget-decorator.js";
import type { AmazeeClient } from "./client.js";
import type { ConfigStorage, StoredCredentials } from "./storage.js";

export interface KeyExpiryRecoveryOptions {
  /** Inject an Amazee control-plane client (tests); defaults to the real one. */
  client?: AmazeeClient;
  /** Minimum spacing between re-provision attempts, in seconds. */
  failureWindowSeconds?: number;
  /** Optional logger for re-provisioning failures. */
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

  /** Cache key for the one-attempt-per-window re-provision guard. */
  static readonly CACHE_KEY_REPROVISION_ATTEMPT = "scolta_amazee_reprovision_attempt";

  /**
   * How long a recorded auth failure keeps health reporting AI unusable
   * before a fresh failing call must re-confirm it, in seconds.
   */
  private static readonly AUTH_FAILURE_TTL = 3600;

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

  private readonly client?: AmazeeClient;
  private readonly failureWindowSeconds: number;
  private readonly logger?: Logger;

  constructor(
    private readonly storage: ConfigStorage,
    private readonly cache: CacheDriver,
    opts: KeyExpiryRecoveryOptions = {},
  ) {
    this.client = opts.client;
    this.failureWindowSeconds = opts.failureWindowSeconds ?? 600;
    this.logger = opts.logger;
  }

  /**
   * Whether an error (anywhere in its `cause` chain) is an auth-class failure
   * for which re-provisioning is the correct recovery.
   *
   * Budget-exhaustion errors return false even though they also surface as
   * 4xx responses — they route to the budget path, never to re-provisioning.
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
   * Record an auth failure and attempt a one-shot re-provision.
   *
   * Returns true only when the error is an auth failure AND a re-provision
   * was attempted in this call AND it succeeded — i.e. fresh credentials are
   * now in storage and a retry makes sense. Returns false for non-auth
   * errors, when another attempt already ran inside the current failure
   * window, or when re-provisioning failed.
   */
  async handleAuthFailure(
    exc: unknown,
    onModelsResolved?: (aiModel: string, aiExpansionModel: string) => void,
  ): Promise<boolean> {
    if (!KeyExpiryRecovery.isAuthFailure(exc)) {
      return false;
    }

    this.recordAuthFailure();

    return this.attemptReprovision(onModelsResolved);
  }

  /**
   * Mark the stored credentials as auth-failing so health reports AI as
   * unusable until recovery succeeds or the marker ages out.
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
   * The currently stored credentials, or null when none are stored.
   *
   * After a successful {@link handleAuthFailure} these are the fresh
   * post-re-provision credentials callers rebuild their client from.
   */
  credentials(): StoredCredentials | null {
    return this.storage.load();
  }

  /**
   * Attempt one re-provision through the existing provisioner path, guarded
   * to a single attempt per failure window.
   */
  private async attemptReprovision(
    onModelsResolved?: (aiModel: string, aiExpansionModel: string) => void,
  ): Promise<boolean> {
    const now = KeyExpiryRecovery.nowSeconds();
    const attempted = this.cache.get(KeyExpiryRecovery.CACHE_KEY_REPROVISION_ATTEMPT);
    if (typeof attempted === "number" && now - attempted < this.failureWindowSeconds) {
      return false;
    }

    // Set the guard before attempting: a failed attempt must also wait out
    // the window, otherwise every failing request retries provisioning.
    this.cache.set(KeyExpiryRecovery.CACHE_KEY_REPROVISION_ATTEMPT, now, this.failureWindowSeconds);

    const provisioned = await AutoProvisioner.reprovision(this.storage, {
      onModelsResolved,
      client: this.client,
    });

    if (provisioned) {
      // AI is usable again — stop health from reporting the old failure.
      this.cache.set(KeyExpiryRecovery.CACHE_KEY_AUTH_FAILURE, false, 1);
    } else {
      this.logger?.error("Scolta: Amazee re-provisioning failed, AI remains unavailable");
    }

    return provisioned;
  }
}
