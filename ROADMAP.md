# Roadmap — Knowledge-Vault / Zweites Gehirn

Stand: 2026-07-20 · Grundsatz aus der Bauanleitung: Markdown ist die einzige
Wahrheit, die KI schlägt vor, der Mensch entscheidet.

## ✅ Fertig

| Baustein | Was es kann |
|---|---|
| Vault-Struktur (Stufe 1) | Cluster + Workflow-Ordner, `INDEX.md`-Katalog, `CLAUDE.md` mit Brain-First-Suchleiter, Vorlagen |
| Wiki-Schicht (Stufe 2) | `09 Wiki/` mit `_SCHEMA.md` (Widersprüche markieren, nie auflösen) und `log.md` |
| Indexer (Stufe 3) | Deterministisch, ohne KI: Titel, Links, Tags → `graph.json` + Bestand in `INDEX.md` |
| Graph-Ansicht | Lokaler Server (Port 7777), fünf Ansichten nach Video-Referenz: Wolken, Sphäre, Säulen, Radial, Nebel |
| Live-Überwachung | Neue/geänderte Notiz in Obsidian → automatisch neu indexiert, Ansicht lädt selbst nach |
| Windows-Komfort | `Installieren-und-Starten.bat` (installiert Node bei Bedarf), `Autostart-Einrichten.bat` / `-Entfernen.bat` |
| Automat | Crontab-Regeln (unbegrenzt), Auslöser „neue Datei in Ordner", Aktionen: LLM / Indexer / Shell-Befehl |
| Lokales LLM | LM Studio (Standard, erkennt geladene + heruntergeladene Modelle), Ollama, OpenAI-kompatibel, Claude CLI |
| Freie Aufträge | „Leere die Inbox …" → LLM-Aktionsplan (verschieben, taggen, anlegen, anhängen), geprüft ausgeführt — erst Plan, dann Klick |
| GUI-Konfiguration | Alles im ⚙-Tab: LLM-Einstellungen, Regeln anlegen/ändern/löschen, Cron-Vorlagen, Validierung, Backup |
| Multi-PC-Sync | Konfiguration synct mit dem Vault; `regeln.lokal.json` pro Rechner; Regeln per „Nur auf Rechner" bindbar |
| Inhalts-Suche | Volltext mit Fundstellen-Ausschnitten + qmd-Bedeutungssuche (falls installiert), Klick springt zum Knoten |
| Notiz-Vorschau | Notiz gerendert im Panel (Tabellen, Code, Listen), klickbare Wikilinks — Lesen ohne App-Wechsel |
| Undo | Jeder ausgeführte Aktionsplan im Verlauf, per „↩ Rückgängig" umkehrbar; entfernte Notizen landen im Papierkorb statt gelöscht zu werden |
| Aufräum-Bericht | Ohne LLM, per Knopf: kaputte Wikilinks, verwaiste Notizen, Duplikat-Verdacht, Notizen ohne Tags, Inbox-Altbestand — Klick springt zur Notiz |
| Wiki-Ingest | `05 Quellen` + Regelvorlage: neue Quelle → Wiki-Seiten-Entwurf nach `_SCHEMA.md` samt Log-Eintrag (Regel standardmäßig aus, im ⚙-Tab aktivierbar) |
| Heimnetz-Zugriff | GUI-Schalter „Im Heimnetz erreichbar" — gilt sofort ohne Neustart, LAN-Adresse fürs Handy wird angezeigt |
| Auto-Backup | Regelvorlage „Tägliche Sicherung (git)": abends git-Commit, nur bei Änderungen (standardmäßig aus) |
| Vorschläge-Posteingang | Automat-Vorschläge einzeln im ⚙-Tab mit geplanten Schritten, „✓ Übernehmen" (rückgängig machbar) / „✕ Ablehnen", Zähler am Knopf |
| Update-Funktion | ⚙-Tab prüft gegen git/GitHub, zeigt Neuerungen, installiert per Klick (ff-only, mit Neustart-Hinweis); täglicher Check → Posteingang |
| Obsidian-Plugin | Liegt im Vault (`.obsidian/plugins/zweites-gehirn/`): Graph-Ansicht als Tab in Obsidian, Ribbon-Icon 🧠, Befehl, einstellbare Server-Adresse |
| 💬 Chat | Gespräch mit dem Vault übers lokale LLM — Suchleiter-Kontext (INDEX + Top-3-Notizen), antwortet nur daraus, klickbare Quellenangaben |
| Von unterwegs | VPN-Anleitung im README (Tailscale / Fritz!Box-WireGuard) — sicher, ohne Portfreigabe und ohne eigenes Login-System |
| Anmeldung & MFA | Passwort + TOTP-Authenticator, Geräte-Sessions (180 Tage), neues Gerät = neue MFA, Geräte-Verwaltung im ⚙-Tab, Anmelde-Bremse |

| Konnektoren | GUI-definierte Dienste (Name, Domain-Muster, Farbe, Bild), automatische Link-Erkennung, Punkte im Graph, Verweise im Panel, Übersichts-MD je Dienst unter `07 Konnektoren/`, Suche „claude" findet alle Verweise |

## 🔨 In Arbeit (beauftragt)

1. Geteilte Claude-Chats importieren (nur von dir geteilte Links → Ablage in `05 Quellen`)
2. Konnektoren Stufe B: GitHub-Anreicherung (Titel/Status), Auto-Titel/Favicon für neue Links

## 📋 Backlog

*(leer — alles Besprochene ist gebaut)*

## 💡 Ideen (bewusst zurückgestellt)

- Cloud-/Mehrbenutzer-Funktionen mit eigenem Login (VPN-Weg ist sicherer)

---

*Diese Datei wird bei jedem größeren Schritt aktualisiert. Erledigtes
wandert in die Fertig-Tabelle, Neues in den Backlog.*
