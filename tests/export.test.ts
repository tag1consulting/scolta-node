/** Tests for ContentExporter (ported from Export/ContentExporter.php behaviour). */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContentItem } from "../src/content.js";
import { ContentExporter } from "../src/export.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scolta-export-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function item(overrides: Partial<ConstructorParameters<typeof ContentItem>[0]> = {}): ContentItem {
  return new ContentItem({
    id: "1",
    title: "T",
    bodyHtml: "<p>" + "word ".repeat(40) + "</p>",
    url: "/recipe/x",
    date: "2024-01-01",
    ...overrides,
  });
}

describe("urlToExportPath", () => {
  it.each([
    ["/recipe/chocolate-cake/", "recipe/chocolate-cake/index.html"],
    ["/recipe/chocolate-cake", "recipe/chocolate-cake/index.html"],
    ["/about", "about/index.html"],
    ["/", "index.html"],
    ["", "index.html"],
    ["/p?q=1", "p/index.html"],
    ["/p#frag", "p/index.html"],
    ["/a/b/c/", "a/b/c/index.html"],
  ])("%s -> %s", (url, expected) => {
    expect(ContentExporter.urlToExportPath(url)).toBe(expected);
  });
});

describe("ContentExporter", () => {
  it("export writes nested file", () => {
    const exp = new ContentExporter(tmp);
    exp.prepareOutputDir();
    expect(exp.export(item({ url: "/recipe/cake" }))).toBe(true);
    const written = path.join(tmp, "recipe", "cake", "index.html");
    expect(fs.existsSync(written)).toBe(true);
    expect(fs.readFileSync(written, "utf-8")).toContain("data-pagefind-body");
    expect(exp.getStats()).toEqual({ exported: 1, skipped: 0 });
  });

  it("export skips short content", () => {
    const exp = new ContentExporter(tmp, 50);
    exp.prepareOutputDir();
    expect(exp.export(item({ bodyHtml: "<p>tiny</p>" }))).toBe(false);
    expect(exp.getStats()).toEqual({ exported: 0, skipped: 1 });
  });

  it("export path collision raises", () => {
    const exp = new ContentExporter(tmp);
    exp.prepareOutputDir();
    exp.export(item({ id: "1", url: "/recipe/x" }));
    expect(() => exp.export(item({ id: "2", url: "/recipe/x" }))).toThrow(/collision/);
  });

  it("filterItems passes through non-content items", () => {
    const exp = new ContentExporter(tmp);
    const marker = {};
    const items = [item({ id: "1" }), marker, item({ id: "2", bodyHtml: "<p>too short</p>" })];
    const out = [...exp.filterItems(items)];
    expect((out[0] as ContentItem).id).toBe("1");
    expect(out).toContain(marker);
    expect(out.every((i) => (i as ContentItem).id !== "2")).toBe(true);
  });

  it("countHtmlFiles", () => {
    const exp = new ContentExporter(tmp);
    exp.prepareOutputDir();
    exp.export(item({ id: "1", url: "/a" }));
    exp.export(item({ id: "2", url: "/b" }));
    expect(ContentExporter.countHtmlFiles(tmp)).toBe(2);
  });

  it("manifest round trip and delete", () => {
    const exp = new ContentExporter(tmp);
    exp.prepareOutputDir();
    exp.export(item({ id: "42", url: "/recipe/cake" }));
    exp.writeManifest();
    const manifest = ContentExporter.readManifest(tmp);
    expect(manifest["42"]).toBe("recipe/cake/index.html");
    expect(exp.deleteById("42")).toBe(true);
    expect(fs.existsSync(path.join(tmp, "recipe", "cake", "index.html"))).toBe(false);
  });

  it("delete by url", () => {
    const exp = new ContentExporter(tmp);
    exp.prepareOutputDir();
    exp.export(item({ url: "/recipe/cake" }));
    expect(exp.deleteByUrl("/recipe/cake")).toBe(true);
    expect(exp.deleteByUrl("/recipe/cake")).toBe(false);
  });

  it("prepareOutputDir clears existing", () => {
    const d = path.join(tmp, "out");
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, "stale.html"), "old");
    const exp = new ContentExporter(d);
    exp.prepareOutputDir();
    expect(fs.existsSync(path.join(d, "stale.html"))).toBe(false);
    expect(fs.statSync(d).isDirectory()).toBe(true);
  });
});
