/**
 * Connects a site to an amazee.ai account, by email.
 *
 * Port of `Tag1\Scolta\AiProvider\Amazee\AmazeeAccountUpgrader`. The only way
 * to reach a real amazee.ai account, and email-only by design: it mirrors
 * amazee.ai's own `ai_provider_amazeeio` Drupal module, where an operator never
 * generates or pastes an API key. Signing in returns the account's credentials
 * and Scolta persists them. There is deliberately no bring-your-own-key path —
 * an operator who already holds an account attaches it by signing in with that
 * account's email, and the same flow creates the account when it does not exist
 * yet.
 *
 * It serves two operator journeys with the same steps: connecting an account
 * from a clean install, and continuing after the demo credit runs out, which
 * {@link KeyExpiryRecovery} flags with its upgrade-needed marker.
 */

import type { AmazeeClient } from "./client.js";
import { AmazeeConnectionSource } from "./connection-source.js";
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

  /**
   * Provision a private AI key in the given region and store it.
   *
   * New credentials replace any existing stored credentials — including a demo
   * connection this account is replacing — and the connection source is
   * recorded as `account` when the store supports it.
   */
  async upgrade(sessionToken: string, regionId: string): Promise<UpgradeResult> {
    const result = await this.client.createPrivateKey(sessionToken, regionId);
    this.storage.store(result.litellmToken, result.litellmApiUrl, result.region);
    this.storage.storeConnectionSource?.(AmazeeConnectionSource.Account);
    return result;
  }
}
