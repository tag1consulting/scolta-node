/**
 * Pagefind binary path via the official Node API (port of `PagefindBinary`,
 * adapted for JS).
 *
 * Unlike the PHP/Python CLI-resolver chain, the JS binary path uses the
 * `pagefind` npm package's programmatic API (`createIndex` / `addCustomRecord`
 * / `writeFiles`), loaded via dynamic `import()` so installing `scolta` never
 * forces the 7 platform binaries on users of the default TS indexer. The
 * package spawns its platform-native binary as a service process internally —
 * that's its concern, not ours.
 *
 * This is the opt-in path (`indexer: binary`). The TS in-process indexer is the
 * default and needs none of this.
 */

import * as path from "node:path";
import { ContentItem } from "../content.js";
import * as html from "../html.js";

export interface PagefindStatus {
  available: boolean;
  version: string | null;
  via: string;
  message: string;
}

/** The slice of the `pagefind` Node API this binding drives. */
interface PagefindIndex {
  addCustomRecord(record: {
    url: string;
    content: string;
    language: string;
    meta: Record<string, string>;
    filters: Record<string, string[]>;
  }): Promise<unknown>;
  writeFiles(opts: { outputPath: string }): Promise<unknown>;
  deleteIndex?(): Promise<unknown>;
}

interface PagefindModule {
  createIndex(): Promise<{ index: PagefindIndex }>;
  close?(): Promise<unknown>;
}

/** Lazily load the optional `pagefind` peer dependency. */
async function loadPagefind(): Promise<PagefindModule | null> {
  try {
    // Indirect import so bundlers don't hard-require the optional peer dep.
    const mod: unknown = await import("pagefind");
    if (
      mod === null ||
      typeof mod !== "object" ||
      typeof (mod as { createIndex?: unknown }).createIndex !== "function"
    ) {
      return null;
    }
    return mod as PagefindModule;
  } catch {
    return null;
  }
}

export class PagefindNodeApi {
  /** Probe availability by loading the package and creating a throwaway index. */
  async isAvailable(): Promise<boolean> {
    const mod = await loadPagefind();
    if (mod === null) {
      return false;
    }
    try {
      const { index } = await mod.createIndex();
      // A missing platform binary surfaces here, not at import time.
      if (typeof mod.close === "function") {
        await mod.close();
      } else if (index && typeof index.deleteIndex === "function") {
        await index.deleteIndex();
      }
      return true;
    } catch {
      return false;
    }
  }

  async status(): Promise<PagefindStatus> {
    const available = await this.isAvailable();
    if (available) {
      return {
        available: true,
        version: null,
        via: "node-api",
        message: "Pagefind Node API available (npm `pagefind`).",
      };
    }
    return {
      available: false,
      version: null,
      via: "none",
      message:
        "Pagefind Node API not available. Install the optional peer dependency: npm install pagefind",
    };
  }

  /**
   * Build a Pagefind index from content items using the Node API. Uses
   * addCustomRecord with an explicit `url` so the emitted `data.url` /
   * `data.meta.url` match the TS indexer exactly (the #155 URL-parity contract).
   * Writes into `{outputDir}/pagefind`.
   */
  async buildIndex(items: ContentItem[], outputDir: string): Promise<{ pageCount: number }> {
    const mod = await loadPagefind();
    if (mod === null) {
      throw new Error("Pagefind Node API not available.");
    }
    const { index } = await mod.createIndex();
    let pageCount = 0;
    for (const item of items) {
      const cleanText = html.clean(item.bodyHtml, item.title);
      if (cleanText.length < 10) continue;
      const meta: Record<string, string> = { title: item.title, url: item.url };
      if (item.date) meta["date"] = item.date;
      for (const [k, v] of Object.entries(item.metadata)) meta[k] = v;
      const filters: Record<string, string[]> = {};
      if (item.language) filters["language"] = [item.language];
      if (item.siteName) filters["site"] = [item.siteName];
      for (const [k, v] of Object.entries(item.filters)) {
        filters[k] = Array.isArray(v) ? v : [v];
      }
      await index.addCustomRecord({
        url: item.url,
        content: cleanText,
        language: item.language || "en",
        meta,
        filters,
      });
      pageCount += 1;
    }
    await index.writeFiles({ outputPath: path.join(outputDir, "pagefind") });
    if (typeof mod.close === "function") {
      await mod.close();
    }
    return { pageCount };
  }
}
