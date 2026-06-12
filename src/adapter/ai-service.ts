/**
 * Default AI-service construction and the EndpointResult → Web `Response`
 * mapping shared by the JS framework adapters' HTTP handlers. Previously
 * duplicated in each adapter's handler module.
 */

import { AiServiceAdapter } from "../ai/service.js";
import { AmazeeAiService } from "../ai/amazee-service.js";
import { FilesystemConfigStorage } from "../ai/amazee/storage.js";
import type { AiServiceLike, EndpointResult } from "../ai/endpoint.js";
import type { ScoltaConfig } from "../config.js";

/**
 * Default AI service: when the resolved provider is `amazee`, use the
 * auto-provisioning {@link AmazeeAiService} (free LiteLLM trial on first use,
 * no key required) backed by a filesystem credential store under the state
 * dir. Otherwise the plain {@link AiServiceAdapter} (explicit key /
 * framework AI).
 */
export function defaultAiService(config: ScoltaConfig, stateDir: string): AiServiceLike {
  if (config.ai_provider === "amazee") {
    return new AmazeeAiService(config, new FilesystemConfigStorage(stateDir));
  }
  return new AiServiceAdapter(config);
}

/**
 * Map an {@link EndpointResult} onto a Web `Response`.
 *
 * scolta.js reads the payload fields (terms/summary/response) directly off
 * the response body, so success responses send the raw `data` (not an
 * {ok,data} envelope) and failures send {error} — mirroring the
 * Django/Laravel/Drupal controllers' response mapping exactly.
 */
export function endpointResultToResponse(result: EndpointResult): Response {
  if (result.ok) {
    return Response.json(result.data ?? {});
  }
  const headers: Record<string, string> = {};
  if (result.retry_after) headers["Retry-After"] = result.retry_after;
  return Response.json(
    { error: result.error ?? "Error" },
    { status: result.status ?? 500, headers },
  );
}
