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
const automat = require("./automat.js");

const WEB_ROOT = path.join(__dirname, "web");
const GRAPH_JSON = path.join(__dirname, "graph.json");
const CONFIG_PATH = path.join(__dirname, "regeln.json");
const LOG_PATH = path.join(__dirname, "automat-log.md");

const leseConfig = () => JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

function leseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
  });
}

function antworte(res, status, daten) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(daten));
}

/** Validierung der GUI-Konfiguration. Gibt eine Liste deutscher Fehlermeldungen zurück. */
function pruefeConfig(cfg) {
  const fehler = [];
  if (!cfg || typeof cfg !== "object") return ["Ungültige Daten."];
  const llm = cfg.llm || {};
  if (!["lmstudio", "ollama", "openai", "claude-cli"].includes(llm.anbieter)) {
    fehler.push(`Unbekannter LLM-Anbieter: "${llm.anbieter}"`);
  }
  if (!Array.isArray(cfg.regeln)) return [...fehler, "regeln muss eine Liste sein."];
  const namen = new Set();
  cfg.regeln.forEach((r, i) => {
    const wo = `Regel ${i + 1}${r.name ? ` („${r.name}")` : ""}`;
    if (!r.name || !String(r.name).trim()) fehler.push(`${wo}: Name fehlt.`);
    else if (namen.has(r.name)) fehler.push(`${wo}: Name doppelt.`);
    namen.add(r.name);
    if (!["llm", "index", "befehl"].includes(r.aktion)) fehler.push(`${wo}: unbekannte Aktion "${r.aktion}".`);
    if (r.zeitplan) {
      try { automat.cronMatches(r.zeitplan, new Date()); }
      catch (e) { fehler.push(`${wo}: ${e.message}`); }
    } else {
      fehler.push(`${wo}: Zeitplan fehlt.`);
    }
    if (r.aktion === "befehl" && (!r.befehl || !String(r.befehl).trim())) fehler.push(`${wo}: Befehl fehlt.`);
    if (r.aktion === "llm" && (!r.prompt || !String(r.prompt).trim())) fehler.push(`${wo}: Prompt fehlt.`);
    if (r.ausloeser && r.ausloeser.typ === "neue-datei" && !r.ausloeser.ordner) fehler.push(`${wo}: Auslöser-Ordner fehlt.`);
  });
  return fehler;
}

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
  if (r.status === 0) version++;
  return { ok: r.status === 0, output: (r.stdout || "") + (r.stderr || "") };
}

// --- Live: Vault überwachen, bei Änderungen neu indexieren --------------------
// Die Graph-Ansicht fragt /api/version ab und lädt sich bei Änderung selbst neu.

const VAULT_ROOT = path.resolve(__dirname, "..");
const IGNORIEREN = ["_system", ".git", ".obsidian", "node_modules", ".trash"];
let version = 1;
let watchTimer = null;

