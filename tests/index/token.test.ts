/**
 * Token tests (ported from tests/Index/TokenTest.php).
 *
 * The PHP/Python memory-layout test (final readonly class / __slots__) does not
 * translate to a plain TS object; only the behavioural property test is ported.
 */

import { describe, expect, it } from "vitest";
import { token } from "../../src/index/token.js";

describe("Token", () => {
  it("properties are readable", () => {
    const t = token("hello", "Hello", 42);
    expect(t.stem).toBe("hello");
    expect(t.original).toBe("Hello");
    expect(t.position).toBe(42);
  });
});
