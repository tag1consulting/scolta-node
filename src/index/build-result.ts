/** BuildResult + StatusReport DTOs (ported 1:1). */

export interface BuildResult {
  success: boolean;
  message: string;
  pageCount: number;
  fileCount: number;
  elapsedSeconds: number;
  error?: string | null;
}

export interface StatusReportInit {
  version: string;
  pagefindVersion: string;
  resolvedIndexer: string;
  pagesProcessed: number;
  chunksWritten: number;
  peakMemoryBytes: number;
  memoryBudgetBytes: number;
  durationSeconds: number;
  outputDir: string;
  warnings?: string | null;
  success?: boolean;
  error?: string | null;
}

export class StatusReport {
  readonly version: string;
  readonly pagefindVersion: string;
  readonly resolvedIndexer: string;
  readonly pagesProcessed: number;
  readonly chunksWritten: number;
  readonly peakMemoryBytes: number;
  readonly memoryBudgetBytes: number;
  readonly durationSeconds: number;
  readonly outputDir: string;
  readonly warnings: string | null;
  readonly success: boolean;
  readonly error: string | null;

  constructor(init: StatusReportInit) {
    this.version = init.version;
    this.pagefindVersion = init.pagefindVersion;
    this.resolvedIndexer = init.resolvedIndexer;
    this.pagesProcessed = init.pagesProcessed;
    this.chunksWritten = init.chunksWritten;
    this.peakMemoryBytes = init.peakMemoryBytes;
    this.memoryBudgetBytes = init.memoryBudgetBytes;
    this.durationSeconds = init.durationSeconds;
    this.outputDir = init.outputDir;
    this.warnings = init.warnings ?? null;
    this.success = init.success ?? true;
    this.error = init.error ?? null;
  }

  toBuildResult(): BuildResult {
    const peakMb = Math.round((this.peakMemoryBytes / 1_048_576) * 10) / 10;
    const message = this.success
      ? `Built index for ${this.pagesProcessed} pages (${this.chunksWritten} chunks, peak ${peakMb} MB)`
      : (this.error ?? "Build failed");
    return {
      success: this.success,
      message,
      pageCount: this.pagesProcessed,
      fileCount: this.chunksWritten,
      elapsedSeconds: this.durationSeconds,
      error: this.error,
    };
  }

  peakMemoryMb(): string {
    return `${Math.round((this.peakMemoryBytes / 1_048_576) * 10) / 10} MB`;
  }
}
