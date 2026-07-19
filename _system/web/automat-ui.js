/* Automat-Tab: LLM-Status + -Einstellungen, Regel-Editor (unbegrenzt, Crontab),
   freie Aufträge mit Aktionsplan, Protokoll. Alles wird in der GUI bearbeitet
   und über /api/config gespeichert — der Automat übernimmt es sofort. */
"use strict";

(() => {
  const overlay = document.getElementById("automat");
  const modellWahl = document.getElementById("modell-wahl");

  const CRON_PRESETS = [
    ["*/5 * * * *", "alle 5 Minuten"],
    ["*/15 * * * *", "alle 15 Minuten"],
    ["*/30 * * * *", "alle 30 Minuten"],
    ["0 * * * *", "stündlich"],
    ["0 9 * * *", "täglich 9:00"],
    ["0 21 * * *", "täglich 21:00"],
    ["0 9 * * 1-5", "werktags 9:00"],
    ["0 3 * * 0", "sonntags 3:00"],
  ];

  let llmCfg = {};        // aktuelle LLM-Einstellungen
  let regeln = [];        // Regel-Entwurf (wird beim Speichern gepostet)
  let modelle = { heruntergeladen: [], geladen: [] };

  document.getElementById("automat-btn").onclick = () => { overlay.classList.remove("hidden"); lade(); };
  document.getElementById("automat-close").onclick = () => overlay.classList.add("hidden");
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) overlay.classList.add("hidden"); });

  async function lade() {
    try {
      const cfg = await (await fetch("/api/config")).json();
      llmCfg = cfg.llm || {};
      regeln = (cfg.regeln || []).map((r) => JSON.parse(JSON.stringify(r)));
    } catch {}
    fuelleLLMFormular();
    zeichneRegeln();
    ladeLLMStatus();
    ladeLog();
  }

  // --- LLM-Status + Einstellungen -------------------------------------------

  function fuelleLLMFormular() {
    document.getElementById("llm-anbieter").value = llmCfg.anbieter || "lmstudio";
    document.getElementById("llm-url").value = llmCfg.url || "";
    document.getElementById("llm-schluessel").value = llmCfg.schluessel || "";
    fuelleModellListen();
  }

  function fuelleModellListen() {
    const geladen = new Set(modelle.geladen);
    const optionen = (aktuell) => {
      let html = `<option value="auto">automatisch (im RAM geladenes Modell)</option>`;
      const alle = [...modelle.heruntergeladen];
      if (aktuell && aktuell !== "auto" && !alle.includes(aktuell)) alle.unshift(aktuell);
      for (const m of alle) html += `<option value="${m}">${m}${geladen.has(m) ? " ●" : ""}</option>`;
      return html;
    };
    const sel = document.getElementById("llm-modell");
    sel.innerHTML = optionen(llmCfg.modell);
    sel.value = llmCfg.modell || "auto";
    modellWahl.innerHTML =
      `<option value="">Modell wie eingestellt (${llmCfg.modell === "auto" || !llmCfg.modell ? (modelle.geladen[0] || "auto") : llmCfg.modell})</option>` +
      modelle.heruntergeladen.map((m) => `<option value="${m}">${m}${geladen.has(m) ? " ●" : ""}</option>`).join("");
  }

  async function ladeLLMStatus() {
    const el = document.getElementById("llm-status");
    el.textContent = "Prüfe …";
    try {
      const s = await (await fetch("/api/llm")).json();
      modelle = { heruntergeladen: s.heruntergeladen || [], geladen: s.geladen || [] };
      if (!s.erreichbar) {
        el.innerHTML = `<span class="schlecht">✗ ${s.anbieter} unter ${s.url} nicht erreichbar.</span><br>` +
          `<span class="dim">${s.fehler || ""}</span>`;
      } else {
        const geladen = new Set(s.geladen);
        el.innerHTML =
          `<span class="gut">✓ ${s.anbieter} verbunden</span> <span class="dim">${s.url}</span><br>` +
          (s.heruntergeladen.length
            ? s.heruntergeladen.map((m) =>
                `<span class="modell ${geladen.has(m) ? "ram" : ""}">${geladen.has(m) ? "● " : "○ "}${m}</span>`
              ).join("<br>") + `<br><span class="dim">● = im RAM geladen · ○ = nur heruntergeladen</span>`
            : `<span class="dim">Keine Modelle gefunden.</span>`);
      }
      fuelleModellListen();
    } catch (err) {
      el.innerHTML = `<span class="schlecht">✗ ${err.message}</span>`;
    }
  }

  document.getElementById("llm-anbieter").onchange = (ev) => {
    const standard = { lmstudio: "http://localhost:1234", ollama: "http://localhost:11434" };
    const urlFeld = document.getElementById("llm-url");
    if (!urlFeld.value || Object.values(standard).includes(urlFeld.value)) {
      urlFeld.value = standard[ev.target.value] || "";
    }
  };

  document.getElementById("llm-speichern").onclick = async () => {
    llmCfg = {
      anbieter: document.getElementById("llm-anbieter").value,
      url: document.getElementById("llm-url").value.trim(),
      modell: document.getElementById("llm-modell").value || "auto",
      schluessel: document.getElementById("llm-schluessel").value.trim(),
    };
    await speichereConfig("llm-meldung");
    ladeLLMStatus();
  };

  // --- Regel-Editor ----------------------------------------------------------

  function feld(label, element) {
    const l = document.createElement("label");
    l.append(label, element);
    return l;
  }

  function zeichneRegeln() {
    const wurzel = document.getElementById("regeln");
    wurzel.innerHTML = "";
    regeln.forEach((r, i) => wurzel.append(regelKarte(r, i)));
    if (!regeln.length) wurzel.innerHTML = `<p class="dim">Noch keine Regeln — „+ Neue Regel" drücken.</p>`;
  }

  function regelKarte(r, i) {
    const karte = document.createElement("div");
    karte.className = "regel-karte" + (r.aktiv === false ? " aus" : "");

    // Kopfzeile: aktiv, Name, Jetzt, Löschen
    const kopf = document.createElement("div");
    kopf.className = "regel-kopf";
    const aktiv = document.createElement("input");
    aktiv.type = "checkbox";
    aktiv.checked = r.aktiv !== false;
    aktiv.title = "Regel aktiv?";
    aktiv.onchange = () => { r.aktiv = aktiv.checked; karte.classList.toggle("aus", !aktiv.checked); };
    const name = document.createElement("input");
    name.type = "text";
    name.value = r.name || "";
    name.placeholder = "Name der Regel";
    name.className = "regel-name";
    name.oninput = () => { r.name = name.value; };
    const lauf = document.createElement("button");
    lauf.textContent = "▶ Jetzt";
    lauf.title = "Diese Regel sofort ausführen (gespeicherter Stand)";
    lauf.onclick = async () => {
      lauf.disabled = true; lauf.textContent = "läuft …";
      try {
        const res = await (await fetch("/api/regel-lauf", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: r.name }),
        })).json();
        document.getElementById("automat-log").textContent = res.log || res.fehler || "fertig";
      } finally { lauf.disabled = false; lauf.textContent = "▶ Jetzt"; }
    };
    const weg = document.createElement("button");
    weg.textContent = "🗑";
    weg.title = "Regel löschen";
    weg.onclick = () => { regeln.splice(i, 1); zeichneRegeln(); };
    kopf.append(aktiv, name, lauf, weg);
    karte.append(kopf);

    // Zeitplan: Vorlagen + freies Feld
    const zeit = document.createElement("input");
    zeit.type = "text";
    zeit.value = r.zeitplan || "";
    zeit.placeholder = "Minute Stunde Tag Monat Wochentag";
    zeit.oninput = () => { r.zeitplan = zeit.value; };
    const preset = document.createElement("select");
    preset.innerHTML = `<option value="">Vorlage wählen …</option>` +
      CRON_PRESETS.map(([c, t]) => `<option value="${c}">${t} (${c})</option>`).join("");
    preset.onchange = () => { if (preset.value) { zeit.value = preset.value; r.zeitplan = preset.value; preset.value = ""; } };
    const zeile1 = document.createElement("div");
    zeile1.className = "form-grid";
    zeile1.append(feld("Zeitplan (Crontab)", zeit), feld("Vorlage", preset));
    karte.append(zeile1);

    // Auslöser + Aktion
    const ausTyp = document.createElement("select");
    ausTyp.innerHTML = `<option value="">immer (nur Zeitplan)</option><option value="neue-datei">neue Datei in Ordner</option>`;
    ausTyp.value = r.ausloeser ? "neue-datei" : "";
    const ausOrdner = document.createElement("input");
    ausOrdner.type = "text";
    ausOrdner.value = (r.ausloeser && r.ausloeser.ordner) || "";
    ausOrdner.placeholder = "z. B. 00 Inbox";
    ausOrdner.disabled = !r.ausloeser;
    ausTyp.onchange = () => {
      if (ausTyp.value === "neue-datei") {
        r.ausloeser = { typ: "neue-datei", ordner: ausOrdner.value || "00 Inbox" };
        ausOrdner.disabled = false;
        if (!ausOrdner.value) ausOrdner.value = "00 Inbox";
      } else { delete r.ausloeser; ausOrdner.disabled = true; }
    };
    ausOrdner.oninput = () => { if (r.ausloeser) r.ausloeser.ordner = ausOrdner.value; };

    const aktion = document.createElement("select");
    aktion.innerHTML =
      `<option value="llm">LLM (Prompt ausführen)</option>` +
      `<option value="index">Neu indexieren</option>` +
      `<option value="befehl">Shell-Befehl</option>`;
    aktion.value = r.aktion || "llm";

    const ergebnis = document.createElement("select");
    ergebnis.innerHTML =
      `<option value="vorschlag">Vorschlag (nichts ändern)</option>` +
      `<option value="anhang">an Notiz anhängen</option>` +
      `<option value="tags">Tags ins Frontmatter</option>` +
      `<option value="aktionen">Aktionsplan direkt ausführen</option>`;
    ergebnis.value = r.ergebnis || "vorschlag";
    ergebnis.onchange = () => { r.ergebnis = ergebnis.value; };

    const zeile2 = document.createElement("div");
    zeile2.className = "form-grid";
    zeile2.append(feld("Auslöser", ausTyp), feld("Ordner", ausOrdner), feld("Aktion", aktion), feld("Ergebnis", ergebnis));
    karte.append(zeile2);

    // Prompt / Befehl
    const prompt = document.createElement("textarea");
    prompt.rows = 3;
    prompt.value = r.prompt || "";
    prompt.placeholder = "Prompt an das LLM — was soll mit der Notiz passieren?";
    prompt.oninput = () => { r.prompt = prompt.value; };
    const promptFeld = feld("Prompt", prompt);

    const befehl = document.createElement("input");
    befehl.type = "text";
    befehl.value = r.befehl || "";
    befehl.placeholder = "z. B. qmd embed";
    befehl.oninput = () => { r.befehl = befehl.value; };
    const befehlFeld = feld("Befehl", befehl);

    const zeigeAktion = () => {
      r.aktion = aktion.value;
      promptFeld.style.display = aktion.value === "llm" ? "" : "none";
      befehlFeld.style.display = aktion.value === "befehl" ? "" : "none";
      ergebnis.parentElement.style.display = aktion.value === "llm" ? "" : "none";
    };
    aktion.onchange = zeigeAktion;
    karte.append(promptFeld, befehlFeld);
    zeigeAktion();

    return karte;
  }

  document.getElementById("regel-neu").onclick = () => {
    regeln.push({
      name: `Neue Regel ${regeln.length + 1}`,
      aktiv: true,
      zeitplan: "0 * * * *",
      aktion: "llm",
      prompt: "",
      ergebnis: "vorschlag",
    });
    zeichneRegeln();
  };

  document.getElementById("regeln-speichern").onclick = () => speichereConfig("regeln-meldung");

  async function speichereConfig(meldungId) {
    const meldung = document.getElementById(meldungId);
    meldung.textContent = "speichere …";
    meldung.className = "dim";
    try {
      const res = await fetch("/api/config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ llm: llmCfg, regeln }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.fehler || "Speichern fehlgeschlagen");
      meldung.textContent = "✓ gespeichert — gilt sofort";
      meldung.className = "gut";
    } catch (err) {
      meldung.textContent = "✗ " + err.message;
      meldung.className = "schlecht";
    }
  }

  // --- Freier Auftrag --------------------------------------------------------

  function zeigePlan(ziel, ergebnis) {
    ziel.innerHTML = "";
    if (ergebnis.fehler) { ziel.innerHTML = `<span class="schlecht">✗ ${ergebnis.fehler}</span>`; return; }
    const { plan, protokoll } = ergebnis;
    const box = document.createElement("div");
    box.className = "plan";
    const b = document.createElement("p");
    b.innerHTML = `<b>Plan:</b> ${plan.begruendung || "—"}`;
    box.append(b);
    const ul = document.createElement("ul");
    for (const a of plan.aktionen) {
      const li = document.createElement("li");
      li.textContent =
        a.tu === "verschieben" ? `verschieben: ${a.von} → ${a.nach}` :
        a.tu === "tags" ? `Tags für ${a.datei}: ${(a.tags || []).join(", ")}` :
        a.tu === "anhaengen" ? `anhängen an ${a.datei}` :
        a.tu === "neue-notiz" ? `neue Notiz: ${a.datei}` :
        JSON.stringify(a);
      ul.append(li);
    }
    if (!plan.aktionen.length) ul.innerHTML = "<li>— nichts zu tun —</li>";
    box.append(ul);

    if (protokoll) {
      const pre = document.createElement("pre");
      pre.textContent = protokoll.join("\n") || "—";
      box.append(pre);
      ladeLog();
    } else if (plan.aktionen.length) {
      const los = document.createElement("button");
      los.className = "primaer";
      los.textContent = "✓ Diesen Plan jetzt ausführen";
      los.onclick = async () => {
        los.disabled = true; los.textContent = "führe aus …";
        const res = await (await fetch("/api/aktionen", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ aktionen: plan.aktionen }),
        })).json();
        zeigePlan(ziel, { plan, protokoll: res.protokoll || [res.fehler] });
      };
      box.append(los);
    }
    ziel.append(box);
  }

  async function sende(ausfuehren) {
    const text = document.getElementById("auftrag-text").value.trim();
    const ziel = document.getElementById("auftrag-ergebnis");
    if (!text) { ziel.innerHTML = `<span class="schlecht">Bitte zuerst einen Auftrag eintippen.</span>`; return; }
    ziel.innerHTML = `<span class="dim">Das LLM denkt nach … (je nach Modell bis zu einigen Minuten)</span>`;
    const k1 = document.getElementById("auftrag-plan");
    const k2 = document.getElementById("auftrag-los");
    k1.disabled = k2.disabled = true;
    try {
      const res = await (await fetch("/api/auftrag", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, ausfuehren, modell: modellWahl.value || null }),
      })).json();
      zeigePlan(ziel, res);
    } catch (err) {
      ziel.innerHTML = `<span class="schlecht">✗ ${err.message}</span>`;
    } finally {
      k1.disabled = k2.disabled = false;
    }
  }

  document.getElementById("auftrag-plan").onclick = () => sende(false);
  document.getElementById("auftrag-los").onclick = () => sende(true);

  // --- Protokoll -------------------------------------------------------------

  async function ladeLog() {
    try {
      const d = await (await fetch("/api/regeln")).json();
      document.getElementById("automat-log").textContent = d.log || "— noch keine Läufe —";
    } catch {}
  }
})();
