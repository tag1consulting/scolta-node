/** Ported from tests/Util/MarkdownRendererTest.php (1:1). */

import { describe, expect, it } from "vitest";
import { renderMarkdown as render } from "../src/markdown.js";

describe("renderMarkdown", () => {
  it("empty string returns empty", () => {
    expect(render("")).toBe("");
  });

  it("plain text wrapped in paragraph", () => {
    expect(render("Hello world")).toBe("<p>Hello world</p>");
  });

  it("bold renders as strong", () => {
    expect(render("This is **bold** text")).toBe("<p>This is <strong>bold</strong> text</p>");
  });

  it("multiple bold in same line", () => {
    expect(render("**first** and **second**")).toBe(
      "<p><strong>first</strong> and <strong>second</strong></p>",
    );
  });

  it("link renders as anchor", () => {
    expect(render("Visit [Example](https://example.com) now")).toBe(
      '<p>Visit <a href="https://example.com" target="_blank" rel="noopener">Example</a> now</p>',
    );
  });

  it("bullet list renders as ul", () => {
    expect(render("- First item\n- Second item\n- Third item")).toBe(
      "<ul><li>First item</li><li>Second item</li><li>Third item</li></ul>",
    );
  });

  it("mixed paragraphs and list", () => {
    expect(
      render("Introduction paragraph\n\n- Item one\n- Item two\n\nConclusion paragraph"),
    ).toBe(
      "<p>Introduction paragraph</p><ul><li>Item one</li><li>Item two</li></ul><p>Conclusion paragraph</p>",
    );
  });

  it("bold inside list item", () => {
    expect(render("- A **bold** item\n- A normal item")).toBe(
      "<ul><li>A <strong>bold</strong> item</li><li>A normal item</li></ul>",
    );
  });

  it("link inside list item", () => {
    expect(render("- See [docs](https://docs.example.com) for details")).toBe(
      '<ul><li>See <a href="https://docs.example.com" target="_blank" rel="noopener">docs</a> for details</li></ul>',
    );
  });

  it("xss script tag is escaped", () => {
    const out = render('<script>alert("xss")</script>');
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("xss in bold is escaped", () => {
    const out = render("**<img src=x onerror=alert(1)>**");
    expect(out).not.toContain("<img");
    expect(out).toContain("<strong>");
  });

  it("xss in link text is escaped", () => {
    const out = render("[<script>evil</script>](https://example.com)");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("html entities in plain text are escaped", () => {
    const out = render('Use the <div> element & "quotes"');
    expect(out).toContain("&lt;div&gt;");
    expect(out).toContain("&amp;");
    expect(out).toContain("&quot;quotes&quot;");
  });

  it("multiple paragraphs separated by blank lines", () => {
    expect(render("First paragraph\n\nSecond paragraph\n\nThird paragraph")).toBe(
      "<p>First paragraph</p><p>Second paragraph</p><p>Third paragraph</p>",
    );
  });

  it("list closed at end of input", () => {
    expect(render("- Item one\n- Item two")).toBe("<ul><li>Item one</li><li>Item two</li></ul>");
  });

  it("whitespace-only lines act as blank lines", () => {
    expect(render("Paragraph one\n   \nParagraph two")).toBe(
      "<p>Paragraph one</p><p>Paragraph two</p>",
    );
  });

  it("italic renders as em", () => {
    expect(render("This is *italic* text")).toBe("<p>This is <em>italic</em> text</p>");
  });

  it("multiple italic in same line", () => {
    expect(render("*first* and *second*")).toBe("<p><em>first</em> and <em>second</em></p>");
  });

  it("italic inside list item", () => {
    expect(render("- An *italic* item\n- A normal item")).toBe(
      "<ul><li>An <em>italic</em> item</li><li>A normal item</li></ul>",
    );
  });

  it("mixed bold and italic", () => {
    expect(render("**bold** and *italic* text")).toBe(
      "<p><strong>bold</strong> and <em>italic</em> text</p>",
    );
  });

  it("bold italic renders as both", () => {
    expect(render("This is ***bold italic*** text")).toBe(
      "<p>This is <strong><em>bold italic</em></strong> text</p>",
    );
  });

  it("plain text without markdown unchanged", () => {
    expect(render("No formatting here")).toBe("<p>No formatting here</p>");
  });

  it("xss in italic is escaped", () => {
    const out = render("*<img src=x onerror=alert(1)>*");
    expect(out).not.toContain("<img");
    expect(out).toContain("<em>");
  });

  it("truncated link no closing paren becomes bold", () => {
    const out = render("Try [Chocolate Cake](https://example.com/recipe");
    expect(out).toContain("<strong>Chocolate Cake</strong>");
    expect(out).not.toContain("<a ");
  });

  it("orphan bracket becomes bold", () => {
    const out = render("See the [recipe guide] for details");
    expect(out).toContain("<strong>recipe guide</strong>");
    expect(out).not.toContain("<a ");
  });

  it("valid link still renders as anchor after cleanup", () => {
    const out = render("[Example](https://example.com)");
    expect(out).toContain('<a href="https://example.com"');
    expect(out).not.toContain("<strong>Example</strong>");
  });

  it("mixed valid and broken links on same line", () => {
    const out = render("See [Good Link](https://example.com) and also [Broken](https://cut");
    expect(out).toContain('<a href="https://example.com"');
    expect(out).toContain("<strong>Broken</strong>");
  });

  it("orphan bracket in list item", () => {
    const out = render("- Try [the recipe] today");
    expect(out).toContain("<li>");
    expect(out).toContain("<strong>the recipe</strong>");
  });
});
