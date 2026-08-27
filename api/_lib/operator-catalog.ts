import {
  mergeOperatorCatalog,
  type OperatorCatalogResult,
} from "../../src/lib/operatorCatalogMerge";
import { operatorNameDump } from "../../src/lib/operatorNames";

const EXPLORER_NODES_URL =
  "https://explorer.arcium.com/api/v1/nodes?network=mainnet&limit=100";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isPlausibleBase58(value: string): boolean {
  return BASE58_RE.test(value);
}

type ExplorerRow = {
  owner: string;
  primary?: string;
  boundNode?: string;
};

function parseExplorerNodes(body: unknown): ExplorerRow[] {
  if (!body || typeof body !== "object" || !("data" in body)) return [];
  const data = (body as { data: unknown }).data;
  if (!Array.isArray(data)) return [];
  const out: ExplorerRow[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    if (typeof rec.authorityKey !== "string") continue;
    if (!isPlausibleBase58(rec.authorityKey)) continue;
    if (rec.clusterMembership !== "active") continue;
    if (seen.has(rec.authorityKey)) continue;
    seen.add(rec.authorityKey);
    const parsed: ExplorerRow = { owner: rec.authorityKey };
    if (
      typeof rec.primaryStakingAccount === "string" &&
      isPlausibleBase58(rec.primaryStakingAccount)
    ) {
      parsed.primary = rec.primaryStakingAccount;
    }
    if (typeof rec.address === "string" && isPlausibleBase58(rec.address)) {
      parsed.boundNode = rec.address;
    }
    out.push(parsed);
  }
  return out;
}

async function fetchExplorerCensus(): Promise<ExplorerRow[] | null> {
  try {
    const res = await fetch(EXPLORER_NODES_URL);
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return parseExplorerNodes(body);
  } catch {
    return null;
  }
}

export async function loadOperatorCatalog(): Promise<OperatorCatalogResult> {
  const explorer = await fetchExplorerCensus();
  return mergeOperatorCatalog(explorer, operatorNameDump);
}

export async function operatorCatalogResponse(): Promise<Response> {
  const result = await loadOperatorCatalog();
  switch (result.ok) {
    case false:
      return new Response(result.message, {
        status: result.status,
        headers: { "content-type": "text/plain" },
      });
    case true:
      return new Response(JSON.stringify({ operators: result.operators }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    default: {
      const _never: never = result;
      return _never;
    }
  }
}
