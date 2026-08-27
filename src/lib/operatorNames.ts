import { isUnnamedOperator } from "./operatorLabel";
import rawNames from "../data/operator-names.json";

export type OperatorNameMap = Record<string, string>;

export const operatorNameDump: OperatorNameMap = rawNames as OperatorNameMap;

/** Display lookup: bound node `address`, then owner / `authorityKey`. */
export function lookupOperatorName(
  names: OperatorNameMap,
  boundNode: string | undefined,
  owner: string,
): string | undefined {
  if (boundNode) {
    const fromNode = names[boundNode];
    if (fromNode && !isUnnamedOperator(fromNode)) return fromNode;
  }
  const fromOwner = names[owner];
  if (fromOwner && !isUnnamedOperator(fromOwner)) return fromOwner;
  return undefined;
}

export function mergeOperatorNameDump(
  existing: OperatorNameMap,
  scraped: OperatorNameMap,
): { merged: OperatorNameMap; added: number; changed: number } {
  const merged: OperatorNameMap = { ...existing };
  let added = 0;
  let changed = 0;
  for (const [key, name] of Object.entries(scraped)) {
    if (!key || isUnnamedOperator(name)) continue;
    const prev = merged[key];
    if (prev === undefined) {
      merged[key] = name;
      added += 1;
    } else if (prev !== name) {
      merged[key] = name;
      changed += 1;
    }
  }
  return { merged, added, changed };
}

export function sortedOperatorNameDump(names: OperatorNameMap): OperatorNameMap {
  return Object.fromEntries(
    Object.entries(names).sort(([a], [b]) => a.localeCompare(b)),
  );
}
