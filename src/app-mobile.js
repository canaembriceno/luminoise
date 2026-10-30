import { buildSpectrum, loadImageFromFile, loadImageFromUrl } from "./source.js";
import { extractBeams, coverageRatio } from "./beams.js";
import { createOptics, propagate, meanDeltaE } from "./optics.js";
import { expose } from "./expose.js";
import { paintLumini } from "./lumini.js";
import {
  startAudio,
  stopAudio,
  setEngine,
  getEngine,
  updateAudio,
  debug as audioDebug,
} from "./audio.js";

const canvas = document.getElementById("view");
const ctx = canvas.getContext("2d");
const emptyEl = document.getElementById("empty");
const statsEl = document.getElementById("stats");
const fileEl = document.getElementById("file");
const btnPlay = document.getElementById("btnPlay");
const playLabel = document.getElementById("playLabel");
const btnEngine = document.getElementById("btnEngine");
const engineLabel = document.getElementById("engineLabel");
const btnSeq = document.getElementById("btnSeq");
const btnPng = document.getElementById("btnPng");

const AUTO_INTERVAL_MS = 333000;
const AUTO_SEED_MS = 33000;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const FRAME_W = 720;
const FRAME_H = 960;
const LUMINI_BASE = {
  smooth: 6,
  colors: 8,
  sat: 1.45,
  light: 1.05,
  intensity: 0.6,
  hue: 30,
  chroma: 1.5,
  contour: 0.55,
  grain: 0.12,
  seed: 42,
  maxDim: 640,
};

const SEQUENCES = [
  {
    name: "Continuous",
    mode: "continuous",
    ranges: {
      density: [0.28, 0.45],
      dispersion: [0, 0.15],
      minArea: [1, 4],
      gridW: [56, 110],
      kColors: [10, 20],
      sat: [1.05, 1.15],
      focus: [0.3, 0.6],
      step: [2, 5],
      halosPct: [80, 100],
      maxStreaks: [20, 50],
      shadowChains: [0, 1],
    },
    bools: { halos: 0.9, streaks: 0.9, shadows: 0.9 },
  },
  {
    name: "Glass",
    mode: "glass",
    ranges: {
      density: [0.2, 0.35],
      dispersion: [0.1, 0.35],
      minArea: [2, 6],
      gridW: [48, 96],
      kColors: [6, 14],
      sat: [1.1, 1.25],
      focus: [0.2, 0.5],
      step: [2, 6],
      halosPct: [60, 100],
      maxStreaks: [10, 40],
      shadowChains: [0, 2],
    },
    bools: { halos: 0.85, streaks: 0.85, shadows: 0.85 },
  },
  {
    name: "Diffraction",
    mode: "diffraction",
    ranges: {
      density: [0.25, 0.42],
      dispersion: [0.3, 0.7],
      minArea: [1, 5],
      gridW: [60, 128],
      kColors: [8, 24],
      sat: [1.15, 1.3],
      focus: [0.4, 0.8],
      step: [1, 4],
      halosPct: [70, 100],
      maxStreaks: [30, 80],
      shadowChains: [1, 3],
    },
    bools: { halos: 0.9, streaks: 0.9, shadows: 0.9 },
  },
  {
    name: "Grain",
    mode: "grain",
    ranges: {
      density: [0.3, 0.5],
      dispersion: [0.2, 0.6],
      minArea: [1, 6],
      gridW: [40, 96],
      kColors: [4, 12],
      sat: [1.0, 1.2],
      focus: [0.3, 0.7],
      step: [3, 8],
      halosPct: [0, 40],
      maxStreaks: [0, 20],
      shadowChains: [0, 1],
    },
    bools: { halos: 0.7, streaks: 0.6, shadows: 0.7 },
  },
  {
    name: "Dense",
    mode: "continuous",
    ranges: {
      density: [0.42, 0.5],
      dispersion: [0, 0.2],
      minArea: [1, 3],
      gridW: [90, 150],
      kColors: [16, 30],
      sat: [1.1, 1.25],
      focus: [0.5, 0.9],
      step: [1, 3],
      halosPct: [80, 100],
      maxStreaks: [40, 90],
      shadowChains: [0, 2],
    },
    bools: { halos: 0.95, streaks: 0.95, shadows: 0.95 },
  },
  {
    name: "Sparse",
    mode: "glass",
    ranges: {
      density: [0.12, 0.24],
      dispersion: [0.05, 0.3],
      minArea: [3, 10],
      gridW: [32, 64],
      kColors: [4, 10],
      sat: [1.0, 1.2],
      focus: [0.1, 0.4],
      step: [4, 9],
      halosPct: [40, 90],
      maxStreaks: [0, 25],
      shadowChains: [0, 1],
    },
    bools: { halos: 0.8, streaks: 0.7, shadows: 0.8 },
  },
  {
    name: "Chaos",
    mode: "diffraction",
    ranges: {
      density: [0.3, 0.5],
      dispersion: [0.6, 1.0],
      minArea: [1, 4],
      gridW: [70, 160],
      kColors: [10, 28],
      sat: [1.2, 1.35],
      focus: [0.6, 1.0],
      step: [1, 3],
      halosPct: [50, 100],
      maxStreaks: [60, 140],
      shadowChains: [2, 5],
    },
    bools: { halos: 0.9, streaks: 0.9, shadows: 0.9 },
  },
  {
    name: "Mono",
    mode: "grain",
    ranges: {
      density: [0.25, 0.4],
      dispersion: [0.1, 0.4],
      minArea: [2, 8],
      gridW: [40, 80],
      kColors: [2, 5],
      sat: [1.0, 1.1],
      focus: [0.2, 0.5],
      step: [3, 7],
      halosPct: [0, 30],
      maxStreaks: [0, 15],
      shadowChains: [0, 1],
    },
    bools: { halos: 0.6, streaks: 0.5, shadows: 0.6 },
  },
];

