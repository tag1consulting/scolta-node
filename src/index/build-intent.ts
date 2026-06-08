/** Build intent value object + factory (port of BuildIntent / BuildIntentFactory). */

import type { MemoryBudget } from "./memory-budget.js";

export type BuildMode = "fresh" | "resume" | "restart";

export class BuildIntent {
  constructor(
    readonly mode: BuildMode,
    readonly totalPages: number | null,
    readonly memoryBudget: MemoryBudget,
    readonly sourceMeta: Record<string, unknown> = {},
  ) {}

  static fresh(totalPages: number, budget: MemoryBudget, sourceMeta: Record<string, unknown> = {}): BuildIntent {
    return new BuildIntent("fresh", totalPages, budget, sourceMeta);
  }

  static resume(budget: MemoryBudget): BuildIntent {
    return new BuildIntent("resume", null, budget, {});
  }

  static restart(totalPages: number, budget: MemoryBudget, sourceMeta: Record<string, unknown> = {}): BuildIntent {
    return new BuildIntent("restart", totalPages, budget, sourceMeta);
  }

  /** True for fresh and restart — both wipe existing state. */
  isFresh(): boolean {
    return this.mode === "fresh" || this.mode === "restart";
  }
}

export class BuildIntentFactory {
  static fromFlags(resume: boolean, restart: boolean, totalCount: number, budget: MemoryBudget): BuildIntent {
    if (resume) return BuildIntent.resume(budget);
    if (restart) return BuildIntent.restart(totalCount, budget);
    return BuildIntent.fresh(totalCount, budget);
  }
}
