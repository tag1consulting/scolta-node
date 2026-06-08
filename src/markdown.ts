/**
 * Lightweight markdown-to-HTML renderer for AI responses.
 *
 * Direct port of `Tag1\Scolta\Util\MarkdownRenderer`. Handles bold, italic,
 * links, bullet lists and paragraphs. All output is HTML-escaped for XSS
 * safety — text is escaped first, then safe structural tags are applied via
 * regex. A general markdown library is intentionally NOT used: the ported
 * tests assert this exact output (subset of tags, broken-link salvage,
 * escaping order).
 */

const BOLD_ITALIC = /\*\*\*(.+?)\*\*\*/g;
const BOLD = /\*\*(.+?)\*\*/g;
const ITALIC = /\*(.+?)\*/g;
const LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const TRUNCATED_LINK = /\[([^\]]+)\]\([^)]*$/g;
const ORPHAN_BRACKET = /\[([^\]]+)\](?!\()/g;

/** Equivalent of PHP htmlspecialchars(..., ENT_QUOTES, 'UTF-8'). */
function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cleanBrokenLinks(text: string): string {
  // [text]( with no closing ) — truncated URL, keep the label as bold.
  text = text.replace(TRUNCATED_LINK, "**$1**");
  // [text] with no following (url) — orphaned bracket, keep label as bold.
  text = text.replace(ORPHAN_BRACKET, "**$1**");
  return text;
}

function renderInline(text: string): string {
  text = cleanBrokenLinks(text);
  text = escape(text);
  text = text.replace(BOLD_ITALIC, "<strong><em>$1</em></strong>");
  text = text.replace(BOLD, "<strong>$1</strong>");
  text = text.replace(ITALIC, "<em>$1</em>");
  text = text.replace(LINK, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return text;
}

/** Render markdown text to sanitized HTML. */
export function renderMarkdown(markdown: string): string {
  if (markdown === "") {
    return "";
  }

  let html = "";
  let inList = false;

  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();

    if (trimmed === "") {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      continue;
    }

    if (trimmed.startsWith("- ")) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += "<li>" + renderInline(trimmed.slice(2)) + "</li>";
    } else {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += "<p>" + renderInline(trimmed) + "</p>";
    }
  }

  if (inList) {
    html += "</ul>";
  }

  return html;
}
