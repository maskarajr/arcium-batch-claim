const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

export async function POST(request: Request): Promise<Response> {
  const rpcUrl = process.env.RPC_URL || PUBLIC_RPC;
  const body = await request.text();
  const contentType = request.headers.get("content-type") || "application/json";
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
  const out = new Headers();
  const ct = res.headers.get("content-type");
  if (ct) out.set("content-type", ct);
  return new Response(res.body, { status: res.status, headers: out });
}
