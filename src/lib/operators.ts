import { getPrimaryStakeAccAddress } from "@arcium-hq/staking";
import { PublicKey } from "@solana/web3.js";

export type OperatorInfo = { name: string; owner: PublicKey };

let cached: Promise<Map<string, OperatorInfo>> | null = null;

const NAME_OWNER_RE =
  /name:"([^"]+)",logo:[^}]*?owner:"([1-9A-HJ-NP-Za-km-z]{32,44})"/g;

export function loadOperatorCatalog(): Promise<Map<string, OperatorInfo>> {
  cached ??= fetchCatalog();
  return cached;
}

async function fetchCatalog(): Promise<Map<string, OperatorInfo>> {
  const map = new Map<string, OperatorInfo>();
  const htmlRes = await fetch("/stake-site/");
  if (!htmlRes.ok) return map;
  const html = await htmlRes.text();
  const chunk = html.match(/\/_next\/static\/chunks\/1-[^"'\\s]+\.js/);
  if (!chunk) return map;
  const jsRes = await fetch(`/stake-site${chunk[0].split("?")[0]}`);
  if (!jsRes.ok) return map;
  const js = await jsRes.text();
  for (const m of js.matchAll(NAME_OWNER_RE)) {
    try {
      const owner = new PublicKey(m[2]);
      const primary = getPrimaryStakeAccAddress(owner).toBase58();
      map.set(primary, { name: m[1], owner });
    } catch {
      /* skip bad pubkey */
    }
  }
  return map;
}

export async function operatorForPrimary(
  primary: PublicKey,
): Promise<OperatorInfo | null> {
  const catalog = await loadOperatorCatalog();
  return catalog.get(primary.toBase58()) ?? null;
}
