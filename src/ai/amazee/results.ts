/**
 * Amazee result DTOs.
 *
 * Port of `scolta.ai.amazee.results` (ProvisioningResult / UpgradeResult).
 */

export const PROVISIONING_STATUS = {
  PROVISIONED: "provisioned",
  SKIPPED_EXISTING_PROVIDER: "skipped_existing_provider",
  FAILED: "failed",
} as const;

export type ProvisioningStatus = (typeof PROVISIONING_STATUS)[keyof typeof PROVISIONING_STATUS];

export class ProvisioningResult {
  static readonly STATUS_PROVISIONED = PROVISIONING_STATUS.PROVISIONED;
  static readonly STATUS_SKIPPED_EXISTING_PROVIDER = PROVISIONING_STATUS.SKIPPED_EXISTING_PROVIDER;
  static readonly STATUS_FAILED = PROVISIONING_STATUS.FAILED;

  constructor(
    readonly success: boolean,
    readonly litellmToken: string,
    readonly litellmApiUrl: string,
    readonly region: string,
    readonly error: string | null = null,
    readonly status: ProvisioningStatus = PROVISIONING_STATUS.PROVISIONED,
    readonly aiModel: string | null = null,
    readonly aiExpansionModel: string | null = null,
  ) {}

  static makeSuccess(
    litellmToken: string,
    litellmApiUrl: string,
    region: string,
    aiModel: string | null = null,
    aiExpansionModel: string | null = null,
  ): ProvisioningResult {
    return new ProvisioningResult(
      true,
      litellmToken,
      litellmApiUrl,
      region,
      null,
      PROVISIONING_STATUS.PROVISIONED,
      aiModel,
      aiExpansionModel,
    );
  }

  static failure(error: string): ProvisioningResult {
    return new ProvisioningResult(false, "", "", "", error, PROVISIONING_STATUS.FAILED);
  }

  static skippedExistingProvider(): ProvisioningResult {
    return new ProvisioningResult(true, "", "", "", null, PROVISIONING_STATUS.SKIPPED_EXISTING_PROVIDER);
  }
}

export class UpgradeResult {
  constructor(
    readonly success: boolean,
    readonly litellmToken: string,
    readonly litellmApiUrl: string,
    readonly region: string,
    readonly error: string | null = null,
  ) {}

  static makeSuccess(litellmToken: string, litellmApiUrl: string, region: string): UpgradeResult {
    return new UpgradeResult(true, litellmToken, litellmApiUrl, region);
  }

  static failure(error: string): UpgradeResult {
    return new UpgradeResult(false, "", "", "", error);
  }
}
