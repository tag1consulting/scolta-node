/**
 * `window.scolta` bootstrap tests (Release Gate family 4: the emitted config
 * must reflect the SAVED values), lifted with the code from the adapter
 * suites.
 */

import { describe, expect, it } from "vitest";
import { buildWindowScolta } from "../../src/adapter/bootstrap.js";

describe("buildWindowScolta", () => {
  it("passes browser config through and sets the default container", () => {
    const out = buildWindowScolta({ siteName: "My Site", scoring: { RESULTS_PER_PAGE: 12 } });
    expect(out["siteName"]).toBe("My Site");
    expect((out["scoring"] as Record<string, unknown>)["RESULTS_PER_PAGE"]).toBe(12);
    expect(out["container"]).toBe("#scolta-search");
  });

  it("derives wasmPath as the full glue-module path from assetsPath", () => {
    const out = buildWindowScolta({}, { assetsPath: "/scolta/" });
    expect(out["wasmPath"]).toBe("/scolta/wasm/scolta_core.js");
  });

  it("never clobbers an explicit wasmPath", () => {
    const out = buildWindowScolta({ wasmPath: "/custom/scolta_core.js" }, { assetsPath: "/scolta" });
    expect(out["wasmPath"]).toBe("/custom/scolta_core.js");
  });

  it("honours containerId and pagefindPath overrides", () => {
    const out = buildWindowScolta(
      { pagefindPath: "/pf/pagefind.js" },
      { containerId: "my-search", pagefindPath: "/other/pagefind.js" },
    );
    expect(out["container"]).toBe("#my-search");
    expect(out["pagefindPath"]).toBe("/other/pagefind.js");
  });
});
