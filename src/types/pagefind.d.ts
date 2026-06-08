/**
 * Minimal ambient declaration for the optional `pagefind` peer dependency. It
 * is loaded only by the opt-in binary path via dynamic import(); this lets
 * `tsc` resolve the import without requiring the package (and its 7 platform
 * binaries) to be installed for the default TS-indexer build.
 */
declare module "pagefind" {
  export interface PagefindIndex {
    addCustomRecord(record: {
      url: string;
      content: string;
      language: string;
      meta?: Record<string, string>;
      filters?: Record<string, string[]>;
    }): Promise<unknown>;
    addHTMLFile(record: { url?: string; sourcePath?: string; content: string }): Promise<unknown>;
    writeFiles(opts?: { outputPath?: string }): Promise<unknown>;
    deleteIndex?(): Promise<unknown>;
  }
  export function createIndex(options?: unknown): Promise<{ index: PagefindIndex }>;
  export function close(): Promise<void>;
}
