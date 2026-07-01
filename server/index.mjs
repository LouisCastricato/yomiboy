// Local dev server. Serves the static frontend + the same /api routes the Vercel functions
// expose (via the shared server/api-core.mjs), so local behavior matches the deployment.
// On Vercel this file isn't used — api/*.js are the serverless functions and the CDN serves
// the static build. History + saved words live in the browser (localStorage), not here.

import http from "node:http";
import { readFileSync, existsSync, createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import * as core from "./api-core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_DIR = join(ROOT, "web");

const exCfg = JSON.parse(readFileSync(join(ROOT, "server", "config.example.json"), "utf8"));
const PORT = Number(process.env.PORT) || exCfg.httpPort || 8080;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".map": "application/json",
  ".gba": "application/octet-stream",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > 12e6) req.destroy(); });
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}
function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function serveFile(res, file) {
  res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(res);
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "GET" && url === "/api/status") return sendJson(res, 200, await core.status());
    if (req.method === "POST" && url === "/api/enrich") {
      const { japanese } = await readBody(req);
      return sendJson(res, 200, await core.enrich(japanese));
    }
    if (req.method === "POST" && url === "/api/ocr") {
      const { image, mediaType } = await readBody(req);
      if (!image) return sendJson(res, 400, { error: "image required" });
      return sendJson(res, 200, await core.ocr(image, mediaType));
    }
    if (req.method === "POST" && url === "/api/translate") {
      const { japanese } = await readBody(req);
      return sendJson(res, 200, await core.translate(japanese));
    }
    if (req.method === "POST" && url === "/api/ask") {
      const { japanese, translation, messages } = await readBody(req);
      return sendJson(res, 200, await core.ask(japanese, translation, messages));
    }
    if (req.method === "POST" && url === "/api/tts") {
      const { text } = await readBody(req);
      if (!text) return sendJson(res, 400, { error: "text required" });
      const r = await core.tts(text);
      if (r.useBrowser) return sendJson(res, 200, { useBrowser: true });
      res.writeHead(200, { "Content-Type": r.contentType });
      return res.end(r.audio);
    }
  } catch (e) {
    return sendJson(res, 502, { error: e.message });
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}

// Local convenience: serve the mGBA core from node_modules (on Vercel it's a static asset).
function serveVendor(res, url) {
  const m = url.match(/^\/vendor\/mgba\/([A-Za-z0-9._-]+)$/);
  const file = m && join(ROOT, "node_modules", "@thenick775", "mgba-wasm", "dist", m[1]);
  if (!file || !existsSync(file)) { res.writeHead(404); return res.end("Not found"); }
  serveFile(res, file);
}

function serveStatic(req, res) {
  let path = req.url.split("?")[0];
  if (path === "/") path = "/index.html";
  const file = join(WEB_DIR, path);
  if (!file.startsWith(WEB_DIR) || !existsSync(file)) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
  serveFile(res, file);
}

const server = http.createServer((req, res) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  const url = req.url.split("?")[0];
  if (url.startsWith("/vendor/")) return serveVendor(res, url);
  if (url.startsWith("/api/")) return handleApi(req, res, url);
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`[reader] http://localhost:${PORT}  (Ctrl-C to stop)`);
});
