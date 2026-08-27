import { proxyToArcium } from "../_lib/arcium-proxy.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  return proxyToArcium(request, `${url.pathname}${url.search}`);
}

export const GET = handle;
export const POST = handle;
export const HEAD = handle;
