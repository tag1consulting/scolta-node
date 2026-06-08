/**
 * Indexer backend resolver (port of `IndexerResolver`).
 *
 * Design rule (matched exactly): 'auto' always means the TS indexer. 'binary'
 * probes the Pagefind Node API and uses it only if present, otherwise logs a
 * notice and falls back to the TS indexer. Any unrecognized value -> TS.
 */

import type { PagefindStatus } from "./pagefind.js";

export interface BinaryProbe {
  isAvailable(): Promise<boolean>;
  status(): Promise<PagefindStatus>;
}

export interface ResolverLogger {
  info(msg: string, ...args: unknown[]): void;
}

export type ResolvedIndexer = "ts" | "binary";

export class IndexerResolver {
  constructor(
    private readonly binary: BinaryProbe,
    private readonly logger: ResolverLogger = console,
  ) {}

  async resolve(effectiveIndexer: string): Promise<ResolvedIndexer> {
    if (effectiveIndexer === "ts") {
      this.logger.info("[scolta] Using TS indexer.");
      return "ts";
    }

    if (effectiveIndexer === "binary") {
      if (await this.binary.isAvailable()) {
        this.logger.info("[scolta] Using binary indexer (Pagefind Node API).");
        return "binary";
      }
      const status = await this.binary.status();
      this.logger.info(
        `[scolta] Falling back to TS indexer: binary not available. ${status.message}`,
      );
      return "ts";
    }

    // 'auto' or any unrecognized value: always the TS indexer.
    this.logger.info("[scolta] Using TS indexer.");
    return "ts";
  }
}
