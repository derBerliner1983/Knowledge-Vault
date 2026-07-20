/* Zweites Gehirn — Graph-Ansicht (d3 + Canvas).
   Visuelles Soll: die fünf Ansichten aus dem Video (Referenz-Frames in
   _system/design-referenz/): Wolken, Sphäre, Säulen, Radial, Nebel.
   Umschalter in der Seitenleiste rechts, Suche wirkt in jeder Ansicht. */
"use strict";

// Neon-Palette aus der Design-Referenz; Orange ist für die Wurzel reserviert.
const HUB_COLOR = "#ff8c1a";
const PALETTE = [
  "#f02fe0", "#3f9dff", "#52e94a", "#ffd21f", "#a45bff",
  "#23e6ff", "#ff5ea8", "#8dff3f", "#ff6a3d", "#6f7bff",
];
const ROOT_CLUSTER = "Wurzel";

const HINTS = {
  wolken: "Alle Cluster als getrennte Farbwolken — ziehen, zoomen, klicken.",
  sphaere: "Der ganze Bestand als rotierender Globus.",
  saeulen: "Jedes Cluster als Punktsäule — der Bestand auf einen Blick.",
  radial: "Eine Notiz im Zentrum, Verknüpfungen als Speichen. Klick wechselt das Zentrum.",
  nebel: "Tiefer Zoom in ein Cluster als Partikelnebel. Cluster unten in der Leiste wählen.",
};

const canvas = document.getElementById("graph");
const ctx = canvas.getContext("2d");
const dpr = window.devicePixelRatio || 1;

let graph = null;
let nodes = [], edges = [], clusterColor = new Map(), clusterAnchor = new Map();
let cloudParticles = [];
let simulation = null;
let transform = d3.zoomIdentity;
let hovered = null, selected = null, searchTerm = "";
let mutedClusters = new Set();
let mode = "wolken";
let nebelCluster = null;
let sphereTheta = 0, rafId = null, lastT = 0;

// --- Hilfen ------------------------------------------------------------------

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (s) => [...s].reduce((a, ch) => a + ch.charCodeAt(0), 7);

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

function neighborsOf(id) {
  const out = [];
  for (const e of edges) {
    if (e.source.id === id) out.push(e.target);
    if (e.target.id === id) out.push(e.source);
  }
  return out;
}

function resize() {
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";
  layoutStatic();
  draw();
}
addEventListener("resize", resize);

// --- Daten laden -------------------------------------------------------------

