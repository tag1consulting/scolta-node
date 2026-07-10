/**
 * Amazee-aware AI service.
 *
 * Extends {@link AiServiceAdapter} so the built-in (or auto-provisioned) AI path
 * works with no explicit key: when no `ai_api_key` is configured it provisions a
 * free Amazee.ai trial on first use, then drives the OpenAI-compatible
 * {@link AiClient} against the returned LiteLLM gateway — mirroring the Django
 * adapter's `config_overrides()` + `maybe_auto_provision()`. An explicit key
 * always wins (the custom-Anthropic / custom-provider path).
 */

import type { ScoltaConfig } from "../config.js";
import { AiClient, type ChatMessage } from "./client.js";
import { AutoProvisioner } from "./amazee/auto-provisioner.js";
import { BudgetAwareProviderDecorator } from "./amazee/budget-decorator.js";
import { AmazeeBudgetExceededException } from "./amazee/exceptions.js";
import type { AmazeeClient } from "./amazee/client.js";
import type { KeyExpiryRecovery } from "./amazee/key-expiry-recovery.js";
import type { ConfigStorage } from "./amazee/storage.js";
import { AiServiceAdapter } from "./service.js";

export interface AmazeeAiServiceDeps {
  /** Inject an Amazee control-plane client (tests); defaults to the real one. */
  amazeeClient?: AmazeeClient;
}

export class AmazeeAiService extends AiServiceAdapter {
  private readonly storage: ConfigStorage;
  private readonly amazeeClient?: AmazeeClient;
  private clientPromise: Promise<AiClient> | null = null;
  private keyRecovery: KeyExpiryRecovery | null = null;

  constructor(config: ScoltaConfig, storage: ConfigStorage, deps: AmazeeAiServiceDeps = {}) {
    super(config);
    this.storage = storage;
    this.amazeeClient = deps.amazeeClient;
  }

  /**
   * Wire Amazee key-expiry recovery into the AI call path.
   *
   * When set, an auth-class failure (the stored trial key is no longer
   * accepted) on any AI call is recorded so `/health` reports AI as degraded
   * and the site is flagged for admin re-authentication. It never retries —
   * the original failure propagates and the request degrades gracefully.
   * Without it, behavior is unchanged: the failure propagates untracked.
   *
   * Port of the PHP `AiServiceAdapter::setKeyExpiryRecovery()` — it lives on
   * this class rather than the base adapter because in this binding the
   * auto-provisioned path (Amazee storage and all) IS this class; recovery
   * never applies to the explicit-key path, which {@link noteAuthFailure}
   * also guards against directly.
   */
  setKeyExpiryRecovery(recovery: KeyExpiryRecovery): void {
    this.keyRecovery = recovery;
  }

  // -- public AI calls (override to await provisioning) ---------------------

  override async message(systemPrompt: string, userMessage: string, maxTokens = 512): Promise<string> {
    try {
      const client = await this.resolveClient();
      return await client.message(systemPrompt, userMessage, maxTokens);
    } catch (exc) {
      this.handlePossibleBudgetException(exc);
      this.noteAuthFailure(exc);
      throw exc;
    }
  }

  override async conversation(systemPrompt: string, messages: ChatMessage[], maxTokens = 512): Promise<string> {
    try {
      const client = await this.resolveClient();
      return await client.conversation(systemPrompt, messages, maxTokens);
    } catch (exc) {
      this.handlePossibleBudgetException(exc);
      this.noteAuthFailure(exc);
      throw exc;
    }
  }

  override async messageForOperation(
    operation: string,
    systemPrompt: string,
    userMessage: string,
    maxTokens = 512,
  ): Promise<string> {
    try {
      const client = await this.resolveClient();
      const model = operation === "expand_query" ? this.expansionModel() : undefined;
      return await client.message(systemPrompt, userMessage, maxTokens, model);
    } catch (exc) {
      this.handlePossibleBudgetException(exc);
      this.noteAuthFailure(exc);
      throw exc;
    }
  }

  // -- key-expiry recovery ----------------------------------------------------

  /**
   * Record an auth-class failure of the stored Amazee credentials.
   *
   * When recovery is wired and this service is on the auto-provisioned path
   * (no explicit key — an explicit key failing auth is the user's key to fix,
   * not Amazee's), an auth-class failure (never budget-exhaustion —
   * {@link KeyExpiryRecovery} excludes it) marks AI as degraded for `/health`
   * and flags the site for admin re-authentication. It never retries: the
   * caller's original error propagates and the request degrades gracefully
   * (unexpanded query / no summary). A no-op when recovery is not wired.
   */
  private noteAuthFailure(exc: unknown): void {
    if (this.keyRecovery === null) {
      return;
    }
    if (this.getConfig().ai_api_key) {
      return;
    }

    this.keyRecovery.handleAuthFailure(exc);
  }

  // -- client resolution ----------------------------------------------------

  /** Single-flight: provision (if needed) and build the AiClient once. */
  private resolveClient(): Promise<AiClient> {
    if (this.clientPromise === null) {
      this.clientPromise = this.buildClient().catch((exc) => {
        // Allow a later call to retry provisioning after a transient failure.
        this.clientPromise = null;
        throw exc;
      });
    }
    return this.clientPromise;
  }

  private async buildClient(): Promise<AiClient> {
    const config = this.getConfig();

    // Explicit key wins — use the configured provider as-is (custom Anthropic /
    // OpenAI-compatible path). No Amazee provisioning.
    if (config.ai_api_key) {
      return new AiClient(config.toAiClientConfig());
    }

    await AutoProvisioner.ensureAiAvailable(this.storage, {
      hasExplicitApiKey: false,
      onModelsResolved: (aiModel, aiExpansionModel) => this.storage.storeModels(aiModel, aiExpansionModel),
      client: this.amazeeClient,
    });

    const creds = this.storage.load();
    const models = creds === null ? null : this.storage.storedModels();
    if (creds === null || !models?.ai_model) {
      // No credentials, or an incomplete provision whose model resolution never
      // succeeded (provisioning's /model/info call failed). Falling back to the
      // configured client — with no key it throws ApiKeyMissingError, which the
      // endpoint handler degrades to unexpanded/no-summary (HTTP 200), the same
      // path as no credentials. Critically we must NOT build the gateway client
      // with the dated config default, which the gateway rejects with HTTP 400.
      return new AiClient(config.toAiClientConfig());
    }

    return new AiClient({
      provider: "openai",
      api_key: creds.litellm_token,
      base_url: creds.litellm_api_url,
      model: models.ai_model,
    });
  }

  private expansionModel(): string | undefined {
    const stored = this.storage.storedModels().ai_expansion_model;
    if (stored) {
      return stored;
    }
    const config = this.getConfig();
    return config.ai_expansion_model !== "" ? config.ai_expansion_model : undefined;
  }

  // -- budget handling ------------------------------------------------------

  protected override handlePossibleBudgetException(exc: unknown): void {
    if (exc instanceof AmazeeBudgetExceededException) {
      throw exc;
    }
    if (BudgetAwareProviderDecorator.isBudgetError(exc)) {
      throw new AmazeeBudgetExceededException(exc);
    }
  }
}
