/**
 * Default AI-service wiring and EndpointResult → Response mapping, lifted
 * with the code from the adapter handler suites.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AmazeeAiService } from "../../src/ai/amazee-service.js";
import { AiServiceAdapter } from "../../src/ai/service.js";
import { defaultAiService, endpointResultToResponse } from "../../src/adapter/ai-service.js";
import { ScoltaConfig } from "../../src/config.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scolta-aisvc-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("defaultAiService", () => {
  it("provider amazee gets the auto-provisioning service", () => {
    const config = ScoltaConfig.fromObject({ ai_provider: "amazee" });
    expect(defaultAiService(config, tmp)).toBeInstanceOf(AmazeeAiService);
  });

  it("other providers get the plain adapter", () => {
    const config = ScoltaConfig.fromObject({ ai_provider: "anthropic", ai_api_key: "sk" });
    const service = defaultAiService(config, tmp);
    expect(service).toBeInstanceOf(AiServiceAdapter);
    expect(service).not.toBeInstanceOf(AmazeeAiService);
  });
});

describe("endpointResultToResponse", () => {
  it("success sends the raw data payload (no {ok,data} envelope)", async () => {
    // scolta.js reads `data.terms` straight off the body — the envelope-free
    // shape matches the Django/Laravel/Drupal controllers.
    const res = endpointResultToResponse({ ok: true, data: { terms: ["a", "b"] } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json["ok"]).toBeUndefined();
    expect(json["terms"]).toEqual(["a", "b"]);
  });

  it("success with no data sends an empty object", async () => {
    const res = endpointResultToResponse({ ok: true });
    expect(await res.json()).toEqual({});
  });

  it("failure sends {error} with the status and Retry-After", async () => {
    const res = endpointResultToResponse({
      ok: false,
      status: 429,
      error: "rate limited",
      retry_after: "30",
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(((await res.json()) as Record<string, unknown>)["error"]).toBe("rate limited");
  });

  it("failure defaults to 500 and a generic message", async () => {
    const res = endpointResultToResponse({ ok: false });
    expect(res.status).toBe(500);
    expect(((await res.json()) as Record<string, unknown>)["error"]).toBe("Error");
  });
});
