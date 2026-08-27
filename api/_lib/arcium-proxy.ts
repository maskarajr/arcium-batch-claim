const INDEXER_ORIGIN = "https://stake.arcium.com";

export async function proxyToArcium(
  request: Request,
  upstreamPathAndQuery: string,
): Promise<Response> {
  try {
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    headers.set("origin", INDEXER_ORIGIN);
    headers.set("referer", `${INDEXER_ORIGIN}/`);

    const init: RequestInit = { method: request.method, headers };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }

    const path = upstreamPathAndQuery.startsWith("/")
      ? upstreamPathAndQuery
      : `/${upstreamPathAndQuery}`;
    const res = await fetch(`${INDEXER_ORIGIN}${path}`, init);
    const buf = await res.arrayBuffer();
    const out = new Headers();
    const ct = res.headers.get("content-type");
    if (ct) out.set("content-type", ct);
    return new Response(buf, { status: res.status, headers: out });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(msg, { status: 502, headers: { "content-type": "text/plain" } });
  }
}

/** Map /api/stake-site/* or leftover /stake-site/* onto stake.arcium.com paths. */
export function stripStakeSitePath(pathname: string): string {
  for (const prefix of ["/api/stake-site", "/stake-site"]) {
    if (pathname === prefix || pathname === `${prefix}/`) return "/";
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  }
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}
