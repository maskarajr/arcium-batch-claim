import { buildClaimDelegatedStakeRewardsIx, getStakingProgram } from "@arcium-hq/staking";
import { AnchorProvider } from "@anchor-lang/core";
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import { isTxTooLarge, nextBatchSize, sequentialChunks } from "./batch";
import {
  describeClaimFailure,
  formatSendFailure,
  runSequentialSends,
} from "./claimSend";
import {
  isConfirmExpiredError,
  watchClaimSignatures,
  type ConfirmConn,
  type SigWatchOutcome,
} from "./confirmSig";
import {
  CU_PER_CLAIM,
  CU_PRICE_MICRO,
  INITIAL_BATCH_SIZE,
  TX_SIZE_LIMIT,
} from "./constants";
import type { ClaimableRow } from "./types";

type ClaimEpochFields = {
  epoch: bigint;
  stakeOffset: bigint;
  amountLamports: bigint;
  signature: string;
  operatorName: string;
  delegatedStakeAcc: string;
};

export type ClaimProgress =
  | { kind: "fitting" }
  | { kind: "approve"; from: number; to: number; total: number }
  | { kind: "sending"; total: number }
  | { kind: "confirming"; total: number }
  | ({ kind: "submitted" } & ClaimEpochFields)
  | ({ kind: "claimed" } & ClaimEpochFields)
  | ({ kind: "claim-error"; message: string } & Omit<ClaimEpochFields, "signature"> & {
      signature: string | null;
    });

export type ClaimProgressHandler = (event: ClaimProgress) => void;

type WalletLike = {
  publicKey: PublicKey | null;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signAllTransactions?: (txs: Transaction[]) => Promise<Transaction[]>;
};

function toBn(n: bigint): BN {
  return new BN(n.toString());
}

export async function buildClaimIx(
  connection: Connection,
  signer: PublicKey,
  destination: PublicKey,
  row: ClaimableRow,
): Promise<TransactionInstruction> {
  if (!row.proof) throw new Error(`epoch ${row.epoch} has no proof`);
  const provider = new AnchorProvider(
    connection,
    {
      publicKey: signer,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
    },
    { commitment: "confirmed" },
  );
  const program = getStakingProgram(provider);
  const proof = row.proof;
  return buildClaimDelegatedStakeRewardsIx({
    program,
    signer,
    destination,
    primaryAccountOwner: new PublicKey(row.primaryAccountOwner),
    stakeOffset: row.stakeOffset,
    proof: {
      leafIndex: proof.leafIndex,
      opening: proof.opening.map((bytes) => ({ 0: bytes })),
    },
    claims: {
      claims: [
        {
          totalRewards: toBn(proof.totalRewards),
          primaryStake: toBn(proof.primaryStake),
          delegatedStake: toBn(proof.delegatedStake),
          epoch: { 0: toBn(proof.epoch) },
        },
      ],
    },
  });
}

function txBytes(tx: Transaction): number {
  tx.feePayer = tx.feePayer ?? PublicKey.unique();
  if (!tx.recentBlockhash) tx.recentBlockhash = PublicKey.unique().toBase58();
  try {
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isTxTooLarge(msg)) return TX_SIZE_LIMIT + 1;
    throw err;
  }
}

function rowKey(row: ClaimableRow): string {
  return `${row.stakeOffset}:${row.epoch}`;
}

export function groupRowsByStakeAccOrder(
  rows: ClaimableRow[],
  stakeAccOrder: string[],
): ClaimableRow[][] {
  const groups: ClaimableRow[][] = [];
  const seen = new Set<string>();
  for (const acc of stakeAccOrder) {
    const group = rows.filter((r) => r.delegatedStakeAcc === acc);
    if (group.length === 0) continue;
    groups.push(group);
    seen.add(acc);
  }
  for (const row of rows) {
    if (seen.has(row.delegatedStakeAcc)) continue;
    groups.push(rows.filter((r) => r.delegatedStakeAcc === row.delegatedStakeAcc));
    seen.add(row.delegatedStakeAcc);
  }
  return groups;
}

