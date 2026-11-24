import { describe, expect, it } from "vitest";
import { TICKS_PER_DAY } from "./index";

describe("shared constants", () => {
  it("has 288 ticks per day", () => {
    expect(TICKS_PER_DAY).toBe(288);
  });
});
