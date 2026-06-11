/**
 * BuildState.cleanup() ownership: only the build's own transient files are
 * removed.
 *
 * Regression: cleanup() deleted EVERY regular file at the state-dir root —
 * including `amazee-credentials.json`, which FilesystemConfigStorage keeps
 * there. Every fresh index build silently logged the site out of its
 * provisioned AI, so the next AI call re-provisioned a new trial key:
 * trial-account churn, and a re-widened expiry exposure window. (Deliberate
 * deviation from the PHP reference, where Amazee credentials live in CMS
 * config rather than files in the state dir.)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilesystemConfigStorage } from "../../src/ai/amazee/storage.js";
import { BuildState } from "../../src/index/build-state.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scolta-bs-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("BuildState.cleanup ownership", () => {
  it("removes the build's own transient files including .tmp leftovers", () => {
    const state = new BuildState(tmp);
    for (const name of [
      "lock",
      "manifest.json",
      "manifest.json.tmp",
      "chunk-000.dat",
      "chunk-001.dat",
      "chunk-002.dat.tmp",
    ]) {
      fs.writeFileSync(path.join(tmp, name), "x");
    }

    state.cleanup();

    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it("spares amazee-credentials.json so a fresh build does not de-provision AI", () => {
    const storage = new FilesystemConfigStorage(tmp);
    storage.store("sk-trial-token", "https://llm.test.amazee.ai", "test-region");

    const state = new BuildState(tmp);
    fs.writeFileSync(path.join(tmp, "manifest.json"), "{}");
    fs.writeFileSync(path.join(tmp, "chunk-000.dat"), "x");

    state.cleanup();

    expect(storage.load()).toEqual({
      litellm_token: "sk-trial-token",
      litellm_api_url: "https://llm.test.amazee.ai",
      region: "test-region",
    });
    expect(fs.existsSync(path.join(tmp, "manifest.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "chunk-000.dat"))).toBe(false);
  });

  it("spares foreign files and subdirectories", () => {
    const state = new BuildState(tmp);
    fs.writeFileSync(path.join(tmp, "manifest.json"), "{}");
    fs.writeFileSync(path.join(tmp, "user-notes.txt"), "keep me");
    fs.mkdirSync(path.join(tmp, "cache"));
    fs.writeFileSync(path.join(tmp, "cache", "tokens.bin"), "keep me too");

    state.cleanup();

    expect(fs.existsSync(path.join(tmp, "user-notes.txt"))).toBe(true);
    expect(fs.existsSync(path.join(tmp, "cache", "tokens.bin"))).toBe(true);
    expect(fs.existsSync(path.join(tmp, "manifest.json"))).toBe(false);
  });
});
