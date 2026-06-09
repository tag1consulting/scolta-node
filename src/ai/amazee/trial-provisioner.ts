/**
 * Trial provisioning orchestration.
 *
 * Port of `scolta.ai.amazee.trial_provisioner.AmazeeTrialProvisioner`: provision
 * a trial, persist the credentials, resolve the best models.
 */

import type { AmazeeClient } from "./client.js";
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

  async provision(email = ""): Promise<ProvisioningResult> {
    if (this.hasExistingProvider !== null && this.hasExistingProvider()) {
      return ProvisioningResult.skippedExistingProvider();
    }

    const result = await this.client.provisionTrial(email);
    this.storage.store(result.litellmToken, result.litellmApiUrl, result.region);

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
