/** Pagefind version tracking (port of `SupportedVersions`). */

export const TESTED_VERSIONS = ["1.3.0", "1.4.0", "1.5.0"];
export const BUNDLED_VERSION = "1.5.0";
export const MIN_VERSION = "1.3.0";
export const INCOMPATIBLE_VERSIONS: Record<string, string> = {};

export class SupportedVersions {
  static readonly TESTED_VERSIONS = TESTED_VERSIONS;
  static readonly BUNDLED_VERSION = BUNDLED_VERSION;
  static readonly MIN_VERSION = MIN_VERSION;
  static readonly INCOMPATIBLE_VERSIONS = INCOMPATIBLE_VERSIONS;

  static isSupported(version: string): boolean {
    return TESTED_VERSIONS.includes(version);
  }

  static isIncompatible(version: string): boolean {
    return version in INCOMPATIBLE_VERSIONS;
  }

  static warn(version: string): string | null {
    if (SupportedVersions.isIncompatible(version)) {
      return `Pagefind version ${version} is INCOMPATIBLE: ${INCOMPATIBLE_VERSIONS[version]}`;
    }
    if (!SupportedVersions.isSupported(version)) {
      return (
        `Pagefind version ${version} has NOT been tested with Scolta's TS indexer. ` +
        `Search may work, but results are not guaranteed. ` +
        `Tested versions: ${TESTED_VERSIONS.join(", ")}.`
      );
    }
    return null;
  }

  static getVersionForMetadata(): string {
    return BUNDLED_VERSION;
  }

  static getVersionInfo(): string {
    return (
      `Bundled Pagefind: ${BUNDLED_VERSION} | ` +
      `Tested versions: ${TESTED_VERSIONS.join(", ")} | Minimum: ${MIN_VERSION}`
    );
  }
}
