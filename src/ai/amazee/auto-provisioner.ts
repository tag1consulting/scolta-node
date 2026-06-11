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
   * reliable signal: {@link KeyExpiryRecovery} detects them and recovers
   * through {@link reprovision}, which bypasses this no-op.
   */
  static async ensureAiAvailable(storage: ConfigStorage, opts: EnsureAiOptions = {}): Promise<boolean> {
    if (opts.hasExplicitApiKey) {
      return false;
    }
    if (storage.load() !== null) {
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

  /**
   * Replace stored (known-bad) credentials with a freshly provisioned trial.
   *
   * The expired-key recovery entry point: unlike {@link ensureAiAvailable},
   * stored credentials do not short-circuit — they are cleared first, then a
   * fresh trial is provisioned and stored through the same provisioner path.
   * Callers are responsible for rate-limiting (see {@link KeyExpiryRecovery},
   * which guards this behind a one-attempt-per-window marker).
   *
   * Provisioning failures are caught internally and returned as `false`; the
   * old credentials are already cleared at that point, which is correct —
   * they were known-bad, and an empty store lets `ensureAiAvailable()` retry
   * on the next lazy-init pass.
   */
  static async reprovision(
    storage: ConfigStorage,
    opts: Omit<EnsureAiOptions, "hasExplicitApiKey"> = {},
  ): Promise<boolean> {
    storage.clear();

    return AutoProvisioner.ensureAiAvailable(storage, { ...opts, hasExplicitApiKey: false });
  }
}
