/**
 * Platform-agnostic Scolta configuration.
 *
 * Port of `Tag1\Scolta\Config\ScoltaConfig`. Platform adapters map their native
 * config systems into this object. The JS frontend reads scoring parameters
 * from the same structure via `window.scolta.scoring`.
 *
 * Scoring defaults preserve the original algorithm exactly. Property names are
 * **snake_case** to match the wire contract: these keys cross to `scolta.js`,
 * and the PHP `fromArray` already accepted snake_case keys.
 */

export type PresetValues = Record<string, unknown>;

export interface PresetDefinition {
  label: string;
  description: string;
  values: PresetValues;
}

type FieldKind = "string" | "int" | "float" | "bool" | "list" | "dict";

/** Named scoring presets with labels and descriptions for adapter UIs. */
const PRESETS: Record<string, PresetDefinition> = {
  none: {
    label: "Start from Scratch",
    description:
      "No preset applied. All scoring parameters use Scolta defaults, except sub-word expansion is slightly broadened (10%) since an uncategorized corpus benefits from wider recall. This is your starting point for fully custom configuration — select this as your starting point — or leave it as-is. You can optionally adjust any individual setting below.",
    values: {
      expand_subword_max_frequency: 0.1,
      expansion_combine_mode: "relevance_union",
    },
  },
  content_catalog: {
    label: "Recipe & Content Catalog",
    description:
      'Best for recipe sites, wikis, and content collections with structured titles. Strongly prioritizes title matches — a recipe called "Chocolate Brownies" ranks high for that search — and shows more results per page for browsing. Newer and older content rank equally since catalog items stay relevant over time. Select this as your starting point — or leave it as-is. You can optionally adjust any individual setting below.',
    values: {
      recency_strategy: "none",
      recency_boost_max: 0.0,
      title_match_boost: 2.0,
      title_all_terms_multiplier: 2.5,
      exact_title_match_boost: 5.0,
      content_match_boost: 0.5,
      expand_primary_weight: 0.9,
      expand_subword_max_frequency: 0.1,
      expansion_combine_mode: "round_robin",
      ai_summary_top_n: 15,
      max_pagefind_results: 75,
      results_per_page: 12,
    },
  },
  reference: {
    label: "Documentation & Reference",
    description:
      'Best for knowledge bases, documentation, encyclopedias, and compliance references. Strongly favors exact title matches and understands domain synonyms (e.g., searching "GDPR" also finds "data protection regulation"). Newer and older content rank equally since reference material stays relevant over time. Select this as your starting point — or leave it as-is. You can optionally adjust any individual setting below.',
    values: {
      recency_strategy: "none",
      recency_boost_max: 0.0,
      title_match_boost: 2.0,
      title_all_terms_multiplier: 2.5,
      exact_title_match_boost: 5.0,
      content_match_boost: 0.5,
      expand_primary_weight: 0.6,
      expansion_combine_mode: "relevance_union",
      ai_summary_top_n: 15,
      max_pagefind_results: 75,
      results_per_page: 12,
      excerpt_length: 350,
    },
  },
  ecommerce: {
    label: "E-commerce & Product Store",
    description:
      'Best for online stores and product catalogs. People shop in their own words, not yours — so this preset reads product descriptions closely and interprets searches broadly. A search for "sparkly blue gift" finds lapis lazuli, not just items with those exact words. Newer and older products rank equally. Select this as your starting point — or leave it as-is. You can optionally adjust any individual setting below.',
    values: {
      recency_strategy: "none",
      title_match_boost: 1.5,
      title_all_terms_multiplier: 2.0,
      content_match_boost: 0.6,
      expand_primary_weight: 0.8,
      expansion_combine_mode: "round_robin",
      ai_summary_top_n: 12,
      max_pagefind_results: 75,
      results_per_page: 12,
      excerpt_length: 300,
    },
  },
  blog: {
    label: "Blog & Editorial",
    description:
      'Best for blogs, news sites, and editorial content. Gives a gentle boost to newer posts while keeping older content findable, and interprets searches broadly so readers searching by topic or feeling ("scary moment", "funny story") get good results. Select this as your starting point — or leave it as-is. You can optionally adjust any individual setting below.',
    values: {
      recency_strategy: "exponential",
      recency_boost_max: 0.25,
      recency_half_life_days: 365,
      title_match_boost: 1.5,
      title_all_terms_multiplier: 2.0,
      content_match_boost: 0.5,
      expand_primary_weight: 0.7,
      expansion_combine_mode: "round_robin",
      ai_summary_top_n: 12,
      max_pagefind_results: 60,
      results_per_page: 10,
      excerpt_length: 350,
    },
  },
};

/**
 * Per-field type kind, used by {@link ScoltaConfig.fromObject} for the same
 * typed coercion PHP performs on its typed properties. CMS config layers store
 * everything as strings; this restores the declared type.
 */
