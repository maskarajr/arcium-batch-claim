import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";

const INDEXER_ORIGIN = "https://stake.arcium.com";
const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";

function rpcProxy(rpcUrl: string): Record<string, ProxyOptions> {
  const parsed = new URL(rpcUrl);
  const path = `${parsed.pathname}${parsed.search}` || "/";
  return {
    "/rpc": {
      target: parsed.origin,
      changeOrigin: true,
      rewrite: () => path,
    },
  };
}

function siteProxy(): Record<string, ProxyOptions> {
  return {
    "/stake-site": {
      target: INDEXER_ORIGIN,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/stake-site/, "") || "/",
      configure: (proxy) => {
        proxy.on("proxyReq", (proxyReq) => {
          proxyReq.setHeader("origin", INDEXER_ORIGIN);
          proxyReq.setHeader("referer", `${INDEXER_ORIGIN}/`);
        });
      },
    },
  };
}

function indexerProxy(): Record<string, ProxyOptions> {
  return {
    "/api/stake-indexing": {
      target: INDEXER_ORIGIN,
      changeOrigin: true,
      configure: (proxy) => {
        proxy.on("proxyReq", (proxyReq) => {
          proxyReq.setHeader("origin", INDEXER_ORIGIN);
          proxyReq.setHeader("referer", `${INDEXER_ORIGIN}/`);
        });
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const rpcUrl = env.RPC_URL || env.VITE_RPC_URL || PUBLIC_RPC;
  const proxy = { ...indexerProxy(), ...siteProxy(), ...rpcProxy(rpcUrl) };

  return {
    plugins: [react()],
    define: {
      "process.env": {},
    },
    resolve: {
      alias: [
        { find: "buffer", replacement: "buffer" },
        {
          find: /^@anchor-lang\/core$/,
          replacement: fileURLToPath(new URL("./src/shims/anchor-core.ts", import.meta.url)),
        },
      ],
    },
    optimizeDeps: {
      include: ["buffer", "bn.js"],
    },
    server: { port: 5173, proxy, host: true },
    preview: { port: 4173, host: true, proxy, allowedHosts: true },
    build: { sourcemap: false },
  };
});
