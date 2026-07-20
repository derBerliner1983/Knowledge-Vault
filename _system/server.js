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

const os = require("os");
const leseConfig = () => automat.ladeKonfig() || JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

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

// --- Inhalts-Suche -------------------------------------------------------------

function alleNotizen() {
  const out = [];
  const gehe = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) {
        if (!IGNORIEREN.includes(e.name)) gehe(path.join(dir, e.name), r);
      } else if (e.name.toLowerCase().endsWith(".md")) {
        out.push(r);
      }
    }
  };
  gehe(VAULT_ROOT, "");
  return out;
}

/** Volltextsuche: alle Suchwörter müssen vorkommen; liefert Fundstellen-Ausschnitte. */
function sucheExakt(q) {
  const woerter = q.toLowerCase().split(/\s+/).filter(Boolean);
  const treffer = [];
  for (const rel of alleNotizen()) {
    let text;
    try { text = fs.readFileSync(path.join(VAULT_ROOT, rel), "utf8"); } catch { continue; }
    const klein = text.toLowerCase();
    if (!woerter.every((w) => klein.includes(w))) continue;

    const zeilen = text.split(/\r?\n/);
    const fundstellen = [];
    let punkte = 0;
    for (const w of woerter) {
      punkte += klein.split(w).length - 1;
      if (path.basename(rel).toLowerCase().includes(w)) punkte += 25;
    }
    for (let i = 0; i < zeilen.length && fundstellen.length < 3; i++) {
      const zk = zeilen[i].toLowerCase();
      if (woerter.some((w) => zk.includes(w))) {
        const schnipsel = zeilen[i].trim().slice(0, 220);
        if (schnipsel && !schnipsel.startsWith("---")) fundstellen.push(schnipsel);
      }
    }
    treffer.push({ datei: rel, punkte, fundstellen });
  }
  treffer.sort((a, b) => b.punkte - a.punkte);
  return treffer.slice(0, 20);
}

