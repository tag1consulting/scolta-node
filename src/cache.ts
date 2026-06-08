/**
 * Cache abstraction for AI endpoint response caching.
 *
 * Ports `Tag1\Scolta\Cache\CacheDriverInterface` and `NullCacheDriver`. Each
 * platform adapter implements this with its native backend. A simple in-memory
 * driver is provided for tests and standalone use.
 */

export interface CacheDriver {
  /** Return the cached value, or null if not found. */
  get(key: string): unknown;
  /** Store a value with a time-to-live in seconds. */
  set(key: string, value: unknown, ttlSeconds: number): void;
}

/** No-op driver for when caching is disabled (cacheTtl <= 0). */
export class NullCacheDriver implements CacheDriver {
  get(_key: string): unknown {
    return null;
  }

  set(_key: string, _value: unknown, _ttlSeconds: number): void {
    // intentionally empty
  }
}

/** Simple Map-backed cache (TTL not enforced) for tests/standalone use. */
export class InMemoryCacheDriver implements CacheDriver {
  private store = new Map<string, unknown>();

  get(key: string): unknown {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  set(key: string, value: unknown, _ttlSeconds: number): void {
    this.store.set(key, value);
  }
}
