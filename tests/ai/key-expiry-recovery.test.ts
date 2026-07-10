/**
 * Expired/revoked-credential detection and graceful degradation (port of the
 * PHP `KeyExpiryRecoveryTest`).
 *
 * Regression (django demo, 2026-06-09): Amazee credentials were revoked
 * server-side, every LiteLLM call returned 400 expired_key, and nothing
 * detected it — expand silently echoed the query for ~24h while
 * ensureAiAvailable() kept no-opping on the stored dead credentials. When the
 * stored credentials stop being accepted, AI must turn off and the site must be
 * flagged for an admin to re-authenticate; the stored credentials are left in
 * place and no replacement credentials are requested on this path.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCacheDriver } from "../../src/cache.js";
import { ApiKeyInvalidError } from "../../src/errors.js";
import {
  AmazeeBudgetExceededException,
  AmazeeClient,
  BUDGET_MESSAGE,
  KeyExpiryRecovery,
  MemoryConfigStorage,
} from "../../src/ai/amazee/index.js";

const STORED = {
  litellm_token: "sk-stored-token",
  litellm_api_url: "https://llm.test.amazee.ai",
  region: "test-region",
} as const;

/**
 * Credential store that records whether its mutators were invoked, so a test
 * can assert the stored credentials were left untouched.
 */
class TripwireStorage extends MemoryConfigStorage {
  wasStored = false;
  wasCleared = false;

  override store(litellmToken: string, litellmApiUrl: string, region: string): void {
    this.wasStored = true;
    super.store(litellmToken, litellmApiUrl, region);
  }

  override clear(): void {
    this.wasCleared = true;
    super.clear();
  }
}

