/**
 * Account upgrade flow.
 *
 * Port of `scolta.ai.amazee.account_upgrader.AmazeeAccountUpgrader`: the
 * email-OTP sign-in flow that exchanges a trial for a private key.
 */

import type { AmazeeClient } from "./client.js";
import type { UpgradeResult } from "./results.js";
import type { ConfigStorage } from "./storage.js";

export class AmazeeAccountUpgrader {
  constructor(
    private readonly client: AmazeeClient,
    private readonly storage: ConfigStorage,
  ) {}

  requestVerificationCode(email: string): Promise<void> {
    return this.client.requestVerificationCode(email);
  }

  signIn(email: string, code: string): Promise<string> {
    return this.client.signIn(email, code);
  }

  listRegions(sessionToken: string): Promise<unknown[]> {
    return this.client.listRegions(sessionToken);
  }

  async upgrade(sessionToken: string, regionId: string): Promise<UpgradeResult> {
    const result = await this.client.createPrivateKey(sessionToken, regionId);
    this.storage.store(result.litellmToken, result.litellmApiUrl, result.region);
    return result;
  }
}