function epochFields(row: ClaimableRow, signature: string) {
  return {
    epoch: row.epoch,
    stakeOffset: row.stakeOffset,
    amountLamports: row.amountLamports,
    signature,
    operatorName: row.operatorName,
    delegatedStakeAcc: row.delegatedStakeAcc,
  };
}

function emitSlice(
  onProgress: ClaimProgressHandler,
  kind: "submitted" | "claimed",
  slice: ClaimableRow[],
  signature: string,
) {
  for (const row of slice) {
    onProgress({ kind, ...epochFields(row, signature) });
  }
}

function emitSliceError(
  onProgress: ClaimProgressHandler,
  slice: ClaimableRow[],
  signature: string | null,
  message: string,
) {
  for (const row of slice) {
    onProgress({
      kind: "claim-error",
      epoch: row.epoch,
      stakeOffset: row.stakeOffset,
      amountLamports: row.amountLamports,
      signature,
      operatorName: row.operatorName,
      delegatedStakeAcc: row.delegatedStakeAcc,
      message,
    });
  }
}

async function buildPackedTx(
  connection: Connection,
  signer: PublicKey,
  slice: ClaimableRow[],
  blockhash: string,
): Promise<Transaction> {
  const ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: CU_PER_CLAIM * slice.length }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE_MICRO }),
  ];
  for (const row of slice) {
    ixs.push(await buildClaimIx(connection, signer, signer, row));
  }
  const tx = new Transaction({ feePayer: signer, recentBlockhash: blockhash });
  for (const ix of ixs) tx.add(ix);
  return tx;
}

async function packSlices(
  connection: Connection,
  signer: PublicKey,
  ready: ClaimableRow[],
  startPack: number,
  onProgress: ClaimProgressHandler,
): Promise<{ slices: ClaimableRow[][]; packSize: number; stoppedAt?: string }> {
  let packSize = Math.max(1, startPack);
  for (;;) {
    const slices = sequentialChunks(ready, packSize);
    let tooBig = false;
    for (const slice of slices) {
      const probe = await buildPackedTx(connection, signer, slice, PublicKey.unique().toBase58());
      if (txBytes(probe) > TX_SIZE_LIMIT) {
        tooBig = true;
        break;
      }
    }
    if (!tooBig) return { slices, packSize };
    const next = nextBatchSize(packSize, true);
    if (next === 0) {
      return { slices: [], packSize, stoppedAt: "single instruction still exceeds tx size" };
    }
    onProgress({ kind: "fitting" });
    packSize = next;
  }
}

async function signPacked(
  wallet: WalletLike,
  txs: Transaction[],
): Promise<Transaction[]> {
  if (wallet.signAllTransactions) {
    return wallet.signAllTransactions(txs);
  }
  const signed: Transaction[] = [];
  for (const tx of txs) {
    signed.push(await wallet.signTransaction(tx));
  }
  return signed;
}

type SendWatchConn = ConfirmConn & {
  sendRawTransaction: Connection["sendRawTransaction"];
  getTransaction: Connection["getTransaction"];
};

