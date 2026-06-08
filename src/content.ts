/**
 * Content DTOs and the content-source protocol.
 *
 * Ports `Tag1\Scolta\Export\ContentItem`, `Content\TrackerRecord` and
 * `Content\ContentSourceInterface`.
 */

export type FilterValue = string | string[];
export type Filters = Record<string, FilterValue>;
export type MetaMap = Record<string, string>;

export interface ContentItemInit {
  id: string;
  title: string;
  bodyHtml: string;
  /**
   * Absolute or relative URL. Absolute URLs are stripped to a path so the
   * Pagefind index is portable across environments (DDEV → production).
   */
  url: string;
  date: string;
  siteName?: string;
  language?: string;
  filters?: Filters;
  metadata?: MetaMap;
  sortable?: MetaMap;
}

/**
 * A single content item to be exported for Pagefind indexing.
 *
 * Platform adapters construct these from their native entity/post/model
 * objects. The exporter handles cleaning, HTML generation and file writing.
 *
 * `url` is always stored as a relative path: an absolute URL is stripped to
 * path?query#fragment so the index is portable across environments, matching
 * the PHP constructor's behaviour.
 */
export class ContentItem {
  readonly id: string;
  readonly title: string;
  readonly bodyHtml: string;
  readonly url: string;
  readonly date: string;
  readonly siteName: string;
  readonly language: string;
  readonly filters: Filters;
  readonly metadata: MetaMap;
  readonly sortable: MetaMap;

  constructor(init: ContentItemInit) {
    this.id = init.id;
    this.title = init.title;
    this.bodyHtml = init.bodyHtml;
    this.date = init.date;
    this.siteName = init.siteName ?? "";
    this.language = init.language ?? "en";
    this.filters = init.filters ?? {};
    this.metadata = init.metadata ?? {};
    this.sortable = init.sortable ?? {};
    this.url = ContentItem.normalizeUrl(init.url);
  }

  /**
   * Strip scheme and host so the baked-in URL works on any domain. An index
   * built on DDEV must serve correct links on production.
   */
  static normalizeUrl(url: string): string {
    if (!url.includes("://")) {
      return url;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return url;
    }
    let result = parsed.pathname || "/";
    if (parsed.search) {
      result += parsed.search;
    }
    if (parsed.hash) {
      result += parsed.hash;
    }
    return result;
  }

  /**
   * Return a copy with specific fields overridden. Use this instead of
   * constructing a new ContentItem when modifying an existing item — it
   * carries all fields forward and only replaces what is explicitly provided.
   */
  cloneWith(overrides: Partial<ContentItemInit>): ContentItem {
    return new ContentItem({
      id: overrides.id ?? this.id,
      title: overrides.title ?? this.title,
      bodyHtml: overrides.bodyHtml ?? this.bodyHtml,
      url: overrides.url ?? this.url,
      date: overrides.date ?? this.date,
      siteName: overrides.siteName ?? this.siteName,
      language: overrides.language ?? this.language,
      filters: overrides.filters ?? this.filters,
      metadata: overrides.metadata ?? this.metadata,
      sortable: overrides.sortable ?? this.sortable,
    });
  }
}

export const TrackerAction = {
  INDEX: "index",
  DELETE: "delete",
} as const;

export type TrackerActionValue = (typeof TrackerAction)[keyof typeof TrackerAction];

/**
 * A single change-tracker record. Platform adapters populate their tracker
 * tables with these when content is created, updated, or deleted.
 */
export interface TrackerRecord {
  contentId: string;
  contentType: string;
  action: TrackerActionValue;
  changedAt: Date | null;
}

/**
 * Protocol for platform-specific content sources.
 *
 * Each platform adapter implements this to enumerate content from its native
 * storage. The indexing pipeline calls these methods; results pass to the
 * exporter for HTML generation and Pagefind indexing.
 */
export interface ContentSource {
  /** Yield all published content items for full reindexing. */
  getPublishedContent(options?: Record<string, unknown>): AsyncIterable<ContentItem> | Iterable<ContentItem>;
  /** Yield only items changed since the last index. */
  getChangedContent(): AsyncIterable<ContentItem> | Iterable<ContentItem>;
  /** Return IDs of content deleted since the last index. */
  getDeletedIds(): Promise<string[]> | string[];
  /** Mark all tracked changes as processed after a successful build. */
  clearTracker(): Promise<void> | void;
  /** Total count of published content items. */
  getTotalCount(options?: Record<string, unknown>): Promise<number> | number;
  /** Count of items pending reindexing. */
  getPendingCount(): Promise<number> | number;
}
