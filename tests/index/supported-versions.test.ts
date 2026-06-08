/** Ported from tests/Index/SupportedVersionsTest.php (1:1). */

import { describe, expect, it } from "vitest";
import { SupportedVersions } from "../../src/index/supported-versions.js";

describe("SupportedVersions", () => {
  it("bundled version is in tested versions", () => {
    expect(SupportedVersions.TESTED_VERSIONS).toContain(SupportedVersions.BUNDLED_VERSION);
  });

  it("isSupported true for tested versions", () => {
    for (const v of SupportedVersions.TESTED_VERSIONS) {
      expect(SupportedVersions.isSupported(v)).toBe(true);
    }
  });

  it("isSupported false for unknown version", () => {
    expect(SupportedVersions.isSupported("99.99.99")).toBe(false);
  });

  it("warn returns null for supported version", () => {
    expect(SupportedVersions.warn(SupportedVersions.BUNDLED_VERSION)).toBeNull();
  });

  it("warn returns message for unsupported version", () => {
    const w = SupportedVersions.warn("99.99.99");
    expect(w).not.toBeNull();
    expect(w).toContain("NOT been tested");
    expect(w).toContain("99.99.99");
  });

  it("warn returns message for empty version", () => {
    expect(SupportedVersions.warn("")).not.toBeNull();
  });

  it("getVersionForMetadata", () => {
    expect(SupportedVersions.getVersionForMetadata()).toBe(SupportedVersions.BUNDLED_VERSION);
  });

  it("getVersionInfo contains versions", () => {
    const info = SupportedVersions.getVersionInfo();
    expect(info).toContain(SupportedVersions.BUNDLED_VERSION);
    expect(info).toContain(SupportedVersions.MIN_VERSION);
  });

  it("min version is in tested versions", () => {
    expect(SupportedVersions.TESTED_VERSIONS).toContain(SupportedVersions.MIN_VERSION);
  });

  it("isIncompatible false for tested version", () => {
    expect(SupportedVersions.isIncompatible(SupportedVersions.BUNDLED_VERSION)).toBe(false);
  });

  it("version format is valid semver", () => {
    expect(/^\d+\.\d+\.\d+$/.test(SupportedVersions.BUNDLED_VERSION)).toBe(true);
  });
});
