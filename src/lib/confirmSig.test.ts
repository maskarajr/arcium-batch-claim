import { describe, expect, it } from "vitest";
import {
  classifyExpiredConfirm,
  classifySignatureStatus,
  confirmClaimSignature,
  isConfirmExpiredError,
  watchClaimSignatures,
} from "./confirmSig";

describe("isConfirmExpiredError", () => {
  it("matches block height exceeded", () => {
    expect(
      isConfirmExpiredError(
        "Signature 2hNZr8wHQxRywjvX9GXwph3ZGwdUu34d7skRWbQ42pt1HMvGSq6KhEzUPo4f8mrDMxXhGB3pof8UeG1aBDy3B4JC has expired: block height exceeded.",
      ),
    ).toBe(true);
  });
});

describe("classifySignatureStatus", () => {
  it("treats confirmed with null err as landed", () => {
    expect(
      classifySignatureStatus({ err: null, confirmationStatus: "confirmed" }),
    ).toBe("landed");
    expect(
      classifySignatureStatus({ err: null, confirmationStatus: "finalized" }),
    ).toBe("landed");
  });

  it("treats on-chain err as failed", () => {
    expect(
      classifySignatureStatus({ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" }),
    ).toBe("failed");
  });

  it("treats missing status as pending", () => {
    expect(classifySignatureStatus(null)).toBe("pending");
    expect(classifySignatureStatus({ err: null, confirmationStatus: "processed" })).toBe(
      "pending",
    );
  });
});

describe("classifyExpiredConfirm", () => {
  it("counts expired confirm as success when signature is confirmed", () => {
    expect(
      classifyExpiredConfirm(
        "Signature abc has expired: block height exceeded.",
        { err: null, confirmationStatus: "confirmed" },
      ),
    ).toBe("landed");
  });

  it("drops when expired and signature never appears", () => {
    expect(
      classifyExpiredConfirm("Transaction has expired: block height exceeded.", null),
    ).toBe("dropped");
  });
});

describe("watchClaimSignatures", () => {
  it("lands after block height exceeded when history is confirmed", async () => {
    const outcomes: string[] = [];
    await watchClaimSignatures(
      {
        getBlockHeight: async () => 101,
        getSignatureStatuses: async () => ({
          context: { slot: 2 },
          value: [
            {
              slot: 2,
              confirmations: 32,
              err: null,
              confirmationStatus: "confirmed" as const,
            },
          ],
        }),
      },
      ["sig"],
      100,
      (_i, o) => {
        outcomes.push(o);
      },
    );
    expect(outcomes).toEqual(["landed"]);
  });
});

describe("confirmClaimSignature", () => {
  it("lands from getSignatureStatuses without confirmTransaction", async () => {
    await expect(
      confirmClaimSignature(
        {
          getBlockHeight: async () => 1,
          getSignatureStatuses: async () => ({
            context: { slot: 1 },
            value: [
              {
                slot: 1,
                confirmations: 32,
                err: null,
                confirmationStatus: "confirmed" as const,
              },
            ],
          }),
        },
        "sig",
        "blockhash",
        100,
      ),
    ).resolves.toBe("landed");
  });
});
