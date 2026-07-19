/* Automat-Tab: LLM-Status (LM Studio/Ollama), freie Aufträge mit Aktionsplan,
   Regeln sofort ausführen, Protokoll. */
"use strict";

(() => {
  const overlay = document.getElementById("automat");
  const btn = document.getElementById("automat-btn");
  const modellWahl = document.getElementById("modell-wahl");

  btn.onclick = () => { overlay.classList.remove("hidden"); lade(); };
  document.getElementById("automat-close").onclick = () => overlay.classList.add("hidden");
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) overlay.classList.add("hidden"); });

  async function lade() {
    ladeLLM();
    ladeRegeln();
  }

  async function ladeLLM() {
    const el = document.getElementById("llm-status");
    el.textContent = "Prüfe …";
    try {
      const s = await (await fetch("/api/llm")).json();
      if (!s.erreichbar) {
        el.innerHTML = `<span class="schlecht">✗ ${s.anbieter} unter ${s.url} nicht erreichbar.</span><br>` +
          `<span class="dim">${s.fehler || ""}</span>`;
        modellWahl.innerHTML = `<option value="">— kein Modell —</option>`;
        return;
      }
      const geladen = new Set(s.geladen);
      el.innerHTML =
        `<span class="gut">✓ ${s.anbieter}</span> <span class="dim">${s.url}</span><br>` +
        (s.heruntergeladen.length
          ? s.heruntergeladen.map((m) =>
              `<span class="modell ${geladen.has(m) ? "ram" : ""}">${geladen.has(m) ? "● " : "○ "}${m}</span>`
            ).join("<br>")
          : `<span class="dim">Keine Modelle gefunden.</span>`) +
        `<br><span class="dim">● = im RAM geladen · ○ = nur heruntergeladen</span>`;
      modellWahl.innerHTML =
        `<option value="">Modell: automatisch (${s.geladen[0] || s.modell || "?"})</option>` +
        s.heruntergeladen.map((m) => `<option value="${m}">${m}${geladen.has(m) ? " ●" : ""}</option>`).join("");
    } catch (err) {
      el.innerHTML = `<span class="schlecht">✗ ${err.message}</span>`;
    }
  }

  async function ladeRegeln() {
    try {
      const d = await (await fetch("/api/regeln")).json();
      const el = document.getElementById("regeln");
      el.innerHTML = "";
      for (const r of d.regeln || []) {
        const zeile = document.createElement("div");
        zeile.className = "regel" + (r.aktiv === false ? " aus" : "");
        const info = document.createElement("div");
        info.innerHTML = `<b>${r.name}</b><br><span class="dim">` +
          `${r.zeitplan || "—"} · ${r.aktion}` +
          (r.ausloeser ? ` · ${r.ausloeser.typ}: ${r.ausloeser.ordner}` : "") +
          (r.aktiv === false ? " · inaktiv" : "") + `</span>`;
        const lauf = document.createElement("button");
        lauf.textContent = "▶ Jetzt";
        lauf.onclick = async () => {
          lauf.disabled = true; lauf.textContent = "läuft …";
          try {
            const res = await (await fetch("/api/regel-lauf", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: r.name }),
            })).json();
            document.getElementById("automat-log").textContent = res.log || res.fehler || "fertig";
          } finally { lauf.disabled = false; lauf.textContent = "▶ Jetzt"; ladeRegeln(); }
        };
        zeile.append(info, lauf);
        el.append(zeile);
      }
      document.getElementById("automat-log").textContent = d.log || "— noch keine Läufe —";
    } catch (err) {
      document.getElementById("regeln").textContent = err.message;
    }
  }

  function zeigePlan(ziel, ergebnis) {
    ziel.innerHTML = "";
    const { plan, protokoll } = ergebnis;
    if (ergebnis.fehler) { ziel.innerHTML = `<span class="schlecht">✗ ${ergebnis.fehler}</span>`; return; }
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
      ladeRegeln();
      if (typeof window.dispatchEvent === "function") fetch("/graph.json").then(() => {});
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
    const knopf1 = document.getElementById("auftrag-plan");
    const knopf2 = document.getElementById("auftrag-los");
    knopf1.disabled = knopf2.disabled = true;
    try {
      const res = await (await fetch("/api/auftrag", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, ausfuehren, modell: modellWahl.value || null }),
      })).json();
      zeigePlan(ziel, res);
    } catch (err) {
      ziel.innerHTML = `<span class="schlecht">✗ ${err.message}</span>`;
    } finally {
      knopf1.disabled = knopf2.disabled = false;
    }
  }

  document.getElementById("auftrag-plan").onclick = () => sende(false);
  document.getElementById("auftrag-los").onclick = () => sende(true);
})();
