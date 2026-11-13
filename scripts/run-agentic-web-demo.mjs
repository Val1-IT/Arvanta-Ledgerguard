#!/usr/bin/env node
/**
 * Serve the public Open Agentic Web site at sites/agentic-web with CORS
 * enabled, so published agent files can be fetched from another origin.
 *
 * Usage: pnpm demo:agentic-web
 *        pnpm demo:agentic-web --port 8765
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../sites/agentic-web");
const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = Number(portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || 8765);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
};

function cors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

const server = createServer((request, response) => {
  cors(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405);
    response.end("Method not allowed");
    return;
  }
  const url = new URL(request.url || "/", "http://127.0.0.1");
  let relative = decodeURIComponent(url.pathname);
  if (relative === "/") {
    relative = "/index.html";
  }
  const file = path.normalize(path.join(root, relative));
  if (!file.startsWith(root + path.sep) && file !== root) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  if (!existsSync(file)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  const stats = statSync(file);
  if (stats.isDirectory()) {
    const index = path.join(file, "index.html");
    if (existsSync(index)) {
      response.writeHead(302, { Location: relative.endsWith("/") ? `${relative}index.html` : `${relative}/` });
      response.end();
      return;
    }
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  const type = types[path.extname(file)] || "application/octet-stream";
  response.writeHead(200, { "Content-Type": type, "Content-Length": stats.size });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${port}/`;
  console.log(`LedgerGuard Open Agentic Web demo`);
  console.log(`Serving ${root}`);
  console.log(`Open ${url}`);
  console.log("The policy console works without a key. Expand BYOK / router settings to chat with the assistant.");
  console.log("Synthetic Harborlight data only. Ctrl+C to stop.");
});
