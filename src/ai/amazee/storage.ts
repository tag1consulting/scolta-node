/**
 * Credential storage abstraction.
 *
 * Port of `scolta.ai.amazee.storage.ConfigStorage` plus a filesystem-backed
 * implementation. The Django adapter stores credentials in a model row; the
 * Node demos persist a small JSON file under the demo's state dir so a trial is
 * provisioned once and reused across requests.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { AmazeeConnectionSource } from "./connection-source.js";

export interface StoredCredentials {
  litellm_token: string;
  litellm_api_url: string;
  region: string;
}

export interface StoredModels {
  ai_model?: string;
  ai_expansion_model?: string;
}

export interface ConfigStorage {
  store(litellmToken: string, litellmApiUrl: string, region: string): void;
  /** Returns the stored credentials, or null when nothing is stored. */
  load(): StoredCredentials | null;
  clear(): void;
  storeModels(aiModel: string, aiExpansionModel: string): void;
  storedModels(): StoredModels;
  /**
   * Record which operator action produced the credentials just stored.
   *
   * Called immediately after {@link ConfigStorage.store} by the class that
   * established the connection. Optional: a store that cannot record provenance
   * simply omits it, and reports no origin, which is the honest answer for
   * credentials whose origin nothing knows.
   */
  storeConnectionSource?(source: AmazeeConnectionSource): void;
  /**
   * The recorded connection source, or undefined when none was recorded.
   *
   * Callers must report an absent value as "not recorded" and must not
   * substitute a guess. Implementations MUST drop the recorded source in
   * `clear()`, so disconnecting does not leave a stale provenance to be paired
   * with the next connection.
   */
  loadConnectionSource?(): AmazeeConnectionSource | undefined;
}

interface CredentialsFile {
  litellm_token?: string;
  litellm_api_url?: string;
  region?: string;
  ai_model?: string;
  ai_expansion_model?: string;
  connection_source?: AmazeeConnectionSource;
}

/**
 * Stores Amazee credentials as JSON under `${stateDir}/amazee-credentials.json`.
 * The file persists between requests so provisioning happens only once.
 */
export class FilesystemConfigStorage implements ConfigStorage {
  private readonly filePath: string;

  constructor(stateDir: string, fileName = "amazee-credentials.json") {
    this.filePath = path.resolve(stateDir, fileName);
  }

  private read(): CredentialsFile {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as CredentialsFile;
    } catch {
      return {};
    }
  }

  private write(data: CredentialsFile): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  store(litellmToken: string, litellmApiUrl: string, region: string): void {
    const data = this.read();
    data.litellm_token = litellmToken;
    data.litellm_api_url = litellmApiUrl;
    data.region = region;
    this.write(data);
  }

  load(): StoredCredentials | null {
    const data = this.read();
    if (!data.litellm_token || !data.litellm_api_url) {
      return null;
    }
    return {
      litellm_token: data.litellm_token,
      litellm_api_url: data.litellm_api_url,
      region: data.region ?? "default",
    };
  }

  clear(): void {
    try {
      fs.rmSync(this.filePath, { force: true });
    } catch {
      // already absent
    }
  }

  storeModels(aiModel: string, aiExpansionModel: string): void {
    const data = this.read();
    if (aiModel) data.ai_model = aiModel;
    if (aiExpansionModel) data.ai_expansion_model = aiExpansionModel;
    this.write(data);
  }

  storedModels(): StoredModels {
    const data = this.read();
    const out: StoredModels = {};
    if (data.ai_model) out.ai_model = data.ai_model;
    if (data.ai_expansion_model) out.ai_expansion_model = data.ai_expansion_model;
    return out;
  }

  storeConnectionSource(source: AmazeeConnectionSource): void {
    const data = this.read();
    data.connection_source = source;
    this.write(data);
  }

  loadConnectionSource(): AmazeeConnectionSource | undefined {
    return this.read().connection_source;
  }
}

/** In-memory credential storage, useful for tests. */
export class MemoryConfigStorage implements ConfigStorage {
  private creds: StoredCredentials | null = null;
  private models: StoredModels = {};
  private connectionSource: AmazeeConnectionSource | undefined = undefined;

  store(litellmToken: string, litellmApiUrl: string, region: string): void {
    this.creds = { litellm_token: litellmToken, litellm_api_url: litellmApiUrl, region };
  }

  load(): StoredCredentials | null {
    return this.creds;
  }

  clear(): void {
    this.creds = null;
    this.models = {};
    this.connectionSource = undefined;
  }

  storeModels(aiModel: string, aiExpansionModel: string): void {
    if (aiModel) this.models.ai_model = aiModel;
    if (aiExpansionModel) this.models.ai_expansion_model = aiExpansionModel;
  }

  storedModels(): StoredModels {
    return { ...this.models };
  }

  storeConnectionSource(source: AmazeeConnectionSource): void {
    this.connectionSource = source;
  }

  loadConnectionSource(): AmazeeConnectionSource | undefined {
    return this.connectionSource;
  }
}
