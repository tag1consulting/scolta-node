/**
 * Static-output crawl shared by the JS framework adapters (Next/Nuxt/Astro).
 *
 * The crawl is framework-agnostic — it walks rendered HTML and does not care
 * which framework produced it. Previously duplicated file-for-file in each
 * adapter's `build.ts`; the adapters' convention is that shared logic lives in
 * `scolta`, so it lives here.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ContentItem } from "../content.js";

/** Map an output-relative HTML file path to the URL the framework serves it at. */
export function exportPathToUrl(relPath: string): string {
  const p = relPath.replace(/\\/g, "/");
  if (p === "index.html") return "/";
  if (p.endsWith("/index.html")) return "/" + p.slice(0, -"/index.html".length) + "/";
  if (p.endsWith(".html")) return "/" + p.slice(0, -".html".length);
  return "/" + p;
}

/** Crawl rendered HTML files under `dir` into ContentItems. */
export function crawlStaticHtml(dir: string): ContentItem[] {
  const items: ContentItem[] = [];
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".html")) continue;
      const html = fs.readFileSync(full, "utf-8");
      const rel = path.relative(dir, full);
      const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? rel;
      items.push(
        new ContentItem({ id: rel, title, bodyHtml: html, url: exportPathToUrl(rel), date: "" }),
      );
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return items;
}
