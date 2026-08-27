const INDEXER_ORIGIN = "https://stake.arcium.com";

const CHUNK_RE = /\/_next\/static\/chunks\/1-[^"'\\s]+\.js/;
const NAME_OWNER_RE =
  /name:"([^"]+)",logo:[^}]*?owner:"([1-9A-HJ-NP-Za-km-z]{32,44})"/g;

export type OperatorCatalogEntry = {
  name: string;
  owner: string;
};

export type OperatorCatalogOk = { ok: true; operators: OperatorCatalogEntry[] };
export type OperatorCatalogErr = { ok: false; status: 502; message: string };
export type OperatorCatalogResult = OperatorCatalogOk | OperatorCatalogErr;

function arciumHeaders(): Headers {
  const headers = new Headers();
  headers.set("origin", INDEXER_ORIGIN);
  headers.set("referer", `${INDEXER_ORIGIN}/`);
  return headers;
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

export async function operatorCatalogResponse(): Promise<Response> {
  const result = await scrapeOperatorCatalog();
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
