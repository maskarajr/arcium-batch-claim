import { AnchorProvider } from "@anchor-lang/core";
import {
  getArciumClockAccAddress,
  getDelegatedStakeAccAddress,
  getDelegatedStakeAccInfo,
  getStakingProgram,
  getUserStakePositions,
  type StakingProgram,
  type UserStakePosition,
} from "@arcium-hq/staking";
import { Connection, PublicKey } from "@solana/web3.js";
import { fetchIndexerProof, fetchIndexerStatus } from "./indexer";
import { operatorForPrimary } from "./operators";
import { delegatedRewardLamports, leafIndexForEpoch } from "./proof";
import type { ClaimableRow, LookupProgress, PositionShell } from "./types";
import { asBigInt } from "./types";

function readWallet(pubkey: PublicKey) {
  return {
    publicKey: pubkey,
    signTransaction: async <T>(tx: T) => tx,
    signAllTransactions: async <T>(txs: T[]) => txs,
  };
}

export function stakingProgram(connection: Connection, pubkey: PublicKey): StakingProgram {
  const provider = new AnchorProvider(connection, readWallet(pubkey), {
    commitment: "confirmed",
  });
  return getStakingProgram(provider);
}

function field(account: object, ...names: string[]): unknown {
  const rec = account as Record<string, unknown>;
  for (const n of names) {
    if (n in rec && rec[n] != null) return rec[n];
  }
  return undefined;
}

function optBigInt(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  try {
    return asBigInt(value);
  } catch {
    return null;
  }
}

function unwrapOption(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && value !== null && "0" in value && !("toBase58" in value)) {
    return (value as { 0: unknown })[0];
  }
  return value;
}

function optPubkey(value: unknown): PublicKey | null {
  if (value === null || value === undefined) return null;
  if (value instanceof PublicKey) return value;
  if (typeof value === "string") {
    try {
      return new PublicKey(value);
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && "toBase58" in value && typeof (value as PublicKey).toBase58 === "function") {
    try {
      return new PublicKey((value as PublicKey).toBase58());
    } catch {
      return null;
    }
  }
  return null;
}
const EPOCH_MAX = (1n << 64n) - 1n;

function finiteEpoch(value: bigint | null): bigint | null {
  if (value === null || value === EPOCH_MAX) return null;
  return value;
}

export async function readCurrentEpoch(connection: Connection): Promise<bigint> {
  const clockPk = getArciumClockAccAddress();
  let info;
  try {
    info = await connection.getAccountInfo(clockPk);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("403")) {
      throw new Error(
        "RPC 403 on Arcium clock. Restart `npm run dev` (app must use /rpc proxy). If it still 403s, set RPC_URL in .env to Helius/Triton — public api.mainnet-beta.solana.com blocks browsers.",
      );
    }
    throw err;
  }
  if (!info) throw new Error("Arcium clock account missing");
  const data = info.data;
  if (data.length < 24) throw new Error("Arcium clock account too small");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(16, true);
}

async function resolveOperator(
  program: StakingProgram,
  primaryStake: PublicKey | null,
): Promise<{ owner: PublicKey; feeBps: number; name: string } | null> {
  if (!primaryStake) return null;
  const info = await operatorForPrimary(primaryStake);
  if (!info) return null;
  let feeBps = 0;
  try {
    const acc = await program.account.primaryStakingAccount.fetch(primaryStake);
    const feeRaw = field(acc as object, "feeBasisPoints");
    if (feeRaw != null) feeBps = Number(asBigInt(feeRaw));
  } catch {
    /* fee stays 0 */
  }
  return { owner: info.owner, feeBps, name: info.name };
}

type PositionView = {
  stakeOffset: bigint;
  stakeBaseUnits: bigint;
  claimedRewardsEpoch: bigint | null;
  deactivationEpoch: bigint | null;
  primaryStake: PublicKey | null;
  delegationAuthority: PublicKey | null;
  withdrawalAuthority: PublicKey | null;
  isWithdrawalAuthority: boolean;
};

