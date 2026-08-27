import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from "vite";
import { operatorCatalogResponse } from "./api/_lib/operator-catalog";

const INDEXER_ORIGIN = "https://stake.arcium.com";
const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";

function rpcTarget(rpcUrl: string): URL {
  try {
    const parsed = new URL(rpcUrl);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed;
  } catch {
    /* vercel pull writes [SENSITIVE] when secrets cannot be downloaded */
  }
  return new URL(PUBLIC_RPC);
}

function rpcProxy(rpcUrl: string): Record<string, ProxyOptions> {
  const parsed = rpcTarget(rpcUrl);
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
  const configure: NonNullable<ProxyOptions["configure"]> = (proxy) => {
    proxy.on("proxyReq", (proxyReq) => {
      proxyReq.setHeader("origin", INDEXER_ORIGIN);
      proxyReq.setHeader("referer", `${INDEXER_ORIGIN}/`);
    });
  };
  return {
    "/api/stake-site": {
      target: INDEXER_ORIGIN,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api\/stake-site/, "") || "/",
      configure,
    },
    "/stake-site": {
      target: INDEXER_ORIGIN,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/stake-site/, "") || "/",
      configure,
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

function isOperatorsRequest(req: IncomingMessage): boolean {
  if (req.method !== "GET") return false;
  const path = (req.url ?? "").split("?")[0];
  return path === "/api/operators" || path === "/api/operators/";
}

function operatorsApiPlugin(): Plugin {
  const middleware = (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    if (!isOperatorsRequest(req)) {
      next();
      return;
    }
    void (async () => {
      const response = await operatorCatalogResponse();
      const body = await response.text();
      res.statusCode = response.status;
      res.setHeader(
        "content-type",
        response.headers.get("content-type") ?? "text/plain",
      );
      res.end(body);
    })().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      res.statusCode = 502;
      res.setHeader("content-type", "text/plain");
      res.end(msg);
    });
  };
  return {
    name: "operators-api",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const rpcUrl = env.RPC_URL || env.VITE_RPC_URL || PUBLIC_RPC;
  const proxy = { ...indexerProxy(), ...siteProxy(), ...rpcProxy(rpcUrl) };

  return {
    plugins: [react(), operatorsApiPlugin()],
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
