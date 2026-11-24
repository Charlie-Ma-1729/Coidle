import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { cacheControlFor } from "./static";

let dir: string;
const opened: ReturnType<typeof buildApp>[] = [];
const make = (staticDir: string) => {
  const b = buildApp({ config: { dbPath: ":memory:", staticDir } });
  opened.push(b);
  return b.app;
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "coidle-static-"));
  mkdirSync(join(dir, "assets"));
  mkdirSync(join(dir, "icons"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>shell</title>");
  writeFileSync(join(dir, "sw.js"), "// sw");
  writeFileSync(join(dir, "manifest.webmanifest"), "{}");
  writeFileSync(join(dir, "assets", "app-abc123.js"), "console.log(1)");
  writeFileSync(join(dir, "icons", "icon-192.png"), "png");
  writeFileSync(join(tmpdir(), "coidle-secret.txt"), "top secret");
});
afterEach(async () => {
  while (opened.length) await opened.pop()!.app.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("static front-end serving", () => {
  it("serves the shell at / and for client-side routes, but never swallows the API", async () => {
    const app = make(dir);
    const root = await app.inject({ url: "/" });
    expect(root.statusCode).toBe(200);
    expect(root.headers["content-type"]).toContain("text/html");
    expect(root.body).toContain("shell");
    expect((await app.inject({ url: "/some/page" })).body).toContain("shell");
    const missingApi = await app.inject({ url: "/api/nope" });
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.headers["content-type"]).toContain("json");
    expect((await app.inject({ url: "/api/health" })).json().ok).toBe(true);
  });

  it("uses the right content types and cache policy", async () => {
    const app = make(dir);
    const js = await app.inject({ url: "/assets/app-abc123.js" });
    expect(js.headers["content-type"]).toContain("javascript");
    expect(js.headers["cache-control"]).toContain("immutable");
    expect((await app.inject({ url: "/sw.js" })).headers["cache-control"]).toBe("no-cache");
    const mf = await app.inject({ url: "/manifest.webmanifest" });
    expect(mf.headers["content-type"]).toContain("manifest+json");
    expect(mf.headers["cache-control"]).toBe("no-cache");
    expect((await app.inject({ url: "/icons/icon-192.png" })).headers["content-type"]).toBe("image/png");
    expect(cacheControlFor("/index.html")).toBe("no-cache");
  });

  it("missing files with an extension are 404, and path traversal cannot escape the folder", async () => {
    const app = make(dir);
    expect((await app.inject({ url: "/assets/missing.js" })).statusCode).toBe(404);
    for (const url of ["/../coidle-secret.txt", "/%2e%2e/coidle-secret.txt", "/assets/../../coidle-secret.txt", "/..%2fcoidle-secret.txt"]) {
      const r = await app.inject({ url });
      expect(r.body, url).not.toContain("top secret");
    }
  });

  it("sends security headers on every response", async () => {
    const app = make(dir);
    for (const url of ["/", "/api/health", "/sw.js"]) {
      const h = (await app.inject({ url })).headers;
      expect(h["x-content-type-options"], url).toBe("nosniff");
      expect(h["x-frame-options"]).toBe("DENY");
      expect(h["content-security-policy"]).toContain("default-src 'self'");
    }
  });

  it("does nothing when there is no built front-end (development)", async () => {
    const app = make(join(dir, "does-not-exist"));
    expect((await app.inject({ url: "/" })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/health" })).statusCode).toBe(200);
  });
});

describe("PWA assets in client/public", () => {
  const pub = join(process.cwd(), "client", "public");
  const manifest = JSON.parse(readFileSync(join(pub, "manifest.webmanifest"), "utf8"));

  it("the manifest is installable: name, standalone display, start url and real 192/512 PNG icons", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url.startsWith("/")).toBe(true);
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons as { src: string; sizes: string }[]) {
      const file = join(pub, icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      const png = readFileSync(file);
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      const w = png.readUInt32BE(16);
      expect(`${w}x${w}`).toBe(icon.sizes);
    }
  });

  it("the service worker never caches the API or websocket, and handles push and notification clicks", () => {
    const sw = readFileSync(join(pub, "sw.js"), "utf8");
    expect(sw).toContain('"/api/"');
    expect(sw).toContain('"/ws"');
    expect(sw).toContain('addEventListener("push"');
    expect(sw).toContain('addEventListener("notificationclick"');
    expect(sw).toContain("skipWaiting");
    expect(() => new Function(sw)).not.toThrow(); // 語法正確
  });

  it("index.html links the manifest and icons", () => {
    const html = readFileSync(join(process.cwd(), "client", "index.html"), "utf8");
    expect(html).toContain('rel="manifest"');
    expect(html).toContain("apple-touch-icon");
    expect(html).toContain("theme-color");
  });
});
