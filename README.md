# Knowledge-Vault — Second Brain mit Claude Code

Ein Obsidian-Vault, der von diesem System verwaltet und sortiert wird —
gebaut nach der `Bauanleitung_Second-Brain.pdf` (THE NODE AI).

**Grundsatz:** Markdown ist die einzige Wahrheit. Obsidian ist das Regal,
Claude ist der Bibliothekar, die Graph-Ansicht ist nur das Fenster.

## Installation (einmalig)

1. **Node.js installieren** (ab Version 18): [nodejs.org](https://nodejs.org) —
   LTS-Version herunterladen und installieren. Prüfen: `node --version`
2. **Repo holen** (Terminal bzw. PowerShell):

```bash
git clone https://github.com/derBerliner1983/Knowledge-Vault.git
cd Knowledge-Vault
npm run index     # Vault einlesen → _system/graph.json + INDEX.md-Bestand
```

Ohne git geht auch: auf GitHub „Code → Download ZIP", entpacken, im
entpackten Ordner ein Terminal öffnen.

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

### Die fünf Ansichten (Umschalter rechts, wie im Video)

| Ansicht | Zeigt |
|---|---|
| ☁ Wolken | Alle Cluster als getrennte Farbwolken (Force-Layout) |
| ◍ Sphäre | Der ganze Bestand als rotierender Globus aus Punkten |
| ▥ Säulen | Punktmatrix-Säulen pro Cluster, oranger Fundament-Hub |
| ✳ Radial | Eine Notiz im Zentrum, Verknüpfungen als Speichen |
| ✦ Nebel | Tiefer Zoom in ein Cluster als Partikelnebel |

Die Referenz-Frames aus dem Video liegen in `_system/design-referenz/`.

In jeder Ansicht: Suchen (oben rechts — Titel, Tags, Pfad), Cluster per
Leiste unten ein-/ausblenden (im Nebel: Cluster wählen), Knoten anklicken
für Details und **„In Obsidian öffnen"**, Knopf **„Neu indexieren"** liest
den Vault frisch ein. Beenden mit `Strg+C`.

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

## Der Automat — Crontabs, Regeln und lokales LLM (optional)

Der Automat (`_system/automat.js`) führt Regeln nach Zeitplan aus —
Crontab-Syntax, definiert in **`_system/regeln.json`**. Damit geht genau das
Muster „wenn etwas in der Inbox landet, dann mache …":

```bash
npm run automat           # läuft dauerhaft, prüft jede Minute
npm run automat:einmal    # ein einzelner Durchlauf (für OS-Crontab/Taskplaner)
```

Eine Regel besteht aus:

| Feld | Bedeutung |
|---|---|
| `zeitplan` | Crontab, 5 Felder: `Minute Stunde Monatstag Monat Wochentag` — z. B. `*/15 * * * *` = alle 15 Minuten, `0 21 * * *` = täglich 21:00 |
| `ausloeser` | optional: `{ "typ": "neue-datei", "ordner": "00 Inbox" }` — nur neue/geänderte Notizen dort werden verarbeitet (Dateien mit `_` am Anfang nie) |
| `aktion` | `llm` (Notiz + Prompt ans Sprachmodell), `index` (Indexer laufen lassen), `befehl` (beliebiger Shell-Befehl, z. B. `qmd embed`) |
| `ergebnis` | für `llm`: `vorschlag` (Standard — Antwort landet in `00 Inbox/_Automat-Vorschläge.md`, keine Notiz wird geändert), `anhang` (Antwort unten an die Notiz), `tags` (Tags ins Frontmatter) |

**Lokales LLM statt Claude:** In `regeln.json` unter `llm` einstellbar:

- `"anbieter": "ollama"` — [ollama.com](https://ollama.com) installieren, dann
  z. B. `ollama pull qwen2.5:7b`. Läuft komplett lokal auf deinem Rechner.
- `"anbieter": "openai"` — jeder OpenAI-kompatible lokale Server
  (LM Studio, llama.cpp: `"url": "http://localhost:1234/v1"`).
- `"anbieter": "claude-cli"` — nutzt das installierte Claude Code (`claude -p`).

Grundsatz bleibt: **Die KI schlägt vor, du entscheidest.** Der Standard-Modus
`vorschlag` verschiebt und ändert nichts — Vorschläge liest du in Obsidian
unter `00 Inbox/_Automat-Vorschläge.md` und setzt sie selbst um (oder lässt
sie Claude Code umsetzen). Statt `npm run automat` kannst du auch den
OS-eigenen Scheduler nutzen — Eintrag z. B.:
`*/15 * * * * cd /Pfad/zu/Knowledge-Vault && node _system/automat.js --einmal`
(Windows: Aufgabenplanung mit demselben Befehl).

## Bedeutungssuche (optional, empfohlen)

[qmd](https://github.com/tobi/qmd) installieren, dann:

```bash
qmd collection add /Pfad/zu/Knowledge-Vault
qmd embed
qmd query "unscharf formulierte Frage" -n 5
claude plugin install qmd@qmd
```

Läuft komplett lokal — keine Cloud, keine Kosten.