export const FIELD_KINDS: Record<string, FieldKind> = {
  ai_provider: "string",
  ai_api_key: "string",
  ai_model: "string",
  ai_expansion_model: "string",
  ai_base_url: "string",
  site_name: "string",
  site_description: "string",
  search_page_path: "string",
  pagefind_index_path: "string",
  cache_ttl: "int",
  max_follow_ups: "int",
  recency_boost_max: "float",
  recency_half_life_days: "int",
  recency_penalty_after_days: "int",
  recency_max_penalty: "float",
  title_match_boost: "float",
  title_all_terms_multiplier: "float",
  exact_title_match_boost: "float",
  content_match_boost: "float",
  phrase_adjacent_multiplier: "float",
  phrase_near_multiplier: "float",
  phrase_near_window: "int",
  phrase_window: "int",
  expand_primary_weight: "float",
  cross_list_bonus: "float",
  expand_subword_max_frequency: "float",
  expand_subword_deny_list: "list",
  expansion_combine_mode: "string",
  expansion_per_term_top_k: "int",
  language: "string",
  custom_stop_words: "list",
  recency_strategy: "string",
  recency_curve: "list",
  excerpt_length: "int",
  results_per_page: "int",
  max_pagefind_results: "int",
  show_attribution: "bool",
  ai_expand_query: "bool",
  ai_summarize: "bool",
  ai_summary_top_n: "int",
  ai_summary_max_chars: "int",
  ai_summary_max_tokens: "int",
  ai_languages: "list",
  auto_language_filter: "bool",
  prompt_expand_query: "string",
  prompt_summarize: "string",
  prompt_follow_up: "string",
  indexer: "string",
  sortable_fields: "list",
  sortable_field_descriptions: "dict",
  filter_fields: "list",
  filter_field_descriptions: "dict",
  preset: "string",
};

export class ScoltaConfig {
  // -- AI provider --
  ai_provider = "anthropic";
  ai_api_key = "";
  ai_model = "claude-sonnet-4-5-20250929";
  ai_expansion_model = "";
  ai_base_url = "";

  // -- Site identity --
  site_name = "";
  site_description = "website";
  search_page_path = "/search";
  pagefind_index_path = "/pagefind";

  // -- Caching --
  cache_ttl = 2592000; // 30 days in seconds

  // -- Rate limiting --
  max_follow_ups = 3;

  // -- Scoring: Recency --
  recency_boost_max = 0.25;
  recency_half_life_days = 365;
  recency_penalty_after_days = 1825;
  recency_max_penalty = 0.3;

  // -- Scoring: Title/Content match --
  title_match_boost = 2.0;
  title_all_terms_multiplier = 1.5;
  exact_title_match_boost = 5.0;
  content_match_boost = 0.4;

  // -- Scoring: Phrase proximity --
  phrase_adjacent_multiplier = 2.5;
  phrase_near_multiplier = 1.5;
  phrase_near_window = 5;
  phrase_window = 15;

  // -- Scoring: Expanded terms --
  expand_primary_weight = 0.5;
  cross_list_bonus = 0.05;
  expand_subword_max_frequency = 0.05;
  expand_subword_deny_list: string[] = [];
  expansion_combine_mode = "relevance_union";
  /** Locked at 3 — internal constant, never settable from config. */
  expansion_per_term_top_k = 3;

  // -- Scoring: Language and stop words --
  language = "en";
  custom_stop_words: string[] = [];

  // -- Scoring: Recency strategy --
  recency_strategy = "exponential"; // exponential|linear|step|none|custom
  recency_curve: unknown[] = [];

  // -- Display --
  excerpt_length = 300;
  results_per_page = 10;
  max_pagefind_results = 50;
  show_attribution = false;

  // -- AI feature toggles --
  ai_expand_query = true;
  ai_summarize = true;
  ai_summary_top_n = 10;
  ai_summary_max_chars = 4000;
  ai_summary_max_tokens = 1024;

  // -- Multilingual --
  ai_languages: string[] = ["en"];
  auto_language_filter = false;

  // -- Prompt overrides (empty = use DefaultPrompts) --
  prompt_expand_query = "";
  prompt_summarize = "";
  prompt_follow_up = "";

  // -- Indexer: 'auto' (TS indexer) | 'binary' --
  indexer = "auto";

  // -- Content --
  sortable_fields: string[] = [];
  sortable_field_descriptions: Record<string, string> = {};
  filter_fields: string[] = [];
  filter_field_descriptions: Record<string, string> = {};

  // -- Scoring preset --
  preset = "";

  static readonly PRESETS = PRESETS;

