import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scrapePortalOperatorNames } from "../api/_lib/scrape-operator-names.ts";
import {
  mergeOperatorNameDump,
  operatorNameDump,
  sortedOperatorNameDump,
} from "../src/lib/operatorNames.ts";

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