async function load() {
  const res = await fetch("/graph.json");
  graph = await res.json();
  document.getElementById("stats").textContent =
    `${graph.meta.notes} Notizen · ${graph.meta.edges} Verknüpfungen`;

  clusterColor = new Map();
  let pi = 0;
  for (const c of graph.clusters) {
    clusterColor.set(c.id, c.id === ROOT_CLUSTER ? HUB_COLOR : PALETTE[pi++ % PALETTE.length]);
  }

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
    .map((e) => ({ source: nodeById.get(e.source), target: nodeById.get(e.target) }));

  // Partikelwolke je Cluster (Wolken-Ansicht)
  cloudParticles = [];
  for (const c of graph.clusters) {
    const rand = mulberry32(seedOf(c.id));
    const count = 24 + Math.min(60, c.count * 10);
    for (let i = 0; i < count; i++) {
      const a = rand() * 2 * Math.PI;
      const d = Math.pow(rand(), 0.55) * (55 + c.count * 8);
      cloudParticles.push({
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
    .on("tick", () => { if (mode === "wolken") draw(); });
  if (mode !== "wolken") simulation.stop();

  layoutStatic();
  buildLegend();
  applyMode();
  draw();
}

// --- Statische Layouts (Sphäre, Säulen, Radial, Nebel) ------------------------

let sphereShell = [], nebelParticles = [];

function layoutStatic() {
  if (!graph) return;
  layoutSphere();
  layoutColumns();
  layoutRadial();
  layoutNebel();
}

function fibonacci(i, n) {
  const phi = Math.acos(1 - 2 * (i + 0.5) / n);
  const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5);
  return [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
}

function layoutSphere() {
  const K = graph.clusters.length;
  const centers = new Map(graph.clusters.map((c, i) => [c.id, fibonacci(i, K)]));
  for (const n of nodes) {
    const c = centers.get(n.cluster);
    const rand = mulberry32(seedOf(n.id));
    // Tangential-Streuung um das Cluster-Zentrum
    const spread = 0.42;
    let v = [c[0] + (rand() - 0.5) * spread * 2, c[1] + (rand() - 0.5) * spread * 2, c[2] + (rand() - 0.5) * spread * 2];
    const len = Math.hypot(...v);
    n.sv = v.map((x) => x / len);
  }
  sphereShell = [];
  const SHELL = 650;
  for (let i = 0; i < SHELL; i++) {
    const v = fibonacci(i, SHELL);
    const rand = mulberry32(i * 31 + 5);
    sphereShell.push({ v, r: 0.4 + rand() * 0.9, a: 0.08 + rand() * 0.22 });
  }
}

function layoutColumns() {
  const ring = graph.clusters.filter((c) => c.id !== ROOT_CLUSTER);
  const W = innerWidth, H = innerHeight;
  const tw = Math.min(W * 0.66, ring.length * 120);
  const baseY = H * 0.20;
  const colW = 3, gap = 13;
  const byCluster = new Map(graph.clusters.map((c) => [c.id, nodes.filter((n) => n.cluster === c.id)]));
  ring.forEach((c, i) => {
    const cx = ring.length > 1 ? -tw / 2 + (i * tw) / (ring.length - 1) : 0;
    const list = byCluster.get(c.id) || [];
    list.forEach((n, j) => {
      const col = j % colW, row = Math.floor(j / colW);
      n.colX = cx + (col - (colW - 1) / 2) * gap;
      n.colY = baseY - row * gap;
    });
    c._colX = cx;
  });
  // Wurzel als oranger Hub unten in der Mitte
  const rootList = byCluster.get(ROOT_CLUSTER) || [];
  rootList.forEach((n, j) => {
    const a = (j / Math.max(1, rootList.length)) * 2 * Math.PI;
    n.colX = Math.cos(a) * 26;
    n.colY = baseY + 78 + Math.sin(a) * 16;
  });
}

function layoutRadial() {
  const focus = radialFocus();
  if (!focus) return;
  const r1 = Math.min(innerWidth, innerHeight) * 0.26;
  const r2 = r1 * 1.75;
  for (const n of nodes) { n.radX = null; n.radY = null; n.radTier = 9; }
  focus.radX = 0; focus.radY = 0; focus.radTier = 0;
  const ring1 = neighborsOf(focus.id).filter((n) => n !== focus);
  const seen = new Set([focus.id, ...ring1.map((n) => n.id)]);
  ring1.forEach((n, i) => {
    const a = (i / ring1.length) * 2 * Math.PI - Math.PI / 2;
    n.radX = Math.cos(a) * r1;
    n.radY = Math.sin(a) * r1;
    n.radA = a;
    n.radTier = 1;
  });
  ring1.forEach((p) => {
    const kids = neighborsOf(p.id).filter((n) => !seen.has(n.id));
    kids.forEach((n, j) => {
      seen.add(n.id);
      const rand = mulberry32(seedOf(n.id));
      const a = p.radA + (j - (kids.length - 1) / 2) * 0.22 + (rand() - 0.5) * 0.1;
      n.radX = Math.cos(a) * r2;
      n.radY = Math.sin(a) * r2;
      n.radParent = p;
      n.radTier = 2;
    });
  });
}

function radialFocus() {
  if (selected) return selected;
  let best = null;
  for (const n of nodes) {
    if (!visible(n)) continue;
    const deg = neighborsOf(n.id).length;
    if (!best || deg > best._deg) { n._deg = deg; best = n; }
  }
  return best;
}

function currentNebelCluster() {
  if (nebelCluster && graph.clusters.some((c) => c.id === nebelCluster)) return nebelCluster;
  let best = null;
  for (const c of graph.clusters) {
    if (mutedClusters.has(c.id) || c.id === ROOT_CLUSTER) continue;
    if (!best || c.count > best.count) best = c;
  }
  return (best || graph.clusters[0]).id;
}

function layoutNebel() {
  const cid = currentNebelCluster();
  const R = Math.min(innerWidth, innerHeight) * 0.34;
  const list = nodes.filter((n) => n.cluster === cid);
  list.forEach((n) => {
    const rand = mulberry32(seedOf(n.id) * 3 + 1);
    const a = rand() * 2 * Math.PI;
    const d = Math.pow(rand(), 0.6) * R;
    n.nebX = Math.cos(a) * d * 1.15;
    n.nebY = Math.sin(a) * d * 0.85;
  });
  nebelParticles = [];
  const rand = mulberry32(seedOf(cid) * 7 + 3);
  for (let i = 0; i < 800; i++) {
    const a = rand() * 2 * Math.PI;
    const d = Math.pow(rand(), 0.5) * R * 1.5;
    nebelParticles.push({
      x: Math.cos(a) * d * 1.15,
      y: Math.sin(a) * d * 0.85,
      r: 0.5 + rand() * 1.8,
      a: 0.06 + rand() * 0.4,
      white: rand() > 0.85,
    });
  }
}

// --- Zeichnen ----------------------------------------------------------------

function beginFrame() {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(dpr, dpr);
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);
}

function focusSets() {
  const neighborIds = new Set();
  const focus = hovered || selected;
  if (focus) {
    neighborIds.add(focus.id);
    for (const e of edges) {
      if (e.source.id === focus.id) neighborIds.add(e.target.id);
      if (e.target.id === focus.id) neighborIds.add(e.source.id);
    }
  }
  return { focus, neighborIds };
}

function drawNode(n, x, y, r, color, { dimmed = false, core = true, blur = 18 } = {}) {
  n.px = x; n.py = y; n.pr = r;
  ctx.globalAlpha = dimmed ? 0.14 : 1;
  if (!dimmed) {
    const halo = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 3.2);
    halo.addColorStop(0, color + "55");
    halo.addColorStop(1, color + "00");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * 3.2, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.shadowColor = color;
  ctx.shadowBlur = dimmed ? 0 : blur;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fill();
  ctx.shadowBlur = 0;
  if (!dimmed && core) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, r * 0.32), 0, 2 * Math.PI);
    ctx.fill();
  }
  if (n === selected) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.6 / transform.k;
    ctx.beginPath();
    ctx.arc(x, y, r + 4 / transform.k, 0, 2 * Math.PI);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawLabel(text, x, y, alpha = 0.9, size = 11) {
  ctx.font = `${size / transform.k}px "Avenir Next", "Segoe UI", sans-serif`;
  ctx.fillStyle = `rgba(233, 237, 245, ${alpha})`;
  ctx.textAlign = "center";
  ctx.fillText(text, x, y);
}

function draw() {
  beginFrame();
  if (!graph) { ctx.restore(); return; }
  for (const n of nodes) { n.px = null; }
  if (mode === "wolken") drawWolken();
  else if (mode === "sphaere") drawSphaere();
  else if (mode === "saeulen") drawSaeulen();
  else if (mode === "radial") drawRadial();
  else if (mode === "nebel") drawNebel();
  ctx.restore();
}

// ☁ Wolken — getrennte Cluster-Wolken (Force-Layout)
function drawWolken() {
  const { focus, neighborIds } = focusSets();

  const centroids = new Map();
  for (const c of graph.clusters) {
    let x = 0, y = 0, k = 0;
    for (const n of nodes) if (n.cluster === c.id && n.x != null) { x += n.x; y += n.y; k++; }
    centroids.set(c.id, k ? { x: x / k, y: y / k } : clusterAnchor.get(c.id));
  }

  for (const p of cloudParticles) {
    if (mutedClusters.has(p.cluster)) continue;
    const c = centroids.get(p.cluster);
    ctx.globalAlpha = focus ? p.a * 0.4 : p.a;
    ctx.fillStyle = clusterColor.get(p.cluster);
    ctx.beginPath();
    ctx.arc(c.x + p.dx, c.y + p.dy, p.r, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const e of edges) {
    if (!visible(e.source) || !visible(e.target)) continue;
    const active = focus && (e.source.id === focus.id || e.target.id === focus.id);
    const sameCluster = e.source.cluster === e.target.cluster;
    const color = clusterColor.get(e.source.cluster) || "#888";
    ctx.strokeStyle = active ? color : (sameCluster ? color : "#ffffff");
    ctx.globalAlpha = active ? 0.9 : (focus ? 0.06 : (sameCluster ? 0.35 : 0.10));
    ctx.lineWidth = (active ? 1.5 : 0.8) / transform.k;
    ctx.beginPath();
    ctx.moveTo(e.source.x, e.source.y);
    ctx.lineTo(e.target.x, e.target.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (const n of nodes) {
    if (!visible(n)) continue;
    const dimmed = focus && !neighborIds.has(n.id);
    drawNode(n, n.x, n.y, radius(n), clusterColor.get(n.cluster) || "#888", { dimmed });
    if (!dimmed && (transform.k > 1.4 || neighborIds.has(n.id) || (searchTerm && visible(n)))) {
      drawLabel(n.title, n.x, n.y + radius(n) + 13 / transform.k);
    }
  }

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
}

// ◍ Sphäre — rotierender Globus aus Punkten
function project(v) {
  const tilt = 0.35;
  const cosT = Math.cos(sphereTheta), sinT = Math.sin(sphereTheta);
  let x = v[0] * cosT + v[2] * sinT;
  let z = -v[0] * sinT + v[2] * cosT;
  let y = v[1] * Math.cos(tilt) - z * Math.sin(tilt);
  z = v[1] * Math.sin(tilt) + z * Math.cos(tilt);
  const R = Math.min(innerWidth, innerHeight) * 0.33;
  const s = 1 / (1.55 - 0.45 * z);
  return { x: x * R * s, y: y * R * s, z, s };
}

function drawSphaere() {
  const { focus, neighborIds } = focusSets();

  for (const p of sphereShell) {
    const q = project(p.v);
    ctx.globalAlpha = p.a * (0.35 + 0.65 * (q.z + 1) / 2);
    ctx.fillStyle = q.z > 0 ? "#cfe8dd" : "#7d92a8";
    ctx.beginPath();
    ctx.arc(q.x, q.y, p.r * q.s, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const e of edges) {
    if (!visible(e.source) || !visible(e.target)) continue;
    const a = project(e.source.sv), b = project(e.target.sv);
    if (a.z < -0.15 && b.z < -0.15) continue;
    const active = focus && (e.source.id === focus.id || e.target.id === focus.id);
    ctx.strokeStyle = active ? clusterColor.get(e.source.cluster) : "#9db8d8";
    ctx.globalAlpha = active ? 0.9 : 0.10;
    ctx.lineWidth = (active ? 1.4 : 0.6) / transform.k;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const sorted = [...nodes].sort((a, b) => project(a.sv).z - project(b.sv).z);
  for (const n of sorted) {
    if (!visible(n)) continue;
    const q = project(n.sv);
    const depth = (q.z + 1) / 2;
    const dimmed = (focus && !neighborIds.has(n.id)) || depth < 0.25;
    const r = radius(n) * 0.75 * q.s;
    ctx.globalAlpha = 0.35 + 0.65 * depth;
    drawNode(n, q.x, q.y, r, clusterColor.get(n.cluster) || "#888", { dimmed, blur: 14 });
    ctx.globalAlpha = 1;
    if (!dimmed && q.z > 0.15 && (transform.k > 1.4 || neighborIds.has(n.id) || searchTerm)) {
      drawLabel(n.title, q.x, q.y + r + 12 / transform.k, 0.8);
    }
  }
}

// ▥ Säulen — Punktmatrix pro Cluster, oranger Hub unten
function drawSaeulen() {
  const { focus, neighborIds } = focusSets();
  const ring = graph.clusters.filter((c) => c.id !== ROOT_CLUSTER);
  const baseY = innerHeight * 0.20;

  for (const c of ring) {
    if (mutedClusters.has(c.id)) continue;
    ctx.font = `600 ${10 / transform.k}px "Avenir Next", "Segoe UI", sans-serif`;
    ctx.fillStyle = clusterColor.get(c.id) + "cc";
    ctx.textAlign = "center";
    ctx.fillText(c.id.replace(/^\d+\s*/, "").toUpperCase(), c._colX, baseY + 24 / transform.k);
    ctx.fillStyle = clusterColor.get(c.id) + "88";
    ctx.fillText(String(c.count), c._colX, baseY + 40 / transform.k);
  }

  // Hub-Kreis (Wurzel)
  const hub = { x: 0, y: baseY + 78 };
  ctx.shadowColor = HUB_COLOR;
  ctx.shadowBlur = 34;
  ctx.strokeStyle = HUB_COLOR;
  ctx.lineWidth = 2 / transform.k;
  ctx.beginPath();
  ctx.arc(hub.x, hub.y, 44, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.font = `600 ${10 / transform.k}px "Avenir Next", "Segoe UI", sans-serif`;
  ctx.fillStyle = HUB_COLOR;
  ctx.textAlign = "center";
  ctx.fillText("FUNDAMENT", hub.x, hub.y + 62 / transform.k);

  for (const n of nodes) {
    if (!visible(n) || n.colX == null) continue;
    const dimmed = focus && !neighborIds.has(n.id);
    const r = n.cluster === ROOT_CLUSTER ? 5 : 4;
    drawNode(n, n.colX, n.colY, r, clusterColor.get(n.cluster) || "#888", { dimmed, blur: 10, core: false });
    if (!dimmed && (neighborIds.has(n.id) || (searchTerm && visible(n)) || transform.k > 2)) {
      drawLabel(n.title, n.colX, n.colY - 10 / transform.k, 0.85, 10);
    }
  }
}

// ✳ Radial — Zentrum mit Speichen
function drawRadial() {
  const focus = radialFocus();
  if (!focus) return;

  for (const n of nodes) {
    if (n.radTier !== 2 || !visible(n) || !visible(n.radParent)) continue;
    ctx.strokeStyle = "#9db8d8";
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 0.7 / transform.k;
    ctx.beginPath();
    ctx.moveTo(n.radParent.radX, n.radParent.radY);
    ctx.lineTo(n.radX, n.radY);
    ctx.stroke();
  }
  for (const n of nodes) {
    if (n.radTier !== 1 || !visible(n)) continue;
    ctx.strokeStyle = clusterColor.get(n.cluster) || "#888";
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.1 / transform.k;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(n.radX, n.radY);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (const n of nodes) {
    if (n.radTier === 9 || n.radX == null || !visible(n)) continue;
    const r = n.radTier === 0 ? 13 : n.radTier === 1 ? radius(n) : radius(n) * 0.6;
    const color = n.radTier === 0 ? HUB_COLOR : clusterColor.get(n.cluster) || "#888";
    drawNode(n, n.radX, n.radY, r, color, { dimmed: n.radTier === 2 && !!searchTerm && !visible(n), blur: n.radTier === 0 ? 30 : 16 });
    if (n.radTier <= 1) {
      drawLabel(n.title, n.radX, n.radY + r + 14 / transform.k, n.radTier === 0 ? 1 : 0.85, n.radTier === 0 ? 13 : 11);
    } else if (transform.k > 1.3 || searchTerm) {
      drawLabel(n.title, n.radX, n.radY + r + 11 / transform.k, 0.55, 9);
    }
  }
}

// ✦ Nebel — ein Cluster als Partikelnebel
function drawNebel() {
  const cid = currentNebelCluster();
  const color = clusterColor.get(cid) || "#f02fe0";
  const { focus, neighborIds } = focusSets();

  // Hintergrund-Schimmer
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.min(innerWidth, innerHeight) * 0.55);
  g.addColorStop(0, color + "14");
  g.addColorStop(1, "#00000000");
  ctx.fillStyle = g;
  ctx.fillRect(-innerWidth, -innerHeight, innerWidth * 2, innerHeight * 2);

  for (const p of nebelParticles) {
    ctx.globalAlpha = p.a;
    ctx.fillStyle = p.white ? "#ffffff" : color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const e of edges) {
    if (e.source.cluster !== cid || e.target.cluster !== cid) continue;
    if (!visible(e.source) || !visible(e.target)) continue;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 0.8 / transform.k;
    ctx.beginPath();
    ctx.moveTo(e.source.nebX, e.source.nebY);
    ctx.lineTo(e.target.nebX, e.target.nebY);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (const n of nodes) {
    if (n.cluster !== cid || !visible(n)) continue;
    const dimmed = focus && !neighborIds.has(n.id);
    const r = 6 + radius(n) * 0.9;
    drawNode(n, n.nebX, n.nebY, r, color, { dimmed, blur: 30 });
    if (!dimmed && (transform.k > 1.1 || neighborIds.has(n.id) || searchTerm)) {
      drawLabel(n.title, n.nebX, n.nebY + r + 13 / transform.k, 0.85);
    }
  }

  ctx.font = `600 ${13 / transform.k}px "Avenir Next", "Segoe UI", sans-serif`;
  ctx.fillStyle = color + "cc";
  ctx.textAlign = "center";
  ctx.fillText(cid.toUpperCase(), 0, -Math.min(innerWidth, innerHeight) * 0.42);
}

// --- Animation (nur Sphäre) ---------------------------------------------------

function tickSphere(t) {
  if (mode !== "sphaere") { rafId = null; return; }
  if (lastT) sphereTheta += ((t - lastT) / 1000) * 0.18;
  lastT = t;
  draw();
  rafId = requestAnimationFrame(tickSphere);
}

function applyMode() {
  document.querySelectorAll("#views button").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === mode));
  document.getElementById("view-hint").textContent = HINTS[mode];
  if (simulation) (mode === "wolken" ? simulation.restart() : simulation.stop());
  lastT = 0;
  if (mode === "sphaere" && !rafId) rafId = requestAnimationFrame(tickSphere);
  if (mode === "radial") layoutRadial();
  if (mode === "nebel") layoutNebel();
  draw();
}

document.querySelectorAll("#views button").forEach((b) => {
  b.onclick = () => { mode = b.dataset.mode; applyMode(); };
});

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
    if (n.px == null || !visible(n)) continue;
    const d = Math.hypot(n.px - x, n.py - y);
    if (d < (n.pr || 4) + 4 && d < bestD) { best = n; bestD = d; }
  }
  return best;
}

const zoom = d3.zoom()
  .scaleExtent([0.15, 8])
  .filter((ev) => !ev.button && !(ev.type === "mousedown" && mode === "wolken" && nodeAt(ev.offsetX, ev.offsetY)))
  .on("zoom", (ev) => { transform = ev.transform; draw(); });

const drag = d3.drag()
  .container(canvas)
  .subject((ev) => (mode === "wolken" ? nodeAt(ev.x, ev.y) : null))
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
  if (n !== hovered) {
    hovered = n;
    canvas.style.cursor = n ? "pointer" : "grab";
    if (mode !== "sphaere") draw();
  }
});

canvas.addEventListener("click", (ev) => {
  const n = nodeAt(ev.offsetX, ev.offsetY);
  selected = n || null;
  if (mode === "radial") layoutRadial();
  if (mode === "nebel" && n) { nebelCluster = n.cluster; layoutNebel(); }
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
      if (mode === "nebel") {
        nebelCluster = c.id;
        layoutNebel();
      } else {
        mutedClusters.has(c.id) ? mutedClusters.delete(c.id) : mutedClusters.add(c.id);
        buildLegend();
        if (mode === "radial") layoutRadial();
      }
      draw();
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
  const linked = neighborsOf(selected.id);
  if (linked.length) {
    const h = document.createElement("h3");
    h.textContent = "Verknüpft mit";
    nb.append(h);
    for (const n of linked) {
      const a = document.createElement("a");
      a.href = "#"; a.textContent = n.title;
      a.onclick = (ev) => {
        ev.preventDefault();
        selected = n;
        if (mode === "radial") layoutRadial();
        updatePanel(); draw();
      };
      nb.append(a);
    }
  }

  document.getElementById("panel-open").href =
    `obsidian://open?vault=${encodeURIComponent(graph.meta.vaultName)}&file=${encodeURIComponent(selected.id.replace(/\.md$/, ""))}`;
}

document.getElementById("panel-close").onclick = () => { selected = null; updatePanel(); draw(); };

// --- Inhalts-Suche: Volltext (Server) bzw. Bedeutung (qmd) ---------------------

const suchFeld = document.getElementById("search");
const suchArt = document.getElementById("such-art");
const suchListe = document.getElementById("such-ergebnisse");
let suchTimer = null;

function fokusAufNotiz(id) {
  const n = nodes.find((x) => x.id === id);
  if (!n) return;
  selected = n;
  if (mode === "radial") layoutRadial();
  if (mode === "nebel") { nebelCluster = n.cluster; layoutNebel(); }
  updatePanel();
  // Ansicht auf den Knoten zentrieren (nur wo feste Weltkoordinaten existieren)
  const ziel = mode === "wolken" ? { x: n.x, y: n.y }
    : mode === "saeulen" ? { x: n.colX, y: n.colY }
    : mode === "radial" ? { x: n.radX, y: n.radY }
    : mode === "nebel" ? { x: n.nebX, y: n.nebY } : null;
  if (ziel && ziel.x != null) {
    const k = Math.max(transform.k, 1.4);
    const t = d3.zoomIdentity.translate(-ziel.x * k, -ziel.y * k).scale(k);
    d3.select(canvas).call(zoom.transform, t);
  }
  draw();
}

function markiere(text, woerter) {
  let sicher = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  for (const w of woerter) {
    if (w.length < 2) continue;
    sicher = sicher.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), "<mark>$1</mark>");
  }
  return sicher;
}

async function inhaltsSuche() {
  const q = suchFeld.value.trim();
  if (q.length < 2) { suchListe.classList.add("hidden"); return; }
  try {
    const res = await (await fetch(`/api/suche?q=${encodeURIComponent(q)}&art=${suchArt.value}`)).json();
    suchListe.innerHTML = "";
    if (res.hinweis) {
      const p = document.createElement("div");
      p.className = "leer";
      p.textContent = res.hinweis;
      suchListe.append(p);
    }
    const titelVon = new Map(nodes.map((n) => [n.id, n.title]));
    const woerter = q.split(/\s+/);
    for (const t of res.treffer || []) {
      const e = document.createElement("div");
      e.className = "eintrag";
      e.innerHTML =
        `<b>${(titelVon.get(t.datei) || t.datei.split("/").pop().replace(/\.md$/, ""))
          .replace(/&/g, "&amp;").replace(/</g, "&lt;")}</b>` +
        `<div class="pfad">${t.datei.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>` +
        (t.fundstellen || []).map((f) => `<div class="schnipsel">${markiere(f, woerter)}</div>`).join("");
      e.onclick = () => { suchListe.classList.add("hidden"); fokusAufNotiz(t.datei); };
      suchListe.append(e);
    }
    if (!(res.treffer || []).length && !res.hinweis) {
      suchListe.innerHTML = `<div class="leer">Keine Treffer im Inhalt.</div>`;
    }
    suchListe.classList.remove("hidden");
  } catch {}
}

suchFeld.addEventListener("input", (ev) => {
  searchTerm = ev.target.value.trim();
  if (mode === "radial") layoutRadial();
  draw();
  clearTimeout(suchTimer);
  if (searchTerm.length < 2) { suchListe.classList.add("hidden"); return; }
  suchTimer = setTimeout(inhaltsSuche, 350);
});
suchFeld.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") { clearTimeout(suchTimer); inhaltsSuche(); }
  if (ev.key === "Escape") suchListe.classList.add("hidden");
});
suchArt.addEventListener("change", () => { if (suchFeld.value.trim().length >= 2) inhaltsSuche(); });
document.addEventListener("click", (ev) => {
  if (!document.getElementById("suchbox").contains(ev.target)) suchListe.classList.add("hidden");
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

// Live: bei Änderungen im Vault (z. B. neue Notiz in Obsidian) automatisch neu laden
let bekannteVersion = null;
setInterval(async () => {
  try {
    const { version } = await (await fetch("/api/version")).json();
    if (bekannteVersion === null) { bekannteVersion = version; return; }
    if (version !== bekannteVersion) {
      bekannteVersion = version;
      await load();
    }
  } catch {}
}, 3000);

resize();
load();