const state = {
  density: 0.35,
  dispersion: 0.15,
  minArea: 2,
  gridW: 64,
  kColors: 12,
  sat: 1.1,
  focus: 0.4,
  step: 4,
  fps: 10,
  seed: 1,
  halos: true,
  halosPct: 100,
  streaks: true,
  maxStreaks: 40,
  shadows: true,
  shadowChains: 1,
  mode: "continuous",
  playing: true,
  frame: 0,
  seqIndex: 0,
};

let sourceCanvas = null;
let spectrum = null;
let beams = [];
let colorWeights = [];
let optics = null;
let lastTick = 0;
let autoTimer = null;
let autoSeedTimer = null;

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const round2 = (v) => Math.round(v * 100) / 100;

function currentSequence() {
  return SEQUENCES[state.seqIndex];
}

function randomize(seq) {
  const r = seq.ranges;
  return {
    density: round2(rand(r.density[0], r.density[1])),
    dispersion: round2(rand(r.dispersion[0], r.dispersion[1])),
    minArea: randInt(r.minArea[0], r.minArea[1]),
    gridW: randInt(r.gridW[0], r.gridW[1]),
    kColors: randInt(r.kColors[0], r.kColors[1]),
    sat: round2(rand(r.sat[0], r.sat[1])),
    focus: round2(rand(r.focus[0], r.focus[1])),
    step: randInt(r.step[0], r.step[1]),
    halos: Math.random() < seq.bools.halos,
    halosPct: randInt(r.halosPct[0], r.halosPct[1]),
    streaks: Math.random() < seq.bools.streaks,
    maxStreaks: randInt(r.maxStreaks[0], r.maxStreaks[1]),
    shadows: Math.random() < seq.bools.shadows,
    shadowChains: randInt(r.shadowChains[0], r.shadowChains[1]),
    seed: randInt(1, 99),
    mode: seq.mode,
  };
}

function randomParams() {
  return {
    density: round2(rand(0.15, 0.45)),
    dispersion: round2(rand(0, 0.6)),
    minArea: randInt(1, 8),
    gridW: randInt(32, 128),
    kColors: randInt(4, 24),
    sat: round2(rand(1, 1.3)),
    focus: round2(rand(0, 1)),
    step: randInt(1, 10),
    seed: randInt(1, 99),
    halos: Math.random() > 0.2,
    halosPct: randInt(0, 20) * 5,
    streaks: Math.random() > 0.2,
    maxStreaks: randInt(0, 24) * 5,
    shadows: Math.random() > 0.3,
    shadowChains: randInt(0, 4),
  };
}

function setStats(html) {
  statsEl.innerHTML = html;
}

