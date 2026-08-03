/**
 * Establishes the free Amazee.ai demo connection, on an explicit request.
 *
 * Port of `Tag1\Scolta\AiProvider\Amazee\AmazeeTrialProvisioner`: provision
 * the demo, persist the credentials, record how the connection was made,
 * resolve the best models.
 *
 * **Nothing calls this on its own.** It is reached only from an operator action
 * — a "Try the demo" button, a provisioning command, or a first-use path in a
 * headless framework where a developer set `ai_provider` to `amazee` in code.
 * {@link AutoProvisioner} deliberately does not call it: that class self-heals
 * credentials that are already stored and establishes nothing.
 */

import type { AmazeeClient } from "./client.js";
import { AmazeeConnectionSource } from "./connection-source.js";
import type { AmazeeModelResolver } from "./model-resolver.js";
import { ProvisioningResult } from "./results.js";
import type { ConfigStorage } from "./storage.js";

export class AmazeeTrialProvisioner {
  constructor(
    private readonly client: AmazeeClient,
    private readonly storage: ConfigStorage,
    private readonly hasExistingProvider: (() => boolean) | null = null,
    private readonly modelResolver: AmazeeModelResolver | null = null,
  ) {}

  /**
   * Provision the free demo, optionally bound to an email address.
   *
   * `email` defaults to empty — anonymous provisioning — which is what the
   * "Try the demo" action does, so that trying Scolta's AI costs an operator no
   * input at all.
   */
  async provision(email = ""): Promise<ProvisioningResult> {
    if (this.hasExistingProvider !== null && this.hasExistingProvider()) {
      return ProvisioningResult.skippedExistingProvider();
    }

    const result = await this.client.provisionTrial(email);
    this.storage.store(result.litellmToken, result.litellmApiUrl, result.region);
    this.storage.storeConnectionSource?.(AmazeeConnectionSource.Demo);

    if (this.modelResolver !== null) {
      const models = await this.modelResolver.resolve(result.litellmApiUrl, result.litellmToken);
      return ProvisioningResult.makeSuccess(
        result.litellmToken,
        result.litellmApiUrl,
        result.region,
        models.ai_model,
        models.ai_expansion_model,
      );
    }
    return result;
  }
}
