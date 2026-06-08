/**
 * Filesystem storage abstraction used by the indexer.
 *
 * Ports `Tag1\Scolta\Storage\StorageDriverInterface` and `FilesystemDriver`.
 * Defaults to the local filesystem; serverless platforms can swap for cloud
 * storage by implementing {@link StorageDriver}.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const STREAM_WRAPPER = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//;

export interface StorageDriver {
  exists(path: string): boolean;
  get(path: string): string;
  put(path: string, contents: string): boolean;
  delete(path: string): boolean;
  deleteDirectory(path: string): boolean;
  makeDirectory(path: string): boolean;
  move(src: string, dst: string): boolean;
  files(directory: string, pattern?: string): string[];
}

/** Translate a simple glob (`*`, `?`) into an anchored RegExp. */
function globToRegExp(pattern: string): RegExp {
  let out = "^";
  for (const ch of pattern) {
    if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  out += "$";
  return new RegExp(out);
}

/** Local filesystem storage driver. Default for most adapters. */
export class FilesystemDriver implements StorageDriver {
  /** Reject PHP-style stream wrappers (defense in depth). */
  private static validatePath(p: string): void {
    if (STREAM_WRAPPER.test(p)) {
      throw new Error("Stream wrappers are not allowed in file paths.");
    }
  }

  exists(p: string): boolean {
    return fs.existsSync(p);
  }

  get(p: string): string {
    FilesystemDriver.validatePath(p);
    try {
      return fs.readFileSync(p, "utf-8");
    } catch (exc) {
      throw new Error(`Failed to read: ${p}`, { cause: exc });
    }
  }

  put(p: string, contents: string): boolean {
    FilesystemDriver.validatePath(p);
    const directory = path.dirname(p);
    if (directory && !fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true, mode: 0o755 });
    }
    fs.writeFileSync(p, contents, "utf-8");
    return true;
  }

  delete(p: string): boolean {
    FilesystemDriver.validatePath(p);
    if (!fs.existsSync(p)) {
      return true;
    }
    fs.unlinkSync(p);
    return true;
  }

  deleteDirectory(p: string): boolean {
    FilesystemDriver.validatePath(p);
    if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
      return true;
    }
    fs.rmSync(p, { recursive: true, force: true });
    return true;
  }

  makeDirectory(p: string): boolean {
    FilesystemDriver.validatePath(p);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      return true;
    }
    fs.mkdirSync(p, { recursive: true, mode: 0o755 });
    return true;
  }

  move(src: string, dst: string): boolean {
    FilesystemDriver.validatePath(src);
    FilesystemDriver.validatePath(dst);
    fs.renameSync(src, dst);
    return true;
  }

  files(directory: string, pattern = "*"): string[] {
    FilesystemDriver.validatePath(directory);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      return [];
    }
    const re = globToRegExp(pattern);
    // Mirror glob semantics: a leading "*" does not match dotfiles.
    const matchesDot = pattern.startsWith(".");
    return fs
      .readdirSync(directory)
      .filter((name) => (matchesDot || !name.startsWith(".")) && re.test(name))
      .map((name) => path.join(directory, name))
      .sort();
  }
}
