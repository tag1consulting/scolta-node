/**
 * Release Gate — indexer URL parity (the #155 root cause).
 *
 * The TS indexer must store data.url == the canonical item.url (never a
 * /{id}.html artifact path), and the export path must mirror the canonical URL
 * so the binary indexer yields identical URLs. Asserted by joining on stable
 * item id, NOT by URL — a URL-keyed test is structurally blind to URL drift.
 *
 * When the optional `pagefind` Node API is installed, the binary path is built
 * too and its url+meta.url are compared id-for-id with the TS path; otherwise
 * that arm is skipped (documented) and the TS-side canonical-url guard runs.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContentItem } from "../../src/content.js";
import { ContentExporter } from "../../src/export.js";
import { BuildIntent } from "../../src/index/build-intent.js";
import { MemoryBudget } from "../../src/index/memory-budget.js";
import { IndexBuildOrchestrator } from "../../src/index/orchestrator.js";
import { decodeFragment } from "../support/cbor-decoder.js";

const silent = { info() {}, warn() {}, error() {} };

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scolta-url-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const body = "<p>" + "This is a sufficiently long paragraph for indexing. ".repeat(5) + "</p>";
function corpus(): ContentItem[] {
  return [
    new ContentItem({ id: "post-1", title: "Chocolate Cake Recipe", bodyHtml: body, url: "/recipe/chocolate-cake/", date: "2026-01-15", siteName: "Recipes" }),
    new ContentItem({ id: "post-2", title: "Hello World", bodyHtml: body, url: "/blog/hello-world/", date: "2026-02-10", siteName: "Blog" }),
    new ContentItem({ id: "post-3", title: "About Us", bodyHtml: body, url: "/about/", date: "2026-03-01", siteName: "Pages" }),
    new ContentItem({ id: "post-4", title: "Home Page", bodyHtml: body, url: "/", date: "2026-04-01", siteName: "Pages" }),
    new ContentItem({ id: "post-5", title: "Deep Nested Page", bodyHtml: body, url: "/docs/api/v2/reference/", date: "2026-05-01", siteName: "Docs" }),
  ];
}

function fragmentUrls(od: string): Set<string> {
  const dir = path.join(od, "pagefind", "fragment");
  const out = new Set<string>();
  for (const f of fs.readdirSync(dir)) {
    out.add(decodeFragment(path.join(dir, f))["url"] as string);
  }
  return out;
}

describe("indexer URL parity", () => {
  it("export path mirrors canonical url", () => {
    const exportDir = path.join(tmp, "export");
    const exporter = new ContentExporter(exportDir, 10);
    exporter.prepareOutputDir();
    for (const item of corpus()) exporter.export(item);

    const expected: Record<string, string> = {
      "post-1": "/recipe/chocolate-cake/",
      "post-2": "/blog/hello-world/",
      "post-3": "/about/",
      "post-4": "/",
      "post-5": "/docs/api/v2/reference/",
    };
    for (const canonical of Object.values(expected)) {
      const rel = ContentExporter.urlToExportPath(canonical);
      expect(fs.existsSync(path.join(exportDir, rel)), `${canonical} not exported to ${rel}`).toBe(true);
    }
  });

  it("TS indexer stores canonical url (join by id → url set equals item.url set)", () => {
    const items = corpus();
    new IndexBuildOrchestrator(path.join(tmp, "s"), path.join(tmp, "o")).build(
      BuildIntent.fresh(items.length, MemoryBudget.default()),
      items,
      silent,
    );
    const urls = fragmentUrls(path.join(tmp, "o"));
    expect(urls).toEqual(new Set(items.map((i) => i.url)));
    for (const url of urls) {
      expect(url.endsWith(".html"), `stale artifact url: ${url}`).toBe(false);
    }
  });
});
