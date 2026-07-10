/**
 * Idempotent auto-provisioning guard.
 *
 * Port of `scolta.ai.amazee.auto_provisioner.AutoProvisioner`. The gate is the
 * absence of an explicit key / stored credentials — NOT the provider name. (The
 * out-of-date Django `maybe_auto_provision` wrapper gated on `provider ==
 * "amazee"`; this contract does not.)
 */

import { AmazeeClient } from "./client.js";
import { AmazeeApiException } from "./exceptions.js";
import { AmazeeModelResolver } from "./model-resolver.js";
import { ProvisioningResult } from "./results.js";
import type { ConfigStorage } from "./storage.js";
import { AmazeeTrialProvisioner } from "./trial-provisioner.js";

export interface EnsureAiOptions {
  /** When an explicit API key is configured, provisioning is a no-op. */
  hasExplicitApiKey?: boolean;
  /** Called with resolved (aiModel, aiExpansionModel) on a successful provision. */
  onModelsResolved?: (aiModel: string, aiExpansionModel: string) => void;
  /** Inject a client (tests); defaults to a real {@link AmazeeClient}. */
  client?: AmazeeClient;
}

export class AutoProvisioner {
  /**
   * Provision a free trial unless AI is already configured. Idempotent — a
   * no-op when an explicit key exists or credentials are already stored.
   * Returns true only on a successful first provisioning.
   *
   * The stored-credentials no-op deliberately does NOT validate that the
   * stored key still works — trial keys are revoked server-side when the
   * trial ends, and that expiry is not announced at provisioning time, so a
   * cheap lazy-init guard cannot know. Call-time auth failures are the
   * reliable signal: {@link KeyExpiryRecovery} detects them, degrades AI
   * cleanly, and flags the site for admin re-authentication.
   *
   * Stored credentials are treated as a *complete* provision only once their
   * model names are resolved. A provision whose `/model/info` call failed
   * stores token+url with no models, and the client builder would then send
   * the gateway the dated config default it rejects (HTTP 400), breaking AI
   * permanently because this guard kept no-opping on the half-provisioned
   * credentials. When credentials are stored but no model is, model resolution
   * is re-attempted against the ALREADY-STORED key — never a fresh trial,
   * which would waste a server-side-limited allocation — so the
   * incomplete-provision state self-heals.
   */
  static async ensureAiAvailable(storage: ConfigStorage, opts: EnsureAiOptions = {}): Promise<boolean> {
    if (opts.hasExplicitApiKey) {
      return false;
    }

    const creds = storage.load();
    if (creds !== null) {
      // Fully provisioned (creds + resolved model) — nothing to do.
      if (storage.storedModels().ai_model) {
        return false;
      }
      // Incomplete provision: re-resolve models against the stored key.
      const models = await new AmazeeModelResolver(opts.client ?? new AmazeeClient()).resolve(
        creds.litellm_api_url,
        creds.litellm_token,
      );
      if (opts.onModelsResolved && (models.ai_model !== null || models.ai_expansion_model !== null)) {
        opts.onModelsResolved(models.ai_model ?? "", models.ai_expansion_model ?? "");
      }
      return false;
    }

    const client = opts.client ?? new AmazeeClient();
    const provisioner = new AmazeeTrialProvisioner(client, storage, null, new AmazeeModelResolver(client));

    let result: ProvisioningResult;
    try {
      result = await provisioner.provision();
    } catch (exc) {
      if (exc instanceof AmazeeApiException) {
        return false;
      }
      throw exc;
    }

    if (!result.success || result.status !== ProvisioningResult.STATUS_PROVISIONED) {
      return false;
    }

    if (opts.onModelsResolved && (result.aiModel !== null || result.aiExpansionModel !== null)) {
      opts.onModelsResolved(result.aiModel ?? "", result.aiExpansionModel ?? "");
    }
    return true;
  }
}
