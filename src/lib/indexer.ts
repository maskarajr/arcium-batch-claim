import type { IndexerProofResponse, IndexerStatus, ParsedProof } from "./types";
import { INDEXER_PATH } from "./constants";
import { parseIndexerProof } from "./proof";
import { readCachedProof, writeCachedProof } from "./proofCache";

async function indexerGet(params: URLSearchParams): Promise<string | null> {
  const res = await fetch(`${INDEXER_PATH}?${params.toString()}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Rewards indexer ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.text();
}

export async function fetchIndexerStatus(owner: string): Promise<IndexerStatus | null> {
  const text = await indexerGet(new URLSearchParams({ endpoint: "status", owner }));
  if (text === null) return null;
  return JSON.parse(text) as IndexerStatus;
}

export async function fetchIndexerProof(
  owner: string,
  leaf: number,
  expectedEpoch?: bigint,
  skipCache = false,
): Promise<ParsedProof | null> {
  if (!skipCache) {
    const cached = readCachedProof(owner, leaf, expectedEpoch);
    if (cached) return cached;
  }
  const text = await indexerGet(
    new URLSearchParams({ endpoint: "request", owner, leaf: String(leaf) }),
  );
  if (text === null) return null;
  const json = JSON.parse(text) as IndexerProofResponse;
  const parsed = parseIndexerProof(json, leaf, expectedEpoch);
  writeCachedProof(owner, parsed);
  return parsed;
}
