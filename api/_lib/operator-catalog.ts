const EXPLORER_NODES_URL =
  "https://explorer.arcium.com/api/v1/nodes?network=mainnet&limit=100";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isPlausibleBase58(value: string): boolean {
  return BASE58_RE.test(value);
}

export type ExplorerCensusRow = {
  owner: string;
  primary?: string;
  boundNode?: string;
};

export type OperatorCatalogOk = { ok: true; operators: ExplorerCensusRow[] };
export type OperatorCatalogErr = { ok: false; status: 502; message: string };
export type OperatorCatalogResult = OperatorCatalogOk | OperatorCatalogErr;

export function censusToCatalogResult(
  explorer: ExplorerCensusRow[] | null,
): OperatorCatalogResult {
  const byOwner = new Map<string, ExplorerCensusRow>();
  for (const node of explorer ?? []) {
    byOwner.set(node.owner, {
      owner: node.owner,
      ...(node.primary ? { primary: node.primary } : {}),
      ...(node.boundNode ? { boundNode: node.boundNode } : {}),
    });
  }
  const operators = [...byOwner.values()];
  if (operators.length === 0) {
    return {
      ok: false,
      status: 502,
      message:
        explorer === null
          ? "explorer nodes failed"
          : "no active clusterMembership nodes",
    };
  }
  return { ok: true, operators };
}

function parseExplorerNodes(body: unknown): ExplorerCensusRow[] {
  if (!body || typeof body !== "object" || !("data" in body)) return [];
  const data = (body as { data: unknown }).data;
  if (!Array.isArray(data)) return [];
  const out: ExplorerCensusRow[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    if (typeof rec.authorityKey !== "string") continue;
    if (!isPlausibleBase58(rec.authorityKey)) continue;
    if (rec.clusterMembership !== "active") continue;
    if (seen.has(rec.authorityKey)) continue;
    seen.add(rec.authorityKey);
    const parsed: ExplorerCensusRow = { owner: rec.authorityKey };
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

async function fetchExplorerCensus(): Promise<ExplorerCensusRow[] | null> {
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
  return censusToCatalogResult(explorer);
}

export async function operatorCatalogResponse(): Promise<Response> {
  const result = await loadOperatorCatalog();
  if (result.ok === false) {
    return new Response(result.message, {
      status: result.status,
      headers: { "content-type": "text/plain" },
    });
  }
  return new Response(JSON.stringify({ operators: result.operators }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
