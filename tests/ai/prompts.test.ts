/** Tests for prompt template resolution (DefaultPrompts port). */

import { describe, expect, it } from "vitest";
import * as prompts from "../../src/ai/prompts.js";

describe("prompts", () => {
  it("resolve substitutes placeholders", () => {
    const r = prompts.resolve(prompts.EXPAND_QUERY, "Acme", "tech blog");
    expect(r).toContain("Acme");
    expect(r).toContain("tech blog");
    expect(r).not.toContain("{SITE_NAME}");
    expect(r).not.toContain("{SITE_DESCRIPTION}");
  });

  it("resolve default site description", () => {
    const r = prompts.resolve(prompts.FOLLOW_UP, "Acme");
    expect(r).toContain("Acme");
    expect(r).not.toContain("{SITE_DESCRIPTION}");
  });

  it("resolve custom template passthrough", () => {
    const r = prompts.resolve("Hello {SITE_NAME}", "Acme");
    expect(r).toBe("Hello Acme");
  });

  it("get_template returns raw with placeholders", () => {
    const t = prompts.getTemplate(prompts.SUMMARIZE);
    expect(t).toContain("{SITE_NAME}");
  });

  it("get_template unknown raises", () => {
    expect(() => prompts.getTemplate("nope")).toThrow(/Unknown prompt template/);
  });

  it("template constants", () => {
    expect(prompts.EXPAND_QUERY).toBe("expand_query");
    expect(prompts.SUMMARIZE).toBe("summarize");
    expect(prompts.FOLLOW_UP).toBe("follow_up");
  });

  it("expand_query forbids fabricating unverified entities", () => {
    const template = prompts.getTemplate(prompts.EXPAND_QUERY);
    expect(template).toContain("UNRECOGNIZED OR UNVERIFIABLE NAMED ENTITIES");
    expect(template).toContain("do NOT manufacture");
  });
});
