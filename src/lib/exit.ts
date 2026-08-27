export type PositionExitKind = "active" | "unbonding" | "ready";

export function positionExitKind(
  deactivationEpoch: bigint | null,
  currentEpoch: bigint,
): PositionExitKind {
  if (deactivationEpoch === null) return "active";
  if (currentEpoch > deactivationEpoch) return "ready";
  return "unbonding";
}

export function exitStatusLabel(
  kind: PositionExitKind,
  deactivationEpoch: bigint | null,
): string {
  switch (kind) {
    case "active":
      return "Active";
    case "unbonding":
      return `Unbonding until epoch ${deactivationEpoch?.toString() ?? "?"}`;
    case "ready":
      return "Ready to withdraw";
    default: {
      const _exhaustive: never = kind;
      return String(_exhaustive);
    }
  }
}

export function canUndelegate(opts: {
  kind: PositionExitKind;
  proofReadyCount: number;
  hasPrimaryStake: boolean;
  walletIsWithdrawalAuthority: boolean;
}): boolean {
  return (
    opts.kind === "active" &&
    opts.proofReadyCount === 0 &&
    opts.hasPrimaryStake &&
    opts.walletIsWithdrawalAuthority
  );
}

export function canWithdraw(opts: {
  kind: PositionExitKind;
  proofReadyCount: number;
  walletIsWithdrawalAuthority: boolean;
  hasPrimaryStake: boolean;
  hasDelegationOwner: boolean;
}): boolean {
  return (
    opts.kind === "ready" &&
    opts.proofReadyCount === 0 &&
    opts.walletIsWithdrawalAuthority &&
    opts.hasPrimaryStake &&
    opts.hasDelegationOwner
  );
}
