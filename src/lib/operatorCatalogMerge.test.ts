import { describe, expect, it } from "vitest";
import { mergeOperatorCatalog } from "./operatorCatalogMerge";

const OWNER = "33333333333333333333333333333333";
const BOUND = "44444444444444444444444444444444";
const PRIMARY = "55555555555555555555555555555555";

describe("mergeOperatorCatalog", () => {
  it("overlays JSON names boundNode then owner and passes boundNode", () => {
    const result = mergeOperatorCatalog(
      [{ owner: OWNER, primary: PRIMARY, boundNode: BOUND }],
      { [BOUND]: "FromNode", [OWNER]: "FromOwner" },
    );
    expect(result).toEqual({
      ok: true,
      operators: [
        {
          owner: OWNER,
          name: "FromNode",
          primary: PRIMARY,
          boundNode: BOUND,
        },
      ],
    });
  });

  it("uses owner name when boundNode is absent from JSON", () => {
    const result = mergeOperatorCatalog([{ owner: OWNER, boundNode: BOUND }], {
      [OWNER]: "FromOwner",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.operators[0]?.name).toBe("FromOwner");
  });

  it("fails closed when explorer is empty", () => {
    expect(mergeOperatorCatalog([], {})).toEqual({
      ok: false,
      status: 502,
      message: "no active clusterMembership nodes",
    });
    expect(mergeOperatorCatalog(null, {})).toEqual({
      ok: false,
      status: 502,
      message: "explorer nodes failed",
    });
  });
});
