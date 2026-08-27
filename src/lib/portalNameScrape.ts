/**
 * Portal allowlist scrape (hint only). Per-chunk matches:
 * - `"<boundNode>":{name:"…",logo:…,owner:"<owner>"}` (quoted map key)
 * - `<boundNode>:{name:"…",logo:…,owner:"<owner>"}` (unquoted key)
 * - `logo` may be an ident (`logo:p`) or nested `{src,…}` (base64); owner follows
 * Maps both bound-node key and `owner` pubkey → display name.
 * Does not scrape IDL `name:"system_program"` / program-id objects.
 */
const INDEXER_ORIGIN = "https://stake.arcium.com";

const BASE58 = "[1-9A-HJ-NP-Za-km-z]{32,44}";
const CHUNK_PATH_RE = /\/_next\/static\/chunks\/[^"'?\s]+\.js/g;
const ENTRY_RE = new RegExp(
  `(?:"(${BASE58})"|(${BASE58})):\\{name:"([^"]+)",logo:`,
  "g",
);
const OWNER_RE = new RegExp(`owner:"(${BASE58})"`);

export type ScrapedOperatorNames = Record<string, string>;

export function chunkUrlsFromHtml(html: string): string[] {
  const seen = new Set<string>();
  for (const m of html.matchAll(CHUNK_PATH_RE)) {
    const path = m[0].split("?")[0];
    seen.add(`${INDEXER_ORIGIN}${path}`);
  }
  return [...seen];
}

export function namesFromChunkJs(js: string): ScrapedOperatorNames {
  const out: ScrapedOperatorNames = {};
  for (const m of js.matchAll(ENTRY_RE)) {
    const boundNode = m[1] ?? m[2];
    const name = m[3]?.trim();
    if (!boundNode || !name) continue;
    const from = (m.index ?? 0) + m[0].length;
    const window = js.slice(from, from + 12_000);
    const ownerHit = window.match(OWNER_RE);
    out[boundNode] = name;
    if (ownerHit?.[1]) out[ownerHit[1]] = name;
  }
  return out;
}
