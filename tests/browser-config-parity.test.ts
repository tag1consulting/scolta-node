/**
 * Stay-in-sync guard between what the browser reads and what this package emits
 * (port of scolta-php tests/Config/BrowserConfigParityTest.php).
 *
 * assets/js/scolta.js is the vendored canonical browser bundle, byte-identical
 * to scolta-php's copy. Every config value it consumes is read off the instance
 * config object that toBrowserConfig() produces, so the two are a contract: a
 * key the bundle reads but no config layer emits is a feature that is dead on
 * arrival, and a key this package emits but the bundle never reads is dead
 * weight. Eight scoring keys shipped readable-but-unsettable here for exactly
 * that reason: nothing asserted the emitted config covered what the browser
 * reads.
 *
 * This test parses the bundle for the keys it reads and diffs them against
 * toBrowserConfig(), in both directions, recursing one level into the `scoring`
 * and `endpoints` sub-objects (a top-level-only check passes while a scoring
 * sub-key is missing, which is how those eight hid).
 *
 * Two deliberate design choices, shared with the other four implementations:
 *
 * - **Comments are NOT stripped before matching.** Naively cutting `//` to end
 *   of line would corrupt every line containing a URL such as `https://` and
 *   could silently drop a real key. Today exactly one comment names a config key
 *   (`instanceConfig.currentLanguage`) and that key is real, so comment noise
 *   produces zero phantoms. If a future comment does introduce a phantom, this
 *   test fails loudly and the maintainer either emits the key or adds it to an
 *   allowlist with a written justification. Loud and occasionally wrong beats
 *   silent and blind.
 * - **The reverse assertion uses strict set membership, not a substring search
 *   of the bundle.** A substring search over 3,300 lines matches almost any
 *   plausible camelCase name and would make the assertion worthless.
 *
 * The parse is deliberately strict: the tripwire assertions run BEFORE any diff,
 * so a reformat of scolta.js that stops the extraction matching fails loudly
 * instead of passing while asserting nothing.
 *
 * Note this package has no Jest rig and no JS test of the vendored bundle, by
 * deliberate policy: the browser behaviour itself is covered upstream in
 * scolta-php. This test reads the bundle as text only.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ScoltaConfig } from "../src/config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = fs.readFileSync(path.join(here, "..", "assets", "js", "scolta.js"), "utf-8");

/**
 * Keys scolta.js reads that toBrowserConfig() deliberately does not emit.
 * Subtracts from the extracted set, so it may only ever contain keys the bundle
 * actually reads.
 */
const FORWARD_ALLOWLIST = [
  // Supplied by the platform's language layer, not by the config object.
  "currentLanguage",
  // Has no config property. Adapters pass an empty array; a direct caller
  // supplies it through createInstance().
  "allowedLinkDomains",
  // Same as allowedLinkDomains: caller-supplied, no config property.
  "disclaimer",
  // Emitted by no adapter at all; caller-supplied through the createInstance()
  // public API only. Note the snake_case name, unlike every other top-level key.
  "priority_pages",
];

/**
 * Keys toBrowserConfig() emits that scolta.js does not read off the instance
 * config. Subtracts from the emitted set, so it may only ever contain keys this
 * package actually emits. Empty here: scolta-node emits nothing the browser does
 * not read.
 */
const REVERSE_ALLOWLIST: string[] = [];

function distinct(re: RegExp): string[] {
  return [...new Set([...BUNDLE.matchAll(re)].map((m) => m[1]!))];
}

/** Distinct top-level keys read as `instanceConfig.<key>`. */
function extractTopLevelKeys(): string[] {
  const keys = distinct(/instanceConfig\.([A-Za-z_][A-Za-z0-9_]*)/g);
  expect(
    keys.length,
    "Parsed too few top-level config reads from assets/js/scolta.js — the bundle may have " +
      "been reformatted so `instanceConfig.<key>` no longer matches. Update the parser in " +
      "tests/browser-config-parity.test.ts so the guard keeps working.",
  ).toBeGreaterThanOrEqual(11);
  return keys;
}

