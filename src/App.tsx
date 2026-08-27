import { ConnectionProvider, WalletProvider, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton, useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState, type FC, type FormEvent, type ReactNode } from "react";
import {
  activityHeadline,
  activityItems,
  activityLatestLine,
  claimRowStatusLabel,
  shortPk,
  type ActivityEvent,
  type ActivityItem,
} from "./lib/activity";
import { groupRowsByStakeAccOrder, sendClaimBatches } from "./lib/claim";
import { canUndelegate, canWithdraw, exitStatusLabel, positionExitKind } from "./lib/exit";
import { sendUndelegate, sendWithdraw, type ExitAction, type ExitProgress } from "./lib/exitTx";
import { INITIAL_BATCH_SIZE } from "./lib/constants";
import { isUnnamedOperator, operatorCardLabel } from "./lib/operatorLabel";
import { lookupClaimable, refreshPositionExit } from "./lib/positions";
import { clearCachedProofs } from "./lib/proofCache";
import type { ClaimableRow, LookupProgress, PositionShell } from "./lib/types";
import { formatArx, lamportsToSol } from "./lib/types";
import "@solana/wallet-adapter-react-ui/styles.css";

/** Vite `/rpc` proxy. Must be absolute — web3.js rejects `/rpc`. Never `VITE_RPC_URL`. */
const RPC = `${typeof window !== "undefined" ? window.location.origin : "http://localhost:5173"}/rpc`;

function activityItemKey(item: ActivityItem): string {
  switch (item.kind) {
    case "claim":
      return `claim:${item.stakeOffset.toString()}:${item.epoch.toString()}`;
    case "exit":
      return `exit:${item.signature}:${item.action}`;
    default: {
      const _exhaustive: never = item;
      return String(_exhaustive);
    }
  }
}

function ActivityRow({ item }: { item: ActivityItem }) {
  switch (item.kind) {
    case "claim": {
      const statusClass =
        item.status === "claimed" ? "ok" : item.status === "error" ? "bad" : "activity-status";
      return (
        <li>
          <span>
            {item.operatorName} · {shortPk(item.delegatedStakeAcc)} · Epoch {item.epoch.toString()}
          </span>
          <span className={statusClass}>{claimRowStatusLabel(item)}</span>
          {item.signature ? (
            <a href={`https://solscan.io/tx/${item.signature}`} target="_blank" rel="noreferrer">
              View
            </a>
          ) : (
            <span />
          )}
        </li>
      );
    }
    case "exit": {
      let actionLabel: string;
      switch (item.action) {
        case "undelegate":
          actionLabel = "Undelegate";
          break;
        case "withdraw":
          actionLabel = "Withdraw";
          break;
        default: {
          const _exhaustive: never = item.action;
          actionLabel = String(_exhaustive);
        }
      }
      return (
        <li>
          <span>
            {item.operatorName} · {shortPk(item.delegatedStakeAcc)} · {actionLabel}
          </span>
          <span className="ok">Done</span>
          <a href={`https://solscan.io/tx/${item.signature}`} target="_blank" rel="noreferrer">
            View
          </a>
        </li>
      );
    }
    default: {
      const _exhaustive: never = item;
      return <li>{String(_exhaustive)}</li>;
    }
  }
}

