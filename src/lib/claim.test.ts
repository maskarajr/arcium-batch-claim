import { describe, expect, it, vi } from "vitest";
import type { ClaimableRow } from "./types";

const watchClaimSignatures = vi.hoisted(() => vi.fn());

vi.mock("./confirmSig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./confirmSig")>();
  return {
    ...actual,
    watchClaimSignatures: (
      ...args: Parameters<typeof actual.watchClaimSignatures>
    ) => watchClaimSignatures(...args),
  };
});

import { groupRowsByStakeAccOrder, sendAndConfirmSignedSlices } from "./claim";

function row(over: Pick<ClaimableRow, "delegatedStakeAcc" | "epoch">): ClaimableRow {
  return {
    epoch: over.epoch,
    stakeOffset: 1n,
    operatorName: "Op",
    operatorOwner: "own",
    amountLamports: 1n,
    status: "proof-ready",
    feeBasisPoints: 0,
    primaryAccountOwner: "p",
    delegatedStakeAcc: over.delegatedStakeAcc,
    stakeBaseUnits: 1n,
  };
}

describe("groupRowsByStakeAccOrder", () => {
  it("groups by shells order, not mixed row order", () => {
    const mixed = [
      row({ delegatedStakeAcc: "b", epoch: 2n }),
      row({ delegatedStakeAcc: "a", epoch: 1n }),
      row({ delegatedStakeAcc: "b", epoch: 3n }),
    ];
    const groups = groupRowsByStakeAccOrder(mixed, ["a", "b"]);
    expect(groups.map((g) => g.map((r) => `${r.delegatedStakeAcc}:${r.epoch}`))).toEqual([
      ["a:1"],
      ["b:2", "b:3"],
    ]);
  });
});

describe("sendAndConfirmSignedSlices", () => {
  it("does not send remaining after first watch failed", async () => {
    watchClaimSignatures.mockImplementation(
      async (
        _c: unknown,
        _sigs: unknown,
        _h: unknown,
        onOutcome: (index: number, outcome: "failed") => void | Promise<void>,
      ) => {
        await onOutcome(0, "failed");
      },
    );
    const sendRawTransaction = vi.fn(async () => "sig0");
    const result = await sendAndConfirmSignedSlices({
      connection: {
        sendRawTransaction,
        getBlockHeight: async () => 1,
        getSignatureStatuses: async () => ({ context: { slot: 1 }, value: [null] }),
        getTransaction: async () => null,
      },
      signed: [{ serialize: () => new Uint8Array([1]) }, { serialize: () => new Uint8Array([2]) }],
      slices: [
        [row({ delegatedStakeAcc: "a", epoch: 1n })],
        [row({ delegatedStakeAcc: "a", epoch: 2n })],
      ],
      lastValidBlockHeight: 10,
      epochTotal: 2,
      onProgress: () => {},
    });
    expect(sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(result.stop).toBe("abort");
  });
});
