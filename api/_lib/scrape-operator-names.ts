import {
  chunkUrlsFromHtml,
  namesFromChunkJs,
  type ScrapedOperatorNames,
} from "../../src/lib/portalNameScrape";

const INDEXER_ORIGIN = "https://stake.arcium.com";

function arciumHeaders(): Headers {
  const headers = new Headers();
  headers.set("origin", INDEXER_ORIGIN);
  headers.set("referer", `${INDEXER_ORIGIN}/`);
  return headers;
}

export async function scrapePortalOperatorNames(): Promise<ScrapedOperatorNames> {
  const htmlRes = await fetch(`${INDEXER_ORIGIN}/`, { headers: arciumHeaders() });
  if (!htmlRes.ok) {
    throw new Error(`stake.arcium.com HTML ${htmlRes.status}`);
  }
  const html = await htmlRes.text();
  const urls = chunkUrlsFromHtml(html);
  if (urls.length === 0) {
    throw new Error("no /_next/static/chunks/*.js URLs in HTML");
  }
  const merged: ScrapedOperatorNames = {};
  for (const url of urls) {
    const jsRes = await fetch(url, { headers: arciumHeaders() });
    if (!jsRes.ok) continue;
    Object.assign(merged, namesFromChunkJs(await jsRes.text()));
  }
  return merged;
}
