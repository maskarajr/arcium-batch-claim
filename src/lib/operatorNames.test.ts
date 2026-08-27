import { describe, expect, it } from "vitest";
import {
  lookupOperatorName,
  mergeOperatorNameDump,
  sortedOperatorNameDump,
} from "./operatorNames";

const BOUND = "11111111111111111111111111111111";
const OWNER = "22222222222222222222222222222222";

describe("lookupOperatorName", () => {
  it("prefers bound node over owner", () => {
    expect(
      lookupOperatorName(
        { [BOUND]: "NodeName", [OWNER]: "OwnerName" },
        BOUND,
        OWNER,
      ),
    ).toBe("NodeName");
  });

  it("falls back to owner when bound node missing or unnamed", () => {
    expect(lookupOperatorName({ [OWNER]: "OwnerName" }, BOUND, OWNER)).toBe(
      "OwnerName",
    );
    expect(
      lookupOperatorName(
        { [BOUND]: "unknown", [OWNER]: "OwnerName" },
        BOUND,
        OWNER,
      ),
    ).toBe("OwnerName");
  });

  it("returns undefined when neither maps to a real name", () => {
    expect(lookupOperatorName({}, BOUND, OWNER)).toBeUndefined();
    expect(
      lookupOperatorName({ [OWNER]: "unknown" }, undefined, OWNER),
    ).toBeUndefined();
  });
});

describe("mergeOperatorNameDump", () => {
  it("adds new keys, updates changed names, keeps scrape misses", () => {
    const { merged, added, changed } = mergeOperatorNameDump(
      { keep: "KeepMe", change: "Old" },
      { change: "New", fresh: "Fresh" },
    );
    expect(added).toBe(1);
    expect(changed).toBe(1);
    expect(merged).toEqual({ keep: "KeepMe", change: "New", fresh: "Fresh" });
  });
});

describe("sortedOperatorNameDump", () => {
  it("sorts keys for stable JSON", () => {
    expect(Object.keys(sortedOperatorNameDump({ b: "B", a: "A" }))).toEqual([
      "a",
      "b",
    ]);
  });
});
