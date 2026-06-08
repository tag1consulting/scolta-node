/**
 * HTML cleaning and Pagefind-document building.
 *
 * Faithful port of `Tag1\Scolta\Html\HtmlCleaner` and `PagefindHtmlBuilder`.
 * Both are intentionally regex/string-based (the PHP is itself ported from the
 * Rust `html.rs`), NOT DOM-parser based — a real HTML parser (parse5/linkedom)
 * would diverge on the malformed-input and comment/attribute edge cases the
 * parity gate checks. So this reproduces PHP's `strip_tags` /
 * `html_entity_decode` / non-`/u` `\s` semantics exactly. (Confirmed by the
 * scolta-python port, which is byte-identical to PHP on the same goldens.)
 */

import { decodeHTML } from "entities";

// PHP trim()/ltrim() default character mask.
const PHP_TRIM_CHARS = " \t\n\r\0\x0b";

const COMMENT = /<!--[\s\S]*?-->/g;
const FOOTER_TAG = /<footer\b[^>]*>[\s\S]*?<\/footer\s*>/gi;
const FOOTER_ID = /<[^>]*\sid\s*=\s*["'][^"']*footer[^"']*["'][^>]*>[\s\S]*?<\/[^>]*>/gi;
const FOOTER_CLASS = /<[^>]*\sclass\s*=\s*["'][^"']*footer[^"']*["'][^>]*>[\s\S]*?<\/[^>]*>/gi;
const FOOTER_REGION =
  /<[^>]*\sclass\s*=\s*["'][^"']*region-footer[^"']*["'][^>]*>[\s\S]*?<\/[^>]*>/gi;
const SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const STYLE = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
const NAV = /<nav\b[^>]*>[\s\S]*?<\/nav\s*>/gi;
// Whitespace set matching PCRE2 \s WITHOUT the /u modifier: HT LF FF CR SP VT.
// Notably this does NOT include U+00A0 (&nbsp;), so decoded nbsp survives. The
// \x0b (vertical tab) is intentional for parity, hence the control-char waiver.
// eslint-disable-next-line no-control-regex
const WS = /[\t\n\f\r \x0b]+/g;
const MAIN = /<(div|main|article|section)\b[^>]*\sid\s*=\s*["']main-content["'][^>]*>/i;

const TAG_TRIGGER_STOP = new Set("\t\n\f\r \x0b".split(""));
const CLOSE_OK_AFTER_OPEN = new Set([" ", ">", "/", "\t", "\n"]);

function isTrimChar(ch: string): boolean {
  return PHP_TRIM_CHARS.includes(ch);
}

function phpTrim(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isTrimChar(s[start]!)) start++;
  while (end > start && isTrimChar(s[end - 1]!)) end--;
  return s.slice(start, end);
}

function phpLtrim(s: string): string {
  let start = 0;
  while (start < s.length && isTrimChar(s[start]!)) start++;
  return s.slice(start);
}

/** Clean raw HTML into plain text suitable for search indexing. */
export function clean(html: string, title = ""): string {
  let content = html.replace(COMMENT, "");
  content = extractMainContent(content);
  content = content.replace(FOOTER_TAG, "");
  content = content.replace(FOOTER_ID, "");
  content = content.replace(FOOTER_CLASS, "");
  content = content.replace(FOOTER_REGION, "");
  content = content.replace(SCRIPT, "");
  content = content.replace(STYLE, "");
  content = content.replace(NAV, "");
  content = stripTagsInternal(content);
  content = decodeHTML(content);
  content = phpTrim(content.replace(WS, " "));

  if (title !== "") {
    const pos = content.indexOf(title);
    if (pos !== -1 && pos < 50) {
      content = phpLtrim(content.slice(pos + title.length));
    }
  }

  return content;
}

/**
 * Replicate PHP strip_tags for the (comment/script/style-free) inputs the
 * cleaner produces: `<` starts a tag unless it is followed by whitespace or
 * end-of-string; a tag with no closing `>` swallows to end of string.
 */
function stripTagsInternal(s: string): string {
  const out: string[] = [];
  let i = 0;
  const n = s.length;
  let inTag = false;
  while (i < n) {
    const c = s[i]!;
    if (inTag) {
      if (c === ">") {
        inTag = false;
      }
      i += 1;
      continue;
    }
    if (c === "<") {
      const nxt = i + 1 < n ? s[i + 1]! : "";
      if (nxt !== "" && !TAG_TRIGGER_STOP.has(nxt)) {
        inTag = true;
        i += 1;
        continue;
      }
      out.push(c);
      i += 1;
      continue;
    }
    out.push(c);
    i += 1;
  }
  return out.join("");
}

/** Public alias for PHP strip_tags semantics (used by the index builder). */
export function stripTags(s: string): string {
  return stripTagsInternal(s);
}

/** PHP html_entity_decode(ENT_QUOTES | ENT_HTML5) equivalent. */
export function decodeEntities(s: string): string {
  return decodeHTML(s);
}

/** Extract id="main-content", falling back to <body>, then full input. */
function extractMainContent(html: string): string {
  const m = MAIN.exec(html);
  if (m) {
    const tagName = m[1]!;
    const tagEnd = m.index + m[0].length;
    const closePos = findMatchingClose(html, tagEnd, tagName);
    if (closePos !== null) {
      return html.slice(tagEnd, closePos);
    }
  }

  const lower = html.toLowerCase();
  const bodyStart = lower.indexOf("<body");
  if (bodyStart !== -1) {
    let bodyTagEnd = html.indexOf(">", bodyStart);
    if (bodyTagEnd !== -1) {
      bodyTagEnd += 1;
      const bodyClose = lower.indexOf("</body>", bodyTagEnd);
      if (bodyClose !== -1) {
        return html.slice(bodyTagEnd, bodyClose);
      }
    }
  }

  return html;
}

/** Find the matching closing tag, handling nesting (port of the PHP scan). */
function findMatchingClose(html: string, startPos: number, tagName: string): number | null {
  const search = html.slice(startPos);
  const searchLow = search.toLowerCase();
  const openPat = ("<" + tagName).toLowerCase();
  const closePat = ("</" + tagName).toLowerCase();
  let depth = 1;
  let pos = 0;
  const length = search.length;

  while (pos < length) {
    const remLow = searchLow.slice(pos);
    let nextOpen = remLow.indexOf(openPat);
    const nextClose = remLow.indexOf(closePat);

    if (nextOpen !== -1) {
      const afterIdx = pos + nextOpen + openPat.length;
      const after = afterIdx < length ? search[afterIdx]! : null;
      if (after === null || !CLOSE_OK_AFTER_OPEN.has(after)) {
        nextOpen = -1;
      }
    }

    if (nextOpen !== -1 && nextClose !== -1 && nextOpen < nextClose) {
      depth += 1;
      pos += nextOpen + openPat.length;
    } else if (nextClose !== -1) {
      depth -= 1;
      if (depth === 0) {
        return startPos + pos + nextClose;
      }
      pos += nextClose + closePat.length;
    } else if (nextOpen !== -1) {
      depth += 1;
      pos += nextOpen + openPat.length;
    } else {
      break;
    }
  }

  return null;
}

// -- Pagefind HTML builder --------------------------------------------------

/**
 * Equivalent of PHP htmlspecialchars(s, ENT_QUOTES | ENT_HTML5, 'UTF-8').
 * Note ENT_HTML5 encodes the single quote as &apos; (not &#039;).
 */
function hs(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export type BuildFilters = Record<string, string | string[]>;
export type BuildMeta = Record<string, string>;

/** Build a Pagefind-compatible HTML document (port of PagefindHtmlBuilder). */
export function build(
  id: string,
  title: string,
  body: string,
  url: string,
  date = "",
  siteName = "",
  language = "en",
  filters: BuildFilters = {},
  metadata: BuildMeta = {},
  sortable: BuildMeta = {},
): string {
  const escapedTitle = hs(title);
  const escapedBody = hs(body);
  const escapedUrl = hs(url);
  const escapedLang = hs(language);

  let siteFilter = "";
  if (siteName !== "") {
    siteFilter = ` data-pagefind-filter="site:${hs(siteName)}"`;
  }

  let dateMeta = "";
  if (date !== "") {
    dateMeta = `<p data-pagefind-meta="date:${hs(date)}" hidden></p>\n`;
  }

  const langFilter = `<span data-pagefind-filter="language:${escapedLang}" hidden></span>\n`;

  let extraFilters = "";
  for (const [key, value] of Object.entries(filters)) {
    const ekey = hs(String(key));
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      extraFilters += `<span data-pagefind-filter="${ekey}:${hs(String(v))}" hidden></span>\n`;
    }
  }

  let extraMeta = "";
  for (const [key, value] of Object.entries(metadata)) {
    extraMeta += `<p data-pagefind-meta="${hs(String(key))}:${hs(String(value))}" hidden></p>\n`;
  }

  let sortAttrs = "";
  for (const [key, value] of Object.entries(sortable)) {
    sortAttrs += `<p data-pagefind-sort="${hs(String(key))}:${hs(String(value))}" hidden></p>\n`;
  }
  if (date !== "" && !("date" in sortable)) {
    sortAttrs += `<p data-pagefind-sort="date:${hs(date)}" hidden></p>\n`;
  }

  return (
    "<!DOCTYPE html>\n" +
    `<html lang="${escapedLang}">\n` +
    "<head>\n" +
    '<meta charset="utf-8">\n' +
    `<title>${escapedTitle}</title>\n` +
    "</head>\n" +
    `<body data-pagefind-body id="${id}"${siteFilter}>\n` +
    `<h1>${escapedTitle}</h1>\n` +
    `<p data-pagefind-meta="url:${escapedUrl}" hidden></p>\n` +
    `${dateMeta}${langFilter}${extraFilters}${extraMeta}${sortAttrs}${escapedBody}\n` +
    "</body>\n" +
    "</html>"
  );
}
