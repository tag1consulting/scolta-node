/**
 * Content hashing/fingerprinting for the smart-rebuild cache.
 *
 * Internal keys only (no cross-language parity); sha256-based.
 */

import { createHash } from "node:crypto";
import type { ContentItem } from "../content.js";

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf-8").digest("hex");
}

/** Per-item cache key: sha256(url \0 body_html). */
export function contentHash(item: ContentItem): string {
  return sha256Hex(item.url + "\0" + item.bodyHtml);
}

/** Deterministic fingerprint for a set of content items. */
export function computeFingerprint(items: ContentItem[]): string {
  const data = items
    .map((item) => `${item.id}:${sha256Hex(item.bodyHtml)}`)
    .sort();
  return sha256Hex("ts-indexer-v1:" + JSON.stringify(data));
}
