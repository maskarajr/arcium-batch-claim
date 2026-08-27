import { describe, expect, it } from "vitest";
import { delegatedRewardLamports, leafIndexForEpoch, parseIndexerProof } from "./proof";
import { formatArx, lamportsToSol } from "./types";

describe("parseIndexerProof", () => {
  const opening = Array.from({ length: 15 }, () => Array.from({ length: 32 }, (_, i) => i));

  it("parses portal JSON shape", () => {
    const parsed = parseIndexerProof(
      {
        opening,
        claim: {
          total_rewards: "890598",
          primary_stake: "1000000000000",
          delegated_stake: "118842095362659",
          epoch: "352",
        },
      },
      352,
      352n,
    );
    expect(parsed.leafIndex).toBe(352);
    expect(parsed.epoch).toBe(352n);
    expect(parsed.opening).toHaveLength(15);
  });

  it("rejects short openings", () => {
    expect(() =>
      parseIndexerProof({ opening: [[1]], claim: { epoch: 1, total_rewards: 0, primary_stake: 0, delegated_stake: 0 } }, 0),
    ).toThrow(/15 hashes/);
  });
});

describe("leafIndexForEpoch", () => {
  it("maps epoch to leaf when tree starts at 0", () => {
    expect(leafIndexForEpoch(352n, 0n, 438)).toBe(352);
  });

  it("returns null past tree size", () => {
    expect(leafIndexForEpoch(438n, 0n, 438)).toBeNull();
  });
});

describe("lamportsToSol", () => {
  it("keeps fractional SOL (portal 0.000029)", () => {
    expect(lamportsToSol(29_000n)).toBe("0.000029");
  });

  it("formats ARX stake", () => {
    expect(formatArx(4_000_000_000_000n)).toBe("4,000");
  });
});

describe("delegatedRewardLamports", () => {
  it("returns 0 when delegated stake is 0", () => {
    expect(
      delegatedRewardLamports(
        {
          epoch: 0n,
          leafIndex: 0,
          opening: [],
          totalRewards: 100n,
          primaryStake: 1n,
          delegatedStake: 0n,
        },
        100,
        1n,
      ),
    ).toBe(0n);
  });
});
