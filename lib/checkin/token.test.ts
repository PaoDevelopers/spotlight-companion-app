import { describe, expect, it } from "vitest";
import { makeEventToken, verifyEventToken, makeTagToken, verifyTagToken, WINDOW_SECONDS } from "./token";

const S = "test-secret";
const t0 = 1_700_000_000_000;

describe("event token", () => {
  it("verifies a fresh token", () => {
    expect(verifyEventToken(S, makeEventToken(S, 7, t0), t0)).toBe(7);
  });
  it("accepts the previous window but not older", () => {
    const tok = makeEventToken(S, 7, t0);
    expect(verifyEventToken(S, tok, t0 + WINDOW_SECONDS * 1000)).toBe(7);
    expect(verifyEventToken(S, tok, t0 + 3 * WINDOW_SECONDS * 1000)).toBeNull();
  });
  it("rejects tampering and wrong secret", () => {
    const tok = makeEventToken(S, 7, t0);
    expect(verifyEventToken(S, tok.replace(/^7\./, "8."), t0)).toBeNull();
    expect(verifyEventToken("other", tok, t0)).toBeNull();
    expect(verifyEventToken(S, "garbage", t0)).toBeNull();
  });
  it("rejects tokens from the future", () => {
    expect(verifyEventToken(S, makeEventToken(S, 7, t0 + 5 * WINDOW_SECONDS * 1000), t0)).toBeNull();
  });
});

describe("tag token", () => {
  it("round-trips and rejects tampering", () => {
    const tok = makeTagToken(S, "exhibit", 3);
    expect(verifyTagToken(S, tok)).toEqual({ kind: "exhibit", id: 3 });
    expect(verifyTagToken(S, tok.replace("exhibit.3", "exhibit.4"))).toBeNull();
    expect(verifyTagToken("other", tok)).toBeNull();
  });
});
