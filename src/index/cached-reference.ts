/**
 * CachedContentReference marker (port, 1:1).
 *
 * Yielded by gatherers for entities unchanged since the last build: carries the
 * metadata needed to rebuild a chunk entry from cached token data, without
 * loading the entity body.
 */

export class CachedContentReference {
  constructor(
    readonly entityKey: string,
    readonly contentHash: string,
    readonly id: string,
    readonly url: string,
    readonly date: string,
    readonly siteName: string,
    readonly language: string,
    readonly filters: Record<string, string | string[]>,
    readonly sortable: Record<string, string> = {},
  ) {}
}
