#!/usr/bin/env node
/**
 * Der Automat — Zeitpläne (Crontab-Syntax) + Regeln + lokales LLM.
 *
 * Regeln stehen in _system/regeln.json. Eine Regel hat:
 *   zeitplan   Crontab, 5 Felder (Minute Stunde Monatstag Monat Wochentag)
 *   ausloeser  optional: { "typ": "neue-datei", "ordner": "00 Inbox" }
 *   aktion     "llm" | "index" | "befehl"
 *   ergebnis   für llm: "vorschlag" (Standard) | "anhang" | "tags"
 *
 * Start:
 *   npm run automat                 läuft dauerhaft, prüft jede Minute
 *   node _system/automat.js --einmal        alle aktiven Regeln einmal jetzt
 *   node _system/automat.js --regel "Name"  nur diese eine Regel jetzt
 * Für OS-eigene Crontabs/Taskplaner: den --einmal-Aufruf eintragen.
 *
 * Grundsatz aus der Bauanleitung: Die KI schlägt vor, der Mensch entscheidet.
 * Deshalb ändert "vorschlag" nie eine Notiz — Vorschläge landen in
 * "00 Inbox/_Automat-Vorschläge.md". Dateien, die mit "_" beginnen,
 * werden nie verarbeitet (verhindert Schleifen).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync, execSync } = require("child_process");

const VAULT_ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(__dirname, "regeln.json");
const STATE_PATH = path.join(__dirname, ".automat-state.json");
const LOG_PATH = path.join(__dirname, "automat-log.md");
const VORSCHLAEGE = path.join(VAULT_ROOT, "00 Inbox", "_Automat-Vorschläge.md");
const MAX_INHALT = 8000; // Zeichen pro Notiz ans LLM

// --- Crontab-Parser (Minute Stunde Monatstag Monat Wochentag) ----------------

function parseField(field, min, max) {
  if (field === "*") return null; // null = jedes
  const set = new Set();
  for (const part of field.split(",")) {
    let m;
    if ((m = part.match(/^\*\/(\d+)$/))) {
      for (let v = min; v <= max; v += Number(m[1])) set.add(v);
    } else if ((m = part.match(/^(\d+)-(\d+)$/))) {
      for (let v = Number(m[1]); v <= Number(m[2]); v++) set.add(v);
    } else if (/^\d+$/.test(part)) {
      set.add(Number(part));
    } else {
      throw new Error(`Ungültiges Crontab-Feld: "${part}"`);
    }
  }
  return set;
}

function cronMatches(expr, d) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Zeitplan braucht 5 Felder: "${expr}"`);
  const vals = [d.getMinutes(), d.getHours(), d.getDate(), d.getMonth() + 1, d.getDay()];
  const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  return parts.every((p, i) => {
    const set = parseField(p, ...ranges[i]);
    return !set || set.has(vals[i]);
  });
}

// --- Zustand & Protokoll -----------------------------------------------------

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}
const state = loadJson(STATE_PATH, { verarbeitet: {} });
const saveState = () => fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function log(text) {
  console.log(`[${stamp()}] ${text}`);
  fs.appendFileSync(LOG_PATH, `- ${stamp()} · ${text}\n`);
}

// --- LLM-Anbindung -----------------------------------------------------------

async function frageLLM(cfg, prompt) {
  const timeout = AbortSignal.timeout(180000);
  if (cfg.anbieter === "ollama") {
    const res = await fetch(`${cfg.url.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      signal: timeout,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: cfg.modell, prompt, stream: false }),
    });
    if (!res.ok) throw new Error(`Ollama antwortet mit HTTP ${res.status}`);
    return (await res.json()).response.trim();
  }
  if (cfg.anbieter === "openai") {
    const headers = { "Content-Type": "application/json" };
    if (cfg.schluessel) headers.Authorization = `Bearer ${cfg.schluessel}`;
    const res = await fetch(`${cfg.url.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: timeout,
      headers,
      body: JSON.stringify({ model: cfg.modell, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error(`LLM-Server antwortet mit HTTP ${res.status}`);
    return (await res.json()).choices[0].message.content.trim();
  }
  if (cfg.anbieter === "claude-cli") {
    const r = spawnSync("claude", ["-p", prompt], { encoding: "utf8", timeout: 300000 });
    if (r.status !== 0) throw new Error(`claude -p fehlgeschlagen: ${r.stderr || r.status}`);
    return r.stdout.trim();
  }
  throw new Error(`Unbekannter Anbieter: "${cfg.anbieter}"`);
}

// --- Ergebnis-Verarbeitung ---------------------------------------------------

function schreibeVorschlag(regel, relPath, antwort) {
  if (!fs.existsSync(VORSCHLAEGE)) {
    fs.writeFileSync(VORSCHLAEGE,
      "---\ntags: [meta, automat]\n---\n\n# Automat-Vorschläge\n\n" +
      "Vorschläge des Automaten (Regeln: `_system/regeln.json`). " +
      "Du entscheidest — erledigte Abschnitte einfach löschen.\n");
  }
  fs.appendFileSync(VORSCHLAEGE,
    `\n## ${stamp()} — ${relPath || regel.name}\n\n> Regel „${regel.name}"\n\n${antwort}\n`);
}

function haengeAn(fullPath, cfg, antwort) {
  fs.appendFileSync(fullPath, `\n\n## Automat (${cfg.modell || cfg.anbieter}, ${stamp()})\n\n${antwort}\n`);
}

function mischeTags(fullPath, antwort) {
  const neu = antwort.split(/[,\n]/).map((t) => t.trim().replace(/^#/, "").replace(/[^\p{L}\p{N}_/-]/gu, ""))
    .filter((t) => t && t.length <= 30).slice(0, 8);
  if (!neu.length) return;
  let text = fs.readFileSync(fullPath, "utf8");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (m && /^tags:/m.test(m[1])) {
    text = text.replace(/^(---\r?\n[\s\S]*?)tags:\s*\[?([^\]\n]*)\]?/m, (all, head, alt) => {
      const merged = [...new Set([...alt.split(",").map((t) => t.trim()).filter(Boolean), ...neu])];
      return `${head}tags: [${merged.join(", ")}]`;
    });
  } else if (m) {
    text = text.replace(/^---\r?\n/, `---\ntags: [${neu.join(", ")}]\n`);
  } else {
    text = `---\ntags: [${neu.join(", ")}]\n---\n\n` + text;
  }
  fs.writeFileSync(fullPath, text);
}

// --- Regeln ausführen --------------------------------------------------------

function neueDateien(ordner) {
  const dir = path.join(VAULT_ROOT, ordner);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith(".md") || name.startsWith("_") || name.startsWith(".")) continue;
    const rel = ordner + "/" + name;
    const mtime = fs.statSync(path.join(dir, name)).mtimeMs;
    if (state.verarbeitet[rel] === mtime) continue;
    out.push({ rel, mtime });
  }
  return out;
}

async function laufeRegel(regel, llmCfg) {
  try {
    if (regel.aktion === "index") {
      const r = spawnSync(process.execPath, [path.join(__dirname, "indexer.js")], { encoding: "utf8" });
      log(`Regel „${regel.name}": ${r.status === 0 ? (r.stdout || "").trim() : "FEHLER: " + r.stderr}`);
      return;
    }
    if (regel.aktion === "befehl") {
      const out = execSync(regel.befehl, { cwd: VAULT_ROOT, encoding: "utf8", timeout: 600000 });
      log(`Regel „${regel.name}": Befehl ausgeführt (${regel.befehl}). ${out.trim().slice(0, 200)}`);
      return;
    }
    if (regel.aktion === "llm") {
      const dateien = regel.ausloeser && regel.ausloeser.typ === "neue-datei"
        ? neueDateien(regel.ausloeser.ordner)
        : [{ rel: null, mtime: null }];
      if (regel.ausloeser && !dateien.length) return; // nichts Neues — still bleiben

      for (const d of dateien) {
        let prompt = regel.prompt;
        if (d.rel) {
          const inhalt = fs.readFileSync(path.join(VAULT_ROOT, d.rel), "utf8").slice(0, MAX_INHALT);
          prompt += `\n\n---\nDATEI: ${d.rel}\n\n${inhalt}`;
        }
        const antwort = await frageLLM(llmCfg, prompt);
        const art = regel.ergebnis || "vorschlag";
        if (art === "anhang" && d.rel) haengeAn(path.join(VAULT_ROOT, d.rel), llmCfg, antwort);
        else if (art === "tags" && d.rel) mischeTags(path.join(VAULT_ROOT, d.rel), antwort);
        else schreibeVorschlag(regel, d.rel, antwort);
        if (d.rel) { state.verarbeitet[d.rel] = d.mtime; saveState(); }
        log(`Regel „${regel.name}": ${d.rel || "Lauf"} → ${art}`);
      }
      return;
    }
    log(`Regel „${regel.name}": unbekannte Aktion "${regel.aktion}" — übersprungen.`);
  } catch (err) {
    log(`Regel „${regel.name}": FEHLER — ${err.message}`);
  }
}

// --- Hauptprogramm -----------------------------------------------------------

async function main() {
  const cfg = loadJson(CONFIG_PATH, null);
  if (!cfg) { console.error(`Keine gültige ${CONFIG_PATH}`); process.exit(1); }
  const regeln = (cfg.regeln || []).filter((r) => r.aktiv !== false);
  const args = process.argv.slice(2);

  const nurRegel = args.indexOf("--regel") !== -1 ? args[args.indexOf("--regel") + 1] : null;
  if (args.includes("--einmal") || nurRegel) {
    for (const r of regeln) {
      if (nurRegel && r.name !== nurRegel) continue;
      await laufeRegel(r, cfg.llm || {});
    }
    return;
  }

  console.log(`Der Automat läuft — ${regeln.length} aktive Regel(n), Prüfung jede Minute. Beenden mit Strg+C.`);
  for (const r of regeln) console.log(`  · ${r.name} (${r.zeitplan})`);
  let letzteMinute = -1;
  const tick = async () => {
    const jetzt = new Date();
    const minute = jetzt.getMinutes() + jetzt.getHours() * 60;
    if (minute === letzteMinute) return;
    letzteMinute = minute;
    for (const r of regeln) {
      try {
        if (r.zeitplan && cronMatches(r.zeitplan, jetzt)) await laufeRegel(r, cfg.llm || {});
      } catch (err) {
        log(`Regel „${r.name}": FEHLER im Zeitplan — ${err.message}`);
      }
    }
  };
  await tick();
  setInterval(tick, 20000);
}

main();