function starteUeberwachung() {
  try {
    fs.watch(VAULT_ROOT, { recursive: true }, (ereignis, datei) => {
      if (!datei || !datei.toLowerCase().endsWith(".md")) return;
      const norm = String(datei).replace(/\\/g, "/");
      if (IGNORIEREN.some((d) => norm === d || norm.startsWith(d + "/"))) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        const r = reindex();
        if (r.ok) console.log(`Änderung erkannt (${norm}) — neu indexiert.`);
      }, 1200);
    });
    console.log("Live-Überwachung aktiv: Änderungen aus Obsidian erscheinen automatisch.");
  } catch (err) {
    console.log(`Live-Überwachung nicht verfügbar (${err.message}) — Knopf „Neu indexieren" nutzen.`);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/reindex") {
    const r = reindex();
    res.writeHead(r.ok ? 200 : 500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(r));
    return;
  }

  if (url.pathname === "/api/version") {
    antworte(res, 200, { version });
    return;
  }

  // LLM-Status: Anbieter + welche Modelle heruntergeladen / im RAM geladen sind
  if (url.pathname === "/api/llm") {
    try {
      const cfg = leseConfig().llm || {};
      let modelle = { heruntergeladen: [], geladen: [] };
      let fehler = null;
      try { modelle = await automat.listeModelle(cfg); }
      catch (err) { fehler = err.message; }
      antworte(res, 200, {
        anbieter: cfg.anbieter, url: cfg.url, modell: cfg.modell,
        erreichbar: !fehler, fehler, ...modelle,
      });
    } catch (err) { antworte(res, 500, { fehler: err.message }); }
    return;
  }

  // Komplette Konfiguration lesen (für den Editor in der GUI)
  if (url.pathname === "/api/config" && req.method === "GET") {
    try {
      const cfg = leseConfig();
      antworte(res, 200, { llm: cfg.llm || {}, regeln: cfg.regeln || [] });
    } catch (err) { antworte(res, 500, { fehler: err.message }); }
    return;
  }

  // Konfiguration aus der GUI speichern — validiert, mit Backup
  if (url.pathname === "/api/config" && req.method === "POST") {
    try {
      const neu = await leseBody(req);
      const fehler = pruefeConfig(neu);
      if (fehler.length) { antworte(res, 400, { fehler: fehler.join(" · ") }); return; }
      const alt = leseConfig();
      const speichern = {
        llm: neu.llm,
        regeln: neu.regeln,
        _hilfe: alt._hilfe,
        _ergebnis_arten: alt._ergebnis_arten,
      };
      fs.writeFileSync(CONFIG_PATH + ".bak", JSON.stringify(alt, null, 2));
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(speichern, null, 2));
      antworte(res, 200, { ok: true });
    } catch (err) { antworte(res, 500, { fehler: err.message }); }
    return;
  }

  // Regeln + Log-Ende für den Automat-Tab
  if (url.pathname === "/api/regeln") {
    try {
      const cfg = leseConfig();
      let logEnde = "";
      if (fs.existsSync(LOG_PATH)) {
        logEnde = fs.readFileSync(LOG_PATH, "utf8").split("\n").slice(-15).join("\n");
      }
      antworte(res, 200, { regeln: cfg.regeln || [], log: logEnde });
    } catch (err) { antworte(res, 500, { fehler: err.message }); }
    return;
  }

  // Eine Regel sofort ausführen
  if (url.pathname === "/api/regel-lauf" && req.method === "POST") {
    try {
      const { name } = await leseBody(req);
      const cfg = leseConfig();
      const regel = (cfg.regeln || []).find((r) => r.name === name);
      if (!regel) { antworte(res, 404, { fehler: `Regel nicht gefunden: ${name}` }); return; }
      await automat.laufeRegel(regel, cfg.llm || {});
      const logEnde = fs.existsSync(LOG_PATH)
        ? fs.readFileSync(LOG_PATH, "utf8").trim().split("\n").slice(-3).join("\n") : "";
      antworte(res, 200, { ok: true, log: logEnde });
    } catch (err) { antworte(res, 500, { fehler: err.message }); }
    return;
  }

  // Freier Auftrag ans LLM: erst Plan, auf Wunsch direkt ausführen
  if (url.pathname === "/api/auftrag" && req.method === "POST") {
    try {
      const { text, ausfuehren, modell } = await leseBody(req);
      if (!text || !text.trim()) { antworte(res, 400, { fehler: "Kein Auftragstext." }); return; }
      const cfg = leseConfig();
      const ergebnis = await automat.auftrag(cfg.llm || {}, text.trim(), {
        ausfuehren: !!ausfuehren, modell: modell || null,
      });
      antworte(res, 200, ergebnis);
    } catch (err) { antworte(res, 500, { fehler: err.message }); }
    return;
  }

  // Einen zuvor geplanten Aktionsplan ausführen
  if (url.pathname === "/api/aktionen" && req.method === "POST") {
    try {
      const { aktionen } = await leseBody(req);
      if (!Array.isArray(aktionen)) { antworte(res, 400, { fehler: "aktionen fehlt." }); return; }
      antworte(res, 200, { protokoll: automat.fuehreAktionenAus(aktionen) });
    } catch (err) { antworte(res, 500, { fehler: err.message }); }
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
  starteUeberwachung();
  console.log(`Second-Brain-Graph läuft: http://localhost:${PORT}`);
  console.log("Beenden mit Strg+C. Neu indexieren: npm run index (oder Knopf in der Ansicht).");
});
