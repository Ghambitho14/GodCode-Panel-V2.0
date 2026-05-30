import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv, type Plugin, type ViteDevServer } from "vite";

/**
 * Plugin SOLO de desarrollo: monta las funciones serverless `/api/auth/*` dentro
 * del dev server de Vite para poder probar el BFF de cookies httpOnly con un unico
 * `pnpm dev` (sin Vercel CLI). En produccion estas rutas corren como funciones
 * nativas en Vercel y este plugin no se usa (`apply: "serve"`).
 */

const ROUTES = ["login", "logout", "refresh", "session"] as const;

/** Lee el body crudo del request y lo intenta parsear como JSON. */
function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(raw));
      } catch {
        resolveBody(raw);
      }
    });
    req.on("error", () => resolveBody({}));
  });
}

/** Envuelve la respuesta de Node con los helpers que esperan los handlers de Vercel. */
function wrapResponse(res: ServerResponse) {
  const shim = res as ServerResponse & {
    status: (code: number) => typeof shim;
    json: (body: unknown) => void;
  };
  shim.status = (code: number) => {
    res.statusCode = code;
    return shim;
  };
  shim.json = (body: unknown) => {
    if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  };
  return shim;
}

export function bffDevPlugin(mode: string): Plugin {
  return {
    name: "gc-bff-dev",
    apply: "serve",
    configResolved() {
      // Inyecta el .env (sin prefijo) en process.env para que los handlers del BFF
      // (que leen SUPABASE_URL / VITE_SUPABASE_URL via process.env) los encuentren.
      const env = loadEnv(mode, process.cwd(), "");
      for (const [key, value] of Object.entries(env)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
    },
    resolveId(source, importer) {
      // Los handlers importan con extension `.js` (NodeNext). En dev mapeamos al `.ts`.
      if (importer && importer.includes("/api/") && source.endsWith(".js")) {
        const candidate = resolve(dirname(importer), source.replace(/\.js$/, ".ts"));
        if (existsSync(candidate)) return candidate;
      }
      return null;
    },
    configureServer(server: ViteDevServer) {
      for (const route of ROUTES) {
        server.middlewares.use(`/api/auth/${route}`, async (req, res) => {
          try {
            const mod = await server.ssrLoadModule(`/api/auth/${route}.ts`);
            const handler = mod.default as (
              request: unknown,
              response: unknown,
            ) => unknown | Promise<unknown>;

            const reqShim = req as IncomingMessage & { body?: unknown };
            if (req.method && req.method !== "GET" && req.method !== "HEAD") {
              reqShim.body = await readBody(req);
            }

            await handler(reqShim, wrapResponse(res));
          } catch (error) {
            const message = error instanceof Error ? error.message : "Error de servidor.";
            // eslint-disable-next-line no-console
            console.error(`[gc-bff-dev] /api/auth/${route} fallo:`, error);
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
            }
            res.end(JSON.stringify({ error: message }));
          }
        });
      }
    },
  };
}
