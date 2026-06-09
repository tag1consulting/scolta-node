/**
 * HTTP client for the Amazee.ai control plane.
 *
 * Port of `scolta.ai.amazee.client.AmazeeClient` (httpx → the global `fetch`,
 * matching the style of {@link AiClient}). Provisions free trials, lists
 * regions, creates private keys, and reads the LiteLLM model catalogue.
 */

import type { FetchLike } from "../client.js";
import { AmazeeApiException } from "./exceptions.js";
import { ProvisioningResult, UpgradeResult } from "./results.js";

export const DEFAULT_BASE_URL = "https://api.amazee.ai";
const TIMEOUT_SECONDS = 15;

interface JsonObject {
  [key: string]: unknown;
}

export class AmazeeClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(baseUrl: string = DEFAULT_BASE_URL, fetchImpl?: FetchLike) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl ?? fetch;
  }

  async provisionTrial(email = ""): Promise<ProvisioningResult> {
    const body = await this.post("/auth/generate-trial-access", { email });
    const creds = (body["key"] && typeof body["key"] === "object" ? body["key"] : body) as JsonObject;
    const token = creds["litellm_token"];
    const apiUrl = creds["litellm_api_url"];
    const region = typeof creds["region"] === "string" ? (creds["region"] as string) : "default";
    if (typeof token !== "string" || token === "" || typeof apiUrl !== "string" || apiUrl === "") {
      throw new AmazeeApiException(
        "Amazee.ai trial provisioning response missing litellm_token or litellm_api_url.",
      );
    }
    return ProvisioningResult.makeSuccess(token, apiUrl, region);
  }

  async requestVerificationCode(email: string): Promise<void> {
    await this.post("/auth/validate-email", { email });
  }

  async signIn(email: string, code: string): Promise<string> {
    const body = await this.post("/auth/sign-in", { email, code });
    const tokenField = body["token"];
    let sessionToken: unknown;
    if (tokenField && typeof tokenField === "object") {
      sessionToken = (tokenField as JsonObject)["access_token"];
    } else {
      sessionToken = tokenField !== undefined ? tokenField : body["access_token"];
    }
    if (typeof sessionToken !== "string" || sessionToken === "") {
      throw new AmazeeApiException("Amazee.ai sign-in response missing session token.");
    }
    return sessionToken;
  }

  async listRegions(sessionToken: string): Promise<unknown[]> {
    const body = await this.get("/regions", sessionToken);
    if (Array.isArray(body)) {
      return body;
    }
    const regions = body["regions"];
    return Array.isArray(regions) ? regions : [];
  }

  async createPrivateKey(sessionToken: string, regionId: string): Promise<UpgradeResult> {
    const body = await this.post("/private-ai-keys", { region_id: regionId }, sessionToken);
    const token = body["litellm_token"];
    const apiUrl = body["litellm_api_url"];
    const region = typeof body["region"] === "string" ? (body["region"] as string) : regionId;
    if (typeof token !== "string" || token === "" || typeof apiUrl !== "string" || apiUrl === "") {
      throw new AmazeeApiException(
        "Amazee.ai private key creation response missing litellm_token or litellm_api_url.",
      );
    }
    return UpgradeResult.makeSuccess(token, apiUrl, region);
  }

  async getAvailableModels(litellmApiUrl: string, litellmToken: string): Promise<unknown[]> {
    const url = litellmApiUrl.replace(/\/+$/, "") + "/model/info";
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${litellmToken}`, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_SECONDS * 1000),
      });
      if (!response.ok) {
        return [];
      }
      const body = (await response.json()) as JsonObject;
      const data = body["data"];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async validateToken(litellmToken: string, litellmApiUrl: string): Promise<void> {
    const url = litellmApiUrl.replace(/\/+$/, "") + "/auth/me";
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${litellmToken}`, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_SECONDS * 1000),
      });
    } catch (exc) {
      throw new AmazeeApiException(`Amazee.ai token validation request failed: ${String(exc)}`);
    }
    if (!response.ok) {
      throw new AmazeeApiException(
        `Amazee.ai token validation failed with HTTP ${response.status}.`,
        response.status,
      );
    }
  }

  // -- internal -------------------------------------------------------------

  private async post(path: string, payload: unknown, bearer?: string): Promise<JsonObject> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (bearer !== undefined) {
      headers["Authorization"] = `Bearer ${bearer}`;
    }
    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl + path, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_SECONDS * 1000),
      });
    } catch (exc) {
      throw new AmazeeApiException(`Amazee.ai API request to ${path} failed: ${String(exc)}`);
    }
    return AmazeeClient.decode(path, response);
  }

  private async get(path: string, bearer?: string): Promise<JsonObject> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (bearer !== undefined) {
      headers["Authorization"] = `Bearer ${bearer}`;
    }
    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl + path, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(TIMEOUT_SECONDS * 1000),
      });
    } catch (exc) {
      throw new AmazeeApiException(`Amazee.ai API request to ${path} failed: ${String(exc)}`);
    }
    return AmazeeClient.decode(path, response);
  }

  private static async decode(path: string, response: Response): Promise<JsonObject> {
    const status = response.status;
    const text = await response.text();
    if (!response.ok) {
      let message = `Amazee.ai API returned HTTP ${status} for ${path}.`;
      try {
        const data = JSON.parse(text) as JsonObject;
        if (data && typeof data === "object" && data["detail"]) {
          message += " " + String(data["detail"]);
        } else if (data && typeof data === "object" && data["message"]) {
          message += " " + String(data["message"]);
        }
      } catch {
        // body was not JSON — keep the status-only message
      }
      throw new AmazeeApiException(message, status);
    }
    if (text === "") {
      return {};
    }
    try {
      return (JSON.parse(text) as JsonObject) ?? {};
    } catch (exc) {
      throw new AmazeeApiException(
        `Amazee.ai API returned malformed JSON from ${path}: ${String(exc)}`,
        status,
      );
    }
  }
}
