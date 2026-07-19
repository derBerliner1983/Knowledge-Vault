#!/usr/bin/env node
/**
 * Lokaler Server für die Graph-Ansicht.
 * Start:  npm start   (oder: node _system/server.js --port 7777)
 * Dann im Browser: http://localhost:7777
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const WEB_ROOT = path.join(__dirname, "web");
const GRAPH_JSON = path.join(__dirname, "graph.json");

const argPort = process.argv.indexOf("--port");
const PORT = argPort !== -1 ? Number(process.argv[argPort + 1]) : Number(process.env.PORT || 7777);
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function reindex() {
  const r = spawnSync(process.execPath, [path.join(__dirname, "indexer.js")], { encoding: "utf8" });
  return { ok: r.status === 0, output: (r.stdout || "") + (r.stderr || "") };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/reindex") {
    const r = reindex();
    res.writeHead(r.ok ? 200 : 500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(r));
    return;
  }

  if (url.pathname === "/graph.json") {
    if (!fs.existsSync(GRAPH_JSON)) reindex();
    res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
    res.end(fs.readFileSync(GRAPH_JSON));
    return;
  }

  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(WEB_ROOT, file);
  if (!full.startsWith(WEB_ROOT) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Nicht gefunden");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
  res.end(fs.readFileSync(full));
});

server.listen(PORT, HOST, () => {
  reindex();
  console.log(`Second-Brain-Graph läuft: http://localhost:${PORT}`);
  console.log("Beenden mit Strg+C. Neu indexieren: npm run index (oder Knopf in der Ansicht).");
});
