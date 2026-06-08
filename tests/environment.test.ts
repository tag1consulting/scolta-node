/** Hosting environment detection (ported from Environment/*). */

import { describe, expect, it } from "vitest";
import { HostingDetector, HostingEnvironment } from "../src/environment.js";

describe("HostingDetector", () => {
  it("detects standard by default", () => {
    expect(HostingDetector.detect({})).toBe(HostingEnvironment.STANDARD);
  });

  it("detects managed/serverless hosts from env vars", () => {
    expect(HostingDetector.detect({ WPE_APIKEY: "x" })).toBe(HostingEnvironment.WP_ENGINE);
    expect(HostingDetector.detect({ KINSTA_CACHE_ZONE: "x" })).toBe(HostingEnvironment.KINSTA);
    expect(HostingDetector.detect({ PANTHEON_ENVIRONMENT: "live" })).toBe(HostingEnvironment.PANTHEON);
    expect(HostingDetector.detect({ AH_SITE_ENVIRONMENT: "prod" })).toBe(HostingEnvironment.ACQUIA);
    expect(HostingDetector.detect({ VERCEL: "1" })).toBe(HostingEnvironment.VERCEL);
    expect(HostingDetector.detect({ NETLIFY: "true" })).toBe(HostingEnvironment.NETLIFY);
    expect(HostingDetector.detect({ AWS_LAMBDA_FUNCTION_NAME: "fn" })).toBe(HostingEnvironment.AWS_LAMBDA);
  });

  it("serverless hosts report ephemeral filesystem", () => {
    const c = HostingDetector.constraints({ VERCEL: "1" });
    expect(c.ephemeralFilesystem).toBe(true);
    expect(c.note).toContain("ephemeral");
  });

  it("restricted-exec hosts disable native binaries", () => {
    expect(HostingDetector.constraints({ WPE_APIKEY: "x" }).execAvailable).toBe(false);
  });

  it("describe is human-readable", () => {
    expect(HostingDetector.describe({})).toBe("Standard hosting");
    expect(HostingDetector.describe({ VERCEL: "1" })).toContain("Vercel");
  });
});
