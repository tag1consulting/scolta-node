/**
 * Ported from tests/Storage/FilesystemDriverTest.php (1:1).
 *
 * PHP raises InvalidArgumentException for stream wrappers; this port throws
 * an Error with the same "Stream wrappers" message.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilesystemDriver } from "../src/storage.js";

let tmp: string;
const driver = new FilesystemDriver();

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scolta-storage-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("FilesystemDriver", () => {
  it("put and get", () => {
    const p = path.join(tmp, "test.txt");
    expect(driver.put(p, "hello")).toBe(true);
    expect(driver.get(p)).toBe("hello");
  });

  it("exists", () => {
    const p = path.join(tmp, "exists.txt");
    expect(driver.exists(p)).toBe(false);
    driver.put(p, "data");
    expect(driver.exists(p)).toBe(true);
  });

  it("delete", () => {
    const p = path.join(tmp, "delete.txt");
    driver.put(p, "data");
    expect(driver.delete(p)).toBe(true);
    expect(driver.exists(p)).toBe(false);
  });

  it("make directory", () => {
    const d = path.join(tmp, "sub", "nested");
    expect(driver.makeDirectory(d)).toBe(true);
    expect(fs.statSync(d).isDirectory()).toBe(true);
  });

  it("move", () => {
    const src = path.join(tmp, "from.txt");
    const dst = path.join(tmp, "to.txt");
    driver.put(src, "moved");
    expect(driver.move(src, dst)).toBe(true);
    expect(driver.exists(src)).toBe(false);
    expect(driver.get(dst)).toBe("moved");
  });

  it("files", () => {
    driver.put(path.join(tmp, "a.txt"), "1");
    driver.put(path.join(tmp, "b.txt"), "2");
    expect(driver.files(tmp, "*.txt").length).toBe(2);
  });

  it("delete directory", () => {
    const d = path.join(tmp, "toremove");
    fs.mkdirSync(d);
    driver.put(path.join(d, "file.txt"), "data");
    expect(driver.deleteDirectory(d)).toBe(true);
    expect(fs.existsSync(d)).toBe(false);
  });

  it("put creates parent directories", () => {
    const p = path.join(tmp, "deep", "nested", "dir", "file.txt");
    expect(driver.put(p, "deep")).toBe(true);
    expect(driver.get(p)).toBe("deep");
  });

  it("rejects stream wrappers", () => {
    for (const wrapper of [
      "php://filter/resource=/etc/passwd",
      "file:///etc/passwd",
      "expect://ls",
    ]) {
      expect(() => driver.get(wrapper)).toThrow(/Stream wrappers/);
    }
  });

  it("rejects stream wrapper in put", () => {
    expect(() => driver.put("php://memory", "data")).toThrow(/Stream wrappers/);
  });

  it("rejects stream wrapper in move", () => {
    expect(() => driver.move("php://filter/resource=/etc/passwd", "/tmp/out")).toThrow(
      /Stream wrappers/,
    );
  });

  it("normal paths are not rejected", () => {
    const p = path.join(tmp, "normal-file.txt");
    driver.put(p, "ok");
    expect(driver.get(p)).toBe("ok");
  });
});
