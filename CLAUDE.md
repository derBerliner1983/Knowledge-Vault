# Knowledge-Vault — Regelwerk

Dieser Vault ist ein Second Brain nach der Bauanleitung (`Bauanleitung_Second-Brain.pdf`).
Markdown ist die einzige Wahrheit — alles andere (graph.json, Web-Ansicht) ist eine
abgeleitete Sicht und jederzeit ersetzbar.

## Brain-First-Protokoll (Suchleiter)

Bei jeder Wissensfrage gilt diese Reihenfolge:

1. Lies zuerst INDEX.md (den Katalog) — steht die Quelle dort,
   öffne genau diese.
2. Prüfe dann das Wiki (`09 Wiki/`, verdichtetes Wissen), falls vorhanden.
3. Erst danach die Suche (`qmd query`) — Kandidaten prüfen,
   ohne Dateien zu öffnen.
4. Öffne genau EINE Datei — die beste — und lies nur die
   relevante Sektion.
5. Dann erst antworten. Kein blindes Durchsuchen ganzer Ordner.

## Ordnungs-Regeln (Obsidian wird von diesem System verwaltet)

- Der Vault wird ausschließlich über dieses System sortiert: Neues landet in `00 Inbox`
  und wird von dort in die Cluster einsortiert — Claude schlägt vor, der Mensch gibt frei.
- Verschieben nur nach Freigabe, Schritt für Schritt, nie alles auf einmal.
- Jeder neue Bereich (Top-Level-Ordner) bekommt sofort eine Indexzeile in INDEX.md.
- Rohquellen sind unantastbar — das Wiki liest sie, ändert sie nie.
- `_system/` enthält Werkzeuge (Indexer, Graph-Ansicht) — keine Notizen dort ablegen.
- Nach größeren Umsortierungen: `npm run index` ausführen, damit graph.json
  und der Katalog-Teil der INDEX.md aktuell bleiben.

## Wiki-Regeln

Für alles unter `09 Wiki/` gilt `09 Wiki/_SCHEMA.md`. Kurzfassung:
nur die KI schreibt dort, Widersprüche werden markiert statt aufgelöst,
jede Änderung endet mit einem Eintrag in `09 Wiki/log.md`.

## Cluster-Struktur

| Ordner | Zweck |
|---|---|
| `00 Inbox` | Eingang — unsortiert, wird regelmäßig geleert |
| `01 Daily Notes` | Tagesnotizen (`JJJJ-MM-TT.md`) |
| `02 Projekte` | Aktive Vorhaben, ein Unterordner pro Projekt |
| `03 Wissen` | Themen-Notizen, dauerhaftes Wissen |
| `04 Personen` | Steckbriefe zu Personen und Organisationen |
| `05 Quellen` | Rohquellen für das Wiki — unantastbar, nur lesen |
| `08 Vorlagen` | Templates und Prompt-Vorlagen |
| `09 Wiki` | Verdichtetes Wissen — nur die KI schreibt hier |
| `99 Archiv` | Erledigtes und Veraltetes |
