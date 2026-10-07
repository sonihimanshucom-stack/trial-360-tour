import { PanoViewer, deg } from "./viewer.js";
import { TOUR, SCENES } from "./tour-data.js";

const $ = (s) => document.querySelector(s);
const byId = Object.fromEntries(SCENES.map((s, i) => [s.id, { ...s, index: i }]));
const isTouch = matchMedia("(pointer: coarse)").matches;
const debug = /debug/.test(location.search + location.hash);

const ui = {
  body: document.body,
  loader: $("#loader"),
  progress: $("#progress-bar"),
  loaderNote: $("#loader-note"),
  intro: $("#intro"),
  hotspots: $("#hotspots"),
  caption: $(".caption"),
  capIndex: $("#cap-index"),
  capTotal: $("#cap-total"),
  capTitle: $("#cap-title"),
  capSub: $("#cap-sub"),
  dock: $("#dock"),
  panel: $("#panel"),
  hint: $("#hint"),
  toast: $("#toast"),
  map: $("#map-svg"),
};

// ------------------------------------------------------------ viewer
let viewer;
try {
  viewer = new PanoViewer($("#pano"));
} catch (e) {
  console.error(e);
  $("#fallback").hidden = false;
  ui.loader.classList.add("done");
  throw e;
}

// Desktop gets the 4K masters; phones stay on 2K to keep GPU memory sane.
const wantHi = viewer.maxTex >= 4096 && !(isTouch && Math.min(screen.width, screen.height) < 900);

const cache = new Map(); // id -> { tex, hi, pending }
function ensure(id, { hi = false, onProgress } = {}) {
  const entry = cache.get(id) || {};
  if (entry.tex && (entry.hi || !hi)) return Promise.resolve(entry.tex);
  const key = hi ? "hiPending" : "pending";
  if (entry[key]) return entry[key];
  const url = `assets/pano/${id}${hi ? "" : "-2k"}.jpg`;
  entry[key] = viewer.loadTexture(url, onProgress).then((tex) => {
    if (entry.tex && entry.tex !== tex) {
      if (viewer.texA === entry.tex) viewer.setTexture(tex);
      viewer.deleteTexture(entry.tex);
    }
    entry.tex = tex;
    entry.hi = entry.hi || hi;
    entry[key] = null;
    return tex;
  });
  cache.set(id, entry);
  return entry[key];
}
const upgrade = (id) => wantHi && ensure(id, { hi: true }).catch(() => {});
const neighbours = (id) => byId[id].hotspots.filter((h) => h.type === "scene").map((h) => h.to);
const preloadAround = (id) => neighbours(id).forEach((n) => ensure(n).catch(() => {}));

// ------------------------------------------------------------ state
let current = null;
let busy = false;
let guided = false;
let guidedTimer = 0;
let guidedStart = 0;

// ------------------------------------------------------------ hotspots
const ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M6 11l6-6 6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
let hsEls = [];

function buildHotspots(scene) {
  ui.hotspots.innerHTML = "";
  hsEls = scene.hotspots.map((h) => {
    const el = document.createElement("div");
    el.className = `hs hs-${h.type === "scene" ? "nav" : "info"} off`;
    if (h.type === "scene") {
      el.innerHTML = `<button class="ring" aria-label="Go to ${h.label}"><span class="core">${ARROW}</span></button>
        <div class="hs-label hs-preview"><img src="assets/pano/${h.to}-thumb.jpg" alt="" draggable="false" />
          <span><small>Walk to</small><b>${h.label}</b></span></div>`;
      el.querySelector(".ring").addEventListener("click", () => {
        stopGuided();
        goTo(h.to, h, el);
      });
    } else {
      el.innerHTML = `<button class="dot" aria-label="${h.title}">i</button><div class="hs-label"><b>${h.title}</b></div>`;
      el.querySelector(".dot").addEventListener("click", () => openPanel("Discover", h.title, h.text));
    }
    ui.hotspots.appendChild(el);
    return { el, lon: deg(h.yaw), lat: deg(h.pitch) };
  });
}

function placeHotspots() {
  const cx = viewer.cssW / 2, cy = viewer.cssH / 2;
  for (const h of hsEls) {
    const p = viewer.project(h.lon, h.lat);
    if (!p) {
      h.el.classList.add("off");
      continue;
    }
    h.el.classList.remove("off");
    h.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
    h.el.classList.toggle("near", Math.hypot(p.x - cx, p.y - cy) < Math.min(110, viewer.cssW * 0.18));
  }
}

