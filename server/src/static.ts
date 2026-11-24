import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { FastifyInstance } from "fastify";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

/** 靜態檔案的快取策略：帶雜湊的資源可長期快取；入口頁、Service Worker、manifest 一律要重新驗證 */
export function cacheControlFor(urlPath: string): string {
  if (urlPath.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  if (urlPath.startsWith("/icons/")) return "public, max-age=86400";
  return "no-cache";
}

/** 基本的安全標頭。CSP 只允許同源（遊戲沒有任何第三方資源）。 */
export const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook("onSend", async (_req, reply) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) reply.header(k, v);
  });
}

/**
 * 直接由 Node 提供打包後的前端（單機部署不需要另外的靜態伺服器；前面有 nginx 時它會負責壓縮與快取）。
 * 沒有 dist 資料夾就什麼都不做（開發時前端由 Vite 提供）。
 */
export function registerStatic(app: FastifyInstance, dir: string): boolean {
  const root = resolve(dir);
  const index = join(root, "index.html");
  if (!existsSync(index)) return false;

  const send = (reply: import("fastify").FastifyReply, file: string, urlPath: string) => {
    reply.header("content-type", TYPES[extname(file).toLowerCase()] ?? "application/octet-stream");
    reply.header("cache-control", cacheControlFor(urlPath));
    return reply.send(createReadStream(file));
  };

  app.get("/*", async (req, reply) => {
    const urlPath = decodeURIComponent((req.raw.url ?? "/").split("?")[0] ?? "/");
    if (urlPath.startsWith("/api/") || urlPath === "/ws") return reply.status(404).send({ error: "找不到" });
    const file = resolve(root, "." + normalize("/" + urlPath));
    if (file !== root && !file.startsWith(root + sep)) return reply.status(404).send({ error: "找不到" });
    if (existsSync(file) && statSync(file).isFile()) return send(reply, file, urlPath);
    // 有副檔名卻找不到＝真的不存在；否則是前端路由，回入口頁
    if (extname(urlPath)) return reply.status(404).send({ error: "找不到" });
    return send(reply, index, "/index.html");
  });
  return true;
}
