import type { Connection } from "@solana/web3.js";

export type SendStepOutcome = "landed" | "failed" | "dropped" | "send-error" | "expired";

export type SequentialSendStop = "complete" | "abort" | "resign";

export type SequentialSendStepResult =
  | { ok: true }
  | { ok: false; reason: Exclude<SendStepOutcome, "landed"> };

export async function runSequentialSends(opts: {
  count: number;
  sendAndConfirm: (index: number) => Promise<SequentialSendStepResult>;
}): Promise<{ landed: number; stop: SequentialSendStop }> {
  for (let i = 0; i < opts.count; i++) {
    const step = await opts.sendAndConfirm(i);
    if (step.ok) continue;
    switch (step.reason) {
      case "expired":
        return { landed: i, stop: "resign" };
      case "failed":
      case "dropped":
      case "send-error":
        return { landed: i, stop: "abort" };
      default: {
        const _exhaustive: never = step.reason;
        void _exhaustive;
        return { landed: i, stop: "abort" };
      }
    }
  }
  return { landed: opts.count, stop: "complete" };
}

export function shouldAbortRemainingSends(outcome: SendStepOutcome): boolean {
  switch (outcome) {
    case "landed":
      return false;
    case "failed":
    case "dropped":
    case "send-error":
    case "expired":
      return true;
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

export type ClaimIdlErrorName = "rewardsNotClaimed" | "rewardsAlreadyClaimed";

export function idlNameFromCustomCode(code: number): ClaimIdlErrorName | null {
  switch (code) {
    case 6004:
      return "rewardsNotClaimed";
    case 6005:
      return "rewardsAlreadyClaimed";
    default:
      return null;
  }
}

export function customErrorFromTxErr(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  if (!("InstructionError" in err)) return null;
  const ie = (err as { InstructionError: unknown }).InstructionError;
  if (!Array.isArray(ie) || ie.length < 2) return null;
  const inner = ie[1];
  if (inner && typeof inner === "object" && inner !== null && "Custom" in inner) {
    const n = (inner as { Custom: unknown }).Custom;
    if (typeof n === "number") return n;
  }
  return null;
}

export function customCodeFromMessage(message: string): number | null {
  const hex = message.match(/custom program error:\s*0x([0-9a-f]+)/i);
  if (hex) return parseInt(hex[1], 16);
  const dec = message.match(/custom program error:\s*(\d+)/i);
  if (dec) return Number(dec[1]);
  return null;
}

function idlNameFromLogs(logs: readonly string[] | undefined): ClaimIdlErrorName | null {
  if (!logs) return null;
  const blob = logs.join("\n");
  if (blob.includes("rewardsAlreadyClaimed")) return "rewardsAlreadyClaimed";
  if (blob.includes("rewardsNotClaimed")) return "rewardsNotClaimed";
  return null;
}

export function formatOnChainClaimError(
  signature: string,
  err: unknown,
  logs?: readonly string[],
): string {
  const code = customErrorFromTxErr(err);
  const named =
    (code != null ? idlNameFromCustomCode(code) : null) ?? idlNameFromLogs(logs);
  if (named) return `on-chain error ${named} ${signature}`;
  return `on-chain error ${signature}`;
}

export function formatSendFailure(message: string): string {
  const code = customCodeFromMessage(message);
  const named = code != null ? idlNameFromCustomCode(code) : null;
  if (named) return `on-chain error ${named}`;
  return message;
}

type FailConn = {
  getTransaction: Connection["getTransaction"];
  getSignatureStatuses: Connection["getSignatureStatuses"];
};

export async function describeClaimFailure(
  connection: FailConn,
  signature: string,
): Promise<string> {
  try {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (tx?.meta?.err) {
      return formatOnChainClaimError(signature, tx.meta.err, tx.meta.logMessages ?? undefined);
    }
  } catch {
    // RPC may lag; fall through to signature status.
  }
  try {
    const st = await connection.getSignatureStatuses([signature]);
    const err = st.value[0]?.err;
    if (err) return formatOnChainClaimError(signature, err);
  } catch {
    // keep generic fallback
  }
  return `on-chain error ${signature}`;
}
