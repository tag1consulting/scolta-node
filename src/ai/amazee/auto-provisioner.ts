/**
 * Self-heal guard for stored managed-gateway credentials.
 *
 * Port of `Tag1\Scolta\AiProvider\Amazee\AutoProvisioner`. This helper never
 * establishes a managed gateway connection. Establishing one is an explicit
 * caller action: an operator-initiated enable path calls
 * {@link AmazeeTrialProvisioner.provision} directly. Nothing here does it on
 * the caller's behalf, from a request path, from a startup hook, or behind a
 * flag.
 *
 * The class name predates the policy and is kept for callers written against
 * it. What remains is {@link AutoProvisioner.ensureAiAvailable}: a self-heal
 * for credentials that are already stored but whose model names were never
 * resolved.
 *
 * The previous docstring here described the opposite contract — "the gate is
 * the absence of an explicit key / stored credentials — NOT the provider name"
 * — and the code matched it, minting a trial for any caller that reached this
 * with an empty store. Both are gone.
 */

import { AmazeeClient } from "./client.js";
import { AmazeeModelResolver } from "./model-resolver.js";
import type { ConfigStorage } from "./storage.js";

export interface EnsureAiOptions {
  /** When an explicit API key is configured, this is a no-op that reads nothing. */
  hasExplicitApiKey?: boolean;
  /** Called with resolved (aiModel, aiExpansionModel) when a self-heal resolves them. */
  onModelsResolved?: (aiModel: string, aiExpansionModel: string) => void;
  /** Inject a client (tests); defaults to a real {@link AmazeeClient}. */
  client?: AmazeeClient;
}

export class AutoProvisioner {
  /**
   * Re-resolve model names for credentials that are already stored.
   *
   * This method never establishes a managed gateway connection, and it makes no
   * outbound call at all unless credentials are already stored. It is a no-op
   * when:
   *
   * - `hasExplicitApiKey` is true (the caller has their own provider),
   * - no credentials are stored — nothing to heal, and nothing is established
   *   here; that is {@link AmazeeTrialProvisioner.provision}, reached only from
   *   an explicit operator action or from a framework path where a developer
   *   set `ai_provider` to `amazee` in code, or
   * - credentials are stored and their model names are already resolved.
   *
   * The stored-credentials path deliberately does NOT validate that the stored
   * key still works — credentials are revoked server-side when their lifecycle
   * ends, and that is not announced at issue time, so a cheap lazy-init guard
   * cannot know. Call-time auth failures are the reliable signal:
   * {@link KeyExpiryRecovery} detects them, degrades AI cleanly, and flags the
   * site for admin re-authentication without requesting replacement
   * credentials.
   *
   * Stored credentials are, however, usable only once their model names have
   * been resolved. Credentials stored while `/model/info` was unreachable carry
   * no resolved models, leaving the client builder to send the gateway the
   * dated config default it rejects with HTTP 400 — breaking AI permanently
   * because this guard kept no-opping on the half-configured credentials. That
   * state is re-resolved against the ALREADY-STORED key, so it self-heals.
   *
   * @returns Always `false`. The return value is retained for callers written
   *   against the previous signature; nothing is established here, so there is
   *   no success to report.
   */
  static async ensureAiAvailable(storage: ConfigStorage, opts: EnsureAiOptions = {}): Promise<boolean> {
    if (opts.hasExplicitApiKey) {
      return false;
    }

    const creds = storage.load();
    if (creds === null) {
      // POLICY: nothing is established here. Automatic enrollment was removed
      // outright — there is no automatic path and no flag-gated one. A managed
      // gateway connection is established only by an explicit operator action
      // that calls AmazeeTrialProvisioner.provision(). With no stored
      // credentials this is a no-op that makes no outbound call.
      return false;
    }

    // Fully provisioned (creds + resolved model) — nothing to do.
    if (storage.storedModels().ai_model) {
      return false;
    }

    // Credentials are stored but their models are not. Self-heal by
    // re-resolving against the stored key, never by issuing new credentials.
    const models = await new AmazeeModelResolver(opts.client ?? new AmazeeClient()).resolve(
      creds.litellm_api_url,
      creds.litellm_token,
    );
    if (opts.onModelsResolved && (models.ai_model !== null || models.ai_expansion_model !== null)) {
      opts.onModelsResolved(models.ai_model ?? "", models.ai_expansion_model ?? "");
    }

    return false;
  }
}
