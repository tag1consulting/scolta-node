/**
 * Expired-key detection and guarded re-provisioning (port of the PHP
 * `KeyExpiryRecoveryTest`, scolta-php #211).
 *
 * Regression (django demo, 2026-06-09): an Amazee trial key expired
 * server-side, every LiteLLM call returned 400 expired_key, and nothing
 * detected it — expand silently echoed the query for ~24h while
 * ensureAiAvailable() kept no-opping on the stored dead credentials.
 */

import { describe, expect, it } from "vitest";
import { InMemoryCacheDriver } from "../../src/cache.js";
import { ApiKeyInvalidError } from "../../src/errors.js";
import {
  AmazeeBudgetExceededException,
  AmazeeClient,
  BUDGET_MESSAGE,
  KeyExpiryRecovery,
  MemoryConfigStorage,
} from "../../src/ai/amazee/index.js";

const TRIAL = {
  key: {
    litellm_token: "sk-fresh-token",
    litellm_api_url: "https://llm.test.amazee.ai",
    region: "test-region",
  },
};
const MODELS = {
  data: [{ model_name: "claude-sonnet-4-5" }, { model_name: "claude-haiku-4-5" }],
};

interface Harness {
  recovery: KeyExpiryRecovery;
  storage: MemoryConfigStorage;
  cache: InMemoryCacheDriver;
  /** Number of HTTP calls the Amazee control plane received. */
  calls: () => number;
}

/**
 * A recovery instance over a mocked Amazee control plane. `responses` are
 * consumed in order; any call past the end of the queue throws — mirroring
 * the PHP MockHandler so "exactly one provisioning attempt" is enforced by
 * construction.
 */
function makeRecovery(
  responses: { status?: number; json?: unknown }[],
  opts: { failureWindowSeconds?: number } = {},
): Harness {
  const storage = new MemoryConfigStorage();
  storage.store("sk-expired-token", "https://llm.test.amazee.ai", "test-region");
  const cache = new InMemoryCacheDriver();

  let callCount = 0;
  const fetchImpl: typeof fetch = async () => {
    const next = responses.shift();
    callCount += 1;
    if (next === undefined) {
      throw new Error("unexpected Amazee API call: mock response queue is empty");
    }
    return new Response(JSON.stringify(next.json ?? {}), { status: next.status ?? 200 });
  };

  const recovery = new KeyExpiryRecovery(storage, cache, {
    client: new AmazeeClient("https://api.amazee.ai", fetchImpl),
    ...opts,
  });
  return { recovery, storage, cache, calls: () => callCount };
}

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
    // Budget exhaustion belongs to BudgetAwareProviderDecorator and must
    // never trigger re-provisioning (a fresh trial key would reset the spend
    // ceiling — that is the upgrade flow's job).
    expect(KeyExpiryRecovery.isAuthFailure(new Error(BUDGET_MESSAGE))).toBe(false);
    expect(KeyExpiryRecovery.isAuthFailure(new AmazeeBudgetExceededException(new Error("429")))).toBe(false);
  });

  it("generic errors are not auth failures", () => {
    expect(KeyExpiryRecovery.isAuthFailure(new Error("Scolta AI API request failed: network timeout"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleAuthFailure() — detection, recovery, fresh credentials
// ---------------------------------------------------------------------------

describe("KeyExpiryRecovery.handleAuthFailure", () => {
  it("expired key triggers one re-provision and stores fresh credentials", async () => {
    const { recovery, calls } = makeRecovery([{ json: TRIAL }, { json: MODELS }]);

    const result = await recovery.handleAuthFailure(new Error("code: expired_key"));

    expect(result).toBe(true);
    expect(recovery.credentials()?.litellm_token).toBe("sk-fresh-token");
    expect(calls()).toBe(2); // trial + model info — both provisioning calls ran
    expect(recovery.isAuthFailing()).toBe(false); // successful recovery clears the marker
  });

  it("a second failure inside the window does not re-provision again", async () => {
    const { recovery, calls } = makeRecovery([{ json: TRIAL }, { json: MODELS }]);

    expect(await recovery.handleAuthFailure(new Error("code: expired_key"))).toBe(true);

    // The mock queue is empty: another HTTP call would throw.
    expect(await recovery.handleAuthFailure(new Error("code: expired_key"))).toBe(false);
    expect(calls()).toBe(2);
  });

  it("a failed re-provision leaves the failure marker and waits out the window", async () => {
    const { recovery, calls } = makeRecovery([{ status: 500, json: { detail: "server error" } }]);

    const first = await recovery.handleAuthFailure(new Error("code: expired_key"));
    const second = await recovery.handleAuthFailure(new Error("code: expired_key"));

    expect(first).toBe(false); // provisioning failure reports unrecovered
    expect(second).toBe(false); // waits out the window, no API retry
    expect(recovery.isAuthFailing()).toBe(true); // health keeps seeing the failure
    expect(calls()).toBe(1); // exactly one provisioning attempt
  });

  it("an expired attempt window allows a fresh re-provision", async () => {
    const { recovery, cache, calls } = makeRecovery(
      [{ status: 500, json: {} }, { json: TRIAL }, { json: MODELS }],
      { failureWindowSeconds: 600 },
    );

    expect(await recovery.handleAuthFailure(new Error("code: expired_key"))).toBe(false);

    // Age the attempt marker past the window (timestamps are compared in
    // code, not via driver TTL — the in-memory driver ignores TTL).
    cache.set(KeyExpiryRecovery.CACHE_KEY_REPROVISION_ATTEMPT, Date.now() / 1000 - 601, 600);

    expect(await recovery.handleAuthFailure(new Error("code: expired_key"))).toBe(true);
    expect(calls()).toBe(3);
  });

  it("non-auth failures are ignored: no marker, no API call, storage untouched", async () => {
    const { recovery, storage, calls } = makeRecovery([]);

    const result = await recovery.handleAuthFailure(new Error(BUDGET_MESSAGE));

    expect(result).toBe(false);
    expect(recovery.isAuthFailing()).toBe(false);
    expect(storage.load()?.litellm_token).toBe("sk-expired-token");
    expect(calls()).toBe(0);
  });

  it("forwards the models-resolved callback to the provisioner", async () => {
    const { recovery } = makeRecovery([{ json: TRIAL }, { json: MODELS }]);

    let resolved: [string, string] | null = null;
    await recovery.handleAuthFailure(new Error("code: expired_key"), (model, expansionModel) => {
      resolved = [model, expansionModel];
    });

    expect(resolved).toEqual(["claude-sonnet-4-5", "claude-haiku-4-5"]);
  });
});

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

describe("KeyExpiryRecovery markers", () => {
  it("recordAuthFailure is visible to isAuthFailing and isAuthFailingIn", () => {
    const { recovery, cache } = makeRecovery([]);

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
});
