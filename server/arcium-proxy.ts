const INDEXER_ORIGIN = "https://stake.arcium.com";

export async function proxyToArcium(
  request: Request,
  upstreamPathAndQuery: string,
): Promise<Response> {
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("origin", INDEXER_ORIGIN);
  headers.set("referer", `${INDEXER_ORIGIN}/`);

  const init: RequestInit = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  const res = await fetch(`${INDEXER_ORIGIN}${upstreamPathAndQuery}`, init);
  const out = new Headers();
  const ct = res.headers.get("content-type");
  if (ct) out.set("content-type", ct);
  return new Response(res.body, { status: res.status, headers: out });
}

export function pathAfterPrefix(pathname: string, prefix: string): string {
  if (pathname === prefix || pathname === `${prefix}/`) return "/";
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  return pathname;
}
