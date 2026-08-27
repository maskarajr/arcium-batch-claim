import type { ParsedProof } from "./types";

const PREFIX = "arcium-proof-v1:";

type StoredProof = {
  leafIndex: number;
  epoch: string;
  openingB64: string;
  totalRewards: string;
  primaryStake: string;
  delegatedStake: string;
};

function key(owner: string, leaf: number): string {
  return `${PREFIX}${owner}:${leaf}`;
}

function openingToB64(opening: number[][]): string {
  const u = new Uint8Array(opening.length * 32);
  for (let i = 0; i < opening.length; i++) {
    u.set(opening[i], i * 32);
  }
  let bin = "";
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  return btoa(bin);
}

function b64ToOpening(b64: string, height: number): number[][] {
  const bin = atob(b64);
  const opening: number[][] = [];
  for (let i = 0; i < height; i++) {
    const hash: number[] = [];
    const off = i * 32;
    for (let j = 0; j < 32; j++) hash.push(bin.charCodeAt(off + j));
    opening.push(hash);
  }
  return opening;
}

export function readCachedProof(
  owner: string,
  leaf: number,
  expectedEpoch?: bigint,
): ParsedProof | null {
  try {
    const raw = localStorage.getItem(key(owner, leaf));
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredProof;
    const epoch = BigInt(s.epoch);
    if (expectedEpoch !== undefined && epoch !== expectedEpoch) return null;
    if (s.leafIndex !== leaf) return null;
    return {
      leafIndex: s.leafIndex,
      epoch,
      opening: b64ToOpening(s.openingB64, 15),
      totalRewards: BigInt(s.totalRewards),
      primaryStake: BigInt(s.primaryStake),
      delegatedStake: BigInt(s.delegatedStake),
    };
  } catch {
    return null;
  }
}

export function clearCachedProofs(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export function writeCachedProof(owner: string, proof: ParsedProof): void {
  const s: StoredProof = {
    leafIndex: proof.leafIndex,
    epoch: proof.epoch.toString(),
    openingB64: openingToB64(proof.opening),
    totalRewards: proof.totalRewards.toString(),
    primaryStake: proof.primaryStake.toString(),
    delegatedStake: proof.delegatedStake.toString(),
  };
  try {
    localStorage.setItem(key(owner, proof.leafIndex), JSON.stringify(s));
  } catch {
    /* quota / private mode */
  }
}
