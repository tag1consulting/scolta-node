/** Ported from tests/Html/HtmlCleanerTest.php and PagefindHtmlBuilderTest.php (1:1). */

import { describe, expect, it } from "vitest";
import { build, clean } from "../src/html.js";

// -- HtmlCleaner ------------------------------------------------------------

describe("clean", () => {
  it("basic html", () => {
    expect(clean("<p>Hello <strong>world</strong></p>")).toBe("Hello world");
  });

  it("removes script", () => {
    const r = clean('<p>Content</p><script>alert("xss")</script><p>More</p>');
    expect(r).toContain("Content");
    expect(r).toContain("More");
    expect(r).not.toContain("alert");
    expect(r).not.toContain("script");
  });

  it("removes multiline script", () => {
    const html = '<p>Before</p>\n<script type="text/javascript">\n  var x = 1;\n  console.log(x);\n</script>\n<p>After</p>';
    const r = clean(html);
    expect(r).toContain("Before");
    expect(r).toContain("After");
    expect(r).not.toContain("console");
    expect(r).not.toContain("var x");
  });

  it("removes multiline style", () => {
    const html = "<p>Before</p>\n<style>\n  body { color: red; }\n  h1 { font-size: 2em; }\n</style>\n<p>After</p>";
    const r = clean(html);
    expect(r).toContain("Before");
    expect(r).toContain("After");
    expect(r).not.toContain("color");
    expect(r).not.toContain("font-size");
  });

  it("removes html comments", () => {
    const r = clean("<p>Visible</p><!-- This is a comment --><p>Also visible</p>");
    expect(r).toContain("Visible");
    expect(r).toContain("Also visible");
    expect(r).not.toContain("comment");
    expect(r).not.toContain("<!--");
  });

  it("extract main content", () => {
    const html =
      "<nav>Navigation</nav>" +
      '<div id="main-content"><p>Important content here</p></div>' +
      "<footer>Footer stuff</footer>";
    const r = clean(html);
    expect(r).toContain("Important content");
    expect(r).not.toContain("Navigation");
    expect(r).not.toContain("Footer stuff");
  });

  it("main content case insensitive", () => {
    const html =
      "<div>Outside</div>" + '<DIV ID="main-content"><p>Inside main</p></DIV>' + "<div>Also outside</div>";
    const r = clean(html);
    expect(r).toContain("Inside main");
    expect(r).not.toContain("Outside");
  });

  it("removes footer by class", () => {
    const r = clean('<p>Content</p><div class="site-footer"><p>Footer content</p></div>');
    expect(r).toContain("Content");
    expect(r).not.toContain("Footer content");
  });

  it("removes footer by id", () => {
    const r = clean('<p>Content</p><div id="page-footer"><p>Footer content</p></div>');
    expect(r).toContain("Content");
    expect(r).not.toContain("Footer content");
  });

  it("handles malformed html", () => {
    const r = clean("<p>Unclosed paragraph<div>Mixed <b>nesting</div></b>");
    expect(typeof r).toBe("string");
    expect(r).toContain("Unclosed paragraph");
  });

  it("empty input", () => {
    expect(clean("")).toBe("");
  });

  it("removes nav", () => {
    const html = "<nav><ul><li>Home</li><li>About</li></ul></nav><main><p>Page content here</p></main>";
    const r = clean(html);
    expect(r).toContain("Page content");
    expect(r).not.toContain("Home");
    expect(r).not.toContain("About");
  });
});

// -- PagefindHtmlBuilder ----------------------------------------------------

