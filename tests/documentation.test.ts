/**
 * Config-reference drift guard (port of tests/Documentation/ConfigReferenceDocTest.php
 * and scolta-python tests/test_documentation.py).
 *
 * Asserts docs/CONFIG_REFERENCE.md never silently diverges from ScoltaConfig:
 * every scalar default and every preset's combine-mode documented there must
 * equal the live class. (ArchitectureAccuracyTest is N/A — it guards a
 * PHP-specific architecture doc.)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIELD_KINDS, ScoltaConfig } from "../src/config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DOC = fs.readFileSync(path.join(here, "..", "docs", "CONFIG_REFERENCE.md"), "utf-8");
const SCALAR_TYPES = new Set(["string", "int", "float", "bool"]);

function slice(start: string, end: string | null): string {
  const i = DOC.indexOf(start);
  return end ? DOC.slice(i, DOC.indexOf(end, i)) : DOC.slice(i);
}

interface Row {
  raw: string;
  scalar: boolean;
}

function parseProperties(): Record<string, Row> {
  const section = slice("## Configuration Properties", "## Presets");
  const rows: Record<string, Row> = {};
  for (const line of section.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.trim().split("|").map((c) => c.trim());
    if (cells.length < 5) continue;
    const m = /^`([a-z][a-z0-9_]*)`$/.exec(cells[1]!);
    if (!m || !(SCALAR_TYPES.has(cells[2]!) || cells[2] === "array")) continue;
    rows[m[1]!] = { raw: cells[3]!.replace(/`/g, ""), scalar: SCALAR_TYPES.has(cells[2]!) };
  }
  return rows;
}

function scalarFieldNames(): Set<string> {
  const out = new Set<string>();
  for (const [name, kind] of Object.entries(FIELD_KINDS)) {
    if (SCALAR_TYPES.has(kind) && name !== "preset") out.add(name);
  }
  return out;
}

function valuesMatch(live: unknown, tokenRaw: string): boolean {
  const token = tokenRaw.trim().replace(/^[`]+|[`]+$/g, "");
  if (typeof live === "boolean") return token === (live ? "true" : "false");
  if (typeof live === "number") {
    const n = Number(token);
    return !Number.isNaN(n) && Math.abs(n - live) < 1e-9;
  }
  if (live === "") return token === "(empty)";
  return live === token.replace(/^['"]|['"]$/g, "");
}

describe("CONFIG_REFERENCE.md drift guard", () => {
  it("parser finds enough rows", () => {
    expect(Object.keys(parseProperties()).length).toBeGreaterThanOrEqual(30);
  });

  it("documented defaults match live", () => {
    const cfg = new ScoltaConfig() as unknown as Record<string, unknown>;
    for (const [name, info] of Object.entries(parseProperties())) {
      if (!info.scalar) continue;
      expect(name in cfg, `documented \`${name}\` not on ScoltaConfig`).toBe(true);
      expect(
        valuesMatch(cfg[name], info.raw),
        `default drift for \`${name}\`: doc=\`${info.raw}\` vs live=\`${String(cfg[name])}\``,
      ).toBe(true);
    }
  });

  it("every scalar field is documented", () => {
    const documented = new Set(Object.keys(parseProperties()));
    for (const name of scalarFieldNames()) {
      expect(documented.has(name), `\`${name}\` is not documented in CONFIG_REFERENCE.md`).toBe(
        true,
      );
    }
  });

  it("required scalar fields present", () => {
    const documented = parseProperties();
    for (const name of [
      "title_match_boost",
      "recency_boost_max",
      "expand_primary_weight",
      "expand_subword_max_frequency",
      "max_pagefind_results",
      "results_per_page",
    ]) {
      expect(name in documented).toBe(true);
    }
  });

  it("presets documented and combine-mode resolves", () => {
    const section = slice("Available presets:", null);
    const expectedMode: Record<string, string> = {
      none: "relevance_union",
      reference: "relevance_union",
      content_catalog: "round_robin",
      ecommerce: "round_robin",
      blog: "round_robin",
    };
    const documented: Record<string, Record<string, string>> = {};
    for (const line of section.split("\n")) {
      if (!line.trim().startsWith("|")) continue;
      const cells = line.trim().split("|").map((c) => c.trim());
      const m = cells.length > 1 ? /^`([a-z_]+)`$/.exec(cells[1]!) : null;
      if (!m || !(m[1]! in ScoltaConfig.PRESETS)) continue;
      const pairs: Record<string, string> = {};
      for (const pm of line.matchAll(/`([a-z_]+): ([^`]+)`/g)) {
        pairs[pm[1]!] = pm[2]!;
      }
      documented[m[1]!] = pairs;
    }

    for (const name of Object.keys(ScoltaConfig.PRESETS)) {
      expect(name in documented, `preset \`${name}\` not documented`).toBe(true);
    }
    for (const [name, mode] of Object.entries(expectedMode)) {
      if (name === "none") continue; // 'none' has no row (it's the default)
      expect(documented[name]?.["expansion_combine_mode"]).toBe(mode);
      expect(ScoltaConfig.fromObject({ preset: name }).expansion_combine_mode).toBe(mode);
    }
  });
});
