/**
 * Build a partial inverted index for a chunk of content items.
 *
 * Port of `Tag1\Scolta\Index\InvertedIndexBuilder`. Each chunk produces a
 * word -> pages mapping with positions and weights; multiple chunks are later
 * merged by IndexMerger into a complete index. Title weight 50, body weight 25,
 * 200-position cap per weight bucket per page; positions are reindexed to
 * word-sequential indices.
 */

import { createHash } from "node:crypto";
import type { ContentItem } from "../content.js";
import * as html from "../html.js";
import type { IndexPage, InvertedIndex } from "./pf-common.js";
import type { Stemmer } from "./stemmer.js";
import { type Token, token as makeToken } from "./token.js";
import type { Tokenizer } from "./tokenizer.js";

export const TITLE_WEIGHT = 50;
export const BODY_WEIGHT = 25;
export const MAX_POSITIONS_PER_WEIGHT = 200;

const TITLE_SCRIPT_STYLE = /<(script|style)[^>]*>[\s\S]*?<\/\1>/gi;
const URL_EXT = /\.\w+$/;

export interface TokenData {
  titleTokens: Token[];
  bodyTokens: Token[];
  urlTokens: Token[];
  wordCount: number;
  cleanTitle: string;
  content: string;
}

/**
 * The subset of ContentItem fields `buildFromTokenData` reads. The orchestrator
 * passes a lightweight proxy (no body/title) for cache-hit and cached-reference
 * pages, so the page record is built from token data + these fields alone.
 */
export interface ItemMeta {
  id: string;
  url: string;
  date: string;
  siteName: string;
  language: string;
  filters: Record<string, string | string[]>;
  sortable: Record<string, string>;
}

export interface PartialIndex {
  index: InvertedIndex;
  pages: Map<number, IndexPage>;
}

function urlPathOf(url: string): string {
  let p = url.split("#")[0]!.split("?")[0]!;
  // Strip scheme+host if absolute.
  if (p.includes("://")) {
    try {
      p = new URL(url).pathname;
    } catch {
      /* leave as-is */
    }
  }
  return p;
}

export class InvertedIndexBuilder {
  static readonly TITLE_WEIGHT = TITLE_WEIGHT;
  static readonly BODY_WEIGHT = BODY_WEIGHT;
  static readonly MAX_POSITIONS_PER_WEIGHT = MAX_POSITIONS_PER_WEIGHT;

  private readonly tokenizer: Tokenizer;
  private readonly stemmer: Stemmer;

  constructor(tokenizer: Tokenizer, stemmer: Stemmer) {
    this.tokenizer = tokenizer;
    this.stemmer = stemmer;
  }

  build(items: ContentItem[], pageOffset = 0): PartialIndex {
    const tokenDataList: { item: ContentItem; tokenData: TokenData }[] = [];
    for (const item of items) {
      const td = this.tokenizeItem(item);
      if (td !== null) {
        tokenDataList.push({ item, tokenData: td });
      }
    }
    return this.buildFromTokenData(tokenDataList, pageOffset);
  }

  tokenizeItem(item: ContentItem): TokenData | null {
    const cleanText = html.clean(item.bodyHtml, item.title);
    if (cleanText.length < 10) {
      return null;
    }

    const titleRaw = item.title.replace(TITLE_SCRIPT_STYLE, "");
    const cleanTitle = html.decodeEntities(html.stripTags(titleRaw));

    const [titleTokens, afterTitle] = InvertedIndexBuilder.reindex(
      this.tokenizer.tokenize(cleanTitle),
      0,
    );
    const [bodyTokens, afterBody] = InvertedIndexBuilder.reindex(
      this.tokenizer.tokenize(cleanText),
      afterTitle,
    );

    let urlPath = urlPathOf(item.url);
    urlPath = urlPath.replace(URL_EXT, "");
    const urlSegments = urlPath.split("/").filter((s) => s.length > 0);
    const urlText = urlSegments.join(" ");
    const [urlTokens] = InvertedIndexBuilder.reindex(this.tokenizer.tokenize(urlText), afterBody);

    const wordCount = titleTokens.length + bodyTokens.length;
    const content = cleanTitle !== "" ? cleanTitle + ". " + cleanText : cleanText;

    return { titleTokens, bodyTokens, urlTokens, wordCount, cleanTitle, content };
  }

