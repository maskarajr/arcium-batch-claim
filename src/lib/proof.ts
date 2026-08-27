import type { IndexerProofResponse, ParsedProof } from "./types";
import { asBigInt } from "./types";

export function parseIndexerProof(
  raw: unknown,
  expectedLeaf: number,
  expectedEpoch?: bigint,
): ParsedProof {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid rewards indexer response");
  }
  const body = raw as IndexerProofResponse;
  if (!Array.isArray(body.opening)) {
    throw new Error("Merkle opening must be an array");
  }
  if (body.opening.length !== 15) {
    throw new Error("Merkle opening must contain 15 hashes");
  }
  const opening: number[][] = [];
  for (const [i, hash] of body.opening.entries()) {
    if (!Array.isArray(hash) || hash.length !== 32) {
      throw new Error(`Merkle opening hash ${i} must contain 32 bytes`);
    }
    opening.push(
      hash.map((b) => {
        if (typeof b !== "number" || !Number.isInteger(b) || b < 0 || b > 255) {
          throw new Error(`Merkle opening hash ${i} contains an invalid byte`);
        }
        return b;
      }),
    );
  }
  if (!body.claim) throw new Error("Missing reward claim");
  const epoch = asBigInt(body.claim.epoch);
  if (expectedEpoch !== undefined && epoch !== expectedEpoch) {
    throw new Error("Reward proof epoch mismatch");
  }
  if (expectedLeaf < 0 || expectedLeaf > 32767) {
    throw new Error("Merkle leaf index exceeds reward tree size");
  }
  return {
    epoch,
    leafIndex: expectedLeaf,
    opening,
    totalRewards: asBigInt(body.claim.total_rewards),
    primaryStake: asBigInt(body.claim.primary_stake),
    delegatedStake: asBigInt(body.claim.delegated_stake),
  };
}

/** Portal: leafIndex = nextClaimEpoch - firstLeafEpoch (leaf 0 epoch). */
export function leafIndexForEpoch(
  epoch: bigint,
  firstLeafEpoch: bigint,
  treeSize: number,
): number | null {
  if (epoch < firstLeafEpoch) return null;
  const delta = epoch - firstLeafEpoch;
  if (delta > 32767n) return null;
  const i = Number(delta);
  if (i < 0 || i >= treeSize) return null;
  return i;
}

export function delegatedRewardLamports(
  proof: ParsedProof,
  feeBasisPoints: number,
  stakeBaseUnits: bigint,
): bigint {
  if (proof.delegatedStake === 0n) return 0n;
  const nodeStake = proof.primaryStake + proof.delegatedStake;
  if (nodeStake === 0n) return 0n;
  const primaryShare = (proof.totalRewards * proof.primaryStake) / nodeStake;
  const fee = ((proof.totalRewards - primaryShare) * BigInt(feeBasisPoints)) / 10_000n;
  const operatorTake = primaryShare + fee;
  const remainder = proof.totalRewards - operatorTake;
  const share = (remainder * stakeBaseUnits) / proof.delegatedStake;
  const max = (1n << 64n) - 1n;
  return share > max ? max : share;
}
