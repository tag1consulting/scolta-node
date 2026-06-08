/**
 * Prompt-text identity gate (ported from scolta-php
 * tests/Prompt/PromptTextIdentityTest.php).
 *
 * The three AI prompt templates exist as hand-maintained copies in
 * scolta-core/src/prompts.rs (the Rust/WASM source), scolta-php, scolta-python,
 * and here. This gate fails loudly if the TS copy drifts from the canonical
 * Rust base text, modulo two documented normalizations:
 *
 *  1. The `{DYNAMIC_ANCHORS}` line exists ONLY in the Rust copy (the WASM-path
 *     injection token); server-side bindings inject per-site context through the
 *     enricher/override mechanism instead. It is stripped from the Rust side
 *     before comparison.
 *  2. Language-specific string escaping. We compare the runtime template strings
 *     (getTemplate), which carry no source-level escaping, against the Rust
 *     raw-string bodies (which also have none).
 *
 * Path resolution: SCOLTA_CORE_PROMPTS env override, else the umbrella-checkout
 * sibling path. env set but file missing → FAIL; env unset and sibling missing →
 * SKIP (a published-package checkout legitimately has no scolta-core).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTemplate } from "../../src/ai/prompts.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const TEMPLATE_TO_CONST: Record<string, string> = {
  expand_query: "EXPAND_QUERY",
  summarize: "SUMMARIZE",
  follow_up: "FOLLOW_UP",
};

function corePromptsPath(): string {
  const override = process.env["SCOLTA_CORE_PROMPTS"];
  if (override) {
    return override;
  }
  // tests/ai/ -> tests/ -> scolta-node/ -> packages/ -> packages/scolta-core/...
  return path.join(here, "..", "..", "..", "scolta-core", "src", "prompts.rs");
}

/** Remove any line consisting solely of `{DYNAMIC_ANCHORS}` (and its newline). */
function stripDynamicAnchorsLine(text: string): string {
  return text.replace(/^\{DYNAMIC_ANCHORS\}\n/m, "");
}

/** Extract the verbatim body of a Rust raw-string constant from prompts.rs. */
function extractRustRawConst(source: string, constName: string): string {
  const declPos = source.indexOf(`pub const ${constName}:`);
  if (declPos === -1) {
    throw new Error(`Could not find \`pub const ${constName}:\` in scolta-core/src/prompts.rs`);
  }
  const eqPos = source.indexOf("=", declPos);
  if (eqPos === -1) {
    throw new Error(`Malformed const ${constName}: no \`=\` after declaration`);
  }
  const opener = /r(#+)"/.exec(source.slice(eqPos));
  if (!opener) {
    throw new Error(`Could not find raw-string opener for const ${constName}`);
  }
  const hashes = opener[1]!;
  const openEnd = eqPos + opener.index + opener[0].length;
  const closer = '"' + hashes;
  const closePos = source.indexOf(closer, openEnd);
  if (closePos === -1) {
    throw new Error(`Could not find raw-string closer \`${closer}\` for const ${constName}`);
  }
  return source.slice(openEnd, closePos);
}

const resolvedPath = corePromptsPath();
const fileExists = fs.existsSync(resolvedPath);
const explicit = Boolean(process.env["SCOLTA_CORE_PROMPTS"]);
const shouldSkip = !fileExists && !explicit;

describe("prompt-text identity vs scolta-core", () => {
  for (const [tsName, rustConst] of Object.entries(TEMPLATE_TO_CONST)) {
    it.skipIf(shouldSkip)(`${tsName} matches ${rustConst}`, () => {
      if (!fileExists) {
        // explicit env set but file missing → real misconfiguration, fail loudly.
        expect.fail(`SCOLTA_CORE_PROMPTS is set but no file exists at ${resolvedPath}`);
      }
      const source = fs.readFileSync(resolvedPath, "utf-8");
      const coreBase = stripDynamicAnchorsLine(extractRustRawConst(source, rustConst));
      const ts = getTemplate(tsName);
      expect(ts).toBe(coreBase);
    });
  }
});
