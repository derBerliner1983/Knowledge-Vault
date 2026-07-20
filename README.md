# Knowledge-Vault — Second Brain mit Claude Code

Ein Obsidian-Vault, der von diesem System verwaltet und sortiert wird —
gebaut nach der `Bauanleitung_Second-Brain.pdf` (THE NODE AI).

**Grundsatz:** Markdown ist die einzige Wahrheit. Obsidian ist das Regal,
Claude ist der Bibliothekar, die Graph-Ansicht ist nur das Fenster.

## Installation (einmalig)

### Windows 11 — ein Doppelklick

1. Repo holen: auf GitHub **„Code → Download ZIP"**, entpacken (oder `git clone`).
2. Im Ordner **`Installieren-und-Starten.bat`** doppelklicken — das Skript
   installiert Node.js automatisch (über winget), falls es fehlt, indexiert den
   Vault, startet den Server und öffnet den Browser. Fenster offen lassen.
   **Ein Fenster = alles läuft:** Graph-Ansicht, Live-Überwachung und der
   Automat mit allen Crontab-Regeln.
3. Optional: **`Autostart-Einrichten.bat`** doppelklicken — dann startet der
   Server ab der nächsten Anmeldung automatisch und unsichtbar mit Windows;
   die Ansicht ist dann immer unter http://localhost:7777 da.
   Rückgängig: `Autostart-Entfernen.bat`.

### Mac / Linux / manuell

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

In jeder Ansicht: Suchen (oben rechts), Cluster per Leiste unten
ein-/ausblenden (im Nebel: Cluster wählen), Knoten anklicken für Details
und **„In Obsidian öffnen"**, Knopf **„Neu indexieren"** liest den Vault
frisch ein. Beenden mit `Strg+C`.

**Lesen ohne App-Wechsel:** Ein Klick auf einen Knoten zeigt die Notiz
**komplett gerendert** im Seitenpanel (Überschriften, Listen, Tabellen,
Code, Zitate). Wikilinks darin sind klickbar und springen zur nächsten
Notiz — zum Schreiben geht es per Knopf weiter nach Obsidian.

