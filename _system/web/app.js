/* Second Brain — Graph-Ansicht (d3-force auf Canvas).
   Visuelles Soll: _system/design-referenz.jpg (THE NODE AI, „Zweites Gehirn 2.0"):
   tiefschwarzer Grund, getrennte Neon-Cluster mit Glow und Partikelwolken,
   farbige Kanten je Cluster, oranger Zentral-Hub (Wurzel). */
"use strict";

// Neon-Palette aus der Design-Referenz; Orange ist für die Wurzel reserviert.
const HUB_COLOR = "#ff8c1a";
const PALETTE = [
  "#f02fe0", "#3f9dff", "#52e94a", "#ffd21f", "#a45bff",
  "#23e6ff", "#ff5ea8", "#8dff3f", "#ff6a3d", "#6f7bff",
];
const ROOT_CLUSTER = "Wurzel";

const canvas = document.getElementById("graph");
const ctx = canvas.getContext("2d");
const dpr = window.devicePixelRatio || 1;

let graph = null;
let nodes = [], edges = [], clusterColor = new Map(), clusterAnchor = new Map();
let particles = [];
let simulation = null;
let transform = d3.zoomIdentity;
let hovered = null, selected = null, searchTerm = "";
let mutedClusters = new Set();

function resize() {
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";
  draw();
}
addEventListener("resize", resize);

// Deterministischer Pseudozufall für die Partikelwolken
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function load() {
  const res = await fetch("/graph.json");
  graph = await res.json();
  document.getElementById("stats").textContent =
    `${graph.meta.notes} Notizen · ${graph.meta.edges} Verknüpfungen`;

  // Farben: Wurzel bekommt das Hub-Orange, alle anderen die Neon-Palette.
  clusterColor = new Map();
  let pi = 0;
  for (const c of graph.clusters) {
    clusterColor.set(c.id, c.id === ROOT_CLUSTER ? HUB_COLOR : PALETTE[pi++ % PALETTE.length]);
  }

  // Cluster-Anker: Wurzel in der Mitte (Zentral-Hub), der Rest auf einem Kreis.
  const R = Math.min(innerWidth, innerHeight) * 0.36;
  const ring = graph.clusters.filter((c) => c.id !== ROOT_CLUSTER);
  clusterAnchor = new Map();
  clusterAnchor.set(ROOT_CLUSTER, { x: 0, y: 0 });
  ring.forEach((c, i) => {
    const a = (i / ring.length) * 2 * Math.PI - Math.PI / 2;
    clusterAnchor.set(c.id, { x: Math.cos(a) * R, y: Math.sin(a) * R });
  });

  const old = new Map(nodes.map((n) => [n.id, n]));
  nodes = graph.nodes.map((n) => Object.assign({}, n, old.get(n.id) ? { x: old.get(n.id).x, y: old.get(n.id).y } : {}));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  edges = graph.edges
    .filter((e) => nodeById.has(e.source) && nodeById.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));

  // Partikelwolke je Cluster — die feinen Punkte aus der Referenz.
  particles = [];
  for (const c of graph.clusters) {
    const rand = mulberry32([...c.id].reduce((a, ch) => a + ch.charCodeAt(0), 7));
    const count = 24 + Math.min(60, c.count * 10);
    for (let i = 0; i < count; i++) {
      const a = rand() * 2 * Math.PI;
      const d = Math.pow(rand(), 0.55) * (55 + c.count * 8);
      particles.push({
        cluster: c.id,
        dx: Math.cos(a) * d,
        dy: Math.sin(a) * d * 0.85,
        r: 0.5 + rand() * 1.1,
        a: 0.12 + rand() * 0.3,
      });
    }
  }

  if (simulation) simulation.stop();
  simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(edges).id((d) => d.id).distance(55).strength(0.35))
    .force("charge", d3.forceManyBody().strength(-130))
    .force("collide", d3.forceCollide().radius((d) => radius(d) + 6))
    .force("x", d3.forceX((d) => clusterAnchor.get(d.cluster).x).strength(0.2))
    .force("y", d3.forceY((d) => clusterAnchor.get(d.cluster).y).strength(0.2))
    .on("tick", draw);

  buildLegend();
  draw();
}

function radius(n) {
  return 3.5 + Math.min(11, Math.sqrt(n.words || 1) / 4 + (n.links || 0) * 0.8);
}

function visible(n) {
  if (mutedClusters.has(n.cluster)) return false;
  if (!searchTerm) return true;
  const q = searchTerm.toLowerCase();
  return n.title.toLowerCase().includes(q) || n.id.toLowerCase().includes(q) ||
    (n.tags || []).some((t) => t.toLowerCase().includes(q));
}

