import { describe, expect, it } from "vitest";
import { ellipsisPk, isUnnamedOperator, operatorCardLabel } from "./operatorLabel";

describe("operatorCardLabel", () => {
  it("keeps named operators", () => {
    expect(operatorCardLabel("Greenfield", "EG2KxxxxKENT")).toBe("Greenfield");
  });

  it("uses 4...4 primary when unnamed", () => {
    expect(isUnnamedOperator("unknown")).toBe(true);
    expect(ellipsisPk("EG2KxxxxxxxxxxxxxxxxxxxxxxxxxxxxKENT")).toBe("EG2K...KENT");
    expect(operatorCardLabel("unknown", "EG2KxxxxxxxxxxxxxxxxxxxxxxxxxxxxKENT")).toBe(
      "EG2K...KENT",
    );
  });
});
