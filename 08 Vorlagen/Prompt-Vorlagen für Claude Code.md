---
tags: [vorlage, claude-code]
---

# Prompt-Vorlagen für Claude Code

Die Vorlagen aus der [[Bauanleitung|Bauanleitung]] — zum Kopieren in eine Claude-Code-Session
im Vault-Ordner.

## Inbox sortieren (regelmäßig)

```
Durchsuche 00 Inbox und schlage mir vor, wohin jede Notiz gehört
(Cluster-Struktur siehe INDEX.md). Zeige den Vorschlag als Tabelle
(Notiz zu Ziel-Ordner) und verschiebe erst nach meiner Freigabe —
Schritt für Schritt, nicht alles auf einmal. Führe danach
`npm run index` aus.
```

## Bestand neu ordnen (einmalig / bei Bedarf)

```
Durchsuche meinen Notiz-Ordner und schlage mir eine Cluster-Struktur vor:
wenige Themen-Cluster plus Workflow-Ordner (Inbox, Daily Notes, Vorlagen,
Archiv). Zeige den Vorschlag als Tabelle (Notiz zu Ziel-Ordner) und
verschiebe erst nach meiner Freigabe — Schritt für Schritt, nicht alles
auf einmal.
```

## Quelle ins Wiki einarbeiten (Ingest)

```
Arbeite diese Quelle in mein Wiki ein: [Pfad oder Link].
Halte dich an die Regeln in 09 Wiki/_SCHEMA.md.
Gleiche mit dem bestehenden Wiki ab: Widersprüche markieren,
nie stillschweigend auflösen. Schreibe zum Schluss den Log-Eintrag.
```

## Widerspruch auflösen

```
Der Konflikt [Beschreibung] ist entschieden, es gilt X, die Quelle ist
angepasst — aktualisiere das Wiki und schreibe den Log-Eintrag.
```

## qmd einrichten (Bedeutungssuche, optional)

```bash
# Installation: siehe README auf github.com/tobi/qmd
qmd collection add ~/Pfad/zu/Knowledge-Vault
qmd embed
# Testen — absichtlich unscharf formulieren:
qmd query "Wie war unser Stil für die Untertitel?" -n 5
# An Claude Code anbinden:
claude plugin install qmd@qmd
```
