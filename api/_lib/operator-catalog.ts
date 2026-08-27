const INDEXER_ORIGIN = "https://stake.arcium.com";
const EXPLORER_NODES_URL =
  "https://explorer.arcium.com/api/v1/nodes?network=mainnet&limit=100";

const CHUNK_RE = /\/_next\/static\/chunks\/1-[^"'\\s]+\.js/;
const NAME_OWNER_RE =
  /name:"([^"]+)",logo:[^}]*?owner:"([1-9A-HJ-NP-Za-km-z]{32,44})"/g;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type OperatorCatalogEntry = {
  name: string;
  owner: string;
  primary?: string;
};

export type OperatorCatalogOk = { ok: true; operators: OperatorCatalogEntry[] };
export type OperatorCatalogErr = { ok: false; status: 502; message: string };
export type OperatorCatalogResult = OperatorCatalogOk | OperatorCatalogErr;

function isPlausibleBase58(value: string): boolean {
  return BASE58_RE.test(value);
}

function arciumHeaders(): Headers {
  const headers = new Headers();
  headers.set("origin", INDEXER_ORIGIN);
  headers.set("referer", `${INDEXER_ORIGIN}/`);
  return headers;
}

type ExplorerRow = { owner: string; primary?: string };

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

export async function scrapeOperatorCatalog(): Promise<OperatorCatalogResult> {
  try {
    const htmlRes = await fetch(`${INDEXER_ORIGIN}/`, { headers: arciumHeaders() });
    if (!htmlRes.ok) {
      return {
        ok: false,
        status: 502,
        message: `stake.arcium.com HTML ${htmlRes.status}`,
      };
    }
    const html = await htmlRes.text();
    const chunk = html.match(CHUNK_RE);
    if (!chunk) {
      return { ok: false, status: 502, message: "operator chunk not found" };
    }
    const chunkPath = chunk[0].split("?")[0];
    const jsRes = await fetch(`${INDEXER_ORIGIN}${chunkPath}`, {
      headers: arciumHeaders(),
    });
    if (!jsRes.ok) {
      return {
        ok: false,
        status: 502,
        message: `operator chunk ${jsRes.status}`,
      };
    }
    const js = await jsRes.text();
    const operators: OperatorCatalogEntry[] = [];
    const seen = new Set<string>();
    for (const m of js.matchAll(NAME_OWNER_RE)) {
      const owner = m[2];
      if (seen.has(owner)) continue;
      seen.add(owner);
      operators.push({ name: m[1], owner });
    }
    return { ok: true, operators };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 502, message: msg };
  }
}

function portalNames(scrape: OperatorCatalogResult): Map<string, string> {
  const names = new Map<string, string>();
  if (!scrape.ok) return names;
  for (const row of scrape.operators) {
    names.set(row.owner, row.name);
  }
  return names;
}

export function mergeOperatorCatalog(
  explorer: ExplorerRow[] | null,
  scrape: OperatorCatalogResult,
): OperatorCatalogResult {
  const names = portalNames(scrape);
  const byOwner = new Map<string, OperatorCatalogEntry>();

  for (const node of explorer ?? []) {
    byOwner.set(node.owner, {
      owner: node.owner,
      name: names.get(node.owner) ?? "unknown",
      ...(node.primary ? { primary: node.primary } : {}),
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

export async function loadOperatorCatalog(): Promise<OperatorCatalogResult> {
  const [explorer, scrape] = await Promise.all([
    fetchExplorerCensus(),
    scrapeOperatorCatalog(),
  ]);
  return mergeOperatorCatalog(explorer, scrape);
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
