/**
 * Health checks and setup diagnostics (port of `Health\HealthChecker` and
 * `SetupCheck`), adapted to TS.
 *
 * Diagnostics: TS indexer ready, assets present, config valid, AI reachable;
 * the Pagefind Node API is only required when indexer == 'binary'.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import type { ScoltaConfig } from "./config.js";
import { PagefindNodeApi, type PagefindStatus } from "./index/pagefind.js";

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets");
const STALE_URL = /^\/[a-zA-Z0-9_-]+\.html$/;

export interface HealthReport {
  status: "ok" | "degraded";
  aiProvider: string;
  aiConfigured: boolean;
  pagefindAvailable: boolean;
  wasmAvailable: boolean;
  indexExists: boolean;
  indexerActive: "ts" | "binary";
  indexerUpgradeAvailable: boolean;
  indexerUpgradeMessage: string | null;
  staleArtifactUrls: boolean;
  staleArtifactMessage: string | null;
  pagefind: { available: boolean; version: string | null; resolvedVia: string };
}

export class HealthChecker {
  constructor(
    private readonly config: ScoltaConfig,
    private readonly indexOutputDir: string,
    private readonly binary: { status(): Promise<PagefindStatus> } = new PagefindNodeApi(),
  ) {}

  async check(): Promise<HealthReport> {
    const binaryStatus = await this.binary.status();

    const indexExists =
      fs.existsSync(path.join(this.indexOutputDir, "pagefind", "pagefind.js")) ||
      fs.existsSync(path.join(this.indexOutputDir, "pagefind.js"));
    const aiConfigured = this.config.ai_api_key.trim() !== "";

    let status: "ok" | "degraded" = "ok";
    if (!indexExists || !aiConfigured) status = "degraded";

    const configuredIndexer = this.config.indexer || "auto";
    const indexerActive: "ts" | "binary" =
      configuredIndexer === "binary" && binaryStatus.available ? "binary" : "ts";
    const upgradeMessage =
      configuredIndexer === "binary" && !binaryStatus.available
        ? 'Pagefind Node API not found. Set indexer to "auto" or install Pagefind: npm install pagefind'
        : null;

    const stale = this.detectStaleArtifactUrls();
    if (stale) status = "degraded";

    return {
      status,
      aiProvider: this.config.ai_provider || "anthropic",
      aiConfigured,
      pagefindAvailable: binaryStatus.available,
      wasmAvailable: false,
      indexExists,
      indexerActive,
      indexerUpgradeAvailable: configuredIndexer === "binary" && !binaryStatus.available,
      indexerUpgradeMessage: upgradeMessage,
      staleArtifactUrls: stale,
      staleArtifactMessage: stale
        ? "Index contains /{id}.html URLs from a pre-1.1.0 binary build. Run a full rebuild to fix."
        : null,
      pagefind: {
        available: binaryStatus.available,
        version: binaryStatus.version,
        resolvedVia: binaryStatus.via,
      },
    };
  }

  private detectStaleArtifactUrls(): boolean {
    const base = this.indexOutputDir;
    const indexDir = fs.existsSync(path.join(base, "pagefind", "pagefind-entry.json"))
      ? path.join(base, "pagefind")
      : base;
    let fragmentDir = path.join(indexDir, "fragment");
    if (!fs.existsSync(fragmentDir) || !fs.statSync(fragmentDir).isDirectory()) {
      fragmentDir = indexDir;
    }
    let fragments: string[];
    try {
      fragments = fs.readdirSync(fragmentDir).filter((f) => f.endsWith(".pf_fragment"));
    } catch {
      return false;
    }
    for (const f of fragments.slice(0, 5)) {
      let data: Buffer;
      try {
        data = gunzipSync(fs.readFileSync(path.join(fragmentDir, f)));
      } catch {
        continue;
      }
      if (data.subarray(0, 12).toString("latin1") === "pagefind_dcd") data = data.subarray(12);
      try {
        const j = JSON.parse(data.toString("utf-8"));
        if (j && typeof j === "object" && typeof j.url === "string" && STALE_URL.test(j.url)) {
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }
}

export interface SetupCheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  category: string;
}

export class SetupCheck {
  static async run(opts: {
    aiApiKey?: string | null;
    browserWasmDir?: string | null;
    binary?: { status(): Promise<PagefindStatus> };
  } = {}): Promise<SetupCheckResult[]> {
    const results: SetupCheckResult[] = [];

    const major = parseInt(process.versions.node.split(".")[0]!, 10);
    const nodeOk = major >= 20;
    results.push({
      name: "Node version",
      status: nodeOk ? "pass" : "fail",
      message: nodeOk ? `Node ${process.versions.node}` : `Node ${process.versions.node} — requires 20+`,
      category: "runtime",
    });

    const hasKey = Boolean(opts.aiApiKey);
    results.push({
      name: "AI API key",
      status: hasKey ? "pass" : "warn",
      message: hasKey ? "AI API key configured" : "AI API key not set — AI features disabled",
      category: "runtime",
    });

    const wasmDir = opts.browserWasmDir ? opts.browserWasmDir : path.join(ASSETS, "wasm");
    const wasmPresent =
      fs.existsSync(path.join(wasmDir, "scolta_core_bg.wasm")) &&
      fs.existsSync(path.join(wasmDir, "scolta_core.js"));
    results.push({
      name: "Browser WASM",
      status: wasmPresent ? "pass" : "warn",
      message: wasmPresent ? "Browser WASM assets found" : "Browser WASM assets missing",
      category: "runtime",
    });

    const binaryStatus = await (opts.binary ?? new PagefindNodeApi()).status();
    results.push({
      name: "Pagefind Node API",
      status: binaryStatus.available ? "pass" : "warn",
      message: binaryStatus.available ? binaryStatus.message : "Pagefind not found — TS indexer will be used",
      category: "build",
    });

    return results;
  }

  static checkIntlSegmenter(): { level: "ok" | "warning"; message: string } {
    // Node >= 20 ships full ICU, so Intl.Segmenter is always present — the
    // tokenizer parity path. Verify rather than assume.
    if (typeof Intl !== "undefined" && typeof (Intl as any).Segmenter === "function") {
      return { level: "ok", message: "Intl.Segmenter available (full ICU)" };
    }
    return {
      level: "warning",
      message: "Intl.Segmenter unavailable — tokenizer parity may degrade (rebuild Node with full ICU)",
    };
  }

  static checkOutputDirectoryWritable(outputDir: string): { level: "ok" | "error"; message: string } {
    try {
      if (fs.existsSync(outputDir) && fs.statSync(outputDir).isDirectory()) {
        fs.accessSync(outputDir, fs.constants.W_OK);
        return { level: "ok", message: `Output directory writable: ${outputDir}` };
      }
    } catch {
      /* fall through */
    }
    const parent = path.dirname(outputDir.replace(/\/+$/, "")) || ".";
    try {
      fs.accessSync(parent, fs.constants.W_OK);
      return { level: "ok", message: `Output directory will be created in: ${parent}` };
    } catch {
      return { level: "error", message: `Output directory not writable: ${outputDir}` };
    }
  }

  static exitCode(results: { status?: string; level?: string }[]): number {
    for (const r of results) {
      const level = r.status ?? r.level ?? "";
      if (level === "fail" || level === "error") return 1;
    }
    return 0;
  }
}
