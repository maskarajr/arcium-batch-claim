import "../polyfill";
import { AnchorProvider } from "@anchor-lang/core";
import {
  ARX_TOKEN_MINT_ADDR,
  ASSOCIATED_TOKEN_PROGRAM_ADDR,
  TOKEN_PROGRAM_ADDR,
  buildCloseDelegatedStakeIx,
  buildUndelegateStakeIx,
  getArxTokenAtaAddress,
  getStakingProgram,
} from "@arcium-hq/staking";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import { confirmClaimSignature } from "./confirmSig";
import { CU_PER_CLAIM, CU_PRICE_MICRO } from "./constants";
import type { PositionShell } from "./types";

export type ExitAction = "undelegate" | "withdraw";

export type ExitProgress =
  | { kind: "exit-approve"; action: ExitAction }
  | { kind: "exit-sending"; action: ExitAction }
  | {
      kind: "exit";
      action: ExitAction;
      operatorName: string;
      delegatedStakeAcc: string;
      signature: string;
    };

type WalletLike = {
  publicKey: PublicKey | null;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
};

function stakingFor(connection: Connection, signer: PublicKey) {
  const provider = new AnchorProvider(
    connection,
    {
      publicKey: signer,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
    },
    { commitment: "confirmed" },
  );
  return getStakingProgram(provider);
}

async function maybeCreateArxAtaIx(
  connection: Connection,
  signer: PublicKey,
): Promise<TransactionInstruction | null> {
  const ata = getArxTokenAtaAddress(signer);
  const info = await connection.getAccountInfo(ata);
  if (info) return null;
  return createAssociatedTokenAccountIdempotentInstruction(
    signer,
    ata,
    signer,
    ARX_TOKEN_MINT_ADDR,
    TOKEN_PROGRAM_ADDR,
    ASSOCIATED_TOKEN_PROGRAM_ADDR,
  );
}

async function sendSignedIxTx(opts: {
  connection: Connection;
  wallet: WalletLike;
  ixs: TransactionInstruction[];
  action: ExitAction;
  shell: PositionShell;
  onProgress: (event: ExitProgress) => void;
}): Promise<{ signature?: string; stoppedAt?: string }> {
  const signer = opts.wallet.publicKey;
  if (!signer) return { stoppedAt: "Wallet not connected" };

  const { blockhash, lastValidBlockHeight } = await opts.connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: signer, recentBlockhash: blockhash });
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: CU_PER_CLAIM * Math.max(1, opts.ixs.length) }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE_MICRO }),
    ...opts.ixs,
  );

  opts.onProgress({ kind: "exit-approve", action: opts.action });
  let signed: Transaction;
  try {
    signed = await opts.wallet.signTransaction(tx);
  } catch (err) {
    return { stoppedAt: err instanceof Error ? err.message : String(err) };
  }

  opts.onProgress({ kind: "exit-sending", action: opts.action });
  let sig: string;
  try {
    sig = await opts.connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  } catch (err) {
    return { stoppedAt: err instanceof Error ? err.message : String(err) };
  }

  const outcome = await confirmClaimSignature(
    opts.connection,
    sig,
    blockhash,
    lastValidBlockHeight,
  );
  switch (outcome) {
    case "landed":
      opts.onProgress({
        kind: "exit",
        action: opts.action,
        operatorName: opts.shell.operatorName,
        delegatedStakeAcc: opts.shell.delegatedStakeAcc,
        signature: sig,
      });
      return { signature: sig };
    case "failed":
      return { stoppedAt: `on-chain error ${sig}` };
    case "dropped":
      return { stoppedAt: `dropped ${sig}` };
    default: {
      const _exhaustive: never = outcome;
      return { stoppedAt: String(_exhaustive) };
    }
  }
}

export async function sendUndelegate(opts: {
  connection: Connection;
  wallet: WalletLike;
  shell: PositionShell;
  onProgress: (event: ExitProgress) => void;
}): Promise<{ signature?: string; stoppedAt?: string }> {
  const signer = opts.wallet.publicKey;
  if (!signer) return { stoppedAt: "Wallet not connected" };
  if (!opts.shell.primaryStake) return { stoppedAt: "Missing primary stake account" };
  const program = stakingFor(opts.connection, signer);
  const ix = await buildUndelegateStakeIx({
    program,
    signer,
    stakeOffset: opts.shell.stakeOffset,
    primaryStakeAccount: new PublicKey(opts.shell.primaryStake),
  });
  return sendSignedIxTx({
    connection: opts.connection,
    wallet: opts.wallet,
    ixs: [ix],
    action: "undelegate",
    shell: opts.shell,
    onProgress: opts.onProgress,
  });
}

export async function sendWithdraw(opts: {
  connection: Connection;
  wallet: WalletLike;
  shell: PositionShell;
  onProgress: (event: ExitProgress) => void;
}): Promise<{ signature?: string; stoppedAt?: string }> {
  const signer = opts.wallet.publicKey;
  if (!signer) return { stoppedAt: "Wallet not connected" };
  if (!opts.shell.delegationAuthority) return { stoppedAt: "Missing delegation authority" };
  if (!opts.shell.primaryStake) return { stoppedAt: "Missing primary stake account" };
  const program = stakingFor(opts.connection, signer);
  const ataIx = await maybeCreateArxAtaIx(opts.connection, signer);
  const closeIx = await buildCloseDelegatedStakeIx({
    program,
    signer,
    stakeOffset: opts.shell.stakeOffset,
    delegationOwner: new PublicKey(opts.shell.delegationAuthority),
    primaryStakeAccount: new PublicKey(opts.shell.primaryStake),
  });
  const ixs = ataIx ? [ataIx, closeIx] : [closeIx];
  return sendSignedIxTx({
    connection: opts.connection,
    wallet: opts.wallet,
    ixs,
    action: "withdraw",
    shell: opts.shell,
    onProgress: opts.onProgress,
  });
}
