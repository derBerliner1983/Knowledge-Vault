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

## 📋 Backlog (besprochen, noch nicht beauftragt)

- **Vorschläge-Posteingang** — Automat-Vorschläge einzeln in der GUI mit
  „Übernehmen / Ablehnen"-Knöpfen statt nur als Markdown-Datei.
- **Handy-Zugriff im Heimnetz** — Schalter für `HOST=0.0.0.0`, Ansicht vom
  Handy/Tablet im WLAN erreichbar.
- **Auto-Backup-Regel** — täglich `git commit` (oder ZIP), bevor Regeln
  viel bewegen dürfen.

## 💡 Ideen (bewusst zurückgestellt)

- Obsidian-Plugin (der `obsidian://`-Knopf deckt das Öffnen bereits ab)
- Chat-Verlauf mit dem lokalen LLM (dafür ist Claude Code im Vault besser)
- Cloud-/Mehrbenutzer-Funktionen

---

*Diese Datei wird bei jedem größeren Schritt aktualisiert. Erledigtes
wandert in die Fertig-Tabelle, Neues in den Backlog.*