// ------------------------------------------------------------ caption
function splitReveal(text) {
  return `<span class="reveal"><span>${text}</span></span>`;
}
function setCaption(scene) {
  ui.caption.classList.remove("in");
  ui.capIndex.textContent = String(scene.index + 1).padStart(2, "0");
  ui.capTotal.textContent = String(SCENES.length).padStart(2, "0");
  ui.capTitle.innerHTML = splitReveal(scene.title);
  ui.capSub.textContent = scene.subtitle;
  requestAnimationFrame(() => requestAnimationFrame(() => ui.caption.classList.add("in")));
}

// ------------------------------------------------------------ dock
function buildDock() {
  ui.dock.innerHTML = SCENES.map((s, i) => `
    <button class="card" data-id="${s.id}" aria-label="${s.title}">
      <img src="assets/pano/${s.id}-thumb.jpg" alt="" loading="lazy" draggable="false" />
      <span><small>${String(i + 1).padStart(2, "0")}</small>${s.title}</span>
      <i class="bar"></i>
    </button>`).join("");
  ui.dock.addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    stopGuided();
    goTo(card.dataset.id);
  });
}
function setActiveCard(id) {
  ui.dock.querySelectorAll(".card").forEach((c) => {
    const on = c.dataset.id === id;
    c.classList.toggle("active", on);
    if (on) c.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    c.querySelector(".bar").style.width = "0";
  });
}

// ------------------------------------------------------------ map
const mapOffset = {}; // map bearing of world lon 0, per scene
function buildMap() {
  if (!TOUR.map) return $("#minimap").remove();
  const bearing = (a, b) => Math.atan2(b.x - a.x, -(b.y - a.y));
  for (const s of SCENES) {
    const link = s.hotspots.find((h) => h.type === "scene");
    mapOffset[s.id] = link ? bearing(s.map, byId[link.to].map) - deg(link.yaw) : 0;
  }
  const seen = new Set();
  let paths = "";
  for (const s of SCENES)
    for (const h of s.hotspots) {
      if (h.type !== "scene") continue;
      const k = [s.id, h.to].sort().join();
      if (seen.has(k)) continue;
      seen.add(k);
      const a = s.map, b = byId[h.to].map;
      paths += `<path class="path" d="M${a.x} ${a.y}L${b.x} ${b.y}"/>`;
    }
  ui.map.innerHTML = `
    <defs><radialGradient id="coneGrad" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="scale(22)">
      <stop offset="0" stop-color="#d8bb84" stop-opacity=".75"/><stop offset="1" stop-color="#d8bb84" stop-opacity="0"/></radialGradient></defs>
    ${paths}
    <g id="cone-g"><path class="cone" d="M0 0L-11 -20A23 23 0 0 1 11 -20Z"/></g>
    ${SCENES.map((s) => {
      const left = s.map.label === "left";
      return `<circle class="node" data-id="${s.id}" cx="${s.map.x}" cy="${s.map.y}" r="2.6"/>
      <text data-id="${s.id}" x="${s.map.x + (left ? -4.5 : 4.5)}" y="${s.map.y + 1.6}" text-anchor="${left ? "end" : "start"}">${s.title.replace(/^The /, "")}</text>`;
    }).join("")}`;
  ui.map.addEventListener("click", (e) => {
    const n = e.target.closest(".node");
    if (n) { stopGuided(); goTo(n.dataset.id); }
  });
}
function setActiveMap(id) {
  ui.map.querySelectorAll("[data-id]").forEach((n) => n.classList.toggle("active", n.dataset.id === id));
}
function updateCone() {
  const g = document.getElementById("cone-g");
  if (!g || !current) return;
  const s = byId[current];
  const a = (viewer.look().lon + mapOffset[current]) * (180 / Math.PI);
  const spread = Math.min(1.8, Math.max(0.5, viewer.scale * 1.1));
  g.setAttribute("transform", `translate(${s.map.x} ${s.map.y}) rotate(${a.toFixed(1)}) scale(${spread.toFixed(2)} 1)`);
}

