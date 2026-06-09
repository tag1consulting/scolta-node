/**
 * Amazee.ai auto-provisioning subsystem (port of `scolta.ai.amazee`).
 *
 * A managed LiteLLM gateway: provision a free trial (anonymous or by email),
 * resolve the best Claude models, and upgrade to a private key via an email-OTP
 * flow. The returned credentials configure the OpenAI-compatible AiClient path.
 */

export { AmazeeAccountUpgrader } from "./account-upgrader.js";
export { AutoProvisioner, type EnsureAiOptions } from "./auto-provisioner.js";
export { BudgetAwareProviderDecorator, BUDGET_MESSAGE } from "./budget-decorator.js";
export { AmazeeClient, DEFAULT_BASE_URL } from "./client.js";
export { AmazeeApiException, AmazeeBudgetExceededException } from "./exceptions.js";
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
