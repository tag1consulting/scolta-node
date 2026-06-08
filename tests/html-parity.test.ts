/**
 * Parity Gate #1 — HTML cleaning + Pagefind-document building.
 *
 * Asserts the TS html.ts reproduces, byte-for-byte, the output of the real PHP
 * HtmlCleaner / PagefindHtmlBuilder. The golden file
 * (tests/fixtures/html_parity.json) was generated from scolta-php's actual
 * classes via parity/html_harness.php and committed (shared with scolta-python),
 * so this runs PHP-free.
 *
 * Covers the 20 recipe fixtures (the Phase 3 gate corpus), plus edge-case units
 * (malformed HTML, nbsp, entities, nested main-content, leading-title strip,
 * region-footer, diacritics) and 14 builder cases.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build, clean } from "../src/html.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const golden = JSON.parse(fs.readFileSync(path.join(fixtures, "html_parity.json"), "utf-8")) as {
  cleaner_fixtures: Record<string, { title: string; clean_no_title: string; clean_with_title: string }>;
  cleaner_units: Record<string, { input: string; title: string; expected: string }>;
  builder_cases: Array<{ params: Record<string, any>; expected: string }>;
};

describe("HTML cleaner — recipe fixture parity", () => {
  for (const name of Object.keys(golden.cleaner_fixtures).sort()) {
    it(name, () => {
      const raw = fs.readFileSync(path.join(fixtures, "recipes", name), "utf-8");
      const c = golden.cleaner_fixtures[name]!;
      expect(clean(raw)).toBe(c.clean_no_title);
      expect(clean(raw, c.title)).toBe(c.clean_with_title);
    });
  }
});

describe("HTML cleaner — edge-case unit parity", () => {
  for (const key of Object.keys(golden.cleaner_units).sort()) {
    it(key, () => {
      const c = golden.cleaner_units[key]!;
      expect(clean(c.input, c.title)).toBe(c.expected);
    });
  }
});

describe("Pagefind HTML builder parity", () => {
  golden.builder_cases.forEach((c, i) => {
    it(`builder case ${i}`, () => {
      const p = c.params;
      const result = build(
        p["id"],
        p["title"],
        p["body"],
        p["url"],
        p["date"],
        p["siteName"],
        p["language"],
        p["filters"],
        p["metadata"],
        p["sortable"],
      );
      expect(result).toBe(c.expected);
    });
  });
});
