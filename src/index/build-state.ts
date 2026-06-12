/**
 * Resumable build state (port of `Tag1\Scolta\Index\BuildState`).
 *
 * Transient per-build state: an exclusive lock file, an atomically written
 * manifest.json, and chunk-NNN.dat files. `cleanup()` removes only the
 * transient *files* directly in the state dir — it never recurses into subdirs,
 * so the cross-build token cache (kept in its own subdir by the orchestrator)
 * survives a fresh-build wipe.
 *
 * The PHP/Python flock is emulated with an O_EXCL lock file holding
 * `pid:timestamp`; staleness is detected via process-liveness (process.kill
 * pid, 0) plus a 1-hour timeout — matching the documented semantics.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ChunkReader, ChunkWriter } from "./chunk-io.js";
import type { PartialIndex } from "./inverted-index-builder.js";
import { SupportedVersions } from "./supported-versions.js";

const LOCK_FILE = "lock";
const MANIFEST_FILE = "manifest.json";
const STALE_LOCK_SECONDS = 3600;

export type Manifest = Record<string, unknown>;

export class BuildState {
  private hasLock = false;

  constructor(
    private readonly stateDir: string,
    private readonly hmacSecret: string | null = null,
  ) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  initiateBuild(manifest: Manifest): boolean {
    const lockFile = path.join(this.stateDir, LOCK_FILE);

    if (fs.existsSync(lockFile)) {
      try {
        if (this.isLockStale(fs.readFileSync(lockFile, "utf-8"))) {
          this.unlinkQuietly(lockFile);
        }
      } catch {
        /* ignore */
      }
    }

    try {
      // O_EXCL: fail if the lock already exists (another live build).
      const fd = fs.openSync(lockFile, "wx");
      fs.writeSync(fd, `${process.pid}:${Math.floor(Date.now() / 1000)}`);
      fs.closeSync(fd);
    } catch {
      return false;
    }
    this.hasLock = true;

    const full: Manifest = {
      version: "1.0.0",
      language: "en",
      pagefind_version: SupportedVersions.BUNDLED_VERSION,
      total_pages: 0,
      pages_processed: 0,
      chunk_size: 100,
      chunks_written: 0,
      started_at: new Date().toISOString(),
      fingerprint: "",
      status: "building",
      ...manifest,
    };
    this.commitManifest(full);
    return true;
  }

  recordChunk(chunkNumber: number, partial: PartialIndex): void {
    const p = path.join(this.stateDir, `chunk-${String(chunkNumber).padStart(3, "0")}.dat`);
    new ChunkWriter().write(p, partial, this.hmacSecret);
    const manifest = this.readManifest();
    if (manifest !== null) {
      manifest["chunks_written"] = chunkNumber + 1;
      manifest["pages_processed"] = Number(manifest["pages_processed"] ?? 0) + partial.pages.size;
      this.commitManifest(manifest);
    }
  }

  readChunk(chunkNumber: number): PartialIndex {
    const p = path.join(this.stateDir, `chunk-${String(chunkNumber).padStart(3, "0")}.dat`);
    if (!fs.existsSync(p)) {
      throw new Error(`Chunk file not found: chunk-${String(chunkNumber).padStart(3, "0")}.dat`);
    }
    if (this.hmacSecret !== null && !new ChunkReader(p).verifyHmac(this.hmacSecret)) {
      throw new Error(`HMAC verification failed for chunk: ${p}`);
    }
    if (!new ChunkReader(p).verifyCrc32()) {
      throw new Error(`CRC32 validation failed for chunk: ${p}`);
    }
    const pages = new Map([...new ChunkReader(p).openPages()]);
    const index = new Map([...new ChunkReader(p).openIndex()]);
    return { pages, index };
  }

  releaseLock(): void {
    this.dropLockFileOnly();
    const manifest = this.readManifest();
    if (manifest !== null) {
      manifest["status"] = "idle";
      this.commitManifest(manifest);
    }
  }

  releaseLockOnly(): void {
    this.dropLockFileOnly();
  }

  private dropLockFileOnly(): void {
    this.hasLock = false;
    this.unlinkQuietly(path.join(this.stateDir, LOCK_FILE));
  }

  shouldResume(): Manifest | null {
    const manifest = this.readManifest();
    if (manifest === null || manifest["status"] !== "building") return null;
    const lockFile = path.join(this.stateDir, LOCK_FILE);
    if (fs.existsSync(lockFile)) {
      try {
        if (this.isLockStale(fs.readFileSync(lockFile, "utf-8"))) {
          this.unlinkQuietly(lockFile);
        }
      } catch {
        /* ignore */
      }
    }
    return manifest;
  }

  getChunkFiles(): string[] {
    const manifest = this.readManifest();
    const chunksWritten = Number(manifest?.["chunks_written"] ?? 0);
    const files: string[] = [];
    for (let i = 0; i < chunksWritten; i++) {
      const p = path.join(this.stateDir, `chunk-${String(i).padStart(3, "0")}.dat`);
      if (fs.existsSync(p)) files.push(p);
    }
    return files;
  }

  isRunning(): boolean {
    const manifest = this.readManifest();
    if (manifest === null || manifest["status"] !== "building") return false;
    const lockFile = path.join(this.stateDir, LOCK_FILE);
    if (!fs.existsSync(lockFile)) return false;
    try {
      return !this.isLockStale(fs.readFileSync(lockFile, "utf-8"));
    } catch {
      return false;
    }
  }

  getProgress(): number {
    const manifest = this.readManifest();
    if (manifest === null) return 0.0;
    const totalPages = Number(manifest["total_pages"] ?? 0);
    const chunkSize = Number(manifest["chunk_size"] ?? 100);
    const chunksWritten = Number(manifest["chunks_written"] ?? 0);
    const totalChunks = totalPages > 0 ? Math.ceil(totalPages / Math.max(1, chunkSize)) : 1;
    return Math.min(1.0, chunksWritten / totalChunks);
  }

  getStartTime(): string | null {
    const manifest = this.readManifest();
    return manifest ? ((manifest["started_at"] as string) ?? null) : null;
  }

  getPagesProcessed(): number {
    const manifest = this.readManifest();
    return Number(manifest?.["pages_processed"] ?? 0);
  }

  /**
   * Remove transient build files (lock, manifest, chunk data, and their .tmp
   * leftovers) — never subdirectories, and never files the build does not own.
   *
   * Deliberate deviation from the PHP reference, which deletes every file in
   * the state dir: in PHP the Amazee credentials live in CMS config (CMI, WP
   * options, DB rows), but this stack's FilesystemConfigStorage keeps
   * `amazee-credentials.json` at the state-dir root — the delete-every-file
   * sweep wiped it on every fresh build, so the next AI call re-provisioned a
   * new trial key, churning trial accounts and re-widening the expiry
   * exposure window the key-expiry recovery exists to close.
   */
  cleanup(): void {
    if (!fs.existsSync(this.stateDir) || !fs.statSync(this.stateDir).isDirectory()) return;
    const ownsFile = (name: string): boolean =>
      name === LOCK_FILE ||
      name === MANIFEST_FILE ||
      name === MANIFEST_FILE + ".tmp" ||
      /^chunk-\d+\.dat(\.tmp)?$/.test(name);
    for (const entry of fs.readdirSync(this.stateDir, { withFileTypes: true })) {
      if (entry.isFile() && ownsFile(entry.name)) {
        this.unlinkQuietly(path.join(this.stateDir, entry.name));
      }
    }
  }

  // -- internal --

  private commitManifest(manifest: Manifest): void {
    const manifestPath = path.join(this.stateDir, MANIFEST_FILE);
    const tempPath = manifestPath + ".tmp";
    fs.writeFileSync(tempPath, JSON.stringify(manifest, null, 4), "utf-8");
    fs.renameSync(tempPath, manifestPath);
  }

  private readManifest(): Manifest | null {
    const p = path.join(this.stateDir, MANIFEST_FILE);
    for (const candidate of [p, p + ".tmp"]) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const data: unknown = JSON.parse(fs.readFileSync(candidate, "utf-8"));
        if (data && typeof data === "object" && !Array.isArray(data)) return data as Manifest;
      } catch {
        continue;
      }
    }
    return null;
  }

  private isLockStale(lockData: string): boolean {
    const idx = lockData.indexOf(":");
    if (idx !== -1) {
      const pidStr = lockData.slice(0, idx);
      const tsStr = lockData.slice(idx + 1);
      const ts = parseInt(tsStr, 10);
      if (Number.isNaN(ts)) return true;
      if (Date.now() / 1000 - ts > STALE_LOCK_SECONDS) return true;
      const pid = parseInt(pidStr, 10);
      if (Number.isNaN(pid)) return true;
      try {
        process.kill(pid, 0);
        return false; // process alive
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err.code === "EPERM") return false; // alive, not ours
        return true; // ESRCH → dead
      }
    }
    const lockPath = path.join(this.stateDir, LOCK_FILE);
    try {
      const mtime = fs.statSync(lockPath).mtimeMs / 1000;
      return Date.now() / 1000 - mtime > STALE_LOCK_SECONDS;
    } catch {
      return true;
    }
  }

  private unlinkQuietly(p: string): void {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}
