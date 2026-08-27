import type { ClaimProgress } from "./claim";
import type { ExitAction, ExitProgress } from "./exitTx";
import { lamportsToSol } from "./types";

export type ActivityEvent = ClaimProgress | ExitProgress;

export type ClaimActivityStatus = "submitted" | "claimed" | "error";

export type ClaimActivityItem = {
  kind: "claim";
  status: ClaimActivityStatus;
  epoch: bigint;
  stakeOffset: bigint;
  amountLamports: bigint;
  signature: string | null;
  operatorName: string;
  delegatedStakeAcc: string;
  message?: string;
};

export type ExitActivityItem = {
  kind: "exit";
  action: ExitAction;
  operatorName: string;
  delegatedStakeAcc: string;
  signature: string;
};

export type ActivityItem = ClaimActivityItem | ExitActivityItem;

export function shortPk(pk: string): string {
  return pk.length < 12 ? pk : `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}

function claimKey(stakeOffset: bigint, epoch: bigint): string {
  return `${stakeOffset}:${epoch}`;
}

function exitKey(e: Extract<ExitProgress, { kind: "exit" }>): string {
  return `exit:${e.signature}:${e.action}`;
}

export function activityItems(events: ActivityEvent[]): ActivityItem[] {
  const map = new Map<string, ActivityItem>();
  const order: string[] = [];
  const touch = (key: string, item: ActivityItem) => {
    map.set(key, item);
    const idx = order.indexOf(key);
    if (idx >= 0) order.splice(idx, 1);
    order.push(key);
  };
  for (const e of events) {
    switch (e.kind) {
      case "fitting":
      case "approve":
      case "sending":
      case "confirming":
      case "exit-approve":
      case "exit-sending":
        break;
      case "submitted":
        touch(claimKey(e.stakeOffset, e.epoch), {
          kind: "claim",
          status: "submitted",
          epoch: e.epoch,
          stakeOffset: e.stakeOffset,
          amountLamports: e.amountLamports,
          signature: e.signature,
          operatorName: e.operatorName,
          delegatedStakeAcc: e.delegatedStakeAcc,
        });
        break;
      case "claimed":
        touch(claimKey(e.stakeOffset, e.epoch), {
          kind: "claim",
          status: "claimed",
          epoch: e.epoch,
          stakeOffset: e.stakeOffset,
          amountLamports: e.amountLamports,
          signature: e.signature,
          operatorName: e.operatorName,
          delegatedStakeAcc: e.delegatedStakeAcc,
        });
        break;
      case "claim-error":
        touch(claimKey(e.stakeOffset, e.epoch), {
          kind: "claim",
          status: "error",
          epoch: e.epoch,
          stakeOffset: e.stakeOffset,
          amountLamports: e.amountLamports,
          signature: e.signature,
          operatorName: e.operatorName,
          delegatedStakeAcc: e.delegatedStakeAcc,
          message: e.message,
        });
        break;
      case "exit":
        touch(exitKey(e), {
          kind: "exit",
          action: e.action,
          operatorName: e.operatorName,
          delegatedStakeAcc: e.delegatedStakeAcc,
          signature: e.signature,
        });
        break;
      default: {
        const _exhaustive: never = e;
        void _exhaustive;
      }
    }
  }
  const newestFirst: ActivityItem[] = [];
  for (let i = order.length - 1; i >= 0; i--) {
    const item = map.get(order[i]);
    if (item) newestFirst.push(item);
  }
  return newestFirst;
}

function claimTotal(events: ActivityEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === "sending" || e.kind === "confirming") return e.total;
  }
  return 0;
}

function countStatus(items: ActivityItem[], status: ClaimActivityStatus): number {
  return items.filter((x) => x.kind === "claim" && x.status === status).length;
}

export function activityLatestLine(items: ActivityItem[]): string {
  const last = items[0];
  if (!last) return "";
  switch (last.kind) {
    case "claim": {
      const pos = `${last.operatorName} · ${shortPk(last.delegatedStakeAcc)} · Epoch ${last.epoch.toString()}`;
      switch (last.status) {
        case "submitted":
          return `${pos} · submitted`;
        case "claimed":
          return `${pos} · +${lamportsToSol(last.amountLamports)} SOL`;
        case "error":
          return `${pos} · failed`;
        default: {
          const _exhaustive: never = last.status;
          return String(_exhaustive);
        }
      }
    }
    case "exit": {
      let actionLabel: string;
      switch (last.action) {
        case "undelegate":
          actionLabel = "Undelegate";
          break;
        case "withdraw":
          actionLabel = "Withdraw";
          break;
        default: {
          const _exhaustive: never = last.action;
          actionLabel = String(_exhaustive);
        }
      }
      return `${last.operatorName} · ${shortPk(last.delegatedStakeAcc)} · ${actionLabel}`;
    }
    default: {
      const _exhaustive: never = last;
      return String(_exhaustive);
    }
  }
}

export function activityHeadline(events: ActivityEvent[], claiming: boolean): string {
  const last = events.at(-1);
  if (!last) return claiming ? "Preparing…" : "";
  const items = activityItems(events);
  const submitted = items.filter((x) => x.kind === "claim").length;
  const claimed = countStatus(items, "claimed");
  const total = claimTotal(events);
  const confirming = events.some((e) => e.kind === "confirming");

  switch (last.kind) {
    case "fitting":
      return claiming ? "Preparing claim…" : "Claim complete";
    case "approve":
      return `Approve ${last.from}–${last.to} of ${last.total} in wallet`;
    case "sending":
    case "submitted":
      if (!claiming) return claimed > 0 ? `Claimed epoch ${lastClaimedEpoch(items)}` : "Claim complete";
      if (confirming) return `Confirmed ${claimed}/${total}`;
      return `Broadcast ${submitted}/${total}`;
    case "confirming":
      return claiming ? `Confirmed ${claimed}/${total}` : "Claim complete";
    case "claimed":
      return claiming
        ? `Confirmed ${claimed}/${total}`
        : `Claimed epoch ${last.epoch.toString()}`;
    case "claim-error":
      if (claiming) {
        return confirming ? `Confirmed ${claimed}/${total}` : `Broadcast ${submitted}/${total}`;
      }
      return claimed > 0 ? `Claimed epoch ${lastClaimedEpoch(items)}` : "Claim complete";
    case "exit-approve":
      switch (last.action) {
        case "undelegate":
          return "Approve undelegate in wallet";
        case "withdraw":
          return "Approve withdraw in wallet";
        default: {
          const _exhaustive: never = last.action;
          return String(_exhaustive);
        }
      }
    case "exit-sending":
      switch (last.action) {
        case "undelegate":
          return "Sending undelegate…";
        case "withdraw":
          return "Sending withdraw…";
        default: {
          const _exhaustive: never = last.action;
          return String(_exhaustive);
        }
      }
    case "exit":
      switch (last.action) {
        case "undelegate":
          return "Undelegated";
        case "withdraw":
          return "Withdrew ARX";
        default: {
          const _exhaustive: never = last.action;
          return String(_exhaustive);
        }
      }
    default: {
      const _exhaustive: never = last;
      return String(_exhaustive);
    }
  }
}

function lastClaimedEpoch(items: ActivityItem[]): string {
  const claimed = items.find((x) => x.kind === "claim" && x.status === "claimed");
  return claimed && claimed.kind === "claim" ? claimed.epoch.toString() : "";
}

export function claimRowStatusLabel(item: ClaimActivityItem): string {
  switch (item.status) {
    case "submitted":
      return "Submitted";
    case "claimed":
      return `Claimed +${lamportsToSol(item.amountLamports)} SOL`;
    case "error":
      return item.message ?? "Failed";
    default: {
      const _exhaustive: never = item.status;
      return String(_exhaustive);
    }
  }
}
