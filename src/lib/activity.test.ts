import { describe, expect, it } from "vitest";
import {
  activityHeadline,
  activityItems,
  activityLatestLine,
  claimRowStatusLabel,
} from "./activity";
import type { ClaimProgress } from "./claim";

const base = {
  epoch: 368n,
  stakeOffset: 1n,
  amountLamports: 1_000_000_000n,
  signature: "sigA",
  operatorName: "Greenfield",
  delegatedStakeAcc: "7Jd9xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxJPG1",
};

function submitted(over: Partial<typeof base> = {}): ClaimProgress {
  return { kind: "submitted", ...base, ...over };
}

function claimed(over: Partial<typeof base> = {}): ClaimProgress {
  return { kind: "claimed", ...base, ...over };
}

describe("activityItems", () => {
  it("upserts submitted to claimed by stakeOffset:epoch", () => {
    const items = activityItems([
      { kind: "sending", total: 2 },
      submitted(),
      submitted({ epoch: 369n, signature: "sigB" }),
      claimed(),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "claim", status: "claimed", epoch: 368n });
    expect(items[1]).toMatchObject({ kind: "claim", status: "submitted", epoch: 369n });
  });

  it("keeps error rows", () => {
    const items = activityItems([
      submitted(),
      {
        kind: "claim-error",
        ...base,
        signature: "sigA",
        message: "dropped sigA",
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "claim", status: "error" });
  });
});

describe("activityHeadline", () => {
  it("asks wallet to approve every remaining claim tx once", () => {
    expect(
      activityHeadline([{ kind: "approve", from: 1, to: 70, total: 70 }], true),
    ).toBe("Approve 1–70 of 70 in wallet");
  });

  it("broadcasts submitted count then confirmed", () => {
    const send = [
      { kind: "sending" as const, total: 82 },
      submitted(),
      submitted({ epoch: 369n }),
      submitted({ epoch: 370n }),
    ];
    expect(activityHeadline(send, true)).toBe("Broadcast 3/82");
    const confirm = [...send, { kind: "confirming" as const, total: 82 }, claimed()];
    expect(activityHeadline(confirm, true)).toBe("Confirmed 1/82");
    expect(activityHeadline(confirm, false)).toBe("Claimed epoch 368");
  });

  it("idle with no claimed is Claim complete", () => {
    expect(activityHeadline([{ kind: "sending", total: 1 }], false)).toBe("Claim complete");
  });
});

describe("activityLatestLine", () => {
  it("formats submitted latest", () => {
    const items = activityItems([submitted()]);
    expect(activityLatestLine(items)).toMatch(/Greenfield · 7Jd9…JPG1 · Epoch 368 · submitted/);
  });
});

describe("claimRowStatusLabel", () => {
  it("keeps View-ready claimed label", () => {
    const item = activityItems([claimed()])[0];
    if (item.kind !== "claim") throw new Error("expected claim");
    expect(claimRowStatusLabel(item)).toBe("Claimed +1 SOL");
  });
});