/** Bedeutungssuche über qmd (github.com/tobi/qmd), falls installiert. */
let qmdDa = null;
function sucheBedeutung(q) {
  if (qmdDa === null) {
    qmdDa = spawnSync("qmd", ["--help"], { encoding: "utf8", timeout: 10000 }).status === 0;
  }
  if (!qmdDa) {
    return {
      treffer: [], verfuegbar: false,
      hinweis: "qmd ist nicht installiert. Einrichtung: github.com/tobi/qmd — danach: qmd collection add <Vault-Pfad> && qmd embed",
    };
  }
  const r = spawnSync("qmd", ["query", q, "-n", "10"], {
    cwd: VAULT_ROOT, encoding: "utf8", timeout: 120000,
  });
  if (r.status !== 0) {
    return { treffer: [], verfuegbar: true, hinweis: `qmd meldet: ${(r.stderr || r.stdout || "Fehler").trim().slice(0, 300)}` };
  }
  // Ausgabe robust parsen: Zeilen mit einem .md-Pfad werden zu Treffern.
  // Pfade können Leerzeichen enthalten (z. B. "03 Wissen/…"), deshalb zuerst
  // nach zitierten Pfaden suchen und dann gegen die echte Notizliste abgleichen.
  const bekannte = alleNotizen();
  const treffer = [];
  const gesehen = new Set();
  for (const zeile of (r.stdout || "").split(/\r?\n/)) {
    const m = zeile.match(/"([^"]+\.md)"/i) || zeile.match(/'([^']+\.md)'/i) || zeile.match(/([^\s"']+\.md)/i);
    if (!m) continue;
    let rel = m[1].replace(/\\/g, "/").replace(/^\.\//, "");
    if (!fs.existsSync(path.join(VAULT_ROOT, rel))) {
      const hit = bekannte.find((n) => n === rel || n.endsWith("/" + rel) || rel.endsWith("/" + n) || n.endsWith(rel));
      if (!hit) continue;
      rel = hit;
    }
    if (gesehen.has(rel)) continue;
    gesehen.add(rel);
    const rest = zeile.replace(m[0], "").trim().slice(0, 220);
    treffer.push({ datei: rel, fundstellen: rest ? [rest] : [] });
    if (treffer.length >= 10) break;
  }
  return { treffer, verfuegbar: true };
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

// Bind-Adresse: GUI-Schalter „Heimnetz" (regeln.json → server.heimnetz)
// öffnet den Server fürs lokale Netz (Handy/Tablet); HOST-Env geht vor.
function gewuenschterHost() {
  if (process.env.HOST) return process.env.HOST;
  try { return leseConfig().server && leseConfig().server.heimnetz ? "0.0.0.0" : "127.0.0.1"; }
  catch { return "127.0.0.1"; }
}

function lanAdresse() {
  for (const schnittstellen of Object.values(os.networkInterfaces())) {
    for (const i of schnittstellen || []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return null;
}

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

  // Notiz-Inhalt für die Vorschau im Panel
  if (url.pathname === "/api/notiz") {
    try {
      const rel = (url.searchParams.get("pfad") || "").replace(/\\/g, "/");
      const norm = path.posix.normalize(rel).replace(/^\/+/, "");
      const voll = path.join(VAULT_ROOT, norm);
      if (
        norm.startsWith("..") || !norm.toLowerCase().endsWith(".md") ||
        IGNORIEREN.includes(norm.split("/")[0]) || !voll.startsWith(VAULT_ROOT) ||
        !fs.existsSync(voll)
      ) { antworte(res, 404, { fehler: "Notiz nicht gefunden." }); return; }
      antworte(res, 200, { inhalt: fs.readFileSync(voll, "utf8").slice(0, 200000) });
    } catch (err) { antworte(res, 500, { fehler: err.message }); }
    return;
  }

  // Inhalts-Suche: exakt (Volltext mit Fundstellen) oder bedeutung (qmd)
  if (url.pathname === "/api/suche") {
    const q = (url.searchParams.get("q") || "").trim();
    const art = url.searchParams.get("art") || "exakt";
    if (q.length < 2) { antworte(res, 200, { treffer: [] }); return; }
    try {
      if (art === "bedeutung") { antworte(res, 200, sucheBedeutung(q)); return; }
      antworte(res, 200, { treffer: sucheExakt(q) });
    } catch (err) { antworte(res, 500, { fehler: err.message }); }
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
      antworte(res, 200, {
        llm: cfg.llm || {},
        regeln: cfg.regeln || [],
        llmLokal: !!cfg._llmLokal,
        rechner: os.hostname(),
        server: cfg.server || { heimnetz: false },
        lan: lanAdresse() ? `http://${lanAdresse()}:${PORT}` : null,
      });
    } catch (err) { antworte(res, 500, { fehler: err.message }); }
    return;
  }

  // Konfiguration aus der GUI speichern — validiert, mit Backup.
  // llmLokal=true: LLM-Einstellungen nur für diesen Rechner (regeln.lokal.json,
  // wird nicht mitgesynct) — Regeln und Crontabs bleiben immer geteilt.
  if (url.pathname === "/api/config" && req.method === "POST") {
    try {
      const neu = await leseBody(req);
      const fehler = pruefeConfig(neu);
      if (fehler.length) { antworte(res, 400, { fehler: fehler.join(" · ") }); return; }
      const geteilt = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      fs.writeFileSync(CONFIG_PATH + ".bak", JSON.stringify(geteilt, null, 2));
      const speichern = {
        llm: neu.llmLokal ? geteilt.llm : neu.llm,
        server: { heimnetz: !!(neu.server && neu.server.heimnetz) },
        regeln: neu.regeln,
        _hilfe: geteilt._hilfe,
        _ergebnis_arten: geteilt._ergebnis_arten,
      };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(speichern, null, 2));
      if (neu.llmLokal) {
        fs.writeFileSync(automat.CONFIG_LOKAL, JSON.stringify({ llm: neu.llm }, null, 2));
      } else if (fs.existsSync(automat.CONFIG_LOKAL)) {
        fs.unlinkSync(automat.CONFIG_LOKAL);
      }
      antworte(res, 200, { ok: true, lan: lanAdresse() ? `http://${lanAdresse()}:${PORT}` : null });
      setTimeout(bindeNeuFallsNoetig, 150);
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
      const { aktionen, beschreibung } = await leseBody(req);
      if (!Array.isArray(aktionen)) { antworte(res, 400, { fehler: "aktionen fehlt." }); return; }
      antworte(res, 200, { protokoll: automat.fuehreAktionenAus(aktionen, beschreibung || "Aktionsplan (GUI)") });
    } catch (err) { antworte(res, 500, { fehler: err.message }); }
    return;
  }

  // Aufräum-Bericht — deterministisch, ohne LLM
  if (url.pathname === "/api/bericht") {
    try {
      reindex();
      const g = JSON.parse(fs.readFileSync(GRAPH_JSON, "utf8"));
      const grad = new Map(g.nodes.map((n) => [n.id, 0]));
      for (const e of g.edges) {
        grad.set(e.source, (grad.get(e.source) || 0) + 1);
        grad.set(e.target, (grad.get(e.target) || 0) + 1);
      }
      const waisen = g.nodes
        .filter((n) => !grad.get(n.id) && !path.basename(n.id).startsWith("_") && n.cluster !== "Wurzel")
        .map((n) => n.id);
      const ohneTags = g.nodes
        .filter((n) => (!n.tags || !n.tags.length) && n.cluster !== "Wurzel" && !path.basename(n.id).startsWith("_"))
        .map((n) => n.id);
      const proName = new Map();
      for (const n of g.nodes) {
        const basis = path.basename(n.id, ".md").toLowerCase().replace(/ \(\d+\)$/, "");
        if (basis.startsWith("_")) continue; // Ordnernotizen wie _Über … sind gewollt mehrfach
        if (!proName.has(basis)) proName.set(basis, []);
        proName.get(basis).push(n.id);
      }
      const duplikate = [...proName.values()].filter((liste) => liste.length > 1);
      const inboxAlt = [];
      const inboxDir = path.join(VAULT_ROOT, "00 Inbox");
      if (fs.existsSync(inboxDir)) {
        for (const name of fs.readdirSync(inboxDir)) {
          if (!name.toLowerCase().endsWith(".md") || name.startsWith("_")) continue;
          const tage = Math.floor((Date.now() - fs.statSync(path.join(inboxDir, name)).mtimeMs) / 86400000);
          if (tage >= 14) inboxAlt.push({ datei: "00 Inbox/" + name, tage });
        }
        inboxAlt.sort((a, b) => b.tage - a.tage);
      }
      antworte(res, 200, {
        kaputteLinks: g.unaufgeloest || [],
        waisen, ohneTags, duplikate, inboxAlt,
        stand: new Date().toISOString().slice(0, 16).replace("T", " "),
      });
    } catch (err) { antworte(res, 500, { fehler: err.message }); }
    return;
  }

  // Update aus git: Status prüfen / einspielen
  if (url.pathname === "/api/update" && req.method === "GET") {
    antworte(res, 200, automat.updateStatus());
    return;
  }
  if (url.pathname === "/api/update" && req.method === "POST") {
    const r = automat.updateEinspielen();
    if (r.ok) reindex();
    antworte(res, r.ok ? 200 : 500, r);
    return;
  }

  // Vorschläge-Posteingang: lesen, übernehmen, ablehnen
  if (url.pathname === "/api/vorschlaege" && req.method === "GET") {
    try { antworte(res, 200, { vorschlaege: automat.ladeVorschlaege() }); }
    catch (err) { antworte(res, 500, { fehler: err.message }); }
    return;
  }
  if (url.pathname === "/api/vorschlaege" && req.method === "POST") {
    try {
      const { id, tun } = await leseBody(req);
      const alle = automat.ladeVorschlaege();
      const v = alle.find((x) => x.id === id);
      if (!v) { antworte(res, 404, { fehler: "Vorschlag nicht gefunden." }); return; }
      if (tun === "uebernehmen") {
        if (!v.aktionen || !v.aktionen.length) { antworte(res, 400, { fehler: "Dieser Vorschlag hat keine ausführbaren Aktionen." }); return; }
        const protokoll = automat.fuehreAktionenAus(v.aktionen, `Vorschlag: ${v.datei || v.regel}`);
        automat.entferneVorschlag(id);
        antworte(res, 200, { protokoll });
      } else {
        automat.entferneVorschlag(id);
        antworte(res, 200, { ok: true });
      }
    } catch (err) { antworte(res, 500, { fehler: err.message }); }
    return;
  }

  // Undo-Verlauf lesen / rückgängig machen
  if (url.pathname === "/api/undo" && req.method === "GET") {
    try {
      const verlauf = automat.ladeUndo().map((e, i) => ({
        index: i, zeit: e.zeit, beschreibung: e.beschreibung, schritte: (e.schritte || []).length,
      }));
      antworte(res, 200, { verlauf });
    } catch (err) { antworte(res, 500, { fehler: err.message }); }
    return;
  }
  if (url.pathname === "/api/undo" && req.method === "POST") {
    try {
      const { index } = await leseBody(req);
      antworte(res, 200, { protokoll: automat.macheRueckgaengig(typeof index === "number" ? index : -1) });
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

// --- Eingebauter Automat: Crontab-Regeln laufen im Server mit -----------------
// Kein zweites Programm nötig — der Server prüft jede Minute die Regeln aus
// _system/regeln.json (GUI-Änderungen gelten sofort).

let letzteMinute = -1;
let automatLaeuft = false;

async function automatTick() {
  if (automatLaeuft) return;
  const jetzt = new Date();
  const minute = jetzt.getMinutes() + jetzt.getHours() * 60;
  if (minute === letzteMinute) return;
  letzteMinute = minute;
  automatLaeuft = true;
  try {
    const cfg = leseConfig();
    for (const r of (cfg.regeln || []).filter((x) => x.aktiv !== false)) {
      try {
        if (r.zeitplan && automat.cronMatches(r.zeitplan, jetzt)) {
          await automat.laufeRegel(r, cfg.llm || {});
        }
      } catch (err) {
        console.log(`Regel „${r.name}": FEHLER — ${err.message}`);
      }
    }
  } catch {}
  automatLaeuft = false;
}

let aktuellerHost = gewuenschterHost();

function meldeAdressen() {
  console.log(`Second-Brain-Graph läuft: http://localhost:${PORT}`);
  if (aktuellerHost === "0.0.0.0" && lanAdresse()) {
    console.log(`Im Heimnetz erreichbar (Handy/Tablet): http://${lanAdresse()}:${PORT}`);
  }
}

/** GUI-Schalter „Heimnetz" umgelegt? Dann ohne Neustart neu binden. */
function bindeNeuFallsNoetig() {
  const soll = gewuenschterHost();
  if (soll === aktuellerHost) return;
  aktuellerHost = soll;
  if (server.closeAllConnections) server.closeAllConnections();
  server.close(() => {
    server.listen(PORT, aktuellerHost, () => {
      console.log(soll === "0.0.0.0"
        ? "Heimnetz-Zugriff EIN — Windows fragt ggf. einmal nach Firewall-Freigabe."
        : "Heimnetz-Zugriff AUS — nur noch dieser Rechner.");
      meldeAdressen();
    });
  });
}

// Täglicher Update-Check: bei neuen Versionen landet ein Hinweis im Posteingang.
function taeglicherUpdateCheck() {
  try {
    const s = automat.updateStatus();
    if (!s.ok || !s.hinter) return;
    if (automat.ladeVorschlaege().some((v) => v.regel === "Update-Prüfung")) return;
    automat.schreibeVorschlag({ name: "Update-Prüfung" }, null,
      `Es gibt ${s.hinter} Update(s) für das System:\n` +
      s.meldungen.map((m) => `· ${m}`).join("\n") +
      `\nInstallieren: ⚙-Tab → Update → „Update jetzt installieren".`);
    console.log(`Update verfügbar (${s.hinter} Commit(s)) — Hinweis liegt im Posteingang.`);
  } catch {}
}

server.listen(PORT, aktuellerHost, () => {
  reindex();
  starteUeberwachung();
  setInterval(automatTick, 20000);
  automatTick();
  setTimeout(taeglicherUpdateCheck, 15000);
  setInterval(taeglicherUpdateCheck, 24 * 3600 * 1000);
  meldeAdressen();
  console.log("Der Automat läuft mit: Crontab-Regeln aus _system/regeln.json werden jede Minute geprüft.");
  console.log("Beenden mit Strg+C. Neu indexieren: npm run index (oder Knopf in der Ansicht).");
});
