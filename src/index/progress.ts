/** Progress reporter protocol + no-op (ported 1:1). */

export interface ProgressReporter {
  start(totalSteps: number, label: string): void;
  advance(steps?: number, detail?: string | null): void;
  finish(summary?: string | null): void;
}

export class NullProgressReporter implements ProgressReporter {
  start(_totalSteps: number, _label: string): void {
    /* no-op */
  }
  advance(_steps = 1, _detail: string | null = null): void {
    /* no-op */
  }
  finish(_summary: string | null = null): void {
    /* no-op */
  }
}