/**
 * Distinct scoring keys read as `KEY: s.KEY ??` in the config return literals.
 *
 * The regex matches two return literals, the module-level getConfig() block and
 * the getInstanceConfig() block, and their union is the full set only because
 * the former's keys are a strict subset of the latter's. That holds today; if it
 * ever stops holding, the tripwire count below moves and whoever hits it reads
 * this note.
 *
 * Parsing the literals rather than grepping consumption sites is deliberate:
 * several keys are forwarded to WASM wholesale and never named at a use site, so
 * a consumption-site grep would silently miss them.
 */
function extractScoringKeys(): string[] {
  const keys = distinct(/^[ \t]*([A-Z][A-Z0-9_]*):[ \t]*s\.\1[ \t]*\?\?/gm);
  expect(
    keys.length,
    "Parsed too few scoring keys from assets/js/scolta.js — the getInstanceConfig() return " +
      "literal may have been reformatted so `KEY: s.KEY ??` no longer matches. Update the " +
      "parser in tests/browser-config-parity.test.ts so the guard keeps working.",
  ).toBeGreaterThanOrEqual(40);
  return keys;
}

/** Distinct endpoint keys read as `key: e.key ||`. */
function extractEndpointKeys(): string[] {
  const keys = distinct(/^[ \t]*([a-z]+):[ \t]*e\.\1[ \t]*\|\|/gm);
  expect(
    keys.length,
    "Expected exactly 3 endpoint keys in assets/js/scolta.js (expand, summarize, followup). " +
      "Either an endpoint was added or the bundle was reformatted so `key: e.key ||` no " +
      "longer matches. Update the parser in tests/browser-config-parity.test.ts so the guard " +
      "keeps working.",
  ).toBe(3);
  return keys;
}

describe("browser config parity", () => {
  it("emits every top-level key scolta.js reads", () => {
    const read = extractTopLevelKeys();
    const emitted = Object.keys(new ScoltaConfig().toBrowserConfig());

    for (const key of read) {
      if (FORWARD_ALLOWLIST.includes(key)) continue;
      expect(
        emitted,
        `scolta.js reads instanceConfig.${key} but toBrowserConfig() does not emit it, so the ` +
          "feature behind it is unreachable. Either emit the key or add it to " +
          "FORWARD_ALLOWLIST in tests/browser-config-parity.test.ts with a written justification.",
      ).toContain(key);
    }
  });

  it("emits every scoring key scolta.js reads", () => {
    const read = extractScoringKeys();
    const browserConfig = new ScoltaConfig().toBrowserConfig();
    const emitted = Object.keys(browserConfig["scoring"] as Record<string, unknown>);

    for (const key of read) {
      expect(
        emitted,
        `scolta.js reads scoring key ${key} but toJsScoringConfig() does not emit it, so it ` +
          "can only ever take its hardcoded JS fallback. Add a config field and a FIELD_KINDS " +
          "entry for it.",
      ).toContain(key);
    }
  });

  it("emits every endpoint key scolta.js reads", () => {
    const read = extractEndpointKeys();
    const browserConfig = new ScoltaConfig().toBrowserConfig();
    const emitted = Object.keys(browserConfig["endpoints"] as Record<string, unknown>);

    for (const key of read) {
      expect(
        emitted,
        `scolta.js reads endpoint ${key} but toBrowserConfig() does not emit it in endpoints.`,
      ).toContain(key);
    }
  });

  // Separate from the forward assertions so it can be allowlisted independently.
  it("emits no top-level key the browser never reads", () => {
    const read = extractTopLevelKeys();
    const emitted = Object.keys(new ScoltaConfig().toBrowserConfig());

    for (const key of emitted) {
      if (REVERSE_ALLOWLIST.includes(key)) continue;
      expect(
        read,
        `toBrowserConfig() emits ${key} but scolta.js never reads it off the instance config, ` +
          "so it is dead weight in every page payload. Either drop it or add it to " +
          "REVERSE_ALLOWLIST in tests/browser-config-parity.test.ts with a written justification.",
      ).toContain(key);
    }
  });
});
