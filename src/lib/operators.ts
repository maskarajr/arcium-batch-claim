import { getPrimaryStakeAccAddress } from "@arcium-hq/staking";
import { PublicKey } from "@solana/web3.js";

export type OperatorInfo = { name: string; owner: PublicKey };

let cached: Promise<Map<string, OperatorInfo>> | null = null;

type OperatorJson = { name: string; owner: string };

export function loadOperatorCatalog(): Promise<Map<string, OperatorInfo>> {
  cached ??= fetchCatalog();
  return cached;
}

async function fetchCatalog(): Promise<Map<string, OperatorInfo>> {
  const map = new Map<string, OperatorInfo>();
  const res = await fetch("/api/operators");
  if (!res.ok) return map;
  const body: unknown = await res.json();
  const rows = catalogRows(body);
  for (const row of rows) {
    try {
      const owner = new PublicKey(row.owner);
      const primary = getPrimaryStakeAccAddress(owner).toBase58();
      map.set(primary, { name: row.name, owner });
    } catch {
      /* skip bad pubkey */
    }
  }
  return map;
}

function catalogRows(body: unknown): OperatorJson[] {
  if (!body || typeof body !== "object" || !("operators" in body)) return [];
  const operators = (body as { operators: unknown }).operators;
  if (!Array.isArray(operators)) return [];
  return operators.filter(isOperatorJson);
}

function isOperatorJson(row: unknown): row is OperatorJson {
  if (!row || typeof row !== "object") return false;
  const rec = row as Record<string, unknown>;
  return (
    typeof rec.name === "string" && typeof rec.owner === "string"
  );
}

export async function operatorForPrimary(
  primary: PublicKey,
): Promise<OperatorInfo | null> {
  const catalog = await loadOperatorCatalog();
  return catalog.get(primary.toBase58()) ?? null;
}