  /**
   * Create from a mapping (env, config file, CMS settings, etc.).
   *
   * If a `preset` key is present, the named preset's values are applied first;
   * any other keys override the preset. `null`/`undefined` means "not set" and
   * falls through to the preset/base default. `expansion_per_term_top_k` is
   * locked at 3 and never settable.
   */
  static fromObject(values: Record<string, unknown>): ScoltaConfig {
    const config = new ScoltaConfig();
    const valid = new Set(Object.keys(FIELD_KINDS));

    const preset = values["preset"];
    if (typeof preset === "string" && preset in PRESETS) {
      config.preset = preset;
      const presetValues = PRESETS[preset]!.values;
      for (const [key, value] of Object.entries(presetValues)) {
        if (valid.has(key)) {
          (config as unknown as Record<string, unknown>)[key] = value;
        }
      }
    }

    for (const [key, value] of Object.entries(values)) {
      if (key === "preset") continue;
      if (key === "expansion_per_term_top_k") continue;
      if (value === null || value === undefined) continue;
      if (!valid.has(key)) continue;
      (config as unknown as Record<string, unknown>)[key] = ScoltaConfig.coerce(key, value);
    }

    return config;
  }

  /**
   * Cast an incoming value to the declared field type, mirroring PHP's typed
   * property coercion — including PHP's (bool) cast semantics where only the
   * strings "" and "0" are falsy ("false"/"no" cast to true, as in PHP).
   */
  private static coerce(key: string, value: unknown): unknown {
    const kind = FIELD_KINDS[key];
    if (kind === "bool") {
      if (typeof value === "string") {
        return value !== "" && value !== "0";
      }
      return Boolean(value);
    }
    if (kind === "int") {
      return Math.trunc(Number(value));
    }
    if (kind === "float") {
      return Number(value);
    }
    return value;
  }

  static getPresets(): Record<string, PresetDefinition> {
    return PRESETS;
  }

  static getPresetValues(name: string): PresetValues {
    return PRESETS[name]?.values ?? {};
  }

  /** Export scoring parameters matching the JS CONFIG object. */
  toJsScoringConfig(): Record<string, unknown> {
    return {
      RECENCY_BOOST_MAX: this.recency_boost_max,
      RECENCY_HALF_LIFE_DAYS: this.recency_half_life_days,
      RECENCY_PENALTY_AFTER_DAYS: this.recency_penalty_after_days,
      RECENCY_MAX_PENALTY: this.recency_max_penalty,
      TITLE_MATCH_BOOST: this.title_match_boost,
      TITLE_ALL_TERMS_MULTIPLIER: this.title_all_terms_multiplier,
      EXACT_TITLE_MATCH_BOOST: this.exact_title_match_boost,
      CONTENT_MATCH_BOOST: this.content_match_boost,
      PHRASE_ADJACENT_MULTIPLIER: this.phrase_adjacent_multiplier,
      PHRASE_NEAR_MULTIPLIER: this.phrase_near_multiplier,
      PHRASE_NEAR_WINDOW: this.phrase_near_window,
      PHRASE_WINDOW: this.phrase_window,
      EXCERPT_LENGTH: this.excerpt_length,
      RESULTS_PER_PAGE: this.results_per_page,
      MAX_PAGEFIND_RESULTS: this.max_pagefind_results,
      AI_EXPAND_QUERY: this.ai_expand_query,
      AI_SUMMARIZE: this.ai_summarize,
      AI_SUMMARY_TOP_N: this.ai_summary_top_n,
      AI_SUMMARY_MAX_CHARS: this.ai_summary_max_chars,
      EXPAND_PRIMARY_WEIGHT: this.expand_primary_weight,
      CROSS_LIST_BONUS: this.cross_list_bonus,
      EXPAND_SUBWORD_MAX_FREQ: this.expand_subword_max_frequency,
      EXPAND_SUBWORD_DENYLIST: this.expand_subword_deny_list,
      EXPANSION_COMBINE_MODE: this.expansion_combine_mode,
      EXPANSION_PER_TERM_TOP_K: this.expansion_per_term_top_k,
      AI_MAX_FOLLOWUPS: this.max_follow_ups,
      AI_LANGUAGES: this.ai_languages,
      AUTO_LANGUAGE_FILTER: this.auto_language_filter,
      LANGUAGE: this.language,
      CUSTOM_STOP_WORDS: this.custom_stop_words,
      RECENCY_STRATEGY: this.recency_strategy,
      RECENCY_CURVE: this.recency_curve,
    };
  }

  /** Browser-side config for rendering `window.scolta`. */
  toBrowserConfig(): Record<string, unknown> {
    return {
      scoring: this.toJsScoringConfig(),
      endpoints: {
        expand: "/api/scolta/v1/expand-query",
        summarize: "/api/scolta/v1/summarize",
        followup: "/api/scolta/v1/followup",
      },
      wasmPath: "",
      siteName: this.site_name,
      pagefindPath: this.pagefind_index_path + "/pagefind.js",
      filterFieldDescriptions: this.filter_field_descriptions,
    };
  }

  /** AI client config object for constructing an AiClient. */
  toAiClientConfig(): Record<string, unknown> {
    const config: Record<string, unknown> = {
      provider: this.ai_provider,
      api_key: this.ai_api_key,
      model: this.ai_model,
    };
    if (this.ai_base_url) {
      config["base_url"] = this.ai_base_url;
    }
    return config;
  }
}
