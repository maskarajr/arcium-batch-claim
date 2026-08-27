import { describe, expect, it } from "vitest";
import { chunkUrlsFromHtml, namesFromChunkJs } from "./portalNameScrape";

const GREEN_NODE = "89CTz3jDa5D6tRryXadchzjwi1qLqj5nfFeALmCaP3rB";
const GREEN_OWNER = "ApvPuhoKXXfGqCw9WDCfNXhS38Yszf6FpS2wP2SMfmou";
const SF_NODE = "J3pdCmA84o2TinL74Zw5R1AHhWWJ4X1QFjiwLuY8uvt8";
const SF_OWNER = "8pRz8XYmBTjgCHvMGgV1hhZCzrgeParAbFm1A5XkjVsD";
const H2O_NODE = "JDcpeqPBePAMsStd1KuUf73ZeQbo1JgXHw7Ewdq3mwSi";
const H2O_OWNER = "Gh7jSDNLNAfiekbsyWpRbiJRQtvHL6Km8R9C2vMmfPEs";

describe("portalNameScrape", () => {
  it("collects every /_next/static/chunks/*.js URL", () => {
    expect(
      chunkUrlsFromHtml(
        `<script src="/_next/static/chunks/app/foo.js"></script>
         <script src="/_next/static/chunks/1-abc.js?dpl=1"></script>`,
      ),
    ).toEqual([
      "https://stake.arcium.com/_next/static/chunks/app/foo.js",
      "https://stake.arcium.com/_next/static/chunks/1-abc.js",
    ]);
  });

  it("maps quoted/unquoted bound-node keys and owner, including nested logo", () => {
    const js = `g={"${GREEN_NODE}":{name:"Greenfield",logo:p,owner:"${GREEN_OWNER}"},${SF_NODE}:{name:"Staking Facilities",logo:{src:x,blurDataURL:"data:image/png;base64,abc}"},owner:"${SF_OWNER}"},${H2O_NODE}:{name:"H2O Nodes",logo:m,owner:"${H2O_OWNER}"}};`;
    expect(namesFromChunkJs(js)).toEqual({
      [GREEN_NODE]: "Greenfield",
      [GREEN_OWNER]: "Greenfield",
      [SF_NODE]: "Staking Facilities",
      [SF_OWNER]: "Staking Facilities",
      [H2O_NODE]: "H2O Nodes",
      [H2O_OWNER]: "H2O Nodes",
    });
  });

  it("ignores IDL program name objects", () => {
    expect(
      namesFromChunkJs(
        `{name:"system_program",address:"11111111111111111111111111111111"}`,
      ),
    ).toEqual({});
  });
});
