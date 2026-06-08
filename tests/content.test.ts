/**
 * Tests for ContentItem / TrackerRecord (ported from Export/ContentItem.php
 * constructor + cloneWith semantics; scolta-python tests/test_content.py).
 */

import { describe, expect, it } from "vitest";
import { ContentItem, TrackerAction, type TrackerRecord } from "../src/content.js";

function item(overrides: Partial<ConstructorParameters<typeof ContentItem>[0]> = {}): ContentItem {
  return new ContentItem({
    id: "1",
    title: "Title",
    bodyHtml: "<p>body</p>",
    url: "/page",
    date: "2024-01-01",
    ...overrides,
  });
}

describe("ContentItem", () => {
  it("relative url unchanged", () => {
    expect(item({ url: "/foo/bar" }).url).toBe("/foo/bar");
  });

  it("absolute url stripped to path", () => {
    expect(item({ url: "https://myapp.ddev.site/foo/bar" }).url).toBe("/foo/bar");
  });

  it("absolute url keeps query and fragment", () => {
    expect(item({ url: "https://example.com/p?q=1#frag" }).url).toBe("/p?q=1#frag");
  });

  it("absolute url root path", () => {
    expect(item({ url: "https://example.com" }).url).toBe("/");
  });

  it("clone_with carries all fields forward", () => {
    const it1 = item({ metadata: { price: "9.99" }, sortable: { rating: "4.5" } });
    const cloned = it1.cloneWith({ bodyHtml: "<p>new</p>" });
    expect(cloned.bodyHtml).toBe("<p>new</p>");
    expect(cloned.metadata).toEqual({ price: "9.99" });
    expect(cloned.sortable).toEqual({ rating: "4.5" });
    expect(cloned.id).toBe("1");
  });

  it("clone_with overriding url is renormalized", () => {
    const cloned = item().cloneWith({ url: "https://example.com/new" });
    expect(cloned.url).toBe("/new");
  });
});

describe("TrackerRecord", () => {
  it("index action constant", () => {
    const rec: TrackerRecord = {
      contentId: "42",
      contentType: "post",
      action: TrackerAction.INDEX,
      changedAt: null,
    };
    expect(rec.action).toBe("index");
    expect(rec.changedAt).toBeNull();
  });

  it("delete action with timestamp", () => {
    const now = new Date(2024, 5, 1);
    const rec: TrackerRecord = {
      contentId: "42",
      contentType: "post",
      action: TrackerAction.DELETE,
      changedAt: now,
    };
    expect(rec.action).toBe("delete");
    expect(rec.changedAt).toBe(now);
  });
});
