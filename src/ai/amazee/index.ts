/**
 * Amazee.ai managed-gateway subsystem (port of `scolta.ai.amazee`).
 *
 * A managed LiteLLM gateway, connected only when a site opts in. Two explicit
 * paths establish a connection: the free demo (anonymous, or bound to an email)
 * and the email-OTP account flow, which is also how an operator continues once
 * the demo credit runs out. Nothing here connects a site on its own —
 * `AutoProvisioner` only re-resolves model names against credentials already
 * stored. The returned credentials configure the OpenAI-compatible AiClient
 * path.
 */

export { AmazeeAccountUpgrader } from "./account-upgrader.js";
export { AutoProvisioner, type EnsureAiOptions } from "./auto-provisioner.js";
export { BudgetAwareProviderDecorator, BUDGET_MESSAGE } from "./budget-decorator.js";
export { AmazeeClient, DEFAULT_BASE_URL } from "./client.js";
export {
  AmazeeConnectionSource,
  amazeeConnectionSourceLabel,
} from "./connection-source.js";
export { AmazeeApiException, AmazeeBudgetExceededException } from "./exceptions.js";
export { KeyExpiryRecovery, type KeyExpiryRecoveryOptions } from "./key-expiry-recovery.js";
export { AmazeeModelResolver, type ResolvedModels } from "./model-resolver.js";
export {
  ProvisioningResult,
  UpgradeResult,
  PROVISIONING_STATUS,
  type ProvisioningStatus,
} from "./results.js";
export {
  type ConfigStorage,
  type StoredCredentials,
  type StoredModels,
  FilesystemConfigStorage,
  MemoryConfigStorage,
} from "./storage.js";
export { AmazeeTrialProvisioner } from "./trial-provisioner.js";
