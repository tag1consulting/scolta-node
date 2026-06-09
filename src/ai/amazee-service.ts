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
import { BUDGET_MESSAGE } from "./amazee/budget-decorator.js";
import { AmazeeBudgetExceededException } from "./amazee/exceptions.js";
import type { AmazeeClient } from "./amazee/client.js";
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

  constructor(config: ScoltaConfig, storage: ConfigStorage, deps: AmazeeAiServiceDeps = {}) {
    super(config);
    this.storage = storage;
    this.amazeeClient = deps.amazeeClient;
  }

  // -- public AI calls (override to await provisioning) ---------------------

  override async message(systemPrompt: string, userMessage: string, maxTokens = 512): Promise<string> {
    try {
      const client = await this.resolveClient();
      return await client.message(systemPrompt, userMessage, maxTokens);
    } catch (exc) {
      this.handlePossibleBudgetException(exc);
      throw exc;
    }
  }

  override async conversation(systemPrompt: string, messages: ChatMessage[], maxTokens = 512): Promise<string> {
    try {
      const client = await this.resolveClient();
      return await client.conversation(systemPrompt, messages, maxTokens);
    } catch (exc) {
      this.handlePossibleBudgetException(exc);
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
      throw exc;
    }
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
    if (creds === null) {
      // Provisioning failed or the network was unreachable. Fall back to the
      // configured client; with no key it throws ApiKeyMissingError, which the
      // endpoint handler degrades to unexpanded/no-summary (HTTP 200).
      return new AiClient(config.toAiClientConfig());
    }

    const models = this.storage.storedModels();
    return new AiClient({
      provider: "openai",
      api_key: creds.litellm_token,
      base_url: creds.litellm_api_url,
      model: models.ai_model ?? config.ai_model,
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
    let cause: unknown = exc;
    while (cause !== null && cause !== undefined) {
      if (cause instanceof Error && cause.message.includes(BUDGET_MESSAGE)) {
        throw new AmazeeBudgetExceededException(exc);
      }
      cause = cause instanceof Error ? cause.cause : null;
    }
  }
}
