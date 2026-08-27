export function isUnnamedOperator(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === "" || n === "unknown";
}

/** Portal-style 4...4, not the full pubkey. */
export function ellipsisPk(pk: string): string {
  return pk.length < 12 ? pk : `${pk.slice(0, 4)}...${pk.slice(-4)}`;
}

export function operatorCardLabel(name: string, primary: string): string {
  if (!isUnnamedOperator(name)) return name;
  return primary ? ellipsisPk(primary) : "unknown";
}
