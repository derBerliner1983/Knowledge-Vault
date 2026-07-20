/* Zweites Gehirn — Obsidian-Plugin.
   Bettet die lokale Graph-Ansicht (npm start bzw. Installieren-und-Starten.bat,
   Standard: http://localhost:7777) als eigenen Tab in Obsidian ein.
   Kein Build nötig — reines JavaScript. */
"use strict";

const { Plugin, ItemView, PluginSettingTab, Setting } = require("obsidian");

const VIEW_TYPE = "zweites-gehirn-graph";
const STANDARD = { url: "http://localhost:7777" };

class GraphAnsicht extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Zweites Gehirn"; }
  getIcon() { return "brain"; }

  async onOpen() {
    const el = this.contentEl;
    el.empty();
    el.addClass("zg-rahmen");
    this.iframe = el.createEl("iframe", {
      cls: "zg-iframe",
      attr: { src: this.plugin.einstellungen.url, allow: "clipboard-write" },
    });
    // Freundlicher Hinweis, falls der Server nicht läuft
    this.hinweis = el.createDiv({ cls: "zg-hinweis" });
    this.hinweis.setText(
      "Keine Verbindung? Den Server starten: Installieren-und-Starten.bat " +
      "doppelklicken (oder npm start im Vault-Ordner) — dann hier neu laden."
    );
    const knopf = this.hinweis.createEl("button", { text: "↻ Neu laden" });
    knopf.onclick = () => { this.iframe.src = this.plugin.einstellungen.url; };
  }
}

class Einstellungen extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Server-Adresse")
      .setDesc("Adresse der Graph-Ansicht. Standard: http://localhost:7777 — anderer Port: an node _system/server.js --port anpassen.")
      .addText((t) => t
        .setPlaceholder(STANDARD.url)
        .setValue(this.plugin.einstellungen.url)
        .onChange(async (wert) => {
          this.plugin.einstellungen.url = wert.trim() || STANDARD.url;
          await this.plugin.speichere();
        }));
  }
}

module.exports = class ZweitesGehirn extends Plugin {
  async onload() {
    this.einstellungen = Object.assign({}, STANDARD, await this.loadData());
    this.registerView(VIEW_TYPE, (leaf) => new GraphAnsicht(leaf, this));
    this.addRibbonIcon("brain", "Zweites Gehirn öffnen", () => this.oeffne());
    this.addCommand({
      id: "graph-oeffnen",
      name: "Graph-Ansicht öffnen",
      callback: () => this.oeffne(),
    });
    this.addSettingTab(new Einstellungen(this.app, this));
  }

  async oeffne() {
    const vorhanden = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (vorhanden.length) {
      this.app.workspace.revealLeaf(vorhanden[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
  }

  async speichere() {
    await this.saveData(this.einstellungen);
  }

  onunload() {}
};
