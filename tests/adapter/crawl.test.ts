/**
 * Static-output crawl tests, lifted with the code from the scolta-next /
 * scolta-nuxt adapter suites.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crawlStaticHtml, exportPathToUrl } from "../../src/adapter/crawl.js";

const longBody =
  "<p>" + "This paragraph is long enough to pass the minimum content length filter. ".repeat(4) + "</p>";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scolta-adapter-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("exportPathToUrl", () => {
  it.each([
    ["index.html", "/"],
    ["about/index.html", "/about/"],
    ["blog/first-post.html", "/blog/first-post"],
    ["docs/api/index.html", "/docs/api/"],
    ["posts/hello.html", "/posts/hello"],
  ])("%s -> %s", (rel, url) => {
    expect(exportPathToUrl(rel)).toBe(url);
  });

  it("normalizes Windows separators", () => {
    expect(exportPathToUrl("about\\index.html")).toBe("/about/");
  });
});

describe("crawlStaticHtml", () => {
  it("crawls rendered HTML into ContentItems with titles and URLs", () => {
    fs.mkdirSync(path.join(tmp, "about"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "blog"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "index.html"),
      `<html><head><title>Home</title></head><body>${longBody}</body></html>`,
    );
    fs.writeFileSync(
      path.join(tmp, "about", "index.html"),
      `<html><head><title>About Us</title></head><body>${longBody}</body></html>`,
    );
    fs.writeFileSync(
      path.join(tmp, "blog", "first-post.html"),
      `<html><head><title>First Post</title></head><body>${longBody}</body></html>`,
    );
    fs.writeFileSync(path.join(tmp, "ignored.txt"), "not html");

    const items = crawlStaticHtml(tmp);
    expect(items.length).toBe(3);
    expect(new Set(items.map((i) => i.url))).toEqual(new Set(["/", "/about/", "/blog/first-post"]));
    expect(items.find((i) => i.url === "/about/")?.title).toBe("About Us");
  });

  it("falls back to the relative path when there is no <title>", () => {
    fs.writeFileSync(path.join(tmp, "bare.html"), `<html><body>${longBody}</body></html>`);
    expect(crawlStaticHtml(tmp)[0]?.title).toBe("bare.html");
  });

  it("returns empty for a missing directory", () => {
    expect(crawlStaticHtml(path.join(tmp, "nope"))).toEqual([]);
  });
});