// ------------------------------------------------------------ panel / toast / hint
function openPanel(eyebrow, title, text) {
  $("#panel-eyebrow").textContent = eyebrow;
  $("#panel-title").textContent = title;
  $("#panel-text").textContent = text;
  ui.panel.classList.add("open");
  ui.panel.setAttribute("aria-hidden", "false");
}
function closePanel() {
  ui.panel.classList.remove("open");
  ui.panel.setAttribute("aria-hidden", "true");
}
let toastTimer;
function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 2600);
}
function showHint() {
  $("#hint-text").textContent = isTouch ? "Swipe or tilt to explore" : "Drag to explore";
  ui.hint.classList.add("show");
  const hide = () => ui.hint.classList.remove("show");
  setTimeout(hide, 3400);
  $("#pano").addEventListener("pointerdown", hide, { once: true });
}

// ------------------------------------------------------------ navigation
async function goTo(id, link = null, hsEl = null) {
  if (busy || id === current || !byId[id]) return;
  busy = true;
  closePanel();
  if (viewer.planetMode) {
    await viewer.setPlanet(false);
    $("#btn-planet").setAttribute("aria-pressed", "false");
  }
  const scene = byId[id];
  hsEl?.classList.add("loading");
  let tex;
  try {
    tex = await ensure(id);
  } catch (e) {
    hsEl?.classList.remove("loading");
    busy = false;
    toast("Couldn't load this view — please try again");
    return;
  }
  ui.hotspots.classList.add("hidden");
  ui.caption.classList.remove("in");
  setActiveCard(id);
  setActiveMap(id);
  history.replaceState(null, "", `#${id}`);

  await viewer.transition(tex, {
    fromLon: link ? deg(link.yaw) : null,
    fromLat: link ? deg(link.pitch) : 0,
    arriveLon: deg(link?.arrive ?? scene.yaw),
    duration: link ? 1500 : 1700,
  });
  current = id;
  buildHotspots(scene);
  setCaption(scene);
  ui.hotspots.classList.remove("hidden");
  busy = false;
  upgrade(id);
  preloadAround(id);
  if (guided) scheduleGuided();
}

// ------------------------------------------------------------ guided tour
function scheduleGuided() {
  clearTimeout(guidedTimer);
  guidedStart = performance.now();
  guidedTimer = setTimeout(() => {
    const next = SCENES[(byId[current].index + 1) % SCENES.length].id;
    const link = byId[current].hotspots.find((h) => h.to === next) || null;
    goTo(next, link);
  }, TOUR.guidedSeconds * 1000);
}
function startGuided() {
  guided = true;
  $("#btn-play").setAttribute("aria-pressed", "true");
  viewer.autoRotateSpeed = 0.11;
  viewer.lastInteraction = 0;
  toast("Guided tour — sit back and enjoy");
  scheduleGuided();
}
function stopGuided() {
  if (!guided) return;
  guided = false;
  clearTimeout(guidedTimer);
  $("#btn-play").setAttribute("aria-pressed", "false");
  viewer.autoRotateSpeed = 0.045;
  ui.dock.querySelectorAll(".bar").forEach((b) => (b.style.width = "0"));
}

