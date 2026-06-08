/**
 * Prompt templates for Scolta AI features.
 *
 * Port of `Tag1\Scolta\Prompt\DefaultPrompts`. The canonical template text is
 * identical to scolta-core (Rust) and to scolta-php; the byte-faithful copies
 * live in `prompts.generated.ts`. Placeholders: {SITE_NAME}, {SITE_DESCRIPTION}.
 */

import { TEMPLATES } from "./prompts.generated.js";

export const EXPAND_QUERY = "expand_query";
export const SUMMARIZE = "summarize";
export const FOLLOW_UP = "follow_up";

/** Replace placeholders in a template (or a custom prompt string). */
export function resolve(template: string, siteName: string, siteDescription = "website"): string {
  const raw = TEMPLATES[template] ?? template;
  return raw.split("{SITE_NAME}").join(siteName).split("{SITE_DESCRIPTION}").join(siteDescription);
}

/** Return the raw template text (with placeholders) for a named prompt. */
export function getTemplate(name: string): string {
  const tmpl = TEMPLATES[name];
  if (tmpl === undefined) {
    throw new Error(`Unknown prompt template: ${name}`);
  }
  return tmpl;
}

export { TEMPLATES };
