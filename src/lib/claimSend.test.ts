import { describe, expect, it } from "vitest";
import {
  customCodeFromMessage,
  customErrorFromTxErr,
  formatOnChainClaimError,
  formatSendFailure,
  idlNameFromCustomCode,
  runSequentialSends,
  shouldAbortRemainingSends,
} from "./claimSend";

describe("shouldAbortRemainingSends", () => {
  it("continues after landed and aborts after failure", () => {
    expect(shouldAbortRemainingSends("landed")).toBe(false);
    expect(shouldAbortRemainingSends("failed")).toBe(true);
    expect(shouldAbortRemainingSends("dropped")).toBe(true);
    expect(shouldAbortRemainingSends("send-error")).toBe(true);
  });
});

describe("runSequentialSends", () => {
  it("does not send remaining after first failure", async () => {
    const calls: number[] = [];
    const result = await runSequentialSends({
      count: 3,
      sendAndConfirm: async (index) => {
        calls.push(index);
        if (index === 1) return { ok: false, reason: "send-error" };
        return { ok: true };
      },
    });
    expect(calls).toEqual([0, 1]);
    expect(result).toEqual({ landed: 1, stop: "abort" });
  });

  it("resigns leftover signed txs only after an expired send", async () => {
    const calls: number[] = [];
    const result = await runSequentialSends({
      count: 3,
      sendAndConfirm: async (index) => {
        calls.push(index);
        if (index === 1) return { ok: false, reason: "expired" };
        return { ok: true };
      },
    });
    expect(calls).toEqual([0, 1]);
    expect(result).toEqual({ landed: 1, stop: "resign" });
  });
});


describe("idl claim errors", () => {
  it("maps 6004/6005", () => {
    expect(idlNameFromCustomCode(6004)).toBe("rewardsNotClaimed");
    expect(idlNameFromCustomCode(6005)).toBe("rewardsAlreadyClaimed");
    expect(idlNameFromCustomCode(1)).toBeNull();
  });

  it("reads InstructionError Custom", () => {
    expect(customErrorFromTxErr({ InstructionError: [2, { Custom: 6005 }] })).toBe(6005);
  });

  it("names failed sigs", () => {
    expect(
      formatOnChainClaimError("sigX", { InstructionError: [2, { Custom: 6005 }] }),
    ).toBe("on-chain error rewardsAlreadyClaimed sigX");
    expect(
      formatOnChainClaimError("sigY", { InstructionError: [2, { Custom: 6004 }] }),
    ).toBe("on-chain error rewardsNotClaimed sigY");
    expect(formatOnChainClaimError("sigZ", { InstructionError: [0, "GenericError"] })).toBe(
      "on-chain error sigZ",
    );
  });

  it("names preflight custom codes", () => {
    expect(
      formatSendFailure("Transaction simulation failed: custom program error: 0x1775"),
    ).toBe("on-chain error rewardsAlreadyClaimed");
    expect(customCodeFromMessage("custom program error: 0x1774")).toBe(6004);
  });
});
