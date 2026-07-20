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
const os = require("os");
const path = require("path");
const { spawnSync, execSync } = require("child_process");

const VAULT_ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(__dirname, "regeln.json");
const CONFIG_LOKAL = path.join(__dirname, "regeln.lokal.json");
const STATE_PATH = path.join(__dirname, ".automat-state.json");
const LOG_PATH = path.join(__dirname, "automat-log.md");
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

/**
 * Konfiguration laden: regeln.json (geteilt, synct mit dem Vault) plus
 * optional regeln.lokal.json (nur dieser Rechner, wird nicht gesynct) —
 * die lokale Datei überschreibt die LLM-Einstellungen.
 */
function ladeKonfig() {
  const cfg = loadJson(CONFIG_PATH, null);
  if (!cfg) return null;
  const lokal = loadJson(CONFIG_LOKAL, null);
  if (lokal && lokal.llm) cfg.llm = Object.assign({}, cfg.llm, lokal.llm);
  cfg._llmLokal = !!(lokal && lokal.llm);
  return cfg;
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

const basisUrl = (cfg) => (cfg.url || standardUrl(cfg.anbieter)).replace(/\/$/, "");
function standardUrl(anbieter) {
  return anbieter === "lmstudio" ? "http://localhost:1234"
    : anbieter === "ollama" ? "http://localhost:11434" : "";
}

/** Modelle des lokalen Servers: heruntergeladen + im RAM geladen. */
async function listeModelle(cfg) {
  const timeout = AbortSignal.timeout(8000);
  const url = basisUrl(cfg);
  if (cfg.anbieter === "lmstudio") {
    // Native LM-Studio-API kennt den Lade-Zustand; /v1/models als Rückfallebene.
    try {
      const res = await fetch(`${url}/api/v0/models`, { signal: timeout });
      if (res.ok) {
        const j = await res.json();
        const alle = (j.data || j.models || []).filter((m) => (m.type || "llm") !== "embeddings");
        return {
          heruntergeladen: alle.map((m) => m.id),
          geladen: alle.filter((m) => m.state === "loaded").map((m) => m.id),
        };
      }
    } catch {}
    const res = await fetch(`${url}/v1/models`, { signal: timeout });
    if (!res.ok) throw new Error(`LM Studio nicht erreichbar (HTTP ${res.status}) — läuft der Server? (LM Studio → Developer → Start Server)`);
    const ids = ((await res.json()).data || []).map((m) => m.id);
    return { heruntergeladen: ids, geladen: [] };
  }
  if (cfg.anbieter === "ollama") {
    const tags = await (await fetch(`${url}/api/tags`, { signal: timeout })).json();
    let geladen = [];
    try { geladen = ((await (await fetch(`${url}/api/ps`, { signal: timeout })).json()).models || []).map((m) => m.name); } catch {}
    return { heruntergeladen: (tags.models || []).map((m) => m.name), geladen };
  }
  return { heruntergeladen: [], geladen: [] };
}

/** "auto" → nimm das Modell, das gerade im RAM geladen ist. */
async function aufloeseModell(cfg) {
  if (cfg.modell && cfg.modell !== "auto") return cfg.modell;
  const m = await listeModelle(cfg);
  if (m.geladen.length) return m.geladen[0];
  if (m.heruntergeladen.length === 1) return m.heruntergeladen[0];
  throw new Error(
    cfg.anbieter === "lmstudio"
      ? "Kein Modell im RAM geladen — in LM Studio ein Modell laden oder in regeln.json ein festes Modell eintragen."
      : "Kein geladenes Modell gefunden — Modell in regeln.json eintragen.");
}

async function frageLLM(cfg, prompt) {
  const timeout = AbortSignal.timeout(300000);
  if (cfg.anbieter === "ollama") {
    const modell = await aufloeseModell(cfg);
    const res = await fetch(`${basisUrl(cfg)}/api/generate`, {
      method: "POST",
      signal: timeout,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modell, prompt, stream: false }),
    });
    if (!res.ok) throw new Error(`Ollama antwortet mit HTTP ${res.status}`);
    return (await res.json()).response.trim();
  }
  if (cfg.anbieter === "lmstudio" || cfg.anbieter === "openai") {
    const modell = cfg.anbieter === "lmstudio" ? await aufloeseModell(cfg) : cfg.modell;
    const headers = { "Content-Type": "application/json" };
    if (cfg.schluessel) headers.Authorization = `Bearer ${cfg.schluessel}`;
    const pfad = cfg.anbieter === "lmstudio" ? "/v1/chat/completions" : "/chat/completions";
    const res = await fetch(`${basisUrl(cfg)}${pfad}`, {
      method: "POST",
      signal: timeout,
      headers,
      body: JSON.stringify({ model: modell, messages: [{ role: "user", content: prompt }] }),
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

/**
 * Vorschläge landen strukturiert in .vorschlaege.json und werden im ⚙-Tab
 * als Posteingang angezeigt (Übernehmen / Ablehnen). Wenn die LLM-Antwort
 * auswertbar ist, wird gleich ein fertiger Aktionsplan mitgespeichert —
 * „Übernehmen" führt dann deterministisch aus (und ist rückgängig machbar).
 */
const VORSCHLAEGE_PATH = path.join(__dirname, ".vorschlaege.json");

const ladeVorschlaege = () => loadJson(VORSCHLAEGE_PATH, []);
function speichereVorschlaege(liste) {
  fs.writeFileSync(VORSCHLAEGE_PATH, JSON.stringify(liste.slice(-100), null, 2));
}
function entferneVorschlag(id) {
  const liste = ladeVorschlaege();
  const v = liste.find((x) => x.id === id);
  speichereVorschlaege(liste.filter((x) => x.id !== id));
  return v || null;
}

function schreibeVorschlag(regel, relPath, antwort) {
  let text = antwort;
  let aktionen = null;
  try {
    const j = parseAktionsplan(antwort);
    if (Array.isArray(j.aktionen) && j.aktionen.length) {
      aktionen = j.aktionen;
      text = j.begruendung || j.zusammenfassung || text;
    } else if (j.zielordner || j.tags) {
      // Kurzform der Inbox-Regel: {zusammenfassung, tags, zielordner}
      text = j.zusammenfassung || text;
      aktionen = [];
      if (relPath && j.zielordner && typeof j.zielordner === "string") {
        const ordner = j.zielordner.replace(/[\\/]+$/, "");
        const zielRel = ordner + "/" + path.basename(relPath);
        if (fs.existsSync(path.join(VAULT_ROOT, ordner)) && zielRel !== relPath) {
          aktionen.push({ tu: "verschieben", von: relPath, nach: zielRel });
        }
      }
      if (relPath && Array.isArray(j.tags) && j.tags.length) {
        const zielDatei = aktionen.length ? aktionen[0].nach : relPath;
        aktionen.push({ tu: "tags", datei: zielDatei, tags: j.tags.slice(0, 8) });
      }
      if (!aktionen.length) aktionen = null;
    }
  } catch {} // keine JSON-Antwort — als Freitext-Vorschlag speichern

  const liste = ladeVorschlaege();
  liste.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    zeit: stamp(),
    regel: regel.name,
    datei: relPath || null,
    text: String(text).slice(0, 2000),
    aktionen,
  });
  speichereVorschlaege(liste);
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

// --- Aktionsplan: das LLM plant, das System führt geprüft aus -----------------

const GESCHUETZT = new Set(["_system", ".git", ".obsidian", "node_modules"]);

/** Pfad muss im Vault liegen, .md sein und keinen Systemordner berühren. */
function sichererPfad(rel) {
  if (typeof rel !== "string" || !rel.trim()) throw new Error("Leerer Pfad");
  const norm = path.posix.normalize(rel.replace(/\\/g, "/")).replace(/^\/+/, "");
  if (norm.startsWith("..")) throw new Error(`Pfad verlässt den Vault: ${rel}`);
  if (!norm.toLowerCase().endsWith(".md")) throw new Error(`Nur .md-Dateien erlaubt: ${rel}`);
  if (GESCHUETZT.has(norm.split("/")[0])) throw new Error(`Systemordner sind tabu: ${rel}`);
  return norm;
}

function freierZielpfad(norm) {
  let ziel = path.join(VAULT_ROOT, norm);
  let i = 2;
  while (fs.existsSync(ziel)) {
    ziel = path.join(VAULT_ROOT, norm.replace(/\.md$/i, ` (${i}).md`));
    i++;
  }
  return ziel;
}

/**
 * Führt einen geprüften Aktionsplan aus. Gibt Protokollzeilen zurück.
 * Jeder Lauf landet im Undo-Verlauf (.automat-undo.json) und ist über
 * macheRueckgaengig() umkehrbar.
 */
const UNDO_PATH = path.join(__dirname, ".automat-undo.json");
const PAPIERKORB = path.join(__dirname, ".papierkorb");

function ladeUndo() {
  return loadJson(UNDO_PATH, []);
}

function fuehreAktionenAus(aktionen, beschreibung = "Aktionsplan") {
  const protokoll = [];
  const undoSchritte = [];
  for (const a of aktionen || []) {
    try {
      if (a.tu === "verschieben") {
        const von = sichererPfad(a.von);
        const nach = sichererPfad(a.nach);
        const quelle = path.join(VAULT_ROOT, von);
        if (!fs.existsSync(quelle)) throw new Error(`Quelle fehlt: ${von}`);
        const ziel = freierZielpfad(nach);
        fs.mkdirSync(path.dirname(ziel), { recursive: true });
        fs.renameSync(quelle, ziel);
        const zielRel = path.relative(VAULT_ROOT, ziel).replace(/\\/g, "/");
        undoSchritte.push({ tu: "verschieben", von: zielRel, nach: von });
        protokoll.push(`✓ verschoben: ${von} → ${zielRel}`);
      } else if (a.tu === "tags") {
        const datei = sichererPfad(a.datei);
        const voll = path.join(VAULT_ROOT, datei);
        if (!fs.existsSync(voll)) throw new Error(`Datei fehlt: ${datei}`);
        undoSchritte.push({ tu: "wiederherstellen", datei, inhalt: fs.readFileSync(voll, "utf8") });
        mischeTags(voll, (a.tags || []).join(", "));
        protokoll.push(`✓ Tags ergänzt: ${datei} (${(a.tags || []).join(", ")})`);
      } else if (a.tu === "anhaengen") {
        const datei = sichererPfad(a.datei);
        const voll = path.join(VAULT_ROOT, datei);
        if (!fs.existsSync(voll)) throw new Error(`Datei fehlt: ${datei}`);
        undoSchritte.push({ tu: "wiederherstellen", datei, inhalt: fs.readFileSync(voll, "utf8") });
        fs.appendFileSync(voll, `\n\n${String(a.text || "").slice(0, 20000)}\n`);
        protokoll.push(`✓ angehängt an: ${datei}`);
      } else if (a.tu === "neue-notiz") {
        const datei = sichererPfad(a.datei);
        const ziel = freierZielpfad(datei);
        fs.mkdirSync(path.dirname(ziel), { recursive: true });
        fs.writeFileSync(ziel, String(a.text || "").slice(0, 40000));
        const zielRel = path.relative(VAULT_ROOT, ziel).replace(/\\/g, "/");
        undoSchritte.push({ tu: "entfernen", datei: zielRel });
        protokoll.push(`✓ Notiz angelegt: ${zielRel}`);
      } else {
        protokoll.push(`✗ unbekannte Aktion übersprungen: ${JSON.stringify(a).slice(0, 120)}`);
      }
    } catch (err) {
      protokoll.push(`✗ ${a.tu || "?"}: ${err.message}`);
    }
  }
  if (undoSchritte.length) {
    const verlauf = ladeUndo();
    verlauf.push({
      zeit: stamp(),
      beschreibung: String(beschreibung).slice(0, 120),
      schritte: undoSchritte.reverse(), // rückwärts abarbeiten
    });
    fs.writeFileSync(UNDO_PATH, JSON.stringify(verlauf.slice(-20), null, 2));
  }
  // Nach Änderungen den Katalog frisch halten
  if (protokoll.some((z) => z.startsWith("✓"))) {
    spawnSync(process.execPath, [path.join(__dirname, "indexer.js")]);
  }
  return protokoll;
}

/**
 * Macht einen Eintrag aus dem Undo-Verlauf rückgängig (Standard: den
 * neuesten). Angelegte Notizen werden nicht gelöscht, sondern in
 * _system/.papierkorb verschoben.
 */
function macheRueckgaengig(index = -1) {
  const verlauf = ladeUndo();
  if (!verlauf.length) return ["Nichts zum Rückgängigmachen."];
  const i = index < 0 ? verlauf.length - 1 : index;
  const eintrag = verlauf[i];
  if (!eintrag) return [`Eintrag ${index} nicht gefunden.`];
  const protokoll = [];
  for (const s of eintrag.schritte || []) {
    try {
      if (s.tu === "verschieben") {
        const von = sichererPfad(s.von);
        const quelle = path.join(VAULT_ROOT, von);
        if (!fs.existsSync(quelle)) throw new Error(`Datei fehlt inzwischen: ${von}`);
        const ziel = freierZielpfad(sichererPfad(s.nach));
        fs.mkdirSync(path.dirname(ziel), { recursive: true });
        fs.renameSync(quelle, ziel);
        protokoll.push(`✓ zurückverschoben: ${von} → ${path.relative(VAULT_ROOT, ziel)}`);
      } else if (s.tu === "wiederherstellen") {
        const datei = sichererPfad(s.datei);
        fs.writeFileSync(path.join(VAULT_ROOT, datei), s.inhalt);
        protokoll.push(`✓ wiederhergestellt: ${datei}`);
      } else if (s.tu === "entfernen") {
        const datei = sichererPfad(s.datei);
        const voll = path.join(VAULT_ROOT, datei);
        if (fs.existsSync(voll)) {
          fs.mkdirSync(PAPIERKORB, { recursive: true });
          fs.renameSync(voll, path.join(PAPIERKORB, Date.now() + "-" + path.basename(datei)));
          protokoll.push(`✓ in den Papierkorb: ${datei} (_system/.papierkorb)`);
        } else {
          protokoll.push(`· schon weg: ${datei}`);
        }
      }
    } catch (err) {
      protokoll.push(`✗ ${s.tu}: ${err.message}`);
    }
  }
  verlauf.splice(i, 1);
  fs.writeFileSync(UNDO_PATH, JSON.stringify(verlauf, null, 2));
  spawnSync(process.execPath, [path.join(__dirname, "indexer.js")]);
  log(`Rückgängig: „${eintrag.beschreibung}" (${eintrag.zeit}) — ${protokoll.join(" · ")}`);
  return protokoll;
}

/** Kontext für freie Aufträge: Regeln + Ordnerliste + Inbox-Inhalt. */
function bauKontext() {
  const teile = [];
  const ordner = fs.readdirSync(VAULT_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !GESCHUETZT.has(e.name))
    .map((e) => e.name);
  teile.push("ORDNER DES VAULTS:\n" + ordner.join("\n"));
  for (const datei of ["INDEX.md", "CLAUDE.md"]) {
    const p = path.join(VAULT_ROOT, datei);
    if (fs.existsSync(p)) teile.push(`=== ${datei} ===\n` + fs.readFileSync(p, "utf8").slice(0, 4000));
  }
  const inboxDir = path.join(VAULT_ROOT, "00 Inbox");
  if (fs.existsSync(inboxDir)) {
    const dateien = fs.readdirSync(inboxDir)
      .filter((n) => n.toLowerCase().endsWith(".md") && !n.startsWith("_"))
      .slice(0, 12);
    for (const n of dateien) {
      teile.push(`=== 00 Inbox/${n} ===\n` +
        fs.readFileSync(path.join(inboxDir, n), "utf8").slice(0, 1500));
    }
    if (!dateien.length) teile.push("HINWEIS: Die Inbox ist leer.");
  }
  return teile.join("\n\n");
}

function parseAktionsplan(antwort) {
  let text = antwort.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  const ende = text.lastIndexOf("}");
  if (start === -1 || ende <= start) throw new Error("Antwort enthält kein JSON-Objekt.");
  const plan = JSON.parse(text.slice(start, ende + 1));
  if (!Array.isArray(plan.aktionen)) plan.aktionen = [];
  return plan;
}

/**
 * Freier Auftrag ("Leere die Inbox und sortiere nach den Regeln ein"):
 * LLM bekommt Regeln + Kontext, antwortet mit einem JSON-Aktionsplan.
 * ausfuehren=false → nur der Plan kommt zurück (der Mensch entscheidet).
 */
async function auftrag(llmCfg, text, { ausfuehren = false, modell = null } = {}) {
  const cfg = modell ? Object.assign({}, llmCfg, { modell }) : llmCfg;
  const prompt =
    "Du bist der Bibliothekar eines Obsidian-Vaults. Unten stehen die Regeln und der aktuelle Zustand.\n" +
    "Erfülle die AUFGABE, indem du ausschließlich mit einem JSON-Objekt antwortest — kein Text davor oder danach:\n" +
    '{"begruendung": "ein kurzer Satz", "aktionen": [\n' +
    '  {"tu": "verschieben", "von": "00 Inbox/X.md", "nach": "03 Wissen/X.md"},\n' +
    '  {"tu": "tags", "datei": "03 Wissen/X.md", "tags": ["tag1", "tag2"]},\n' +
    '  {"tu": "anhaengen", "datei": "…", "text": "…"},\n' +
    '  {"tu": "neue-notiz", "datei": "03 Wissen/Neu.md", "text": "…"}\n' +
    "]}\n" +
    "Nur diese vier Aktionsarten existieren. Verschiebe nur in vorhandene Ordner. " +
    "Wenn nichts zu tun ist, gib eine leere aktionen-Liste zurück.\n\n" +
    `AUFGABE: ${text}\n\n${bauKontext()}`;

  const antwort = await frageLLM(cfg, prompt);
  const plan = parseAktionsplan(antwort);
  let protokoll = null;
  if (ausfuehren) {
    protokoll = fuehreAktionenAus(plan.aktionen, `Auftrag: ${text.slice(0, 80)}`);
    log(`Auftrag „${text.slice(0, 60)}": ${protokoll.filter((z) => z.startsWith("✓")).length}/${plan.aktionen.length} Aktionen ausgeführt.`);
  } else {
    log(`Auftrag „${text.slice(0, 60)}": Plan mit ${plan.aktionen.length} Aktion(en) erstellt (nicht ausgeführt).`);
  }
  return { plan, protokoll };
}

// --- Update aus git ------------------------------------------------------------

function gitAusgabe(befehl, cwd = VAULT_ROOT) {
  return execSync(befehl, { cwd, encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Prüft, ob es auf dem git-Remote eine neuere Version gibt. */
function updateStatus(cwd = VAULT_ROOT) {
  try {
    const zweig = gitAusgabe("git rev-parse --abbrev-ref HEAD", cwd);
    gitAusgabe(`git fetch --quiet origin ${zweig}`, cwd);
    const hinter = Number(gitAusgabe(`git rev-list --count HEAD..origin/${zweig}`, cwd)) || 0;
    const meldungen = hinter
      ? gitAusgabe(`git log --oneline --no-decorate HEAD..origin/${zweig}`, cwd)
          .split("\n").slice(0, 10).map((z) => z.replace(/^\w+\s/, ""))
      : [];
    return { ok: true, zweig, hinter, meldungen };
  } catch (err) {
    return { ok: false, fehler: (err.stderr || err.message || "git nicht verfügbar").toString().trim().slice(0, 300) };
  }
}

/** Spielt Updates ein (nur Schnellvorlauf — lokale Änderungen bleiben sicher). */
function updateEinspielen(cwd = VAULT_ROOT) {
  try {
    const zweig = gitAusgabe("git rev-parse --abbrev-ref HEAD", cwd);
    const vorher = gitAusgabe("git rev-parse HEAD", cwd);
    const ausgabe = gitAusgabe(`git pull --ff-only origin ${zweig}`, cwd);
    const geaendert = gitAusgabe(`git diff --name-only ${vorher} HEAD`, cwd).split("\n").filter(Boolean);
    const neustart = geaendert.some((d) => d.startsWith("_system/"));
    log(`Update eingespielt (${geaendert.length} Datei(en))${neustart ? " — Neustart nötig" : ""}.`);
    return { ok: true, ausgabe: ausgabe.slice(0, 500), geaendert: geaendert.length, neustart };
  } catch (err) {
    const text = (err.stderr || err.message || "").toString().trim().slice(0, 300);
    return {
      ok: false,
      fehler: /divergent|ff-only|Not possible/i.test(text)
        ? "Lokale und entfernte Änderungen laufen auseinander — bitte einmal von Hand lösen (git pull im Vault-Ordner)."
        : text,
    };
  }
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
  // Regel an einen Rechner gebunden? (Vault auf mehreren PCs gesynct —
  // so läuft eine Crontab-Regel nur auf dem benannten Rechner.)
  if (regel.rechner && regel.rechner.trim() &&
      regel.rechner.trim().toLowerCase() !== os.hostname().toLowerCase()) {
    return;
  }
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
        else if (art === "aktionen") {
          const plan = parseAktionsplan(antwort);
          const protokoll = fuehreAktionenAus(plan.aktionen, `Regel: ${regel.name}`);
          log(`Regel „${regel.name}": Aktionsplan — ${protokoll.join(" · ") || "nichts zu tun"}`);
        }
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
  const cfg = ladeKonfig();
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
  console.log("Änderungen an _system/regeln.json (auch aus der GUI) gelten sofort.");
  let letzteMinute = -1;
  const tick = async () => {
    const jetzt = new Date();
    const minute = jetzt.getMinutes() + jetzt.getHours() * 60;
    if (minute === letzteMinute) return;
    letzteMinute = minute;
    // Konfiguration bei jedem Tick frisch lesen — die GUI speichert hierhin.
    const aktuelleCfg = ladeKonfig() || cfg;
    const aktuelleRegeln = (aktuelleCfg.regeln || []).filter((r) => r.aktiv !== false);
    for (const r of aktuelleRegeln) {
      try {
        if (r.zeitplan && cronMatches(r.zeitplan, jetzt)) await laufeRegel(r, aktuelleCfg.llm || {});
      } catch (err) {
        log(`Regel „${r.name}": FEHLER im Zeitplan — ${err.message}`);
      }
    }
  };
  await tick();
  setInterval(tick, 20000);
}

module.exports = {
  frageLLM, listeModelle, aufloeseModell, auftrag, laufeRegel,
  fuehreAktionenAus, macheRueckgaengig, ladeUndo,
  ladeVorschlaege, entferneVorschlag, schreibeVorschlag,
  updateStatus, updateEinspielen,
  cronMatches, ladeKonfig, CONFIG_LOKAL,
};

if (require.main === module) main();