function clusterCentroid(id) {
  let x = 0, y = 0, k = 0;
  for (const n of nodes) if (n.cluster === id && n.x != null) { x += n.x; y += n.y; k++; }
  return k ? { x: x / k, y: y / k } : clusterAnchor.get(id) || { x: 0, y: 0 };
}

function draw() {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!graph) { ctx.restore(); return; }
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(dpr, dpr);
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);

  const neighborIds = new Set();
  const focus = hovered || selected;
  if (focus) {
    neighborIds.add(focus.id);
    for (const e of edges) {
      if (e.source.id === focus.id) neighborIds.add(e.target.id);
      if (e.target.id === focus.id) neighborIds.add(e.source.id);
    }
  }

  // Partikelwolken (hinter allem)
  const centroids = new Map(graph.clusters.map((c) => [c.id, clusterCentroid(c.id)]));
  for (const p of particles) {
    if (mutedClusters.has(p.cluster)) continue;
    const c = centroids.get(p.cluster);
    ctx.globalAlpha = focus ? p.a * 0.4 : p.a;
    ctx.fillStyle = clusterColor.get(p.cluster);
    ctx.beginPath();
    ctx.arc(c.x + p.dx, c.y + p.dy, p.r, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Kanten — in der Farbe des Quell-Clusters, wie in der Referenz
  for (const e of edges) {
    if (!visible(e.source) || !visible(e.target)) continue;
    const active = focus && (e.source.id === focus.id || e.target.id === focus.id);
    const sameCluster = e.source.cluster === e.target.cluster;
    const color = clusterColor.get(e.source.cluster) || "#888";
    if (active) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.5 / transform.k;
    } else {
      ctx.strokeStyle = sameCluster ? color : "#ffffff";
      ctx.globalAlpha = focus ? 0.06 : (sameCluster ? 0.35 : 0.10);
      ctx.lineWidth = 0.8 / transform.k;
    }
    ctx.beginPath();
    ctx.moveTo(e.source.x, e.source.y);
    ctx.lineTo(e.target.x, e.target.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Knoten — doppelter Glow: farbiger Halo + heller Kern
  for (const n of nodes) {
    if (!visible(n)) continue;
    const color = clusterColor.get(n.cluster) || "#888";
    const r = radius(n);
    const dimmed = focus && !neighborIds.has(n.id);

    ctx.globalAlpha = dimmed ? 0.14 : 1;

    if (!dimmed) {
      const halo = ctx.createRadialGradient(n.x, n.y, r * 0.4, n.x, n.y, r * 3.2);
      halo.addColorStop(0, color + "55");
      halo.addColorStop(1, color + "00");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r * 3.2, 0, 2 * Math.PI);
      ctx.fill();
    }

    ctx.shadowColor = color;
    ctx.shadowBlur = dimmed ? 0 : 18;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.shadowBlur = 0;

    // heller Kern
    if (!dimmed) {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.arc(n.x, n.y, Math.max(1, r * 0.32), 0, 2 * Math.PI);
      ctx.fill();
    }

    if (n === selected) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.6 / transform.k;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 4 / transform.k, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Beschriftung: bei Zoom, Fokus oder Suche
    if (!dimmed && (transform.k > 1.4 || neighborIds.has(n.id) || (searchTerm && visible(n)))) {
      ctx.font = `${11 / transform.k}px "Avenir Next", "Segoe UI", sans-serif`;
      ctx.fillStyle = "rgba(233, 237, 245, 0.9)";
      ctx.textAlign = "center";
      ctx.fillText(n.title, n.x, n.y + r + 13 / transform.k);
    }
    ctx.globalAlpha = 1;
  }

  // Cluster-Namen an den Wolken (nur herausgezoomt)
  if (transform.k < 1.4 && !focus) {
    for (const c of graph.clusters) {
      if (mutedClusters.has(c.id) || c.id === ROOT_CLUSTER) continue;
      const p = centroids.get(c.id);
      ctx.font = `600 ${12 / transform.k}px "Avenir Next", "Segoe UI", sans-serif`;
      ctx.fillStyle = clusterColor.get(c.id) + "bb";
      ctx.textAlign = "center";
      ctx.fillText(c.id.toUpperCase(), p.x, p.y - (60 + c.count * 6) / transform.k);
    }
  }
  ctx.restore();
}

// --- Interaktion -------------------------------------------------------------

function screenToWorld(px, py) {
  return [
    (px - innerWidth / 2 - transform.x) / transform.k,
    (py - innerHeight / 2 - transform.y) / transform.k,
  ];
}

function nodeAt(px, py) {
  const [x, y] = screenToWorld(px, py);
  let best = null, bestD = Infinity;
  for (const n of nodes) {
    if (!visible(n)) continue;
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < radius(n) + 4 && d < bestD) { best = n; bestD = d; }
  }
  return best;
}

