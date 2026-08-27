import { getPrimaryStakeAccAddress } from "@arcium-hq/staking";
import { PublicKey } from "@solana/web3.js";
import { isUnnamedOperator } from "./operatorLabel";
import { lookupOperatorName, operatorNameDump } from "./operatorNames";

export type OperatorInfo = { name: string; owner: PublicKey };

let cached: Promise<Map<string, OperatorInfo>> | null = null;

type OperatorJson = {
  name: string;
  owner: string;
  primary?: string;
  boundNode?: string;
};

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
      const primary = catalogMapKey(row, owner);
      map.set(primary, { name: catalogDisplayName(row), owner });
    } catch {
      /* skip bad pubkey */
    }
  }
  return map;
}

function catalogMapKey(row: OperatorJson, owner: PublicKey): string {
  if (row.primary) {
    try {
      return new PublicKey(row.primary).toBase58();
    } catch {
      /* derive from owner */
    }
  }
  return getPrimaryStakeAccAddress(owner).toBase58();
}

function catalogDisplayName(row: OperatorJson): string {
  if (!isUnnamedOperator(row.name)) return row.name;
  return (
    lookupOperatorName(operatorNameDump, row.boundNode, row.owner) ?? row.name
  );
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
  if (typeof rec.name !== "string" || typeof rec.owner !== "string") {
    return false;
  }
  if (rec.primary !== undefined && typeof rec.primary !== "string") {
    return false;
  }
  if (rec.boundNode !== undefined && typeof rec.boundNode !== "string") {
    return false;
  }
  return true;
}

export async function operatorForPrimary(
  primary: PublicKey,
): Promise<OperatorInfo | null> {
  const catalog = await loadOperatorCatalog();
  return catalog.get(primary.toBase58()) ?? null;
}
