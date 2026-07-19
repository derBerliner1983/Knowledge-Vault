# Knowledge-Vault — Second Brain mit Claude Code

Ein Obsidian-Vault, der von diesem System verwaltet und sortiert wird —
gebaut nach der `Bauanleitung_Second-Brain.pdf` (THE NODE AI).

**Grundsatz:** Markdown ist die einzige Wahrheit. Obsidian ist das Regal,
Claude ist der Bibliothekar, die Graph-Ansicht ist nur das Fenster.

## Installation (einmalig)

Voraussetzung: [Node.js](https://nodejs.org) ab Version 18 (prüfen mit `node --version`).

```bash
git clone https://github.com/derBerliner1983/Knowledge-Vault.git
cd Knowledge-Vault
npm run index     # Vault einlesen → _system/graph.json + INDEX.md-Bestand
```

Keine weiteren Abhängigkeiten — die Graph-Bibliothek (d3) liegt lokal unter
`_system/web/vendor/`, es wird nichts aus dem Netz geladen.

## Starten (Graph-Ansicht auf einem Port)

```bash
npm start
```

Dann im Browser öffnen: **http://localhost:7777**

Anderer Port bei Bedarf:

```bash
node _system/server.js --port 8080
# oder: PORT=8080 npm start
```

In der Ansicht: Suchen (oben rechts), Cluster per Legende ein-/ausblenden,
Knoten anklicken für Details und **„In Obsidian öffnen"**, Knopf
**„Neu indexieren"** liest den Vault frisch ein. Beenden mit `Strg+C`.

## Obsidian anbinden

Diesen Ordner in Obsidian als Vault öffnen („Ordner als Vault öffnen").
Wichtig: **Sortiert wird nicht von Hand**, sondern über das System —
Neues in `00 Inbox` ablegen und regelmäßig den Sortier-Prompt aus
`08 Vorlagen/Prompt-Vorlagen für Claude Code.md` in Claude Code ausführen.

## Die Bausteine

| Baustein | Datei/Ordner | Zweck |
|---|---|---|
| Katalog | `INDEX.md` | Eine Zeile pro Bereich; Bestand wird von `npm run index` gepflegt |
| Regelwerk | `CLAUDE.md` | Brain-First-Suchleiter + Ordnungs-Regeln für Claude Code |
| Wiki | `09 Wiki/` | KI-gepflegtes, verdichtetes Wissen (`_SCHEMA.md`, `log.md`) |
| Indexer | `_system/indexer.js` | Deterministisch, ohne KI: Titel, Links, Tags → `graph.json` |
| Ansicht | `_system/server.js` + `_system/web/` | Lokaler Server, Port 7777 |

## Bedeutungssuche (optional, empfohlen)

[qmd](https://github.com/tobi/qmd) installieren, dann:

```bash
qmd collection add /Pfad/zu/Knowledge-Vault
qmd embed
qmd query "unscharf formulierte Frage" -n 5
claude plugin install qmd@qmd
```

Läuft komplett lokal — keine Cloud, keine Kosten.
