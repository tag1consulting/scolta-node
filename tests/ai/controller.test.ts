/**
 * Ported from tests/Http/AiControllerTraitTest.php.
 *
 * The PHP/Python controller is an abstract mixin with a `_resolve_cache`
 * hook; the TS binding uses a `createAiEndpointHandler` factory that takes the
 * cache directly. These tests assert the factory wires config through and the
 * resulting handler honours cache_ttl.
 */

import { describe, expect, it } from "vitest";
import { createAiEndpointHandler } from "../../src/ai/controller.js";
import { AiEndpointHandler } from "../../src/ai/endpoint.js";
import { ScoltaConfig } from "../../src/config.js";
import { MockAiService, TrackingCacheDriver } from "./doubles.js";

describe("createAiEndpointHandler", () => {
  it("returns an AiEndpointHandler", () => {
    const handler = createAiEndpointHandler(new MockAiService(), new ScoltaConfig(), {
      cache: new TrackingCacheDriver(),
      generation: 0,
    });
    expect(handler).toBeInstanceOf(AiEndpointHandler);
  });

  it("cache_ttl zero never touches cache", async () => {
    const config = new ScoltaConfig();
    config.cache_ttl = 0;
    const cache = new TrackingCacheDriver();
    const handler = createAiEndpointHandler(new MockAiService({ response: '["a", "b"]' }), config, {
      cache,
      generation: 0,
    });
    await handler.handleExpandQuery("test query");
    expect(cache.getCalls).toBe(0);
    expect(cache.setCalls).toBe(0);
  });

  it("cache_ttl > 0 reads and writes cache", async () => {
    const config = new ScoltaConfig();
    config.cache_ttl = 3600;
    const cache = new TrackingCacheDriver();
    const handler = createAiEndpointHandler(new MockAiService({ response: '["a", "b", "c"]' }), config, {
      cache,
      generation: 7,
    });
    await handler.handleExpandQuery("test query");
    expect(cache.getCalls).toBeGreaterThan(0);
    expect(cache.setCalls).toBeGreaterThan(0);
  });
});
