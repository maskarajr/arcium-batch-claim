import type { Connection } from "@solana/web3.js";

export type ConfirmationStatus = "processed" | "confirmed" | "finalized";

export const SIG_POLL_MS = 150;
const SIG_STATUS_CHUNK = 256;

export type SigStatusLike = {
  err: unknown;
  confirmationStatus?: ConfirmationStatus | null;
};

export type SigLandedKind = "landed" | "failed" | "pending";

export function isConfirmExpiredError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("block height exceeded") ||
    m.includes("has expired") ||
    m.includes("blockhash not found") ||
    m.includes("transaction expired")
  );
}

export function classifySignatureStatus(status: SigStatusLike | null): SigLandedKind {
  if (!status) return "pending";
  if (status.err) return "failed";
  const cs = status.confirmationStatus;
  if (cs == null) return "pending";
  switch (cs) {
    case "confirmed":
    case "finalized":
      return "landed";
    case "processed":
      return "pending";
    default: {
      const _exhaustive: never = cs;
      return _exhaustive;
    }
  }
}

export function classifyExpiredConfirm(
  errorMessage: string,
  status: SigStatusLike | null,
): SigLandedKind | "dropped" {
  const kind = classifySignatureStatus(status);
  switch (kind) {
    case "landed":
    case "failed":
      return kind;
    case "pending":
      return isConfirmExpiredError(errorMessage) ? "dropped" : "pending";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ConfirmConn = {
  confirmTransaction?: Connection["confirmTransaction"];
  getSignatureStatuses: Connection["getSignatureStatuses"];
  getBlockHeight: Connection["getBlockHeight"];
};

export type SigWatchOutcome = "landed" | "failed" | "dropped";

export async function watchClaimSignatures(
  connection: ConfirmConn,
  signatures: string[],
  lastValidBlockHeight: number,
  onOutcome: (index: number, outcome: SigWatchOutcome) => void | Promise<void>,
): Promise<void> {
  const open = new Set(signatures.map((_, i) => i));
  while (open.size > 0) {
    const height = await connection.getBlockHeight("confirmed");
    if (height > lastValidBlockHeight) {
      const pendingIdx = [...open];
      for (let off = 0; off < pendingIdx.length; off += SIG_STATUS_CHUNK) {
        const chunkIdx = pendingIdx.slice(off, off + SIG_STATUS_CHUNK);
        const chunkSigs = chunkIdx.map((i) => signatures[i]);
        const resp = await connection.getSignatureStatuses(chunkSigs, {
          searchTransactionHistory: true,
        });
        for (let j = 0; j < chunkIdx.length; j++) {
          const i = chunkIdx[j];
          const raw = resp.value[j];
          const status: SigStatusLike | null = raw
            ? { err: raw.err, confirmationStatus: raw.confirmationStatus }
            : null;
          const classified = classifyExpiredConfirm("block height exceeded", status);
          open.delete(i);
          switch (classified) {
            case "landed":
            case "failed":
            case "dropped":
              await onOutcome(i, classified);
              break;
            case "pending":
              await onOutcome(i, "dropped");
              break;
            default: {
              const _exhaustive: never = classified;
              void _exhaustive;
            }
          }
        }
      }
      return;
    }

    const pendingIdx = [...open];
    for (let off = 0; off < pendingIdx.length; off += SIG_STATUS_CHUNK) {
      const chunkIdx = pendingIdx.slice(off, off + SIG_STATUS_CHUNK);
      const chunkSigs = chunkIdx.map((i) => signatures[i]);
      const resp = await connection.getSignatureStatuses(chunkSigs, {
        searchTransactionHistory: true,
      });
      for (let j = 0; j < chunkIdx.length; j++) {
        const i = chunkIdx[j];
        const raw = resp.value[j];
        const status: SigStatusLike | null = raw
          ? { err: raw.err, confirmationStatus: raw.confirmationStatus }
          : null;
        const kind = classifySignatureStatus(status);
        switch (kind) {
          case "pending":
            break;
          case "landed":
          case "failed":
            open.delete(i);
            await onOutcome(i, kind);
            break;
          default: {
            const _exhaustive: never = kind;
            void _exhaustive;
          }
        }
      }
    }

    if (open.size > 0) await sleep(SIG_POLL_MS);
  }
}

export async function confirmClaimSignature(
  connection: ConfirmConn,
  signature: string,
  _blockhash: string,
  lastValidBlockHeight: number,
): Promise<SigWatchOutcome> {
  let outcome: SigWatchOutcome | undefined;
  await watchClaimSignatures(connection, [signature], lastValidBlockHeight, (_i, o) => {
    outcome = o;
  });
  return outcome ?? "dropped";
}
