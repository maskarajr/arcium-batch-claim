import { proxyToArcium, stripStakeSitePath } from "./_lib/arcium-proxy.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const upstream = stripStakeSitePath(url.pathname);
  return proxyToArcium(request, `${upstream}${url.search}`);
}

export const GET = handle;
export const POST = handle;
export const HEAD = handle;
