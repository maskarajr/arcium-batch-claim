export type ClaimRowStatus = "proof-ready" | "error";

export type IndexerStatus = {
  merkle_tree: { height: number; size: number };
  tracked_primary_stake_owner: string;
};

export type IndexerClaim = {
  total_rewards: string | number;
  primary_stake: string | number;
  delegated_stake: string | number;
  epoch: string | number;
};

export type IndexerProofResponse = {
  opening: number[][];
  claim: IndexerClaim;
};

export type ParsedProof = {
  epoch: bigint;
  leafIndex: number;
  opening: number[][];
  totalRewards: bigint;
  primaryStake: bigint;
  delegatedStake: bigint;
};

export type ClaimableRow = {
  epoch: bigint;
  stakeOffset: bigint;
  operatorName: string;
  operatorOwner: string;
  amountLamports: bigint;
  status: ClaimRowStatus;
  error?: string;
  proof?: ParsedProof;
  feeBasisPoints: number;
  primaryAccountOwner: string;
  delegatedStakeAcc: string;
  stakeBaseUnits: bigint;
};

export type PositionShell = {
  delegatedStakeAcc: string;
  stakeOffset: bigint;
  operatorName: string;
  operatorOwner: string;
  feeBasisPoints: number;
  primaryAccountOwner: string;
  stakeBaseUnits: bigint;
  primaryStake: string;
  deactivationEpoch: bigint | null;
  delegationAuthority: string;
  withdrawalAuthority: string;
  isWithdrawalAuthority: boolean;
};

export type LookupProgress =
  | { kind: "positions"; positions: PositionShell[]; currentEpoch: bigint }
  | {
      kind: "row";
      row: ClaimableRow;
      fetched: number;
      total: number;
      currentEpoch: bigint;
    };

export function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  if (value && typeof value === "object") {
    if ("toString" in value && typeof value.toString === "function") {
      const s = value.toString();
      if (/^-?\d+$/.test(s)) return BigInt(s);
    }
    if ("0" in value) return asBigInt((value as { 0: unknown })[0]);
  }
  throw new Error("not an integer");
}

export const ARX_DECIMALS = 9n;

export function lamportsToSol(lamports: bigint): string {
  return formatUnits(lamports, 9n);
}

export function formatArx(baseUnits: bigint): string {
  const s = formatUnits(baseUnits, ARX_DECIMALS);
  const [w, f] = s.split(".");
  const whole = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return f ? `${whole}.${f}` : whole;
}

function formatUnits(amount: bigint, decimals: bigint): string {
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const base = 10n ** decimals;
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(Number(decimals), "0").replace(/0+$/, "");
  const body = frac.length === 0 ? whole.toString() : `${whole.toString()}.${frac}`;
  return neg ? `-${body}` : body;
}