**Suche:** Das Suchfeld filtert live den Graph (Titel, Tags, Pfad) und
durchsucht gleichzeitig den **Inhalt aller Notizen** — Treffer erscheinen
als Liste mit Fundstellen-Ausschnitten, ein Klick springt zur Notiz im
Graph. Der Umschalter daneben wählt die Suchart: **exakt** (Volltext) oder
**Bedeutung** — letzteres nutzt [qmd](https://github.com/tobi/qmd), falls
installiert (findet auch Notizen, die das gesuchte Wort gar nicht
enthalten); ohne qmd erscheint ein Hinweis mit den Einrichtungsschritten.

**Live:** Der Server überwacht den Vault. Legst du in Obsidian eine Notiz an
(oder änderst eine), wird automatisch neu indexiert und die Graph-Ansicht
aktualisiert sich von selbst nach wenigen Sekunden — kein Knopfdruck nötig.

### Der ⚙-Automat-Tab (oben rechts)

- **Lokales LLM:** zeigt, ob LM Studio/Ollama erreichbar ist, welche Modelle
  heruntergeladen sind und welches gerade **im RAM geladen** ist (●).
- **Auftrag an das LLM:** Freitext wie *„Leere die Inbox und sortiere die
  Notizen nach den Regeln ein."* — das LLM bekommt die Vault-Regeln
  (INDEX.md, CLAUDE.md) mit und antwortet mit einem Aktionsplan
  (verschieben, taggen, Notiz anlegen, anhängen). **„Nur Plan zeigen"**
  lässt dich erst abnicken; **„Planen & ausführen"** macht es direkt.
  Ausgeführt wird immer geprüft: nur `.md`-Dateien, nur innerhalb des
  Vaults, Systemordner sind tabu, nichts wird überschrieben.
- **Regeln:** jede Crontab-Regel per **„▶ Jetzt"** sofort starten.
- **Alles direkt in der GUI konfigurierbar:** LLM-Einstellungen (Anbieter,
  URL, Modell, API-Key) und **unbegrenzt viele Regeln** — anlegen
  („+ Neue Regel"), bearbeiten, an-/abschalten, löschen. Zeitpläne per
  Crontab-Feld mit Vorlagen-Auswahl (alle 15 Min, täglich 21:00, werktags 9:00 …).
  „Speichern" schreibt geprüft nach `_system/regeln.json` (mit Backup
  `.bak`) — der laufende Automat übernimmt Änderungen **sofort**, ohne
  Neustart. Die Datei von Hand zu bearbeiten geht weiterhin, ist aber
  nicht mehr nötig.

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

Der Automat führt Regeln nach Zeitplan aus — Crontab-Syntax, definiert in
**`_system/regeln.json`** (am einfachsten über die GUI, ⚙-Tab). Damit geht
genau das Muster „wenn etwas in der Inbox landet, dann mache …".

**Er läuft automatisch im Server mit** — `npm start` (bzw. die .bat)
genügt, es ist kein zweites Programm nötig. Die Zeiten sind die lokale
Uhrzeit deines Rechners. Nur für Sonderfälle gibt es zusätzlich:

```bash
npm run automat           # Automat allein, ohne Graph-Server (headless)
npm run automat:einmal    # ein einzelner Durchlauf (für OS-Crontab/Taskplaner)
```

(Nicht beides gleichzeitig mit `npm start` laufen lassen, sonst laufen
Regeln doppelt.)

Eine Regel besteht aus:

| Feld | Bedeutung |
|---|---|
| `zeitplan` | Crontab, 5 Felder: `Minute Stunde Monatstag Monat Wochentag` — z. B. `*/15 * * * *` = alle 15 Minuten, `0 21 * * *` = täglich 21:00 |
| `ausloeser` | optional: `{ "typ": "neue-datei", "ordner": "00 Inbox" }` — nur neue/geänderte Notizen dort werden verarbeitet (Dateien mit `_` am Anfang nie) |
| `aktion` | `llm` (Notiz + Prompt ans Sprachmodell), `index` (Indexer laufen lassen), `befehl` (beliebiger Shell-Befehl, z. B. `qmd embed`) |
| `ergebnis` | für `llm`: `vorschlag` (Standard — Antwort landet in `00 Inbox/_Automat-Vorschläge.md`, keine Notiz wird geändert), `anhang` (Antwort unten an die Notiz), `tags` (Tags ins Frontmatter) |

**Lokales LLM statt Claude:** In `regeln.json` unter `llm` einstellbar:

- `"anbieter": "lmstudio"` (Standard) — [lmstudio.ai](https://lmstudio.ai)
  installieren, ein Modell laden, im Developer-Tab den Server starten.
  `"modell": "auto"` nimmt automatisch das Modell, das gerade im RAM
  geladen ist; der ⚙-Automat-Tab zeigt den Zustand an.
- `"anbieter": "ollama"` — [ollama.com](https://ollama.com), dann
  z. B. `ollama pull qwen2.5:7b` (`"url": "http://localhost:11434"`).
- `"anbieter": "openai"` — jeder andere OpenAI-kompatible Server.
- `"anbieter": "claude-cli"` — nutzt das installierte Claude Code (`claude -p`).

Neben dem Zeitplan geht alles auch **manuell**: im ⚙-Automat-Tab der
Web-Ansicht — Regel per Knopf starten oder freien Auftrag eintippen.

Grundsatz bleibt: **Die KI schlägt vor, du entscheidest.** Der Standard-Modus
`vorschlag` verschiebt und ändert nichts — Vorschläge liest du in Obsidian
unter `00 Inbox/_Automat-Vorschläge.md` und setzt sie selbst um (oder lässt
sie Claude Code umsetzen). Statt `npm run automat` kannst du auch den
OS-eigenen Scheduler nutzen — Eintrag z. B.:
`*/15 * * * * cd /Pfad/zu/Knowledge-Vault && node _system/automat.js --einmal`
(Windows: Aufgabenplanung mit demselben Befehl).

## Zwei PCs, ein Gehirn — Vault-Sync

Der Vault kann komplett gesynct werden (Syncthing, OneDrive, Obsidian Sync,
git …) — **die Konfiguration wandert automatisch mit**, denn Regeln und
Crontabs liegen im Vault (`_system/regeln.json`). Auf dem zweiten PC also
nur syncen lassen und `Installieren-und-Starten.bat` doppelklicken.

Zwei Dinge sind dafür vorbereitet:

- **LLM-Einstellungen pro Rechner:** Haben die PCs unterschiedliche Modelle
  oder Server (z. B. LM Studio nur auf einem), im ⚙-Tab den Haken
  **„Nur für diesen Rechner speichern"** setzen. Das landet in
  `_system/regeln.lokal.json`, die nicht gesynct werden sollte
  (steht in `.gitignore`; bei Syncthing/OneDrive die Datei vom Sync
  ausnehmen). Regeln und Crontabs bleiben immer geteilt.
- **Regeln an einen Rechner binden:** Damit eine Crontab-Regel nicht auf
  beiden PCs gleichzeitig läuft (doppelte Vorschläge!), im Regel-Editor das
  Feld **„Nur auf Rechner"** ausfüllen — der eigene Rechnername wird
  angezeigt. Leer = Regel läuft überall.

## Bedeutungssuche (optional, empfohlen)

[qmd](https://github.com/tobi/qmd) installieren, dann:

```bash
qmd collection add /Pfad/zu/Knowledge-Vault
qmd embed
qmd query "unscharf formulierte Frage" -n 5
claude plugin install qmd@qmd
```

Läuft komplett lokal — keine Cloud, keine Kosten.
