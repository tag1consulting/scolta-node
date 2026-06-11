/** Build state-machine coordinator (port of `BuildCoordinator`). */

import type { BuildIntent } from "./build-intent.js";
import { BuildState, type Manifest } from "./build-state.js";
import type { PartialIndex } from "./inverted-index-builder.js";

export class BuildCoordinator {
  private readonly state: BuildState;

  constructor(
    readonly stateDir: string,
    hmacSecret: string | null = null,
  ) {
    this.state = new BuildState(stateDir, hmacSecret);
  }

  prepare(intent: BuildIntent): Manifest {
    if (intent.isFresh()) {
      if (this.state.isRunning()) {
        throw new Error(
          "Another index build is already running. Wait for it to complete, or kill the process and retry with --restart.",
        );
      }
      this.state.cleanup();
      const manifest: Manifest = {
        total_pages: intent.totalPages ?? 0,
        chunk_size: intent.memoryBudget.chunkSize(),
        language: (intent.sourceMeta["language"]) ?? "en",
        fingerprint: (intent.sourceMeta["fingerprint"]) ?? "",
        ...intent.sourceMeta,
      };
      if (!this.state.initiateBuild(manifest)) {
        throw new Error("Failed to acquire build lock — another process may have just started.");
      }
      return manifest;
    }

    const manifest = this.state.shouldResume();
    if (manifest === null) {
      throw new Error(
        "No resumable build found in state directory. Run without --resume to start a fresh build.",
      );
    }
    if (!this.state.initiateBuild(manifest)) {
      throw new Error("Failed to re-acquire build lock for resume.");
    }
    return manifest;
  }

  commitChunk(chunkNumber: number, partial: PartialIndex): void {
    this.state.recordChunk(chunkNumber, partial);
  }

  chunkFiles(): string[] {
    return this.state.getChunkFiles();
  }

  pagesProcessed(): number {
    return this.state.getPagesProcessed();
  }

  buildState(): BuildState {
    return this.state;
  }

  release(): void {
    this.state.releaseLock();
    this.state.cleanup();
  }

  releaseLockOnly(): void {
    this.state.releaseLockOnly();
  }
}