function ActivityStrip({
  events,
  claiming,
}: {
  events: ActivityEvent[];
  claiming: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!claiming && events.length === 0) return null;
  const last = events.at(-1);
  const items = activityItems(events);
  const headline = activityHeadline(events, claiming);
  const latest = activityLatestLine(items);
  return (
    <section className="activity" aria-live="polite">
      <button
        type="button"
        className="activity-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="activity-headline">{headline || "Activity"}</div>
        {latest ? <p className="activity-muted">{latest}</p> : null}
        <span className="activity-expand">{expanded ? "Hide" : `Show all (${items.length})`}</span>
      </button>
      {last?.kind === "fitting" ? <p className="activity-muted">Fitting transaction size…</p> : null}
      {last?.kind === "approve" ? (
        <p className="activity-muted">
          Wallet signed every claim tx. We submit those signed txs now, then wait for each to land.
        </p>
      ) : null}
      {expanded ? (
        <ul className="activity-list">
          {items.map((item) => (
            <ActivityRow key={activityItemKey(item)} item={item} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

type PosSummary = {
  acc: string;
  operator: string;
  stake: bigint;
  epochs: number;
  sol: bigint;
  rows: ClaimableRow[];
  shell: PositionShell;
};

function ProofTable({
  rows,
  busy,
}: {
  rows: ClaimableRow[];
  busy: boolean;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Epoch</th>
            <th>Amount (SOL)</th>
            <th>Proof</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3}>{busy ? "Waiting for first proof…" : "No epochs"}</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={`${r.stakeOffset}-${r.epoch.toString()}-${r.status}`}>
                <td>{r.epoch.toString()}</td>
                <td>{lamportsToSol(r.amountLamports)}</td>
                <td className={r.status === "proof-ready" ? "ok" : "bad"}>
                  {r.status === "proof-ready" ? "proof-ready" : r.error ?? "error"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function OperatorHeading({
  name,
  primary,
}: {
  name: string;
  primary: string;
}) {
  const [copied, setCopied] = useState(false);
  const unnamed = isUnnamedOperator(name) && primary.length > 0;
  const label = operatorCardLabel(name, primary);
  const canCopy = primary.length > 0;

  const onCopy = () => {
    void navigator.clipboard.writeText(primary).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="pos-title-row">
      <div className={unnamed ? "pos-title pos-title--pk" : "pos-title"} title={unnamed ? primary : undefined}>
        {label}
      </div>
      {canCopy ? (
        <button
          type="button"
          className="pos-pk-copy"
          title={primary}
          onClick={onCopy}
          aria-label={copied ? "Copied primary address" : "Copy primary address"}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      ) : null}
    </div>
  );
}

function PositionBlock({
  p,
  busy,
  packSize,
  currentEpoch,
  walletPk,
  onClaim,
  onUndelegate,
  onWithdraw,
}: {
  p: PosSummary;
  busy: boolean;
  packSize: number;
  currentEpoch: bigint | null;
  walletPk: string | null;
  onClaim: (slice: ClaimableRow[]) => void;
  onUndelegate: (shell: PositionShell) => void;
  onWithdraw: (shell: PositionShell) => void;
}) {
  const readyHere = p.rows.filter((r) => r.status === "proof-ready");
  const nextN = Math.min(packSize, readyHere.length);
  const epoch = currentEpoch ?? 0n;
  const kind = positionExitKind(p.shell.deactivationEpoch, epoch);
  const walletIsWithdrawalAuthority =
    !!walletPk &&
    p.shell.isWithdrawalAuthority &&
    walletPk === p.shell.withdrawalAuthority;
  const undelegateOk = canUndelegate({
    kind,
    proofReadyCount: readyHere.length,
    hasPrimaryStake: p.shell.primaryStake.length > 0,
    walletIsWithdrawalAuthority,
  });
  const withdrawOk = canWithdraw({
    kind,
    proofReadyCount: readyHere.length,
    walletIsWithdrawalAuthority,
    hasPrimaryStake: p.shell.primaryStake.length > 0,
    hasDelegationOwner: p.shell.delegationAuthority.length > 0,
  });
  const statusText = exitStatusLabel(kind, p.shell.deactivationEpoch);
  return (
    <section className="pos-block">
      <div className="pos-row">
        <div className="pos-copy">
          <div className="stat-label">Position</div>
          <OperatorHeading name={p.operator} primary={p.shell.primaryStake} />
          <div className="stat-value sm">{formatArx(p.stake)} ARX</div>
          <div className="stat-hint">{p.epochs} epochs · {lamportsToSol(p.sol)} SOL</div>
          <div className="stat-hint mono" title={p.acc}>{shortPk(p.acc)}</div>
          <div className={kind === "ready" ? "pos-status ready" : "pos-status"}>{statusText}</div>
        </div>
        <div className="pos-actions">
          <button
            type="button"
            className="primary"
            disabled={busy || readyHere.length === 0}
            onClick={() => onClaim(readyHere)}
          >
            Claim all
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || readyHere.length === 0}
            onClick={() => onClaim(readyHere.slice(0, nextN))}
          >
            Claim next {nextN}
          </button>
          <button
            type="button"
            className="ghost"
            disabled={busy || !undelegateOk}
            onClick={() => onUndelegate(p.shell)}
          >
            Undelegate
          </button>
          <button
            type="button"
            className="ghost"
            disabled={busy || !withdrawOk}
            onClick={() => onWithdraw(p.shell)}
          >
            Withdraw ARX
          </button>
        </div>
      </div>
      <ProofTable rows={p.rows} busy={busy && p.rows.length === 0} />
    </section>
  );
}

function BrandMark() {
  return (
    <img
      className="brand-mark"
      src="/arcium-logomark.svg"
      width={36}
      height={36}
      alt=""
    />
  );
}

function AppChrome() {
  return (
    <header className="app-header">
      <div className="brand">
        <BrandMark />
        <h1>Arcium Batch Claim</h1>
        <BrandMark />
      </div>
      <p className="lede">
        Leftover rewards, one address, claim per position. Unofficial helper until official claim-all
        ships.
      </p>
    </header>
  );
}

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "Why does my wallet show a negative SOL change after a claim?",
    a: "Wallet “balance change” is usually net SOL, not reward-only: leftover SOL in minus the Solana network fee out. This site takes no fee. Each claim tx still pays the chain: a base signature fee plus a small priority fee attached so the tx is more likely to land (together often about 0.000007 SOL). If that epoch’s leftover reward is smaller, the line can look red. That is fee vs dust reward, not your ARX stake being taken.",
  },
  {
    q: "I already undelegated. Why can’t I withdraw my ARX?",
    a: "Undelegate only starts cooldown. ARX stays in the stake account until Withdraw. This app turns Withdraw on only after leftover reward epochs are gone and unbonding has finished (current epoch past deactivation — often about two Arcium epochs / ~24 hours). That cooldown is an estimate, not a guarantee. Leftover claims are why this helper exists.",
  },
  {
    q: "Why claim tiny “dust” epochs if they cost more than they pay?",
    a: "The staking program tracks last claimed epoch and expects claims in order. This app lists the next epochs that way and does not skip dust. Later epochs and withdraw stay blocked here until that list is cleared. Dust can cost more in fees than it pays; you claim it to exit, not for profit.",
  },
  {
    q: "Why so many transactions? Why isn’t this one click on-chain?",
    a: "Each leftover epoch needs its own indexer Merkle proof. Those proofs are large, so Solana’s ~1232-byte tx limit usually means one claim instruction per transaction. Claim all still tries one wallet approval to sign the remaining set, then this site submits them. The wallet may ask again if a blockhash expires. We do not put every epoch in a single on-chain transaction.",
  },
  {
    q: "Is this the official Arcium site?",
    a: "No. Unofficial community helper. Not affiliated with Arcium. You sign in your own wallet. For staking and docs use the official portal. We do not speak for Arcium’s roadmap.",
  },
  {
    q: "Do I paste a private key?",
    a: "No. Lookup is read-only. Connect a Wallet Standard wallet (Phantom, Solflare, or Backpack) only to sign. This page does not custody keys or funds.",
  },
  {
    q: "Lookup vs Connect — what is the difference?",
    a: "Paste the delegator / withdrawal-authority address (connect can fill it), then Lookup. That lists positions with no signing. Connect is for Claim, Undelegate, and Withdraw. You still have to click Lookup after connecting.",
  },
  {
    q: "I have two cards for the same operator. Is that a bug?",
    a: "Usually not. Each delegated stake account is its own position. This app claims and exits per card and does not mix two positions into one Claim all.",
  },
  {
    q: "A claim failed. Did I lose money?",
    a: "If a transaction is included and the instruction fails, you can still pay the small Solana fee; the leftover reward is not paid out. If a tx never lands, you typically do not pay that fee. Force refresh if a row still shows after a claim you believe landed.",
  },
];

function FaqList() {
  return (
    <section className="faq" aria-labelledby="faq-heading">
      <h2 id="faq-heading">FAQ</h2>
      {FAQ_ITEMS.map((item) => (
        <details key={item.q}>
          <summary>{item.q}</summary>
          <p>{item.a}</p>
        </details>
      ))}
    </section>
  );
}

function IdleGuide() {
  return (
    <footer className="sheet-foot">
      <ol className="guide-steps">
        <li>
          <span className="guide-n">Paste</span>
          <strong>Solana address</strong>
          <span>Read-only lookup. Delegator / withdrawal authority. No wallet yet.</span>
        </li>
        <li>
          <span className="guide-n">Review</span>
          <strong>Positions</strong>
          <span>Epoch proofs stream in. Claim SOL on that card, then undelegate / withdraw ARX.</span>
        </li>
        <li>
          <span className="guide-n">Sign</span>
          <strong>Wallet Standard</strong>
          <span>Phantom, Solflare, or Backpack. One approval signs remaining claims; we submit them.</span>
        </li>
      </ol>
      <p className="guide-caption">
        Never paste a private key — this site does not take custody. Unofficial, not Arcium. Connect
        the withdrawal-authority wallet to sign; lookup works without it.
      </p>
      <FaqList />
    </footer>
  );
}

function LookupSheet({
  address,
  busy,
  error,
  note,
  compact,
  footer,
  onAddress,
  onLookup,
}: {
  address: string;
  busy: boolean;
  error: string | null;
  note: string;
  compact?: boolean;
  footer?: ReactNode;
  onAddress: (value: string) => void;
  onLookup: (e: FormEvent) => void;
}) {
  return (
    <section className={compact ? "sheet sheet--compact" : "sheet"}>
      <div className="sheet-main">
        <AppChrome />
        <p className="disclaimer" role="note">
          Unofficial community tool. Not affiliated with Arcium. You sign every transaction in your
          wallet; failed on-chain claims can still cost a network fee.{" "}
          <a href="https://stake.arcium.com/" target="_blank" rel="noreferrer">
            Official staking portal
          </a>
        </p>
        <form className="hero" onSubmit={onLookup}>
          <div className={error ? "lookup-join lookup-join--invalid" : "lookup-join"}>
            <input
              type="text"
              placeholder="Delegator Solana address"
              value={address}
              onChange={(e) => onAddress(e.target.value)}
              spellCheck={false}
              aria-invalid={error ? true : undefined}
            />
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Fetching…" : "Lookup"}
            </button>
          </div>
          <WalletMultiButton />
        </form>
        {error ? (
          <p className="err" role="alert">
            {error}
          </p>
        ) : note ? (
          <p className="note">{note}</p>
        ) : null}
      </div>
      {footer}
    </section>
  );
}

function EmptyPositions() {
  return (
    <section className="empty-panel">
      <h2>No delegated positions</h2>
      <p>
        This master account has no delegated stake to list. Typical cases: already withdrawn, never
        delegated, or a different address than the withdrawal authority.
      </p>
      <p className="empty-hint">Force refresh after a withdraw, or look up the wallet that still holds the position.</p>
    </section>
  );
}

function LookupSkeleton() {
  return (
    <div className="skel-list" aria-hidden="true">
      <div className="skel-block">
        <div className="skel-card" />
        <div className="skel-table" />
      </div>
      <div className="skel-block">
        <div className="skel-card" />
        <div className="skel-table" />
      </div>
    </div>
  );
}

function ClaimApp() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const [address, setAddress] = useState("");
  const [rows, setRows] = useState<ClaimableRow[] | null>(null);
  const [shells, setShells] = useState<PositionShell[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [claimEvents, setClaimEvents] = useState<ActivityEvent[]>([]);
  const [claiming, setClaiming] = useState(false);
  const [packSize, setPackSize] = useState(INITIAL_BATCH_SIZE);
  const [currentEpoch, setCurrentEpoch] = useState<bigint | null>(null);

  useEffect(() => {
    const pk = wallet.publicKey;
    if (!pk) return;
    setAddress(pk.toBase58());
  }, [wallet.publicKey]);

  const runLookup = useCallback(
    async (skipCache: boolean) => {
      setError(null);
      setClaimEvents([]);
      setRows([]);
      setShells(null);
      setNote("Looking up positions…");
      setBusy(true);
      try {
        const pk = new PublicKey(address.trim());
        const result = await lookupClaimable(
          connection,
          pk.toBase58(),
          (p: LookupProgress) => {
            switch (p.kind) {
              case "positions":
                setShells(p.positions);
                setCurrentEpoch(p.currentEpoch);
                setNote(`Arcium epoch ${p.currentEpoch.toString()}. Streaming proofs…`);
                return;
              case "row":
                setRows((prev) => [...(prev ?? []), p.row]);
                setCurrentEpoch(p.currentEpoch);
                setNote(
                  `Arcium epoch ${p.currentEpoch.toString()}. Fetching proofs ${p.fetched}/${p.total}`,
                );
                return;
              default: {
                const _exhaustive: never = p;
                return _exhaustive;
              }
            }
          },
          skipCache,
        );
        setRows(result.rows);
        setCurrentEpoch(result.currentEpoch);
        setNote(
          `Arcium epoch ${result.currentEpoch.toString()}. ${result.note}`.trim(),
        );
      } catch (err) {
        setRows(null);
        setShells(null);
        setCurrentEpoch(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [address, connection],
  );

  const onLookup = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      void runLookup(false);
    },
    [runLookup],
  );

  const onForceRefresh = useCallback(() => {
    clearCachedProofs();
    void runLookup(true);
  }, [runLookup]);

  const ready = rows?.filter((r) => r.status === "proof-ready") ?? [];
  const totalLamports = ready.reduce((sum, r) => sum + r.amountLamports, 0n);
  const positions: PosSummary[] = (shells ?? []).map((s) => {
    const list = (rows ?? []).filter((x) => x.delegatedStakeAcc === s.delegatedStakeAcc);
    const readyHere = list.filter((x) => x.status === "proof-ready");
    return {
      acc: s.delegatedStakeAcc,
      operator: s.operatorName,
      stake: s.stakeBaseUnits,
      epochs: readyHere.length,
      sol: readyHere.reduce((sum, x) => sum + x.amountLamports, 0n),
      rows: list,
      shell: s,
    } satisfies PosSummary;
  });

  const runClaim = useCallback(
    async (slice: ClaimableRow[]) => {
      if (!wallet.connected || !wallet.publicKey) {
        setVisible(true);
        return;
      }
      if (!wallet.signTransaction) {
        setError("Wallet cannot sign transactions");
        return;
      }
      setError(null);
      setBusy(true);
      setClaiming(true);
      setClaimEvents([]);
      const groups = groupRowsByStakeAccOrder(
        slice,
        (shells ?? []).map((s) => s.delegatedStakeAcc),
      );
      try {
        for (const group of groups) {
          const result = await sendClaimBatches({
            connection,
            wallet: {
              publicKey: wallet.publicKey,
              signTransaction: wallet.signTransaction,
              signAllTransactions: wallet.signAllTransactions,
            },
            rows: group,
            packSize,
            onProgress: (event) => {
              setClaimEvents((prev) => [...prev, event]);
              switch (event.kind) {
                case "fitting":
                case "approve":
                case "sending":
                case "confirming":
                case "submitted":
                case "claim-error":
                  return;
                case "claimed": {
                  const gone = `${event.stakeOffset}:${event.epoch}`;
                  setRows((prev) =>
                    (prev ?? []).filter((r) => `${r.stakeOffset}:${r.epoch}` !== gone),
                  );
                  return;
                }
                default: {
                  const _exhaustive: never = event;
                  return _exhaustive;
                }
              }
            },
          });
          if (result.claimedKeys.length > 0) {
            const gone = new Set(result.claimedKeys);
            setRows((prev) =>
              (prev ?? []).filter((r) => !gone.has(`${r.stakeOffset}:${r.epoch}`)),
            );
          }
          if (result.stoppedAt) {
            setError(`Stopped: ${result.stoppedAt}`);
            break;
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
        setClaiming(false);
      }
    },
    [connection, packSize, setVisible, shells, wallet],
  );

  const runExit = useCallback(
    async (action: ExitAction, shell: PositionShell) => {
      if (!wallet.connected || !wallet.publicKey) {
        setVisible(true);
        return;
      }
      if (!wallet.signTransaction) {
        setError("Wallet cannot sign transactions");
        return;
      }
      if (wallet.publicKey.toBase58() !== shell.withdrawalAuthority || !shell.isWithdrawalAuthority) {
        setError("Connected wallet is not this position's withdrawal authority");
        return;
      }
      let confirmed = false;
      switch (action) {
        case "undelegate":
          confirmed = window.confirm(
            "Undelegate starts ~2-epoch unbonding (~24h). ARX stays in the stake account until you withdraw. No rewards during unbonding.",
          );
          break;
        case "withdraw":
          confirmed = window.confirm(
            "Withdraw ARX sends tokens to your ARX token account and closes this delegated position.",
          );
          break;
        default: {
          const _exhaustive: never = action;
          setError(String(_exhaustive));
          return;
        }
      }
      if (!confirmed) return;
      setError(null);
      setBusy(true);
      setClaiming(true);
      setClaimEvents([]);
      try {
        const walletLike = {
          publicKey: wallet.publicKey,
          signTransaction: wallet.signTransaction,
        };
        const onProgress = (event: ExitProgress) => setClaimEvents((prev) => [...prev, event]);
        let result: { signature?: string; stoppedAt?: string };
        switch (action) {
          case "undelegate":
            result = await sendUndelegate({
              connection,
              wallet: walletLike,
              shell,
              onProgress,
            });
            break;
          case "withdraw":
            result = await sendWithdraw({
              connection,
              wallet: walletLike,
              shell,
              onProgress,
            });
            break;
          default: {
            const _exhaustive: never = action;
            setError(String(_exhaustive));
            return;
          }
        }
        if (result.stoppedAt) {
          setError(result.stoppedAt);
          return;
        }
        const owner = address.trim() || wallet.publicKey.toBase58();
        const refreshed = await refreshPositionExit(connection, owner, shell.stakeOffset);
        setCurrentEpoch(refreshed.currentEpoch);
        if (action === "withdraw" || refreshed.closed) {
          setShells((prev) => (prev ?? []).filter((s) => s.delegatedStakeAcc !== shell.delegatedStakeAcc));
          setRows((prev) => (prev ?? []).filter((r) => r.delegatedStakeAcc !== shell.delegatedStakeAcc));
        } else {
          setShells((prev) =>
            (prev ?? []).map((s) =>
              s.delegatedStakeAcc === shell.delegatedStakeAcc
                ? { ...s, deactivationEpoch: refreshed.deactivationEpoch }
                : s,
            ),
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
        setClaiming(false);
      }
    },
    [address, connection, setVisible, wallet],
  );

  const idle = rows === null;

  return (
    <div className={idle ? "wrap wrap--idle" : "wrap wrap--results"}>
      <LookupSheet
        address={address}
        busy={busy}
        error={error}
        note={note}
        compact={!idle}
        footer={idle && !busy ? <IdleGuide /> : undefined}
        onAddress={setAddress}
        onLookup={onLookup}
      />

      {rows ? (
        <>
          <div className="claim-head">
            <div className="ink-card">
              <div className="ink-copy">
                <span className="stat-label">Claimable</span>
                <div className="ink-value">{lamportsToSol(totalLamports)} SOL</div>
                <span className="ink-meta">{ready.length} epochs</span>
              </div>
              <div className="toolbar-actions">
                <label className="batch-label">
                  claims per tx
                  <input
                    type="number"
                    min={1}
                    max={16}
                    value={packSize}
                    disabled={busy}
                    onChange={(e) => setPackSize(Math.max(1, Number(e.target.value) || 1))}
                  />
                </label>
                <button type="button" className="primary" disabled={busy || ready.length === 0} onClick={() => void runClaim(ready)}>
                  Claim all
                </button>
                <button type="button" className="ghost" disabled={busy || !address.trim()} onClick={onForceRefresh}>
                  Force refresh
                </button>
              </div>
            </div>
            <ActivityStrip events={claimEvents} claiming={claiming} />
          </div>

          <div className="pos-list">
            {busy && (shells === null || positions.length === 0) ? (
              <LookupSkeleton />
            ) : shells === null || positions.length === 0 ? (
              <EmptyPositions />
            ) : (
              positions.map((p) => (
                <PositionBlock
                  key={p.acc}
                  p={p}
                  busy={busy}
                  packSize={packSize}
                  currentEpoch={currentEpoch}
                  walletPk={wallet.publicKey?.toBase58() ?? null}
                  onClaim={runClaim}
                  onUndelegate={(shell) => void runExit("undelegate", shell)}
                  onWithdraw={(shell) => void runExit("withdraw", shell)}
                />
              ))
            )}
          </div>
          <FaqList />
        </>
      ) : null}
    </div>
  );
}

export default function App() {
  const wallets = useMemo(() => [], []);
  const Conn = ConnectionProvider as FC<{
    endpoint: string;
    config?: { commitment?: string };
    children?: ReactNode;
  }>;
  const Wallets = WalletProvider as FC<{
    wallets: never[];
    autoConnect?: boolean;
    children?: ReactNode;
  }>;
  const Modal = WalletModalProvider as FC<{ children?: ReactNode }>;
  return (
    <Conn endpoint={RPC} config={{ commitment: "confirmed" }}>
      <Wallets wallets={wallets} autoConnect={false}>
        <Modal>
          <ClaimApp />
        </Modal>
      </Wallets>
    </Conn>
  );
}
