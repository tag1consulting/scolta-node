/**
 * Export content items as Pagefind-ready HTML files.
 *
 * Port of `Tag1\Scolta\Export\ContentExporter`. CMS-agnostic export logic:
 * output-dir preparation, HTML cleaning, Pagefind document generation, the
 * URL->file-path mapping that keeps the TS and binary indexers' `data.url`
 * identical, and the min-content-length filter used by the in-process indexer.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ContentItem } from "./content.js";
import * as html from "./html.js";

const MANIFEST_NAME = ".scolta-export-manifest.json";

export interface ExportStats {
  exported: number;
  skipped: number;
}

export class ContentExporter {
  readonly outputDir: string;
  readonly minContentLength: number;
  private exported = 0;
  private skipped = 0;
  private exportedPaths: Record<string, string> = {};

  constructor(outputDir: string, minContentLength = 50) {
    this.outputDir = outputDir;
    this.minContentLength = minContentLength;
  }

  /**
   * Map a canonical URL path to an export-relative file path.
   *
   *   /recipe/chocolate-cake/  -> recipe/chocolate-cake/index.html
   *   /recipe/chocolate-cake   -> recipe/chocolate-cake/index.html
   *   /about                   -> about/index.html
   *   /                        -> index.html
   */
  static urlToExportPath(url: string): string {
    // PHP strtok($url, '?#'): first token, skipping any leading delimiters.
    let p = url;
    for (const delim of ["?", "#"]) {
      const idx = p.indexOf(delim);
      if (idx !== -1) {
        p = p.slice(0, idx);
      }
    }
    p = p.replace(/^[?#]+/, "");
    if (p === "") {
      p = "/";
    }
    p = p.replace(/^\/+/, "");
    if (p === "") {
      return "index.html";
    }
    p = p.replace(/\/+$/, "");
    return p + "/index.html";
  }

  /** Remove all files in the output directory and ensure it exists. */
  prepareOutputDir(): void {
    if (fs.existsSync(this.outputDir) && fs.statSync(this.outputDir).isDirectory()) {
      for (const entry of fs.readdirSync(this.outputDir)) {
        fs.rmSync(path.join(this.outputDir, entry), { recursive: true, force: true });
      }
    }
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true, mode: 0o755 });
    }
    this.exportedPaths = {};
  }

  /** Export a single content item; return false if skipped (too short). */
  export(item: ContentItem): boolean {
    const cleanText = html.clean(item.bodyHtml, item.title);

    if (cleanText.length < this.minContentLength) {
      this.skipped += 1;
      return false;
    }

    const doc = html.build(
      item.id,
      item.title,
      cleanText,
      item.url,
      item.date,
      item.siteName,
      item.language,
      item.filters,
      item.metadata,
      item.sortable,
    );

    const relativePath = ContentExporter.urlToExportPath(item.url);

    if (relativePath in this.exportedPaths) {
      throw new Error(
        `Export path collision: items "${this.exportedPaths[relativePath]}" and "${item.id}" ` +
          `both map to "${relativePath}" (URL: "${item.url}")`,
      );
    }
    this.exportedPaths[relativePath] = item.id;

    const exportPath = path.join(this.outputDir, relativePath);
    fs.mkdirSync(path.dirname(exportPath), { recursive: true, mode: 0o755 });
    fs.writeFileSync(exportPath, doc, "utf-8");
    this.exported += 1;
    return true;
  }

  /** Filter items by minimum content length without writing to disk. */
  exportToItems(items: ContentItem[]): ContentItem[] {
    return items.filter((item) => html.clean(item.bodyHtml).length >= this.minContentLength);
  }

  /**
   * Lazily filter items by min content length. Non-ContentItem objects (e.g.
   * CachedContentReference cache-hit markers) pass through unchanged.
   */
  *filterItems(items: Iterable<unknown>): Generator<unknown> {
    for (const item of items) {
      if (!(item instanceof ContentItem)) {
        yield item;
        continue;
      }
      if (html.clean(item.bodyHtml).length >= this.minContentLength) {
        yield item;
      }
    }
  }

  /** Count .html files recursively. */
  static countHtmlFiles(directory: string): number {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      return 0;
    }
    let count = 0;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        count += ContentExporter.countHtmlFiles(full);
      } else if (entry.name.endsWith(".html")) {
        count += 1;
      }
    }
    return count;
  }

  deleteByUrl(url: string): boolean {
    const relativePath = ContentExporter.urlToExportPath(url);
    const fullPath = path.join(this.outputDir, relativePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      delete this.exportedPaths[relativePath];
      return true;
    }
    return false;
  }

  deleteById(id: string): boolean {
    const manifest = ContentExporter.readManifest(this.outputDir);
    if (id in manifest) {
      const fullPath = path.join(this.outputDir, manifest[id]!);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        return true;
      }
    }
    const flatPath = path.join(this.outputDir, id + ".html");
    if (fs.existsSync(flatPath)) {
      fs.unlinkSync(flatPath);
      return true;
    }
    return false;
  }

  writeManifest(): void {
    const manifest: Record<string, string> = {};
    for (const [p, itemId] of Object.entries(this.exportedPaths)) {
      manifest[itemId] = p;
    }
    const manifestPath = path.join(this.outputDir, MANIFEST_NAME);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4), "utf-8");
  }

  static readManifest(outputDir: string): Record<string, string> {
    const manifestPath = path.join(outputDir, MANIFEST_NAME);
    if (!fs.existsSync(manifestPath)) {
      return {};
    }
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch {
      return {};
    }
    return data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, string>)
      : {};
  }

  getStats(): ExportStats {
    return { exported: this.exported, skipped: this.skipped };
  }
}
