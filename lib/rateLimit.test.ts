import { expect, it } from "vitest";
import { clearFailures, recordFailure, tooManyFailures } from "./rateLimit";

it("locks after max failures, expires, and clears on success", () => {
  for (let i = 0; i < 5; i++) recordFailure("a@x", 1000, 0);
  expect(tooManyFailures("a@x", 5, 1000, 500)).toBe(true);
  expect(tooManyFailures("a@x", 5, 1000, 2000)).toBe(false);
  clearFailures("a@x");
  expect(tooManyFailures("a@x", 5, 1000, 500)).toBe(false);
});
