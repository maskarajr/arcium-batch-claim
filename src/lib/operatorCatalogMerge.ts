import { lookupOperatorName, type OperatorNameMap } from "./operatorNames";

export type ExplorerCensusRow = {
  owner: string;
  primary?: string;
  boundNode?: string;
};

export type OperatorCatalogEntry = {
  name: string;
  owner: string;
  primary?: string;
  boundNode?: string;
};

export type OperatorCatalogOk = { ok: true; operators: OperatorCatalogEntry[] };
export type OperatorCatalogErr = { ok: false; status: 502; message: string };
export type OperatorCatalogResult = OperatorCatalogOk | OperatorCatalogErr;

export function mergeOperatorCatalog(
  explorer: ExplorerCensusRow[] | null,
  names: OperatorNameMap,
): OperatorCatalogResult {
  const byOwner = new Map<string, OperatorCatalogEntry>();

  for (const node of explorer ?? []) {
    byOwner.set(node.owner, {
      owner: node.owner,
      name: lookupOperatorName(names, node.boundNode, node.owner) ?? "unknown",
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
