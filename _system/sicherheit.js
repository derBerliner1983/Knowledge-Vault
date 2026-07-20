/**
 * Anmeldung & MFA für den Second-Brain-Server — ohne Fremdpakete.
 *
 * - Passwort (scrypt-Hash) + TOTP-Einmalcode (RFC 6238, kompatibel mit
 *   Google Authenticator, Aegis, 2FAS, Microsoft Authenticator …)
 * - Geräte-Sessions: einmal angemeldet = Gerät gemerkt (Cookie, 180 Tage);
 *   ein neues Gerät muss wieder Passwort + Code eingeben.
 * - Ablage in _system/.sicherheit.json (lokal, wird nicht gesynct).
 *   Notfall-Zugang: diese Datei am Rechner löschen = Schutz zurückgesetzt.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATEI = path.join(__dirname, ".sicherheit.json");
const SESSION_TAGE = 180;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function lade() {
  try { return JSON.parse(fs.readFileSync(DATEI, "utf8")); } catch { return {}; }
}
function speichere(d) {
  fs.writeFileSync(DATEI, JSON.stringify(d, null, 2));
}

// --- TOTP ---------------------------------------------------------------------

function base32Encode(buf) {
  let bits = 0, wert = 0, aus = "";
  for (const b of buf) {
    wert = (wert << 8) | b; bits += 8;
    while (bits >= 5) { aus += B32[(wert >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) aus += B32[(wert << (5 - bits)) & 31];
  return aus;
}
function base32Decode(s) {
  let bits = 0, wert = 0;
  const aus = [];
  for (const z of s.replace(/=+$/, "").toUpperCase()) {
    const i = B32.indexOf(z);
    if (i < 0) continue;
    wert = (wert << 5) | i; bits += 5;
    if (bits >= 8) { aus.push((wert >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(aus);
}

function totp(secretB32, zeit = Date.now()) {
  const zaehler = Math.floor(zeit / 30000);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(zaehler));
  const h = crypto.createHmac("sha1", base32Decode(secretB32)).update(buf).digest();
  const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}

function codeGueltig(secretB32, code) {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  for (const versatz of [-1, 0, 1]) {
    const soll = totp(secretB32, Date.now() + versatz * 30000);
    if (crypto.timingSafeEqual(Buffer.from(soll), Buffer.from(c))) return true;
  }
  return false;
}

// --- Passwort -----------------------------------------------------------------

function hashPasswort(pw, salz = crypto.randomBytes(16).toString("hex")) {
  return salz + ":" + crypto.scryptSync(String(pw), salz, 32).toString("hex");
}
function passwortGueltig(pw, gespeichert) {
  const [salz, hash] = String(gespeichert || "").split(":");
  if (!salz || !hash) return false;
  const neu = crypto.scryptSync(String(pw), salz, 32).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(neu));
}

// --- Bremse gegen Durchprobieren ------------------------------------------------

let fehlversuche = 0, gesperrtBis = 0;
function bremse() {
  if (Date.now() < gesperrtBis) {
    return Math.ceil((gesperrtBis - Date.now()) / 1000);
  }
  return 0;
}
function fehlversuch() {
  fehlversuche++;
  if (fehlversuche >= 5) {
    gesperrtBis = Date.now() + Math.min(300, 2 ** (fehlversuche - 4)) * 1000;
  }
}
const erfolg = () => { fehlversuche = 0; gesperrtBis = 0; };

// --- Öffentliche API ------------------------------------------------------------

const aktiv = () => !!lade().aktiv;

/** Schritt 1: Passwort setzen, Geheimnis erzeugen (noch nicht aktiv). */
function einrichten(passwort) {
  if (aktiv()) throw new Error("Schutz ist bereits aktiv.");
  if (!passwort || String(passwort).length < 8) throw new Error("Passwort braucht mindestens 8 Zeichen.");
  const secret = base32Encode(crypto.randomBytes(20));
  const d = lade();
  d.passwort = hashPasswort(passwort);
  d.secret = secret;
  d.aktiv = false;
  d.sessions = {};
  speichere(d);
  const otpauth = `otpauth://totp/Zweites%20Gehirn?secret=${secret}&issuer=Zweites%20Gehirn`;
  return { secret, otpauth };
}

/** Schritt 2: ersten Code prüfen — erst dann wird der Schutz scharf. */
function bestaetigen(code) {
  const d = lade();
  if (!d.secret) throw new Error("Zuerst einrichten.");
  if (!codeGueltig(d.secret, code)) throw new Error("Code stimmt nicht — Uhrzeit am Handy prüfen und erneut versuchen.");
  d.aktiv = true;
  speichere(d);
  return true;
}

/** Anmeldung: Passwort + Code → Session-Token fürs Gerät. */
function anmelden(passwort, code, geraet) {
  const warte = bremse();
  if (warte) throw new Error(`Zu viele Fehlversuche — bitte ${warte} Sekunden warten.`);
  const d = lade();
  if (!d.aktiv) throw new Error("Schutz ist nicht aktiv.");
  if (!passwortGueltig(passwort, d.passwort) || !codeGueltig(d.secret, code)) {
    fehlversuch();
    throw new Error("Passwort oder Code falsch.");
  }
  erfolg();
  const token = crypto.randomBytes(32).toString("hex");
  d.sessions[token] = {
    geraet: String(geraet || "Unbekanntes Gerät").slice(0, 80),
    erstellt: new Date().toISOString().slice(0, 16).replace("T", " "),
    zuletzt: Date.now(),
  };
  // Alte Sessions aufräumen
  const limit = Date.now() - SESSION_TAGE * 86400000;
  for (const [t, s] of Object.entries(d.sessions)) {
    if (s.zuletzt < limit) delete d.sessions[t];
  }
  speichere(d);
  return token;
}

function sessionGueltig(token) {
  if (!token) return false;
  const d = lade();
  const s = d.sessions && d.sessions[token];
  if (!s) return false;
  if (s.zuletzt < Date.now() - SESSION_TAGE * 86400000) return false;
  // "zuletzt" höchstens einmal pro Stunde fortschreiben (spart Schreibzugriffe)
  if (Date.now() - s.zuletzt > 3600000) {
    s.zuletzt = Date.now();
    speichere(d);
  }
  return true;
}

function geraete() {
  const d = lade();
  return Object.entries(d.sessions || {}).map(([token, s]) => ({
    kennung: token.slice(0, 8),
    geraet: s.geraet,
    erstellt: s.erstellt,
  }));
}

function geraetAbmelden(kennung) {
  const d = lade();
  for (const t of Object.keys(d.sessions || {})) {
    if (t.startsWith(kennung)) delete d.sessions[t];
  }
  speichere(d);
}

function deaktivieren(passwort, code) {
  const d = lade();
  if (!d.aktiv) return;
  if (!passwortGueltig(passwort, d.passwort) || !codeGueltig(d.secret, code)) {
    fehlversuch();
    throw new Error("Passwort oder Code falsch.");
  }
  erfolg();
  fs.unlinkSync(DATEI);
}

module.exports = {
  aktiv, einrichten, bestaetigen, anmelden, sessionGueltig,
  geraete, geraetAbmelden, deaktivieren, totp, codeGueltig,
};
