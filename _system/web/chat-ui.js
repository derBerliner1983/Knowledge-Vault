/* Chat mit dem lokalen LLM — geerdet über die Suchleiter (Server /api/chat).
   Antworten nennen Quellen; Klick auf eine Quelle springt zur Notiz. */
"use strict";

(() => {
  const overlay = document.getElementById("chat");
  const verlaufEl = document.getElementById("chat-verlauf");
  const frageEl = document.getElementById("chat-frage");
  const sendenEl = document.getElementById("chat-senden");
  const verlauf = []; // {rolle: "nutzer"|"ki", text}

  document.getElementById("chat-btn").onclick = () => {
    overlay.classList.remove("hidden");
    frageEl.focus();
  };
  document.getElementById("chat-close").onclick = () => overlay.classList.add("hidden");
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) overlay.classList.add("hidden"); });

  function zeige(rolle, text, quellen) {
    const n = document.createElement("div");
    n.className = "chat-nachricht " + rolle;
    n.textContent = text;
    if (quellen && quellen.length) {
      const q = document.createElement("div");
      q.className = "quellen";
      q.append("Quellen: ");
      quellen.forEach((pfad, i) => {
        if (i) q.append(" · ");
        const a = document.createElement("a");
        a.textContent = pfad;
        a.onclick = () => {
          overlay.classList.add("hidden");
          if (typeof fokusAufNotiz === "function") fokusAufNotiz(pfad);
        };
        q.append(a);
      });
      n.append(q);
    }
    verlaufEl.append(n);
    verlaufEl.scrollTop = verlaufEl.scrollHeight;
    return n;
  }

  async function senden() {
    const frage = frageEl.value.trim();
    if (!frage) return;
    frageEl.value = "";
    zeige("nutzer", frage);
    verlauf.push({ rolle: "nutzer", text: frage });
    sendenEl.disabled = true;
    const warte = zeige("ki", "… denkt nach (lokales LLM) …");
    try {
      const res = await (await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frage, verlauf: verlauf.slice(0, -1) }),
      })).json();
      warte.remove();
      if (res.fehler) {
        zeige("ki", "✗ " + res.fehler);
      } else {
        zeige("ki", res.antwort || "(keine Antwort)", res.quellen);
        verlauf.push({ rolle: "ki", text: res.antwort || "" });
      }
    } catch (err) {
      warte.remove();
      zeige("ki", "✗ " + err.message);
    } finally {
      sendenEl.disabled = false;
      frageEl.focus();
    }
  }

  sendenEl.onclick = senden;
  frageEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); senden(); }
  });
})();
