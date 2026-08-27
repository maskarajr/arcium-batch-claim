import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chunkUrlsFromHtml,
  namesFromChunkJs,
  type ScrapedOperatorNames,
} from "../src/lib/portalNameScrape.ts";
import {
  mergeOperatorNameDump,
  operatorNameDump,
  sortedOperatorNameDump,
} from "../src/lib/operatorNames.ts";

const INDEXER_ORIGIN = "https://stake.arcium.com";

function arciumHeaders(): Headers {
  const headers = new Headers();
  headers.set("origin", INDEXER_ORIGIN);
  headers.set("referer", `${INDEXER_ORIGIN}/`);
  return headers;
}

async function scrapePortalOperatorNames(): Promise<ScrapedOperatorNames> {
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

const dumpPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/data/operator-names.json",
);

const scraped = await scrapePortalOperatorNames();
const { merged, added, changed } = mergeOperatorNameDump(
  operatorNameDump,
  scraped,
);
const sorted = sortedOperatorNameDump(merged);
writeFileSync(`${dumpPath}`, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(
  `operator-names: added ${added}, changed ${changed}, total ${Object.keys(sorted).length} (scraped ${Object.keys(scraped).length} keys this run)`,
);
