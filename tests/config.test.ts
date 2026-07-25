/**
 * Config behaviour tests, ported from scolta-python tests/test_config.py
 * (which pins the from_dict/preset/coercion semantics of
 * Config/ScoltaConfig.php).
 */

import { describe, expect, it, vi } from "vitest";
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

  it("non-numeric float value keeps the base default and re-warns on each load", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const c = ScoltaConfig.fromObject({ title_match_boost: "high" });
      expect(c.title_match_boost).toBe(2.0);
      expect(c.toJsScoringConfig()["TITLE_MATCH_BOOST"]).toBe(2.0);
      // Within a single load, the bad field warns exactly once.
      expect(warn).toHaveBeenCalledTimes(1);
      // A second, independent load is a fresh dedupe scope: the warning fires
      // again rather than being silenced for the lifetime of the process.
      // (Before the per-load reset this stayed at 1 — permanently suppressed.)
      ScoltaConfig.fromObject({ title_match_boost: "high" });
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("non-numeric int value keeps the preset value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const c = ScoltaConfig.fromObject({ preset: "blog", results_per_page: "lots" });
      expect(c.results_per_page).toBe(10); // blog preset survives the junk override
    } finally {
      warn.mockRestore();
    }
  });

  it("numeric strings still coerce", () => {
    const c = ScoltaConfig.fromObject({ title_match_boost: "2.5", results_per_page: "12.9" });
    expect(c.title_match_boost).toBe(2.5);
    expect(c.results_per_page).toBe(12);
  });

  it("hide_empty_facets defaults to true", () => {
    expect(new ScoltaConfig().hide_empty_facets).toBe(true);
  });

  it("hide_empty_facets opt-out maps from a boolean", () => {
    expect(ScoltaConfig.fromObject({ hide_empty_facets: false }).hide_empty_facets).toBe(false);
  });

  it("hide_empty_facets opt-out maps from the string '0' (PHP falsy semantics)", () => {
    expect(ScoltaConfig.fromObject({ hide_empty_facets: "0" }).hide_empty_facets).toBe(false);
    expect(ScoltaConfig.fromObject({ hide_empty_facets: "" }).hide_empty_facets).toBe(false);
    // Only "" and "0" are falsy, matching PHP.
    expect(ScoltaConfig.fromObject({ hide_empty_facets: "false" }).hide_empty_facets).toBe(true);
  });

  it("hide_empty_facets stays true when the key is absent", () => {
    expect(ScoltaConfig.fromObject({ site_name: "x" }).hide_empty_facets).toBe(true);
  });

  it("to_browser_config carries hideEmptyFacets top-level, not under scoring", () => {
    const b = new ScoltaConfig().toBrowserConfig();
    expect(b["hideEmptyFacets"]).toBe(true);
    expect("hideEmptyFacets" in (b["scoring"] as Record<string, unknown>)).toBe(false);
  });

  it("to_browser_config carries the hideEmptyFacets opt-out through as false", () => {
    const b = ScoltaConfig.fromObject({ hide_empty_facets: false }).toBrowserConfig();
    expect(b["hideEmptyFacets"]).toBe(false);
  });

  it("specificity and filter-hint scoring defaults match the scolta.js fallbacks", () => {
    const js = new ScoltaConfig().toJsScoringConfig();
    expect(js["SPECIFICITY_WEIGHTING"]).toBe(true);
    expect(js["SPECIFICITY_FLOOR"]).toBe(0.15);
    expect(js["SPECIFICITY_STRONG_MATCH"]).toBe(0.55);
    expect(js["SPECIFICITY_COOCCURRENCE"]).toBe(0.9);
    expect(js["SPECIFICITY_AGREEMENT_GATE"]).toBe(0.45);
    expect(js["SPECIFICITY_AGREEMENT_DECAY"]).toBe(1.0);
    expect(js["FILTER_HINT_MIN_RESULTS"]).toBe(5);
    expect(js["FILTER_HINT_MIN_RATIO"]).toBe(0.1);
  });

  it("specificity and filter-hint keys map from snake_case input", () => {
    const js = ScoltaConfig.fromObject({
      specificity_weighting: false,
      specificity_floor: 0.05,
      specificity_strong_match: 0.7,
      specificity_cooccurrence: 1.4,
      specificity_agreement_gate: 0.3,
      specificity_agreement_decay: 0.65,
      filter_hint_min_results: 12,
      filter_hint_min_ratio: 0.25,
    }).toJsScoringConfig();
    expect(js["SPECIFICITY_WEIGHTING"]).toBe(false);
    expect(js["SPECIFICITY_FLOOR"]).toBe(0.05);
    expect(js["SPECIFICITY_STRONG_MATCH"]).toBe(0.7);
    expect(js["SPECIFICITY_COOCCURRENCE"]).toBe(1.4);
    expect(js["SPECIFICITY_AGREEMENT_GATE"]).toBe(0.3);
    expect(js["SPECIFICITY_AGREEMENT_DECAY"]).toBe(0.65);
    expect(js["FILTER_HINT_MIN_RESULTS"]).toBe(12);
    expect(js["FILTER_HINT_MIN_RATIO"]).toBe(0.25);
  });

  it("specificity_cooccurrence accepts 0 to restore the maximum-only merge", () => {
    expect(ScoltaConfig.fromObject({ specificity_cooccurrence: 0 }).specificity_cooccurrence).toBe(0);
  });

  it("specificity and filter-hint keys coerce from strings", () => {
    const c = ScoltaConfig.fromObject({
      specificity_weighting: "0",
      specificity_cooccurrence: "0.75",
      specificity_agreement_gate: "0.5",
      specificity_agreement_decay: "0.8",
      filter_hint_min_results: "12.9",
      filter_hint_min_ratio: "0.25",
    });
    expect(c.specificity_weighting).toBe(false);
    expect(c.specificity_cooccurrence).toBe(0.75);
    expect(c.specificity_agreement_gate).toBe(0.5);
    expect(c.specificity_agreement_decay).toBe(0.8);
    // int kind truncates, like the other int fields.
    expect(c.filter_hint_min_results).toBe(12);
    expect(c.filter_hint_min_ratio).toBe(0.25);
  });
});