export async function sendAndConfirmSignedSlices(opts: {
  connection: SendWatchConn;
  signed: Array<{ serialize: () => Uint8Array }>;
  slices: ClaimableRow[][];
  lastValidBlockHeight: number;
  epochTotal: number;
  onProgress: ClaimProgressHandler;
}): Promise<{
  signatures: string[];
  claimedKeys: string[];
  consumed: number;
  stop: "complete" | "abort" | "resign";
  sendStopped?: string;
}> {
  const { connection, signed, slices, lastValidBlockHeight, epochTotal, onProgress } = opts;
  const signatures: string[] = [];
  const claimedKeys: string[] = [];
  let sendStopped: string | undefined;

  const step = await runSequentialSends({
    count: signed.length,
    sendAndConfirm: async (i) => {
      const slice = slices[i];
      let sig: string;
      try {
        sig = await connection.sendRawTransaction(signed[i].serialize(), {
          skipPreflight: true,
        });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const msg = formatSendFailure(raw);
        emitSliceError(onProgress, slice, null, msg);
        if (isConfirmExpiredError(raw)) {
          return { ok: false, reason: "expired" as const };
        }
        sendStopped = msg;
        return { ok: false, reason: "send-error" as const };
      }

      emitSlice(onProgress, "submitted", slice, sig);
      onProgress({ kind: "confirming", total: epochTotal });
      let watchOutcome: SigWatchOutcome | undefined;
      await watchClaimSignatures(connection, [sig], lastValidBlockHeight, (_index, outcome) => {
        watchOutcome = outcome;
      });
      const outcome = watchOutcome ?? "dropped";
      switch (outcome) {
        case "landed": {
          signatures.push(sig);
          for (const row of slice) {
            claimedKeys.push(rowKey(row));
          }
          emitSlice(onProgress, "claimed", slice, sig);
          return { ok: true as const };
        }
        case "failed": {
          const msg = await describeClaimFailure(connection, sig);
          sendStopped = msg;
          emitSliceError(onProgress, slice, sig, msg);
          return { ok: false, reason: "failed" as const };
        }
        case "dropped": {
          const msg = `dropped ${sig}`;
          sendStopped = msg;
          emitSliceError(onProgress, slice, sig, msg);
          return { ok: false, reason: "dropped" as const };
        }
        default: {
          const _exhaustive: never = outcome;
          sendStopped = String(_exhaustive);
          return { ok: false, reason: "send-error" as const };
        }
      }
    },
  });

  return {
    signatures,
    claimedKeys,
    consumed: step.landed,
    stop: step.stop,
    sendStopped,
  };
}

export async function sendClaimBatches(opts: {
  connection: Connection;
  wallet: WalletLike;
  rows: ClaimableRow[];
  packSize?: number;
  onProgress: ClaimProgressHandler;
}): Promise<{ signatures: string[]; claimedKeys: string[]; stoppedAt?: string }> {
  const { connection, wallet, rows, onProgress } = opts;
  const signer = wallet.publicKey;
  if (!signer) throw new Error("Wallet not connected");
  const ready = rows.filter((r) => r.status === "proof-ready" && r.proof);
  const signatures: string[] = [];
  const claimedKeys: string[] = [];
  if (ready.length === 0) return { signatures, claimedKeys };

  const packed = await packSlices(
    connection,
    signer,
    ready,
    opts.packSize ?? INITIAL_BATCH_SIZE,
    onProgress,
  );
  if (packed.stoppedAt) return { signatures, claimedKeys, stoppedAt: packed.stoppedAt };

  const totalTxs = packed.slices.length;
  let sendStopped: string | undefined;
  const epochTotal = ready.length;
  let txOffset = 0;

  while (txOffset < packed.slices.length) {
    const remaining = packed.slices.slice(txOffset);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const unsigned: Transaction[] = [];
    for (const slice of remaining) {
      unsigned.push(await buildPackedTx(connection, signer, slice, blockhash));
    }

    onProgress({
      kind: "approve",
      from: txOffset + 1,
      to: txOffset + remaining.length,
      total: totalTxs,
    });
    let signed: Transaction[];
    try {
      signed = await signPacked(wallet, unsigned);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendStopped = msg;
      break;
    }

    onProgress({ kind: "sending", total: epochTotal });
    const round = await sendAndConfirmSignedSlices({
      connection,
      signed,
      slices: remaining,
      lastValidBlockHeight,
      epochTotal,
      onProgress,
    });
    signatures.push(...round.signatures);
    claimedKeys.push(...round.claimedKeys);
    txOffset += round.consumed;
    sendStopped = round.sendStopped;
    switch (round.stop) {
      case "complete":
        break;
      case "resign":
        continue;
      case "abort":
        return { signatures, claimedKeys, stoppedAt: sendStopped };
      default: {
        const _exhaustive: never = round.stop;
        return { signatures, claimedKeys, stoppedAt: String(_exhaustive) };
      }
    }
  }

  if (sendStopped) return { signatures, claimedKeys, stoppedAt: sendStopped };
  return { signatures, claimedKeys };
}
