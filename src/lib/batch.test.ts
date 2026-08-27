import { describe, expect, it } from "vitest";
import { isTxTooLarge, nextBatchSize, sequentialChunks } from "./batch";

describe("nextBatchSize", () => {
  it("halves when tx too large", () => {
    expect(nextBatchSize(3, true)).toBe(1);
    expect(nextBatchSize(4, true)).toBe(2);
    expect(nextBatchSize(1, true)).toBe(0);
  });
});

describe("sequentialChunks", () => {
  it("keeps epoch order", () => {
    expect(sequentialChunks([1, 2, 3, 4, 5], 3)).toEqual([[1, 2, 3], [4, 5]]);
  });
});

describe("isTxTooLarge", () => {
  it("matches solana size errors", () => {
    expect(isTxTooLarge("Transaction too large: 1233 > 1232")).toBe(true);
    expect(isTxTooLarge("Index out of range")).toBe(true);
  });
});
