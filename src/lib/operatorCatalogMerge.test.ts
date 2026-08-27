import { describe, expect, it } from "vitest";
import { censusToCatalogResult } from "../../api/_lib/operator-catalog";

const OWNER = "33333333333333333333333333333333";
const BOUND = "44444444444444444444444444444444";
const PRIMARY = "55555555555555555555555555555555";

describe("censusToCatalogResult", () => {
  it("maps census rows without names", () => {
    const result = censusToCatalogResult([
      { owner: OWNER, primary: PRIMARY, boundNode: BOUND },
    ]);
    expect(result).toEqual({
      ok: true,
      operators: [
        {
          owner: OWNER,
          primary: PRIMARY,
          boundNode: BOUND,
        },
      ],
    });
  });

  it("fails closed when explorer is empty", () => {
    expect(censusToCatalogResult([])).toEqual({
      ok: false,
      status: 502,
      message: "no active clusterMembership nodes",
    });
    expect(censusToCatalogResult(null)).toEqual({
      ok: false,
      status: 502,
      message: "explorer nodes failed",
    });
  });
});