function makeRecovery(): { recovery: KeyExpiryRecovery; storage: MemoryConfigStorage; cache: InMemoryCacheDriver } {
  const storage = new MemoryConfigStorage();
  storage.store(STORED.litellm_token, STORED.litellm_api_url, STORED.region);
  const cache = new InMemoryCacheDriver();
  return { recovery: new KeyExpiryRecovery(storage, cache), storage, cache };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// isAuthFailure() classification
// ---------------------------------------------------------------------------

describe("KeyExpiryRecovery.isAuthFailure", () => {
  it("ApiKeyInvalidError (HTTP 401) is an auth failure", () => {
    expect(KeyExpiryRecovery.isAuthFailure(new ApiKeyInvalidError("Scolta AI API key is invalid or expired."))).toBe(
      true,
    );
  });

  it("expired_key in the message is an auth failure", () => {
    // LiteLLM returns the expired-key error inside an HTTP 400 body, which
    // AiClient preserves in the error message.
    const exc = new Error(
      'Scolta AI API request failed: HTTP 400 {"error": {"message": "Authentication Error - Expired Key. Key Expired. code: expired_key"}}',
    );
    expect(KeyExpiryRecovery.isAuthFailure(exc)).toBe(true);
  });

  it("auth markers are detected anywhere in the cause chain", () => {
    const inner = new Error("code: invalid_api_key");
    const outer = new Error("Scolta AI API request failed", { cause: inner });
    expect(KeyExpiryRecovery.isAuthFailure(outer)).toBe(true);
  });

  it("budget exhaustion is never an auth failure (by message or by type)", () => {
    // Budget exhaustion belongs to BudgetAwareProviderDecorator and follows the
    // budget path, never this credential-handling path.
    expect(KeyExpiryRecovery.isAuthFailure(new Error(BUDGET_MESSAGE))).toBe(false);
    expect(KeyExpiryRecovery.isAuthFailure(new AmazeeBudgetExceededException(new Error("429")))).toBe(false);
  });

  it("generic errors are not auth failures", () => {
    expect(KeyExpiryRecovery.isAuthFailure(new Error("Scolta AI API request failed: network timeout"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleAuthFailure() — degrade, record health, flag for re-auth
// ---------------------------------------------------------------------------

describe("expired credential handling", () => {
  it("degrades and flags for upgrade without writing credentials", async () => {
    const { recovery, storage } = makeRecovery();

    const result = recovery.handleAuthFailure(new Error("code: expired_key"));

    expect(result).toBe(false); // nothing to retry; the caller degrades gracefully
    expect(storage.load()?.litellm_token).toBe("sk-stored-token"); // stored credentials intact
    expect(recovery.isAuthFailing()).toBe(true); // health reports AI degraded
    expect(recovery.isUpgradeNeeded()).toBe(true); // site flagged for admin re-authentication
  });

  it("never requests replacement credentials and never touches the store", async () => {
    // A provision attempt would build an AmazeeClient and POST for a new key.
    // Guard both ends: fail if that endpoint is hit, and if the store is mutated.
    const provisionSpy = vi
      .spyOn(AmazeeClient.prototype, "provisionTrial")
      .mockRejectedValue(new Error("provisionTrial must not be called on an auth failure"));

    const storage = new TripwireStorage();
    storage.store(STORED.litellm_token, STORED.litellm_api_url, STORED.region);
    storage.wasStored = false; // reset after seeding
    const cache = new InMemoryCacheDriver();
    const recovery = new KeyExpiryRecovery(storage, cache);

    const result = recovery.handleAuthFailure(new Error("code: expired_key"));

    expect(result).toBe(false);
    expect(provisionSpy).not.toHaveBeenCalled();
    expect(storage.wasStored).toBe(false); // store() never called
    expect(storage.wasCleared).toBe(false); // clear() never called
    expect(recovery.isAuthFailing()).toBe(true);
    expect(recovery.isUpgradeNeeded()).toBe(true);
  });

  it("keeps the markers set across repeated failures without touching storage", async () => {
    const storage = new TripwireStorage();
    storage.store(STORED.litellm_token, STORED.litellm_api_url, STORED.region);
    storage.wasStored = false;
    const recovery = new KeyExpiryRecovery(storage, new InMemoryCacheDriver());

    expect(recovery.handleAuthFailure(new Error("code: expired_key"))).toBe(false);
    expect(recovery.handleAuthFailure(new Error("code: expired_key"))).toBe(false);

    expect(recovery.isAuthFailing()).toBe(true);
    expect(recovery.isUpgradeNeeded()).toBe(true);
    expect(storage.wasStored).toBe(false);
    expect(storage.wasCleared).toBe(false);
  });

  it("ignores non-auth failures: no markers, storage untouched", async () => {
    const { recovery, storage } = makeRecovery();

    const result = recovery.handleAuthFailure(new Error(BUDGET_MESSAGE));

    expect(result).toBe(false);
    expect(recovery.isAuthFailing()).toBe(false); // budget errors do not mark auth as failing
    expect(recovery.isUpgradeNeeded()).toBe(false); // nor flag for re-authentication
    expect(storage.load()?.litellm_token).toBe("sk-stored-token");
  });
});

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

describe("KeyExpiryRecovery markers", () => {
  it("recordAuthFailure is visible to isAuthFailing and isAuthFailingIn", () => {
    const { recovery, cache } = makeRecovery();

    expect(recovery.isAuthFailing()).toBe(false);
    expect(KeyExpiryRecovery.isAuthFailingIn(cache)).toBe(false);

    recovery.recordAuthFailure();

    expect(recovery.isAuthFailing()).toBe(true);
    expect(KeyExpiryRecovery.isAuthFailingIn(cache)).toBe(true);
  });

  it("an aged-out failure marker no longer reports auth-failing", () => {
    const cache = new InMemoryCacheDriver();
    cache.set(KeyExpiryRecovery.CACHE_KEY_AUTH_FAILURE, Date.now() / 1000 - 3601, 3600);

    expect(KeyExpiryRecovery.isAuthFailingIn(cache)).toBe(false);
  });

  it("a cleared marker (false) no longer reports auth-failing", () => {
    const cache = new InMemoryCacheDriver();
    cache.set(KeyExpiryRecovery.CACHE_KEY_AUTH_FAILURE, false, 1);

    expect(KeyExpiryRecovery.isAuthFailingIn(cache)).toBe(false);
  });

  it("the upgrade-needed marker can be set and cleared", () => {
    const { recovery } = makeRecovery();

    expect(recovery.isUpgradeNeeded()).toBe(false);

    recovery.flagUpgradeNeeded();
    expect(recovery.isUpgradeNeeded()).toBe(true);

    recovery.clearUpgradeNeeded();
    expect(recovery.isUpgradeNeeded()).toBe(false); // a completed re-authentication clears the prompt
  });
});