function viewPosition(p: UserStakePosition): PositionView | null {
  const acc = p.account;
  if (!acc) return null;
  const obj = acc as object;
  const stake = optBigInt(field(obj, "stake")) ?? 0n;
  const claimed = finiteEpoch(optBigInt(field(obj, "claimedRewards")));
  const lockup = field(obj, "lockup");
  const deact = finiteEpoch(
    optBigInt(
      lockup && typeof lockup === "object"
        ? field(lockup as object, "deactivationEpoch")
        : undefined,
    ),
  );
  const primaryStake = optPubkey(unwrapOption(field(obj, "delegationTarget")));
  const auth = field(obj, "authority");
  const authObj = auth && typeof auth === "object" ? (auth as object) : null;
  return {
    stakeOffset: p.offset,
    stakeBaseUnits: stake,
    claimedRewardsEpoch: claimed,
    deactivationEpoch: deact,
    primaryStake,
    delegationAuthority: authObj ? optPubkey(field(authObj, "delegationAuthority")) : null,
    withdrawalAuthority: authObj ? optPubkey(field(authObj, "withdrawalAuthority")) : null,
    isWithdrawalAuthority: p.withdrawalAuthority,
  };
}
export async function lookupClaimable(
  connection: Connection,
  ownerStr: string,
  onProgress?: (progress: LookupProgress) => void,
  skipCache = false,
): Promise<{ rows: ClaimableRow[]; currentEpoch: bigint; note: string }> {
  const owner = new PublicKey(ownerStr);
  const program = stakingProgram(connection, owner);
  const currentEpoch = await readCurrentEpoch(connection);

  const positions = (await getUserStakePositions(program, owner)).flatMap((p) => {
    const v = viewPosition(p);
    return v ? [v] : [];
  });

  const note =
    positions.length === 0
      ? "No delegated positions on the master account for this address."
      : "";

  const rows: ClaimableRow[] = [];
  const lastFinalized = currentEpoch === 0n ? 0n : currentEpoch - 1n;
  const counters = { fetched: 0, total: 0 };

  const emitRow = (row: Omit<ClaimableRow, "delegatedStakeAcc">) => {
    const full: ClaimableRow = {
      ...row,
      delegatedStakeAcc: getDelegatedStakeAccAddress(row.stakeOffset).toBase58(),
    };
    rows.push(full);
    counters.fetched += 1;
    onProgress?.({
      kind: "row",
      row: full,
      fetched: counters.fetched,
      total: Math.max(counters.total, counters.fetched),
      currentEpoch,
    });
  };

  const resolved = await Promise.all(
    positions.map(async (pos) => ({
      pos,
      operator: await resolveOperator(program, pos.primaryStake),
    })),
  );

  const shells: PositionShell[] = resolved.map(({ pos, operator }) => ({
    delegatedStakeAcc: getDelegatedStakeAccAddress(pos.stakeOffset).toBase58(),
    stakeOffset: pos.stakeOffset,
    operatorName: operator?.name ?? "unknown",
    operatorOwner: operator?.owner.toBase58() ?? "",
    feeBasisPoints: operator?.feeBps ?? 0,
    primaryAccountOwner: operator?.owner.toBase58() ?? "",
    stakeBaseUnits: pos.stakeBaseUnits,
    primaryStake: pos.primaryStake?.toBase58() ?? "",
    deactivationEpoch: pos.deactivationEpoch,
    delegationAuthority: pos.delegationAuthority?.toBase58() ?? "",
    withdrawalAuthority: pos.withdrawalAuthority?.toBase58() ?? "",
    isWithdrawalAuthority: pos.isWithdrawalAuthority,
  }));

  onProgress?.({ kind: "positions", positions: shells, currentEpoch });

  const loadProofsForPosition = async (
    pos: PositionView,
    operator: Awaited<ReturnType<typeof resolveOperator>>,
  ) => {
    if (!operator) {
      counters.total += 1;
      emitRow({
        epoch: pos.claimedRewardsEpoch ?? 0n,
        stakeOffset: pos.stakeOffset,
        operatorName: "unknown",
        operatorOwner: "",
        amountLamports: 0n,
        status: "error",
        error:
          "Unknown operator (not in portal catalog). Indexer needs that operator’s primary-owner key.",
        feeBasisPoints: 0,
        primaryAccountOwner: "",
        stakeBaseUnits: pos.stakeBaseUnits,
      });
      return;
    }

    const opOwner = operator.owner.toBase58();
    const opName = operator.name;
    const status = await fetchIndexerStatus(opOwner);
    if (!status) {
      counters.total += 1;
      emitRow({
        epoch: pos.claimedRewardsEpoch ?? 0n,
        stakeOffset: pos.stakeOffset,
        operatorName: opName,
        operatorOwner: opOwner,
        amountLamports: 0n,
        status: "error",
        error: "Indexer has no tree for this operator (404)",
        feeBasisPoints: operator.feeBps,
        primaryAccountOwner: opOwner,
        stakeBaseUnits: pos.stakeBaseUnits,
      });
      return;
    }

    const leaf0 = await fetchIndexerProof(opOwner, 0, undefined, skipCache);
    const firstEpoch = leaf0?.epoch ?? 0n;
    const start =
      pos.claimedRewardsEpoch === null ? firstEpoch : pos.claimedRewardsEpoch + 1n;
    let end = lastFinalized;
    if (pos.deactivationEpoch !== null && pos.deactivationEpoch - 1n < end) {
      end = pos.deactivationEpoch - 1n;
    }

    if (start > end) {
      counters.total += 1;
      emitRow({
        epoch: pos.claimedRewardsEpoch ?? 0n,
        stakeOffset: pos.stakeOffset,
        operatorName: opName,
        operatorOwner: opOwner,
        amountLamports: 0n,
        status: "error",
        error: "No unclaimed finalized epochs",
        feeBasisPoints: operator.feeBps,
        primaryAccountOwner: opOwner,
        stakeBaseUnits: pos.stakeBaseUnits,
      });
      return;
    }

    counters.total += Number(end - start) + 1;

    for (let epoch = start; epoch <= end; epoch++) {
      const leaf = leafIndexForEpoch(epoch, firstEpoch, status.merkle_tree.size);
      if (leaf === null) {
        emitRow({
          epoch,
          stakeOffset: pos.stakeOffset,
          operatorName: opName,
          operatorOwner: opOwner,
          amountLamports: 0n,
          status: "error",
          error: "Epoch not in indexer tree yet",
          feeBasisPoints: operator.feeBps,
          primaryAccountOwner: opOwner,
          stakeBaseUnits: pos.stakeBaseUnits,
        });
        continue;
      }
      try {
        const proof = await fetchIndexerProof(opOwner, leaf, epoch, skipCache);
        if (!proof) {
          emitRow({
            epoch,
            stakeOffset: pos.stakeOffset,
            operatorName: opName,
            operatorOwner: opOwner,
            amountLamports: 0n,
            status: "error",
            error: "Proof missing for leaf",
            feeBasisPoints: operator.feeBps,
            primaryAccountOwner: opOwner,
            stakeBaseUnits: pos.stakeBaseUnits,
          });
          continue;
        }
        emitRow({
          epoch,
          stakeOffset: pos.stakeOffset,
          operatorName: opName,
          operatorOwner: opOwner,
          amountLamports: delegatedRewardLamports(proof, operator.feeBps, pos.stakeBaseUnits),
          status: "proof-ready",
          proof,
          feeBasisPoints: operator.feeBps,
          primaryAccountOwner: opOwner,
          stakeBaseUnits: pos.stakeBaseUnits,
        });
      } catch (err) {
        emitRow({
          epoch,
          stakeOffset: pos.stakeOffset,
          operatorName: opName,
          operatorOwner: opOwner,
          amountLamports: 0n,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
          feeBasisPoints: operator.feeBps,
          primaryAccountOwner: opOwner,
          stakeBaseUnits: pos.stakeBaseUnits,
        });
      }
    }
  };

  await Promise.all(resolved.map(({ pos, operator }) => loadProofsForPosition(pos, operator)));

  return { rows, currentEpoch, note };
}

export async function refreshPositionExit(
  connection: Connection,
  ownerStr: string,
  stakeOffset: bigint,
): Promise<{ deactivationEpoch: bigint | null; currentEpoch: bigint; closed: boolean }> {
  const owner = new PublicKey(ownerStr);
  const program = stakingProgram(connection, owner);
  const [currentEpoch, account] = await Promise.all([
    readCurrentEpoch(connection),
    getDelegatedStakeAccInfo(program, stakeOffset),
  ]);
  if (!account) return { deactivationEpoch: null, currentEpoch, closed: true };
  const lockup = field(account as object, "lockup");
  const deact = finiteEpoch(
    optBigInt(
      lockup && typeof lockup === "object"
        ? field(lockup as object, "deactivationEpoch")
        : undefined,
    ),
  );
  return { deactivationEpoch: deact, currentEpoch, closed: false };
}
