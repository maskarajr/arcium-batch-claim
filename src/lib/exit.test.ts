import { describe, expect, it } from "vitest";
import { canUndelegate, canWithdraw, exitStatusLabel, positionExitKind } from "./exit";

describe("positionExitKind", () => {
  it("is active when deactivation is unset", () => {
    expect(positionExitKind(null, 10n)).toBe("active");
  });

  it("is unbonding while current epoch has not passed deactivation", () => {
    expect(positionExitKind(10n, 10n)).toBe("unbonding");
    expect(positionExitKind(10n, 9n)).toBe("unbonding");
  });

  it("is ready when current epoch is past deactivation", () => {
    expect(positionExitKind(10n, 11n)).toBe("ready");
  });
});

describe("exitStatusLabel", () => {
  it("labels each kind", () => {
    expect(exitStatusLabel("active", null)).toBe("Active");
    expect(exitStatusLabel("unbonding", 42n)).toBe("Unbonding until epoch 42");
    expect(exitStatusLabel("ready", 42n)).toBe("Ready to withdraw");
  });
});

describe("canUndelegate", () => {
  const ok = {
    kind: "active" as const,
    proofReadyCount: 0,
    hasPrimaryStake: true,
    walletIsWithdrawalAuthority: true,
  };

  it("enables only for active claimed-up withdrawal authority", () => {
    expect(canUndelegate(ok)).toBe(true);
    expect(canUndelegate({ ...ok, proofReadyCount: 1 })).toBe(false);
    expect(canUndelegate({ ...ok, hasPrimaryStake: false })).toBe(false);
    expect(canUndelegate({ ...ok, walletIsWithdrawalAuthority: false })).toBe(false);
    expect(canUndelegate({ ...ok, kind: "unbonding" })).toBe(false);
    expect(canUndelegate({ ...ok, kind: "ready" })).toBe(false);
  });
});

describe("canWithdraw", () => {
  const ok = {
    kind: "ready" as const,
    proofReadyCount: 0,
    walletIsWithdrawalAuthority: true,
    hasPrimaryStake: true,
    hasDelegationOwner: true,
  };

  it("enables only when unbonding window has passed and rewards are claimed", () => {
    expect(canWithdraw(ok)).toBe(true);
    expect(canWithdraw({ ...ok, proofReadyCount: 1 })).toBe(false);
    expect(canWithdraw({ ...ok, kind: "active" })).toBe(false);
    expect(canWithdraw({ ...ok, kind: "unbonding" })).toBe(false);
    expect(canWithdraw({ ...ok, walletIsWithdrawalAuthority: false })).toBe(false);
    expect(canWithdraw({ ...ok, hasPrimaryStake: false })).toBe(false);
    expect(canWithdraw({ ...ok, hasDelegationOwner: false })).toBe(false);
  });
});