describe("build", () => {
  it("basic", () => {
    const html = build("doc-1", "Test Title", "Body text here", "https://example.com/page", "2024-06-15", "My Site");
    expect(html).toContain("data-pagefind-body");
    expect(html).toContain('id="doc-1"');
    expect(html).toContain("<title>Test Title</title>");
    expect(html).toContain("<h1>Test Title</h1>");
    expect(html).toContain('data-pagefind-filter="site:My Site"');
    expect(html).toContain('data-pagefind-meta="date:2024-06-15"');
    expect(html).toContain('data-pagefind-meta="url:https://example.com/page"');
    expect(html).toContain("Body text here");
  });

  it("escapes content", () => {
    const html = build(
      "doc-2",
      "Tom & Jerry's <Adventure>",
      'Content with "quotes" & <tags>',
      "https://example.com/page?a=1&b=2",
      "2024-01-01",
      'Site "One"',
    );
    expect(html).toContain("Tom &amp; Jerry&apos;s &lt;Adventure&gt;");
    expect(html).toContain("Content with &quot;quotes&quot; &amp; &lt;tags&gt;");
    expect(html).toContain("url:https://example.com/page?a=1&amp;b=2");
    expect(html).toContain("site:Site &quot;One&quot;");
  });

  it("omits empty site", () => {
    const html = build("doc-3", "No Site", "Body content", "https://example.com", "2024-01-01", "");
    expect(html).not.toContain('data-pagefind-filter="site:');
    expect(html).toContain('data-pagefind-filter="language:en"');
  });

  it("default language is english", () => {
    const html = build("doc-4", "English", "Body", "https://example.com");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('data-pagefind-filter="language:en"');
  });

  it("language attribute + escaped", () => {
    expect(build("doc-5", "x", "b", "https://e.com/es", "2024-06-15", "Mi Sitio", "es")).toContain(
      '<html lang="es">',
    );
    expect(build("doc-6", "Test", "Body", "https://example.com", "", "", "zh-Hant")).toContain(
      'data-pagefind-filter="language:zh-Hant"',
    );
  });

  it("extra filters emitted + escaped", () => {
    const html = build("doc-7", "T", "B", "https://e.com", "", "", "en", {
      base_topic: "Cardiology",
      region: "Europe",
    });
    expect(html).toContain('data-pagefind-filter="base_topic:Cardiology"');
    expect(html).toContain('data-pagefind-filter="region:Europe"');
    const esc = build("doc-8", "T", "B", "https://e.com", "", "", "en", { category: "Rock & Roll <genre>" });
    expect(esc).toContain('data-pagefind-filter="category:Rock &amp; Roll &lt;genre&gt;"');
  });

  it("multi-value filter emits one span per value", () => {
    const html = build("doc-m", "T", "B", "https://e.com", "", "", "en", { topics: ["Science", "History"] });
    expect(html).toContain('data-pagefind-filter="topics:Science"');
    expect(html).toContain('data-pagefind-filter="topics:History"');
  });

  it("empty filters produces only the language span", () => {
    const html = build("doc-9", "T", "B", "https://e.com");
    expect((html.match(/data-pagefind-filter=/g) ?? []).length).toBe(1);
  });

  it("metadata emitted + escaped", () => {
    const html = build("doc-10", "T", "B", "https://e.com", "", "", "en", {}, { price: "29.99", rating: "4.5" });
    expect(html).toContain('data-pagefind-meta="price:29.99"');
    expect(html).toContain('data-pagefind-meta="rating:4.5"');
    const esc = build("doc-11", "T", "B", "https://e.com", "", "", "en", {}, { note: "Tom & Jerry <b>" });
    expect(esc).toContain('data-pagefind-meta="note:Tom &amp; Jerry &lt;b&gt;"');
  });

  it("empty metadata produces only url + date meta", () => {
    const html = build("doc-12", "T", "B", "https://e.com", "2024-01-01");
    expect((html.match(/data-pagefind-meta=/g) ?? []).length).toBe(2);
  });

  it("sortable emitted + escaped", () => {
    const html = build("doc-13", "T", "B", "https://e.com", "", "", "en", {}, {}, { price: "29.99", rating: "4.5" });
    expect(html).toContain('data-pagefind-sort="price:29.99"');
    expect(html).toContain('data-pagefind-sort="rating:4.5"');
    const esc = build("doc-14", "T", "B", "https://e.com", "", "", "en", {}, {}, { field: "a & b" });
    expect(esc).toContain('data-pagefind-sort="field:a &amp; b"');
  });

  it("empty sortable produces no sort attributes", () => {
    expect(build("doc-15", "T", "B", "https://e.com")).not.toContain("data-pagefind-sort=");
  });

  it("auto-includes date as sortable; explicit takes precedence", () => {
    expect(build("doc-17", "T", "B", "https://e.com", "2026-05-15")).toContain(
      'data-pagefind-sort="date:2026-05-15"',
    );
    const explicit = build("doc-18", "T", "B", "https://e.com", "2026-05-15", "", "en", {}, {}, {
      date: "2026-01-01",
    });
    expect(explicit).toContain('data-pagefind-sort="date:2026-01-01"');
    expect(explicit).not.toContain('data-pagefind-sort="date:2026-05-15"');
    expect(build("doc-19", "T", "B", "https://e.com", "")).not.toContain('data-pagefind-sort="date:"');
  });
});
