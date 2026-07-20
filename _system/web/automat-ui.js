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
  let rechner = "";       // Name dieses Rechners (für Sync auf mehreren PCs)

  document.getElementById("automat-btn").onclick = () => { overlay.classList.remove("hidden"); lade(); };
  document.getElementById("automat-close").onclick = () => overlay.classList.add("hidden");
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) overlay.classList.add("hidden"); });

  async function lade() {
    try {
      const cfg = await (await fetch("/api/config")).json();
      llmCfg = cfg.llm || {};
      regeln = (cfg.regeln || []).map((r) => JSON.parse(JSON.stringify(r)));
      rechner = cfg.rechner || "";
      document.getElementById("rechner-name").textContent = rechner || "?";
      document.getElementById("llm-lokal").checked = !!cfg.llmLokal;
      document.getElementById("server-heimnetz").checked = !!(cfg.server && cfg.server.heimnetz);
      document.getElementById("lan-adresse").textContent = cfg.lan || "keine Netzwerk-Adresse gefunden";
    } catch {}
    fuelleLLMFormular();
    zeichneRegeln();
    ladeLLMStatus();
    ladeVorschlaege();
    ladeUndoListe();
    ladeLog();
    pruefeUpdate();
    ladeMFA();
  }

  // --- Anmeldung & MFA ----------------------------------------------------------

  async function ladeMFA() {
    const el = document.getElementById("mfa-bereich");
    try {
      const s = await (await fetch("/api/sicherheit")).json();
      el.innerHTML = "";
      if (!s.aktiv) {
        const p = document.createElement("p");
        p.className = "dim";
        p.textContent = "Ohne Schutz kann jeder im Netz (bei aktivem Heimnetz/VPN) auf dein Gehirn zugreifen. " +
          "Einrichten: Passwort wählen, QR-Code mit einer Authenticator-App scannen (Google Authenticator, Aegis, 2FAS …), Code bestätigen.";
        const pw = document.createElement("input");
        pw.type = "password"; pw.placeholder = "Neues Passwort (mind. 8 Zeichen)";
        const knopf = document.createElement("button");
        knopf.className = "primaer";
        knopf.textContent = "🔒 Schutz einrichten";
        const ziel = document.createElement("div");
        knopf.onclick = async () => {
          knopf.disabled = true;
          try {
            const res = await (await fetch("/api/sicherheit/einrichten", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ passwort: pw.value }),
            })).json();
            if (res.fehler) { ziel.innerHTML = `<span class="schlecht">✗ ${res.fehler}</span>`; return; }
            ziel.innerHTML = "";
            const qrBox = document.createElement("div");
            qrBox.className = "qr-box";
            try {
              const qr = qrcode(0, "M");
              qr.addData(res.otpauth);
              qr.make();
              qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2 });
            } catch { qrBox.textContent = "QR nicht darstellbar — Schlüssel von Hand eintragen:"; }
            const schluessel = document.createElement("p");
            schluessel.className = "dim";
            schluessel.textContent = `Schlüssel (falls Scannen nicht geht): ${res.secret}`;
            const code = document.createElement("input");
            code.type = "text"; code.placeholder = "6-stelliger Code aus der App"; code.maxLength = 6;
            const ok = document.createElement("button");
            ok.className = "primaer";
            ok.textContent = "✓ Code bestätigen & aktivieren";
            const meldung = document.createElement("span");
            meldung.className = "dim";
            ok.onclick = async () => {
              ok.disabled = true;
              const r = await (await fetch("/api/sicherheit/bestaetigen", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: code.value }),
              })).json();
              if (r.fehler) { meldung.textContent = "✗ " + r.fehler; meldung.className = "schlecht"; ok.disabled = false; return; }
              ladeMFA();
            };
            const reihe = document.createElement("div");
            reihe.className = "reihe";
            reihe.append(code, ok, meldung);
            ziel.append(qrBox, schluessel, reihe);
          } finally { knopf.disabled = false; }
        };
        const reihe = document.createElement("div");
        reihe.className = "reihe";
        reihe.append(pw, knopf);
        el.append(p, reihe, ziel);
        return;
      }

      // Schutz aktiv: Geräte-Liste + Verwaltung
      const info = document.createElement("p");
      info.innerHTML = `<span class="gut">✓ Schutz aktiv</span> <span class="dim">— neue Geräte müssen Passwort + Einmalcode eingeben. ` +
        `Notfall: Datei _system/.sicherheit.json am Rechner löschen setzt den Schutz zurück.</span>`;
      el.append(info);
      for (const g of s.geraete || []) {
        const zeile = document.createElement("div");
        zeile.className = "regel";
        const t = document.createElement("div");
        t.innerHTML = `<b>${g.geraet.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</b><br><span class="dim">angemeldet seit ${g.erstellt}</span>`;
        const weg = document.createElement("button");
        weg.textContent = "Abmelden";
        weg.onclick = async () => {
          await fetch("/api/sicherheit/geraet-abmelden", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kennung: g.kennung }),
          });
          ladeMFA();
        };
        zeile.append(t, weg);
        el.append(zeile);
      }
      const aus = document.createElement("details");
      aus.innerHTML = `<summary class="dim">Schutz abschalten …</summary>`;
      const pw2 = document.createElement("input");
      pw2.type = "password"; pw2.placeholder = "Passwort";
      const code2 = document.createElement("input");
      code2.type = "text"; code2.placeholder = "Einmalcode"; code2.maxLength = 6;
      const weg2 = document.createElement("button");
      weg2.textContent = "Schutz deaktivieren";
      weg2.onclick = async () => {
        const r = await (await fetch("/api/sicherheit/deaktivieren", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passwort: pw2.value, code: code2.value }),
        })).json();
        if (r.fehler) alert("✗ " + r.fehler);
        ladeMFA();
      };
      const reihe2 = document.createElement("div");
      reihe2.className = "reihe";
      reihe2.append(pw2, code2, weg2);
      aus.append(reihe2);
      el.append(aus);
    } catch (err) { el.textContent = err.message; }
  }

  // --- Update aus git ----------------------------------------------------------

  const updateLos = document.getElementById("update-los");

  async function pruefeUpdate() {
    const el = document.getElementById("update-status");
    el.textContent = "prüfe …";
    updateLos.style.display = "none";
    try {
      const s = await (await fetch("/api/update")).json();
      if (!s.ok) { el.innerHTML = `<span class="dim">Update-Prüfung nicht möglich: ${s.fehler}</span>`; return; }
      if (!s.hinter) { el.innerHTML = `<span class="gut">✓ Auf dem neuesten Stand</span> <span class="dim">(${s.zweig})</span>`; return; }
      el.innerHTML = `<span class="schlecht">⬇ ${s.hinter} Update(s) verfügbar:</span><br>` +
        s.meldungen.map((m) => `<span class="dim">· ${m.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`).join("<br>");
      updateLos.style.display = "";
    } catch (err) { el.textContent = err.message; }
  }

  document.getElementById("update-pruefen").onclick = pruefeUpdate;

  updateLos.onclick = async () => {
    updateLos.disabled = true; updateLos.textContent = "installiere …";
    const el = document.getElementById("update-status");
    try {
      const r = await (await fetch("/api/update", { method: "POST" })).json();
      if (!r.ok) { el.innerHTML = `<span class="schlecht">✗ ${r.fehler}</span>`; return; }
      el.innerHTML = `<span class="gut">✓ Update eingespielt (${r.geaendert} Datei(en)).</span>` +
        (r.neustart
          ? ` <span class="schlecht">Bitte den Server neu starten</span> <span class="dim">(Fenster schließen und Installieren-und-Starten.bat erneut doppelklicken — bei Autostart: ab- und wieder anmelden).</span>`
          : ` <span class="dim">Kein Neustart nötig.</span>`);
      updateLos.style.display = "none";
    } finally {
      updateLos.disabled = false; updateLos.textContent = "Update jetzt installieren";
    }
  };

  // --- Vorschläge-Posteingang -------------------------------------------------

  function aktionText(a) {
    return a.tu === "verschieben" ? `verschieben: ${a.von} → ${a.nach}` :
      a.tu === "tags" ? `Tags für ${a.datei}: ${(a.tags || []).join(", ")}` :
      a.tu === "anhaengen" ? `anhängen an ${a.datei}` :
      a.tu === "neue-notiz" ? `neue Notiz: ${a.datei}` : JSON.stringify(a);
  }

  async function ladeVorschlaege() {
    const el = document.getElementById("vorschlaege");
    try {
      const d = await (await fetch("/api/vorschlaege")).json();
      const liste = (d.vorschlaege || []).slice().reverse();
      const btn = document.getElementById("automat-btn");
      btn.textContent = liste.length ? `⚙ Automat (${liste.length})` : "⚙ Automat";
      el.innerHTML = "";
      if (!liste.length) {
        el.textContent = "— keine offenen Vorschläge —";
        el.className = "dim";
        return;
      }
      el.className = "";
      for (const v of liste) {
        const karte = document.createElement("div");
        karte.className = "vorschlag";
        const kopf = document.createElement("div");
        kopf.innerHTML = `<b>${(v.datei || v.regel).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</b> ` +
          `<span class="dim">${v.zeit} · Regel „${v.regel}"</span>`;
        const text = document.createElement("div");
        text.className = "vorschlag-text";
        text.textContent = v.text || "";
        karte.append(kopf, text);
        if (v.aktionen && v.aktionen.length) {
          const ul = document.createElement("ul");
          for (const a of v.aktionen) {
            const li = document.createElement("li");
            li.textContent = aktionText(a);
            ul.append(li);
          }
          karte.append(ul);
        }
        const reihe = document.createElement("div");
        reihe.className = "reihe";
        const antwortAuf = async (tun, knopf) => {
          knopf.disabled = true; knopf.textContent = "…";
          try {
            const res = await (await fetch("/api/vorschlaege", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: v.id, tun }),
            })).json();
            if (res.protokoll) document.getElementById("automat-log").textContent = res.protokoll.join("\n");
            if (res.fehler) document.getElementById("automat-log").textContent = "✗ " + res.fehler;
          } finally { ladeVorschlaege(); ladeUndoListe(); ladeLog(); }
        };
        if (v.aktionen && v.aktionen.length) {
          const ok = document.createElement("button");
          ok.className = "primaer";
          ok.textContent = "✓ Übernehmen";
          ok.onclick = () => antwortAuf("uebernehmen", ok);
          reihe.append(ok);
        }
        const weg = document.createElement("button");
        weg.textContent = "✕ Ablehnen";
        weg.onclick = () => antwortAuf("ablehnen", weg);
        reihe.append(weg);
        karte.append(reihe);
        el.append(karte);
      }
    } catch (err) { el.textContent = err.message; }
  }

  // Zähler am ⚙-Knopf auch ohne geöffneten Tab aktuell halten
  ladeVorschlaege();
  setInterval(() => { if (overlay.classList.contains("hidden")) ladeVorschlaege(); }, 30000);

  // --- Aufräum-Bericht --------------------------------------------------------

  document.getElementById("bericht-knopf").onclick = async () => {
    const knopf = document.getElementById("bericht-knopf");
    const ziel = document.getElementById("bericht");
    knopf.disabled = true; knopf.textContent = "🧹 läuft …";
    try {
      const b = await (await fetch("/api/bericht")).json();
      if (b.fehler) { ziel.innerHTML = `<span class="schlecht">✗ ${b.fehler}</span>`; return; }
      ziel.innerHTML = "";
      const notiz = (id, extra) => {
        const a = document.createElement("a");
        a.href = "#"; a.className = "bericht-notiz";
        a.textContent = id + (extra || "");
        a.onclick = (ev) => {
          ev.preventDefault();
          overlay.classList.add("hidden");
          if (typeof fokusAufNotiz === "function") fokusAufNotiz(id);
        };
        return a;
      };
      const gruppe = (titel, eintraege, bauer) => {
        const h = document.createElement("h4");
        h.textContent = `${titel} (${eintraege.length})`;
        h.className = eintraege.length ? "" : "gut";
        ziel.append(h);
        if (!eintraege.length) return;
        const div = document.createElement("div");
        div.className = "bericht-gruppe";
        for (const e of eintraege.slice(0, 30)) div.append(bauer(e));
        if (eintraege.length > 30) div.append(Object.assign(document.createElement("span"), { className: "dim", textContent: `… und ${eintraege.length - 30} weitere` }));
        ziel.append(div);
      };
      gruppe("Kaputte Wikilinks", b.kaputteLinks, (k) => {
        const zeile = document.createElement("div");
        zeile.append(notiz(k.von), ` → [[${k.ziel}]] fehlt`);
        return zeile;
      });
      gruppe("Verwaiste Notizen (keine Verknüpfungen)", b.waisen, (w) => {
        const zeile = document.createElement("div"); zeile.append(notiz(w)); return zeile;
      });
      gruppe("Ohne Tags", b.ohneTags, (o) => {
        const zeile = document.createElement("div"); zeile.append(notiz(o)); return zeile;
      });
      gruppe("Duplikat-Verdacht (gleicher Name)", b.duplikate, (d) => {
        const zeile = document.createElement("div");
        d.forEach((id, i) => { if (i) zeile.append(" ↔ "); zeile.append(notiz(id)); });
        return zeile;
      });
      gruppe("Inbox älter als 14 Tage", b.inboxAlt, (a) => {
        const zeile = document.createElement("div");
        zeile.append(notiz(a.datei, ` — ${a.tage} Tage`));
        return zeile;
      });
    } catch (err) {
      ziel.innerHTML = `<span class="schlecht">✗ ${err.message}</span>`;
    } finally {
      knopf.disabled = false; knopf.textContent = "🧹 Bericht erstellen";
    }
  };

  // --- Undo-Verlauf ----------------------------------------------------------

  async function ladeUndoListe() {
    const el = document.getElementById("undo-liste");
    try {
      const d = await (await fetch("/api/undo")).json();
      el.innerHTML = "";
      el.className = "";
      const verlauf = (d.verlauf || []).slice().reverse();
      if (!verlauf.length) { el.textContent = "— noch keine ausgeführten Pläne —"; el.className = "dim"; return; }
      for (const e of verlauf) {
        const zeile = document.createElement("div");
        zeile.className = "regel";
        const info = document.createElement("div");
        info.innerHTML = `<b>${e.beschreibung.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</b><br>` +
          `<span class="dim">${e.zeit} · ${e.schritte} Schritt(e)</span>`;
        const knopf = document.createElement("button");
        knopf.textContent = "↩ Rückgängig";
        knopf.onclick = async () => {
          knopf.disabled = true; knopf.textContent = "läuft …";
          try {
            const res = await (await fetch("/api/undo", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ index: e.index }),
            })).json();
            document.getElementById("automat-log").textContent =
              (res.protokoll || [res.fehler]).join("\n");
          } finally { ladeUndoListe(); ladeLog(); }
        };
        zeile.append(info, knopf);
        el.append(zeile);
      }
    } catch (err) { el.textContent = err.message; }
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

  document.getElementById("server-speichern").onclick = async () => {
    await speichereConfig("server-meldung");
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

    const nurRechner = document.createElement("input");
    nurRechner.type = "text";
    nurRechner.value = r.rechner || "";
    nurRechner.placeholder = `leer = alle (dieser: ${rechner || "?"})`;
    nurRechner.oninput = () => {
      if (nurRechner.value.trim()) r.rechner = nurRechner.value.trim();
      else delete r.rechner;
    };

    const zeile2 = document.createElement("div");
    zeile2.className = "form-grid";
    zeile2.append(feld("Auslöser", ausTyp), feld("Ordner", ausOrdner), feld("Aktion", aktion), feld("Ergebnis", ergebnis));
    karte.append(zeile2);

    const zeile3 = document.createElement("div");
    zeile3.className = "form-grid";
    zeile3.append(feld("Nur auf Rechner (für gesyncte Vaults)", nurRechner));
    karte.append(zeile3);

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
        body: JSON.stringify({
          llm: llmCfg,
          regeln,
          llmLokal: document.getElementById("llm-lokal").checked,
          server: { heimnetz: document.getElementById("server-heimnetz").checked },
        }),
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
      ladeUndoListe();
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
