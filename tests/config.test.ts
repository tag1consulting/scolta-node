/**
 * Config behaviour tests, ported from scolta-python tests/test_config.py
 * (which pins the from_dict/preset/coercion semantics of
 * Config/ScoltaConfig.php).
 */

import { describe, expect, it } from "vitest";
import { ScoltaConfig } from "../src/config.js";

describe("ScoltaConfig", () => {
  it("defaults", () => {
    const c = new ScoltaConfig();
    expect(c.ai_provider).toBe("anthropic");
    expect(c.indexer).toBe("auto");
    expect(c.expand_subword_max_frequency).toBe(0.05);
    expect(c.expansion_combine_mode).toBe("relevance_union");
    expect(c.expansion_per_term_top_k).toBe(3);
    expect(c.ai_languages).toEqual(["en"]);
  });

  it("preset applied before explicit values", () => {
    const c = ScoltaConfig.fromObject({ preset: "content_catalog" });
    expect(c.preset).toBe("content_catalog");
    expect(c.recency_strategy).toBe("none");
    expect(c.title_all_terms_multiplier).toBe(2.5);
    expect(c.expansion_combine_mode).toBe("round_robin");
    expect(c.results_per_page).toBe(12);
  });

  it("explicit value overrides preset", () => {
    const c = ScoltaConfig.fromObject({ preset: "content_catalog", results_per_page: 99 });
    expect(c.results_per_page).toBe(99);
    expect(c.expansion_combine_mode).toBe("round_robin");
  });

  it("null value falls through to default", () => {
    const c = ScoltaConfig.fromObject({ preset: "content_catalog", results_per_page: null });
    expect(c.results_per_page).toBe(12);
  });

  it("expansion_per_term_top_k is locked", () => {
    const c = ScoltaConfig.fromObject({ expansion_per_term_top_k: 99 });
    expect(c.expansion_per_term_top_k).toBe(3);
  });

  it("unknown keys ignored", () => {
    const c = ScoltaConfig.fromObject({ nonexistent_key: "x", site_name: "Foo" });
    expect(c.site_name).toBe("Foo");
    expect((c as unknown as Record<string, unknown>)["nonexistent_key"]).toBeUndefined();
  });

  it("string coercion to typed fields", () => {
    const c = ScoltaConfig.fromObject({
      results_per_page: "25",
      title_match_boost: "3.5",
      show_attribution: "1",
      ai_summarize: "0",
    });
    expect(c.results_per_page).toBe(25);
    expect(c.title_match_boost).toBe(3.5);
    expect(c.show_attribution).toBe(true);
    expect(c.ai_summarize).toBe(false);
  });

  it("bool coercion matches PHP semantics", () => {
    // PHP (bool): only "" and "0" are falsy; "false" casts to true.
    expect(ScoltaConfig.fromObject({ show_attribution: "false" }).show_attribution).toBe(true);
    expect(ScoltaConfig.fromObject({ show_attribution: "0" }).show_attribution).toBe(false);
    expect(ScoltaConfig.fromObject({ show_attribution: "" }).show_attribution).toBe(false);
  });

  it("combine_mode preset resolution", () => {
    const expected: Record<string, string> = {
      none: "relevance_union",
      reference: "relevance_union",
      content_catalog: "round_robin",
      ecommerce: "round_robin",
      blog: "round_robin",
    };
    for (const [preset, mode] of Object.entries(expected)) {
      expect(ScoltaConfig.fromObject({ preset }).expansion_combine_mode).toBe(mode);
    }
  });

  it("get_presets and values", () => {
    expect(new Set(Object.keys(ScoltaConfig.getPresets()))).toEqual(
      new Set(["none", "content_catalog", "reference", "ecommerce", "blog"]),
    );
    expect(ScoltaConfig.getPresetValues("content_catalog")["results_per_page"]).toBe(12);
    expect(ScoltaConfig.getPresetValues("unknown")).toEqual({});
  });

  it("to_js_scoring_config shape", () => {
    const js = new ScoltaConfig().toJsScoringConfig();
    expect(js["TITLE_MATCH_BOOST"]).toBe(2.0);
    expect(js["EXPANSION_PER_TERM_TOP_K"]).toBe(3);
    expect(js["LANGUAGE"]).toBe("en");
    expect(js["RECENCY_CURVE"]).toEqual([]);
  });

  it("to_browser_config endpoints and paths", () => {
    const c = ScoltaConfig.fromObject({ site_name: "My Site", pagefind_index_path: "/pf" });
    const b = c.toBrowserConfig();
    expect((b["endpoints"] as Record<string, string>)["expand"]).toBe("/api/scolta/v1/expand-query");
    expect(b["pagefindPath"]).toBe("/pf/pagefind.js");
    expect(b["siteName"]).toBe("My Site");
  });

  it("to_ai_client_config omits empty base_url", () => {
    const c = new ScoltaConfig();
    expect("base_url" in c.toAiClientConfig()).toBe(false);
    const c2 = ScoltaConfig.fromObject({ ai_base_url: "https://x/v1" });
    expect(c2.toAiClientConfig()["base_url"]).toBe("https://x/v1");
  });
});
