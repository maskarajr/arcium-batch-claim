import { scrapeOperatorCatalog } from "./_lib/operator-catalog.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

export async function GET(): Promise<Response> {
  const result = await scrapeOperatorCatalog();
  if (!result.ok) {
    return new Response(result.message, {
      status: result.status,
      headers: { "content-type": "text/plain" },
    });
  }
  return new Response(JSON.stringify({ operators: result.operators }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