function updateHud() {
  if (!spectrum) {
    setStats("sin espectro");
    return;
  }
  const cov = beams.length ? coverageRatio(beams, spectrum.gridW, spectrum.gridH) : 0;
  const dE = meanDeltaE(beams);
  setStats(
    `${state.mode.toUpperCase()} · elems <b>${beams.length}</b> · grid <b>${spectrum.gridW}×${spectrum.gridH}</b> · cov <b>${(cov * 100).toFixed(0)}%</b> · ΔE <b>${dE.toFixed(1)}</b>`,
  );
}

function computeWeights() {
  if (!spectrum) return [];
  const index = new Map(spectrum.palette.map((c, i) => [c, i]));
  const w = new Array(spectrum.palette.length).fill(0);
  for (const f of beams) {
    const i = index.get(f.color);
    if (i !== undefined) w[i] += f.filled;
  }
  const total = spectrum.gridW * spectrum.gridH;
  return w.map((v) => v / total);
}

function paint() {
  if (!spectrum) {
    ctx.fillStyle = "#0000f2";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  expose(ctx, canvas, spectrum, beams, {
    mode: state.mode,
    halos: state.halos,
    halosPct: state.halosPct,
    streaks: state.streaks,
    maxStreaks: state.maxStreaks,
    shadows: state.shadows,
    shadowChains: state.shadowChains,
    frame: state.frame,
  });
  updateAudio({
    colors: spectrum.palette,
    weights: colorWeights,
    focus: state.focus,
    mode: state.mode,
    fps: state.fps,
    sat: state.sat,
    seed: state.seed,
  });
}

function rebuildBeams() {
  if (!spectrum) return;
  beams = extractBeams(spectrum, {
    minArea: state.minArea,
    density: state.density,
    dispersion: state.dispersion,
    seed: state.seed,
  });
  colorWeights = computeWeights();
  optics = createOptics(beams, {
    focus: state.focus,
    step: state.step,
    seed: state.seed,
    gridW: spectrum.gridW,
    gridH: spectrum.gridH,
  });
  state.frame = 0;
  paint();
  updateHud();
}

function rebuildAll() {
  if (!sourceCanvas) return;
  const gw = Math.max(3, Math.round(state.gridW / 3) * 3);
  spectrum = buildSpectrum(sourceCanvas, {
    gridW: gw,
    kColors: state.kColors,
    sat: state.sat,
  });
  rebuildBeams();
}

function buildBase(image) {
  const result = paintLumini(image, LUMINI_BASE);
  return result.canvas;
}

function setSource(image) {
  try {
    const base = buildBase(image);
    sourceCanvas = fitToFrame(base);
  } catch (err) {
    console.error("error en setSource:", err);
    setStats("error procesando imagen: " + (err && err.message ? err.message : err));
    return;
  }
  Object.assign(state, randomize(currentSequence()));
  rebuildAll();
  emptyEl.classList.add("is-hidden");
  canvas.classList.remove("is-empty");
}

function applySequence() {
  Object.assign(state, randomize(currentSequence()));
  rebuildAll();
}

function autoStep() {
  if (!state.playing) return;
  const values = randomParams();
  const heavy = ["gridW", "kColors", "sat"].some((k) => values[k] !== state[k]);
  const shapes = ["density", "dispersion", "minArea", "seed"].some((k) => values[k] !== state[k]);
  Object.assign(state, values);
  if (heavy) {
    rebuildAll();
  } else if (shapes) {
    rebuildBeams();
  } else {
    if (optics) {
      optics.focus = state.focus;
      optics.step = state.step;
    }
    paint();
    updateHud();
  }
}

function autoSeed() {
  if (!state.playing || !spectrum) return;
  let s = state.seed;
  while (s === state.seed) s = randInt(1, 99);
  state.seed = s;
  rebuildBeams();
}

function startAuto() {
  if (autoTimer) return;
  autoTimer = setInterval(autoStep, AUTO_INTERVAL_MS);
  autoSeedTimer = setInterval(autoSeed, AUTO_SEED_MS);
}

function stopAuto() {
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
  if (autoSeedTimer) {
    clearInterval(autoSeedTimer);
    autoSeedTimer = null;
  }
}

function updatePlayUI() {
  btnPlay.classList.toggle("is-paused", !state.playing);
  btnPlay.setAttribute("aria-pressed", String(state.playing));
  playLabel.textContent = state.playing ? "Pausa" : "Play";
}

function setPlaying(playing) {
  state.playing = playing;
  updatePlayUI();
  lastTick = performance.now();
  if (playing) {
    startAuto();
    startAudio().catch(() => {});
  } else {
    stopAuto();
    stopAudio();
  }
}

function fitToFrame(image) {
  const cv = document.createElement("canvas");
  cv.width = FRAME_W;
  cv.height = FRAME_H;
  const cx = cv.getContext("2d");
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = "high";
  const s = Math.max(FRAME_W / image.width, FRAME_H / image.height);
  const w = image.width * s;
  const h = image.height * s;
  cx.drawImage(image, (FRAME_W - w) / 2, (FRAME_H - h) / 2, w, h);
  return cv;
}

function togglePlay() {
  setPlaying(!state.playing);
}

function toggleEngine() {
  const next = getEngine() === "arcade" ? "anterior" : "arcade";
  setEngine(next);
  engineLabel.textContent = next === "arcade" ? "Arcade" : "Anterior";
}

function nextSequence() {
  state.seqIndex = (state.seqIndex + 1) % SEQUENCES.length;
  applySequence();
}

function exportPng() {
  if (!spectrum) return;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `luminoise_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, "image/png");
}

function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    setStats("tipo de archivo no soportado");
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    setStats("imagen demasiado grande (máx 10 MB)");
    return;
  }
  setStats("procesando imagen…");
  loadImageFromFile(file)
    .then(setSource)
    .catch((err) => {
      console.error("error cargando imagen:", err);
      setStats("error cargando imagen: " + (err && err.message ? err.message : err));
    });
}

async function loadDemo() {
  setStats("cargando demo…");
  try {
    const img = await loadImageFromUrl("assets/photon.png");
    setSource(img);
  } catch (err) {
    setStats("no se pudo cargar photon.png: " + (err && err.message ? err.message : err));
    try {
      const img = await loadImageFromUrl("assets/demo.jpg");
      setSource(img);
    } catch (err2) {
      setStats("no se pudo cargar demo.jpg: " + (err2 && err2.message ? err2.message : err2));
    }
  }
}

function unlockAudio() {
  startAudio().catch(() => {});
  window.removeEventListener("pointerdown", unlockAudio);
}

function loop(now) {
  requestAnimationFrame(loop);
  if (!state.playing || !optics || !beams.length) return;
  const interval = 1000 / state.fps;
  if (now - lastTick < interval) return;
  lastTick = now;
  try {
    propagate(beams, optics);
    state.frame += 1;
    paint();
  } catch (err) {
    console.error("error en paint:", err);
    setStats("error renderizando: " + (err && err.message ? err.message : err));
    setPlaying(false);
  }
  if (state.frame % 5 === 0) updateHud();
}

fileEl.addEventListener("change", () => {
  handleFile(fileEl.files[0]);
  fileEl.value = "";
});
btnPlay.addEventListener("click", togglePlay);
btnEngine.addEventListener("click", toggleEngine);
btnSeq.addEventListener("click", nextSequence);
btnPng.addEventListener("click", exportPng);
window.addEventListener("pointerdown", unlockAudio, { passive: true });

// Diagnóstico: errores JS y promesas rechazadas nunca deben quedar ocultos
window.addEventListener("error", (ev) => {
  const msg = ev.message || ev.error && ev.error.message || String(ev);
  console.error("error no controlado:", msg, ev.filename, ev.lineno);
  setStats("error: " + msg);
});
window.addEventListener("unhandledrejection", (ev) => {
  const msg = ev.reason && ev.reason.message ? ev.reason.message : String(ev.reason);
  console.error("promesa rechazada:", msg);
  setStats("error: " + msg);
});

engineLabel.textContent = getEngine() === "arcade" ? "Arcade" : "Anterior";
Object.assign(state, randomize(currentSequence()));
updatePlayUI();
setPlaying(false);
loadDemo();
paint();
requestAnimationFrame(loop);

window.__luminoiseMobile = {
  state,
  SEQUENCES,
  paint,
  updateHud,
  rebuildAll,
  applySequence,
  nextSequence,
  setPlaying,
  audio: audioDebug,
  get beams() {
    return beams;
  },
  get spectrum() {
    return spectrum;
  },
};
