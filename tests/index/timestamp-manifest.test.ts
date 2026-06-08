/** TimestampManifest tests (ported from TimestampManifestTest.php behaviour). */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TimestampManifest } from "../../src/index/timestamp-manifest.js";
import { FilesystemDriver } from "../../src/storage.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scolta-tsm-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("TimestampManifest", () => {
  it("put/get round trip", () => {
    const m = new TimestampManifest(tmp, new FilesystemDriver());
    m.put("e1", 123, ["a", "b"]);
    expect(m.get("e1")).toEqual({ ts: 123, items: ["a", "b"] });
    expect(m.get("missing")).toBeNull();
  });

  it("survives reopen after save", () => {
    const m = new TimestampManifest(tmp, new FilesystemDriver());
    m.put("e1", 1, []);
    m.pruneAndSave();
    expect(new TimestampManifest(tmp, new FilesystemDriver()).get("e1")).not.toBeNull();
  });

  it("prune drops unseen entries", () => {
    const m1 = new TimestampManifest(tmp, new FilesystemDriver());
    m1.put("keep", 1, []);
    m1.put("drop", 2, []);
    m1.pruneAndSave();
    const m2 = new TimestampManifest(tmp, new FilesystemDriver());
    m2.markSeen("keep");
    m2.pruneAndSave();
    const m3 = new TimestampManifest(tmp, new FilesystemDriver());
    expect(m3.get("keep")).not.toBeNull();
    expect(m3.get("drop")).toBeNull();
  });

  it("count and isEmpty", () => {
    const m = new TimestampManifest(tmp, new FilesystemDriver());
    expect(m.isEmpty()).toBe(true);
    m.put("a", 1, []);
    expect(m.isEmpty()).toBe(false);
    expect(m.count()).toBe(1);
  });
});