const zoom = d3.zoom()
  .scaleExtent([0.15, 8])
  .filter((ev) => !ev.button && !(ev.type === "mousedown" && nodeAt(ev.offsetX, ev.offsetY)))
  .on("zoom", (ev) => { transform = ev.transform; draw(); });

const drag = d3.drag()
  .container(canvas)
  .subject((ev) => nodeAt(ev.x, ev.y))
  .on("start", (ev) => {
    if (!ev.subject) return;
    simulation.alphaTarget(0.25).restart();
    const [x, y] = screenToWorld(ev.x, ev.y);
    ev.subject.fx = x; ev.subject.fy = y;
  })
  .on("drag", (ev) => {
    if (!ev.subject) return;
    const [x, y] = screenToWorld(ev.x, ev.y);
    ev.subject.fx = x; ev.subject.fy = y;
  })
  .on("end", (ev) => {
    if (!ev.subject) return;
    simulation.alphaTarget(0);
    ev.subject.fx = null; ev.subject.fy = null;
  });

d3.select(canvas).call(drag).call(zoom);

canvas.addEventListener("mousemove", (ev) => {
  const n = nodeAt(ev.offsetX, ev.offsetY);
  if (n !== hovered) { hovered = n; canvas.style.cursor = n ? "pointer" : "grab"; draw(); }
});

canvas.addEventListener("click", (ev) => {
  const n = nodeAt(ev.offsetX, ev.offsetY);
  selected = n || null;
  updatePanel();
  draw();
});

// --- Punktmatrix-Legende, Panel, Suche, Reindex --------------------------------

function buildLegend() {
  const el = document.getElementById("legend");
  el.innerHTML = "";
  for (const c of graph.clusters) {
    const color = clusterColor.get(c.id);
    const item = document.createElement("div");
    item.className = "item" + (mutedClusters.has(c.id) ? " muted" : "");
    item.style.color = color;

    const count = document.createElement("span");
    count.className = "count";
    count.textContent = c.count;

    const dots = document.createElement("div");
    dots.className = "dots";
    for (let i = 0; i < Math.min(10, c.count); i++) dots.append(document.createElement("i"));

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = c.id.replace(/^\d+\s*/, "") || c.id;

    item.append(count, dots, name);
    item.onclick = () => {
      mutedClusters.has(c.id) ? mutedClusters.delete(c.id) : mutedClusters.add(c.id);
      buildLegend(); draw();
    };
    el.append(item);
  }
}

function updatePanel() {
  const panel = document.getElementById("panel");
  if (!selected) { panel.classList.add("hidden"); return; }
  panel.classList.remove("hidden");
  document.getElementById("panel-title").textContent = selected.title;
  document.getElementById("panel-path").textContent = selected.id;

  const tags = document.getElementById("panel-tags");
  tags.innerHTML = "";
  for (const t of selected.tags || []) {
    const s = document.createElement("span");
    s.className = "tag"; s.textContent = "#" + t;
    tags.append(s);
  }

  const nb = document.getElementById("panel-neighbors");
  nb.innerHTML = "";
  const linked = [];
  for (const e of edges) {
    if (e.source.id === selected.id) linked.push(e.target);
    if (e.target.id === selected.id) linked.push(e.source);
  }
  if (linked.length) {
    const h = document.createElement("h3");
    h.textContent = "Verknüpft mit";
    nb.append(h);
    for (const n of linked) {
      const a = document.createElement("a");
      a.href = "#"; a.textContent = n.title;
      a.onclick = (ev) => { ev.preventDefault(); selected = n; updatePanel(); draw(); };
      nb.append(a);
    }
  }

  document.getElementById("panel-open").href =
    `obsidian://open?vault=${encodeURIComponent(graph.meta.vaultName)}&file=${encodeURIComponent(selected.id.replace(/\.md$/, ""))}`;
}

document.getElementById("panel-close").onclick = () => { selected = null; updatePanel(); draw(); };

document.getElementById("search").addEventListener("input", (ev) => {
  searchTerm = ev.target.value.trim();
  draw();
});

document.getElementById("reindex").onclick = async () => {
  const btn = document.getElementById("reindex");
  btn.disabled = true; btn.textContent = "⟳ läuft …";
  try {
    await fetch("/api/reindex");
    await load();
  } finally {
    btn.disabled = false; btn.textContent = "⟳ Neu indexieren";
  }
};

resize();
load();