// ------------------------------------------------------------ controls
function bindControls() {
  $("#btn-enquire").href = TOUR.enquireUrl;
  $("#btn-play").addEventListener("click", () => (guided ? stopGuided() : startGuided()));
  $("#panel-close").addEventListener("click", closePanel);
  $("#cap-more").addEventListener("click", () => {
    const s = byId[current];
    openPanel(`${String(s.index + 1).padStart(2, "0")} — ${s.subtitle}`, s.title, s.description);
  });
  $("#dock-toggle").addEventListener("click", (e) => {
    const collapsed = $(".dock").classList.toggle("collapsed");
    e.currentTarget.setAttribute("aria-expanded", String(!collapsed));
  });
  $(".brand").addEventListener("click", (e) => {
    e.preventDefault();
    stopGuided();
    goTo(TOUR.startScene);
  });

  const planetBtn = $("#btn-planet");
  planetBtn.addEventListener("click", async () => {
    if (busy) return;
    const on = !viewer.planetMode;
    ui.hotspots.classList.toggle("hidden", on);
    await viewer.setPlanet(on);
    planetBtn.setAttribute("aria-pressed", String(viewer.planetMode));
    if (viewer.planetMode) $("#btn-gyro").setAttribute("aria-pressed", "false");
  });

  // gyro
  const gyroBtn = $("#btn-gyro");
  if (PanoViewer.gyroSupported()) {
    gyroBtn.hidden = false;
    gyroBtn.addEventListener("click", async () => {
      if (viewer.gyro) {
        viewer.disableGyro();
        gyroBtn.setAttribute("aria-pressed", "false");
        return;
      }
      try {
        if (viewer.planetMode) {
          await viewer.setPlanet(false);
          planetBtn.setAttribute("aria-pressed", "false");
          ui.hotspots.classList.remove("hidden");
        }
        await viewer.enableGyro();
        gyroBtn.setAttribute("aria-pressed", "true");
        toast("Motion control on — move your phone to look around");
      } catch (err) {
        toast(err.message || "Motion control unavailable");
      }
    });
  }

  // fullscreen (falls back to hiding the interface where the API is missing, e.g. iPhone)
  $("#btn-fs").addEventListener("click", () => {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (req) req.call(el).catch(() => ui.body.classList.toggle("immersive"));
      else ui.body.classList.toggle("immersive");
    } else (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  });

  $("#btn-share").addEventListener("click", async () => {
    const data = { title: document.title, text: TOUR.tagline, url: location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(location.href);
        toast("Link copied to clipboard");
      }
    } catch (_) { /* user cancelled */ }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
    if (busy || !current) return;
    const i = byId[current].index;
    if (e.key === "PageDown" || e.key === "]") { stopGuided(); goTo(SCENES[(i + 1) % SCENES.length].id); }
    if (e.key === "PageUp" || e.key === "[") { stopGuided(); goTo(SCENES[(i - 1 + SCENES.length) % SCENES.length].id); }
  });

  window.addEventListener("hashchange", () => {
    const id = location.hash.slice(1);
    if (byId[id] && id !== current) goTo(id);
  });

  if (debug) {
    window.viewer = viewer;
    $("#pano").addEventListener("click", (e) => {
      const { lon, lat } = viewer.unproject(e.clientX, e.clientY);
      console.log(`${current}: yaw: ${(lon * 180 / Math.PI).toFixed(1)}, pitch: ${(lat * 180 / Math.PI).toFixed(1)}`);
    });
  }
}

// ------------------------------------------------------------ frame hook
viewer.onFrame = (now) => {
  if (current) {
    placeHotspots();
    updateCone();
  }
  if (guided && !busy && current) {
    const bar = ui.dock.querySelector(".card.active .bar");
    if (bar) bar.style.width = `${Math.min(100, ((now - guidedStart) / (TOUR.guidedSeconds * 10)))}%`;
  }
};

// ------------------------------------------------------------ boot
async function boot() {
  const hashId = location.hash.slice(1);
  const start = byId[hashId] ? hashId : TOUR.startScene;
  const scene = byId[start];
  buildDock();
  buildMap();
  bindControls();

  try {
    const tex = await ensure(start, { onProgress: (p) => (ui.progress.style.width = `${Math.round(p * 100)}%`) });
    viewer.setTexture(tex);
  } catch (e) {
    ui.loaderNote.textContent = "Unable to load the tour. Please refresh.";
    throw e;
  }
  current = start;
  buildHotspots(scene);
  ui.hotspots.classList.add("hidden");
  setActiveCard(start);
  setActiveMap(start);
  history.replaceState(null, "", `#${start}`);

  // little planet: loader fades to reveal the spinning globe with the title
  ui.loader.classList.add("done");
  ui.intro.classList.add("show");
  const skip = () => {
    ui.intro.classList.remove("show");
    viewer.skipIntro();
  };
  $("#skip-intro").addEventListener("click", skip, { once: true });
  $("#pano").addEventListener("pointerdown", skip, { once: true });
  upgrade(start);
  preloadAround(start);

  const introDone = viewer.intro({ hold: 2200, duration: 3800, toYaw: deg(scene.yaw) });
  setTimeout(() => ui.intro.classList.remove("show"), 2600);
  await introDone;
  ui.intro.classList.remove("show");
  ui.intro.remove();

  ui.body.classList.add("ready");
  setCaption(scene);
  ui.hotspots.classList.remove("hidden");
  showHint();
}

boot();