  buildFromTokenData(
    tokenDataList: { item: ItemMeta; tokenData: TokenData }[],
    pageOffset = 0,
  ): PartialIndex {
    const index: InvertedIndex = new Map();
    const pages = new Map<number, IndexPage>();
    let pageNum = pageOffset;

    for (const { item, tokenData: td } of tokenDataList) {
      const itemSortable: Record<string, string> = { ...item.sortable };
      const itemDate = item.date || "";
      if (itemDate !== "" && !("date" in itemSortable)) {
        itemSortable["date"] = itemDate;
      }

      const filters: Record<string, string | string[]> = {};
      if (item.siteName !== "") filters["site"] = item.siteName;
      if (item.language !== "") filters["language"] = item.language;
      Object.assign(filters, item.filters);

      // PHP: ['title'=>.., 'date'=>..] + itemSortable (left keys win), then
      // array_filter removes null/'' values.
      const combined: Record<string, string> = { title: td.cleanTitle, date: item.date };
      for (const [k, v] of Object.entries(itemSortable)) {
        if (!(k in combined)) {
          combined[k] = v;
        }
      }
      const meta: Record<string, string> = {};
      for (const [k, v] of Object.entries(combined)) {
        if (v !== null && v !== undefined && v !== "") {
          meta[k] = v;
        }
      }

      pages.set(pageNum, {
        id: item.id,
        url: item.url,
        title: td.cleanTitle,
        content: td.content,
        wordCount: td.wordCount,
        date: item.date,
        filters,
        meta,
        sortable: itemSortable,
        hash: createHash("sha256").update(td.content, "utf-8").digest("hex"),
      });

      this.indexTokens(index, td.titleTokens, pageNum, TITLE_WEIGHT);
      this.indexTokens(index, td.bodyTokens, pageNum, BODY_WEIGHT);
      this.indexTokens(index, td.urlTokens, pageNum, BODY_WEIGHT);

      pageNum += 1;
    }

    return { index, pages };
  }

  static reindex(tokens: Token[], startIndex = 0): [Token[], number] {
    const reindexed: Token[] = [];
    let wordIndex = startIndex;
    for (const t of tokens) {
      reindexed.push(makeToken(t.stem, t.original, wordIndex));
      wordIndex += 1;
    }
    return [reindexed, wordIndex];
  }

  private indexTokens(index: InvertedIndex, tokens: Token[], pageNum: number, weight: number): void {
    for (const t of tokens) {
      const stemmed = this.stemmer.stem(t.stem);
      const position = t.position;

      let entry = index.get(stemmed);
      if (entry === undefined) {
        entry = { pages: new Map(), variants: new Map() };
        index.set(stemmed, entry);
      }
      let pageEntry = entry.pages.get(pageNum);
      if (pageEntry === undefined) {
        pageEntry = { positions: new Map(), metaPositions: [] };
        entry.pages.set(pageNum, pageEntry);
      }

      if (weight === TITLE_WEIGHT) {
        pageEntry.metaPositions.push(position);
      } else {
        let bucket = pageEntry.positions.get(weight);
        if (bucket === undefined) {
          bucket = [];
          pageEntry.positions.set(weight, bucket);
        }
        if (bucket.length < MAX_POSITIONS_PER_WEIGHT) {
          bucket.push(position);
        }
      }

      if (t.stem !== t.original) {
        let vp = entry.variants.get(t.original);
        if (vp === undefined) {
          vp = [];
          entry.variants.set(t.original, vp);
        }
        if (!vp.includes(pageNum)) {
          vp.push(pageNum);
        }
      }
    }
  }
}
