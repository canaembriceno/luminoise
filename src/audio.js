import { mulberry32, rgbToLab } from "./color.js";

const SCALE = [0, 3, 5, 7, 10];
const BASE_HZ = 55;
const MAX_VOICES = 8;
const UPDATE_S = 0.1;
const TICK_MS = 25;
const LOOKAHEAD_S = 0.12;
const STEPS = 16;

const LAYERS = {
  continuous: { beat: 0.55, hiss: 0.7, mel: 0.6, chord: 0.7, pad: 1 },
  glass: { beat: 0.3, hiss: 0.8, mel: 1, chord: 0.9, pad: 0.85 },
  diffraction: { beat: 0.65, hiss: 0.6, mel: 0.7, chord: 0.6, pad: 1 },
  grain: { beat: 0.4, hiss: 1, mel: 0.5, chord: 1, pad: 0.7 },
};
const MODE_BELL = { continuous: 0, glass: 1, diffraction: 0.6, grain: 0.3 };
const CHORD_M7 = [0, 3, 7, 10];
const CHORD_MAJ7 = [0, 4, 7, 11];

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

let ctx = null;
let master = null;
let comp = null;
let gate = null;
let bandHP = null;
let bandLP = null;
let focusLP = null;
let voiceSum = null;
let layerPad = null;
let layerBeat = null;
let layerHiss = null;
let layerMel = null;
let melShaper = null;
let melGate = null;
let melGateDepth = null;
let melGateLFO = null;
let layerChord = null;
let chordLP = null;
let chordOscs = [];
let chordGains = [];
let eventBus = null;
let eventDelay = null;
let echoSend = null;
let delayA = null;
let delayB = null;
let noiseBuf = null;
let wowDepth = null;
let flutterDepth = null;
let hissLPNode = null;
let pwr2Depth = null;
let lastBits = -1;
const voices = [];
const shWalk = new Array(MAX_VOICES).fill(0);

let engine = "arcade";
try {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem("luminoise_engine");
    if (saved === "anterior" || saved === "arcade") engine = saved;
  }
} catch {}

let muted = false;
let running = false;
let volume = 0.18;
let pending = null;
let lastApply = -1;
let lastSeed = -1;
let lastMode = null;

let schedTimer = null;
let nextBeatTime = 0;
let nextStepTime = 0;
let nextMelTime = 0;
let nextPopTime = 0;
let nextBellTime = 0;
let nextChordTime = 0;
let beatInBar = 0;
let stepIdx = 0;
let beatWalk = 0;
let stepWalk = 0;
let eventRnd = null;
let pat = null;
let beatCount = 0;
let stepCount = 0;
let noteCount = 0;
let popCount = 0;
let bellCount = 0;
let chordCount = 0;
let glitchCount = 0;
let ufoCount = 0;
let curParams = null;

function rgbToHsl(r, g, b) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const mx = Math.max(rr, gg, bb);
  const mn = Math.min(rr, gg, bb);
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === rr) h = ((gg - bb) / d) % 6;
    else if (mx === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return h;
}

function snapPent(semi) {
  let best = 0;
  let bd = Infinity;
  for (const o of [0, 12]) {
    for (const d of SCALE) {
      const c = o + d;
      const dd = Math.abs(c - semi);
      if (dd < bd) {
        bd = dd;
        best = c;
      }
    }
  }
  return best;
}

function compute(s) {
  const idx = [];
  for (let i = 0; i < s.colors.length; i++) {
    if ((s.weights[i] || 0) > 0) idx.push(i);
  }
  idx.sort((a, b) => (s.weights[b] || 0) - (s.weights[a] || 0));
  idx.length = Math.min(idx.length, MAX_VOICES);
  const wmax = idx.length ? s.weights[idx[0]] || 1 : 1;
  const rnd = mulberry32((s.seed >>> 0) * 9973 + 17);
  const params = [];
  let fSum = 0;
  let wSum = 0;
  let lumSum = 0;
  let lumSq = 0;
  let hueX = 0;
  let hueY = 0;
  let lumMin = 100;
  let lumMax = 0;
  let topHue = 0;
  for (let i = 0; i < MAX_VOICES; i++) {
    if (i >= idx.length) {
      params.push(null);
      continue;
    }
    const ci = idx[i];
    const [r, g, b] = s.colors[ci];
    const h = rgbToHsl(r, g, b);
    const lum = rgbToLab(r, g, b)[0];
    const w = Math.sqrt((s.weights[ci] || 0) / wmax);
    if (i === 0) topHue = h;
    const oct = Math.min(3, Math.floor((lum / 100) * 3));
    const semi = snapPent((12 * h) / 360) + 12 * oct;
    const f = BASE_HZ * Math.pow(2, semi / 12);
    const detune = ((s.sat - 1) / 0.35) * 18 + (rnd() * 10 - 5);
    params.push({ f, detune, gain: 0.4 * w });
    fSum += f * w;
    wSum += w;
    lumSum += lum * w;
    lumSq += lum * lum * w;
    hueX += Math.cos((h * Math.PI) / 180) * w;
    hueY += Math.sin((h * Math.PI) / 180) * w;
    if (lum < lumMin) lumMin = lum;
    if (lum > lumMax) lumMax = lum;
  }
  const wTot = wSum || 1;
  const lumAvg = lumSum / wTot;
  const lumVar = Math.max(0, lumSq / wTot - lumAvg * lumAvg);
  const lumSpread = clamp01(Math.sqrt(lumVar) / 40);
  const contrast = clamp01((lumMax - lumMin) / 60);
  const hueMag = Math.min(1, Math.hypot(hueX, hueY) / wTot);
  const hueSpread = clamp01(1 - hueMag);
  const wNorm = clamp01(wSum / 2);
  const normSat = clamp01((s.sat - 1) / 0.35);
  const focus = clamp01(s.focus);
  const fps = Math.min(60, Math.max(0, s.fps || 10));
  const mode = LAYERS[s.mode] ? s.mode : "continuous";
  const bandFreq = wSum > 0 ? fSum / wSum : 800;
  const chordRootSemi = snapPent(Math.round(12 * Math.log2(bandFreq / BASE_HZ)));
  const layers = LAYERS[mode];
  const melRate = (0.6 + 0.8 * focus) * (0.7 + fps / 30);
  return {
    voices: params,
    mode,
    cutoff: Math.min(7000, 800 * Math.pow(2, 3.4 * focus)),
    bpm: 70 + 15 * focus,
    swing: 0.55 + 0.05 * hueSpread,
    kickAmp: 0.06 + 0.05 * contrast,
    ghostProb: 0.1 + 0.3 * wNorm,
    hissGain:
      (engine === "anterior"
        ? 0.006 + 0.022 * normSat * (0.4 + lumSpread)
        : 0.0025 + 0.009 * normSat * (0.4 + lumSpread)) * layers.hiss,
    popScale: 0.25 + 0.75 * normSat,
    popGap: 1.8 - 0.8 * normSat,
    bellRate: MODE_BELL[mode] * (0.4 + lumSpread),
    melRate,
    density: clamp01(0.2 + 0.35 * melRate),
    pStutter: 0.15 + 0.5 * normSat,
    pRetrig: 0.5 * contrast,
    pLaser: 0.05 + 0.3 * contrast,
    pExpl: clamp01(0.04 + 0.3 * normSat + 0.15 * contrast),
    pDrop: 0.4 * normSat,
    ufoProb: 0.008 + 0.03 * lumSpread,
    arpProb: 0.2 + 0.5 * hueSpread,
    wow: 4 + 10 * normSat,
    bits: 8 - Math.round(normSat * 5),
    normSat,
    chordRootSemi,
    chordIsMaj7: lumAvg > 50,
    hueSemi: Math.round((12 * topHue) / 360),
    bandFreq,
    lumSpread,
    hueSpread,
    contrast,
    wNorm,
    layers: { beat: layers.beat, mel: layers.mel, chord: layers.chord, pad: layers.pad },
  };
}

function makeNoiseBuffer() {
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function makeBitCurve(bits) {
  const levels = Math.pow(2, bits);
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = -1 + (2 * i) / (n - 1);
    c[i] = Math.round(x * levels) / levels;
  }
  return c;
}

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();

  master = ctx.createGain();
  master.gain.value = 0;
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.01;
  comp.release.value = 0.2;
  gate = ctx.createGain();
  gate.gain.value = 1;
  bandHP = ctx.createBiquadFilter();
  bandHP.type = "highpass";
  bandHP.frequency.value = 150;
  bandHP.Q.value = 0.6;
  bandLP = ctx.createBiquadFilter();
  bandLP.type = "lowpass";
  bandLP.frequency.value = 6500;
  bandLP.Q.value = 0.6;
  focusLP = ctx.createBiquadFilter();
  focusLP.type = "lowpass";
  focusLP.frequency.value = 3000;
  focusLP.Q.value = 0.7;
  master.connect(gate);
  gate.connect(comp);
  comp.connect(bandHP);
  bandHP.connect(bandLP);
  bandLP.connect(focusLP);
  focusLP.connect(ctx.destination);

  noiseBuf = makeNoiseBuffer();

  wowDepth = ctx.createGain();
  wowDepth.gain.value = 7;
  const wow = ctx.createOscillator();
  wow.type = "sine";
  wow.frequency.value = 0.13;
  wow.connect(wowDepth);
  wow.start();
  flutterDepth = ctx.createGain();
  flutterDepth.gain.value = 2;
  const flutter = ctx.createOscillator();
  flutter.type = "sine";
  flutter.frequency.value = 9.5;
  flutter.connect(flutterDepth);
  flutter.start();

  voiceSum = ctx.createGain();
  voiceSum.gain.value = 1;

  for (let i = 0; i < MAX_VOICES; i++) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = BASE_HZ * Math.pow(2, (i % 12) / 12);
    const sub = ctx.createOscillator();
    sub.type = "sine";
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const subGain = ctx.createGain();
    subGain.gain.value = 0;
    osc.connect(gain);
    gain.connect(voiceSum);
    sub.connect(subGain);
    subGain.connect(voiceSum);
    wowDepth.connect(osc.detune);
    wowDepth.connect(sub.detune);
    flutterDepth.connect(osc.detune);
    flutterDepth.connect(sub.detune);
    osc.start();
    sub.start();
    voices.push({ osc, sub, gain, subGain });
  }

  layerPad = ctx.createGain();
  layerPad.gain.value = 1;
  voiceSum.connect(layerPad);
  layerPad.connect(master);

  layerChord = ctx.createGain();
  layerChord.gain.value = 0;
  chordLP = ctx.createBiquadFilter();
  chordLP.type = "lowpass";
  chordLP.frequency.value = 900;
  chordLP.Q.value = 0.7;
  chordLP.connect(layerChord);
  layerChord.connect(master);
  for (let i = 0; i < 4; i++) {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = BASE_HZ;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    osc.connect(g);
    g.connect(chordLP);
    wowDepth.connect(osc.detune);
    flutterDepth.connect(osc.detune);
    osc.start();
    chordOscs.push(osc);
    chordGains.push(g);
  }

  layerMel = ctx.createGain();
  layerMel.gain.value = 1;
  melShaper = ctx.createWaveShaper();
  melShaper.curve = makeBitCurve(8);
  melShaper.oversample = "none";
  melGate = ctx.createGain();
  melGate.gain.value = 1;
  melGateLFO = ctx.createOscillator();
  melGateLFO.type = "square";
  melGateLFO.frequency.value = 10;
  melGateDepth = ctx.createGain();
  melGateDepth.gain.value = 0;
  melGateLFO.connect(melGateDepth);
  melGateDepth.connect(melGate.gain);
  melGateLFO.start();
  layerMel.connect(melShaper);
  melShaper.connect(melGate);
  melGate.connect(master);

  layerBeat = ctx.createGain();
  layerBeat.gain.value = 0;
  layerBeat.connect(master);
  const pwr1 = ctx.createOscillator();
  pwr1.type = "sine";
  pwr1.frequency.value = 1.3;
  const pwr1d = ctx.createGain();
  pwr1d.gain.value = 0.03;
  pwr1.connect(pwr1d);
  pwr1d.connect(layerBeat.gain);
  pwr1.start();

  layerHiss = ctx.createGain();
  layerHiss.gain.value = 0;
  layerHiss.connect(master);
  const pwr2 = ctx.createOscillator();
  pwr2.type = "sine";
  pwr2.frequency.value = 0.7;
  pwr2Depth = ctx.createGain();
  pwr2Depth.gain.value = engine === "arcade" ? 0.0006 : 0.0015;
  pwr2.connect(pwr2Depth);
  pwr2Depth.connect(layerHiss.gain);
  pwr2.start();

  const hiss = ctx.createBufferSource();
  hiss.buffer = noiseBuf;
  hiss.loop = true;
  hissLPNode = ctx.createBiquadFilter();
  hissLPNode.type = "lowpass";
  hissLPNode.frequency.value = engine === "arcade" ? 4800 : 6500;
  hissLPNode.Q.value = 0.5;
  hiss.connect(hissLPNode);
  hissLPNode.connect(layerHiss);
  hiss.start();

  eventBus = ctx.createGain();
  eventBus.gain.value = 1;
  eventBus.connect(master);
  eventDelay = ctx.createDelay(1);
  eventDelay.delayTime.value = 0.31;
  const eventFb = ctx.createGain();
  eventFb.gain.value = 0.3;
  eventBus.connect(eventDelay);
  eventDelay.connect(eventFb);
  eventFb.connect(eventDelay);
  eventDelay.connect(master);

  echoSend = ctx.createGain();
  echoSend.gain.value = 0.5;
  delayA = ctx.createDelay(1);
  delayA.delayTime.value = 0.25;
  delayB = ctx.createDelay(1);
  delayB.delayTime.value = 0.25;
  const panA = ctx.createStereoPanner();
  panA.pan.value = -0.85;
  const panB = ctx.createStereoPanner();
  panB.pan.value = 0.85;
  const echoLP = ctx.createBiquadFilter();
  echoLP.type = "lowpass";
  echoLP.frequency.value = 3000;
  const echoFb = ctx.createGain();
  echoFb.gain.value = 0.42;
  echoSend.connect(delayA);
  delayA.connect(panA);
  panA.connect(master);
  delayA.connect(delayB);
  delayB.connect(panB);
  panB.connect(master);
  delayB.connect(echoLP);
  echoLP.connect(echoFb);
  echoFb.connect(delayA);

  return ctx;
}

function seedScheduler(seed) {
  eventRnd = mulberry32((seed >>> 0) * 40503 + 7);
  const pr = mulberry32((seed >>> 0) * 7717 + 3);
  pat = { on: [], deg: [], oct: [], amp: [] };
  for (let i = 0; i < STEPS; i++) {
    const strong = i % 4 === 0;
    const mid = i % 2 === 0;
    pat.on.push(pr() < (strong ? 0.9 : mid ? 0.7 : 0.45));
    pat.deg.push(Math.floor(pr() * SCALE.length));
    const roll = pr();
    pat.oct.push(roll < 0.3 ? 0 : roll < 0.8 ? 1 : 2);
    pat.amp.push(0.55 + pr() * 0.45);
  }
}

function emit(g, withEcho = true) {
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (pan) {
    pan.pan.value = eventRnd() * 1.4 - 0.7;
    g.connect(pan);
    pan.connect(layerMel);
  } else {
    g.connect(layerMel);
  }
  if (withEcho) g.connect(echoSend);
}

function scheduleBlip(t, f, dur, amp, wave, p, opts = {}) {
  const r = eventRnd;
  const contour = opts.contour;
  const attack = contour ? 0.02 : 0.003;
  const rel = contour ? 1.0 : 0.04;
  const osc = ctx.createOscillator();
  osc.type = wave;
  wowDepth.connect(osc.detune);
  flutterDepth.connect(osc.detune);
  if (p.normSat > 0.25 && !contour) {
    for (let k = 3; k >= 0; k--) {
      osc.frequency.setValueAtTime(f * Math.pow(2, (k * 0.125) * (1 + p.normSat)), t + (3 - k) * 0.012);
    }
    osc.frequency.setValueAtTime(f, t + 0.048);
  } else {
    osc.frequency.setValueAtTime(f * 1.015, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.06);
  }
  const osc2 = ctx.createOscillator();
  osc2.type = wave;
  osc2.detune.value = opts.wave === "sawtooth" ? 8 : -8;
  osc2.frequency.setValueAtTime(f, t);
  wowDepth.connect(osc2.detune);
  flutterDepth.connect(osc2.detune);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = contour ? 1600 : 5000;
  lp.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(amp, t + attack);
  if (contour) {
    g.gain.setValueAtTime(amp, t + dur * 0.6);
  }
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + rel);
  osc.connect(lp);
  osc2.connect(lp);
  lp.connect(g);
  emit(g, opts.echo !== false);

  if (contour && r() < p.pDrop) {
    const dOsc = ctx.createOscillator();
    dOsc.type = "square";
    const dG = ctx.createGain();
    const dt = t + dur * 0.6;
    const dDur = 0.35;
    dOsc.frequency.setValueAtTime(f, dt);
    dOsc.frequency.exponentialRampToValueAtTime(f * 0.55, dt + dDur);
    dG.gain.setValueAtTime(0.0001, dt);
    dG.gain.linearRampToValueAtTime(amp * 0.6, dt + 0.02);
    dG.gain.exponentialRampToValueAtTime(0.0001, dt + dDur);
    dOsc.connect(dG);
    emit(dG);
    dOsc.start(dt);
    dOsc.stop(dt + dDur + 0.1);
    dOsc.onended = () => {
      try {
        dOsc.disconnect();
        dG.disconnect();
      } catch {}
    };
    glitchCount++;
  }

  osc.start(t);
  osc.stop(t + dur + rel + 0.1);
  osc2.start(t);
  osc2.stop(t + dur + rel + 0.1);
  osc.onended = () => {
    try {
      osc.disconnect();
      osc2.disconnect();
      lp.disconnect();
      g.disconnect();
      wowDepth.disconnect(osc.detune);
      flutterDepth.disconnect(osc.detune);
      wowDepth.disconnect(osc2.detune);
      flutterDepth.disconnect(osc2.detune);
    } catch {}
  };
  stepCount++;
}

function scheduleLaser(t, f) {
  const r = eventRnd;
  const dur = 0.07 + r() * 0.06;
  const osc = ctx.createOscillator();
  osc.type = "square";
  const f0 = Math.min(6000, f * 2.4);
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, f * 0.2), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.07, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.03);
  osc.connect(g);
  emit(g);
  osc.start(t);
  osc.stop(t + dur + 0.08);
  osc.onended = () => {
    try {
      osc.disconnect();
      g.disconnect();
    } catch {}
  };
  glitchCount++;
}

function scheduleExplosion(t) {
  const r = eventRnd;
  const dur = 0.35 + r() * 0.3;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(6000, t);
  lp.frequency.exponentialRampToValueAtTime(400, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.11, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp);
  lp.connect(g);
  emit(g);
  src.start(t, r() * 1.5);
  src.stop(t + dur + 0.1);
  src.onended = () => {
    try {
      src.disconnect();
      lp.disconnect();
      g.disconnect();
    } catch {}
  };
  glitchCount++;
}

function scheduleUfo(t, p) {
  const r = eventRnd;
  const dur = 1.2 + r() * 1.4;
  const f0 = BASE_HZ * Math.pow(2, (p.chordRootSemi + 36) / 12);
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + dur);
  const warb = ctx.createOscillator();
  warb.type = "sine";
  warb.frequency.value = 30 + r() * 30;
  const warbD = ctx.createGain();
  warbD.gain.value = f0 * 0.25;
  warb.connect(warbD);
  warbD.connect(osc.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.045, t + 0.08);
  g.gain.setValueAtTime(0.045, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  emit(g);
  osc.start(t);
  warb.start(t);
  osc.stop(t + dur + 0.1);
  warb.stop(t + dur + 0.1);
  osc.onended = () => {
    try {
      osc.disconnect();
      warb.disconnect();
      warbD.disconnect();
      g.disconnect();
    } catch {}
  };
  ufoCount++;
}

function scheduleBell(t) {
  const r = eventRnd;
  const semi = snapPent(Math.floor(r() * 14)) + 48;
  const f = BASE_HZ * Math.pow(2, semi / 12);
  const dur = 0.5 + r() * 1.2;
  const amp = 0.03 + r() * 0.05;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = f;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(amp, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(eventBus);
  g.connect(echoSend);
  osc.start(t);
  osc.stop(t + dur + 0.05);
  osc.onended = () => {
    try {
      osc.disconnect();
      g.disconnect();
    } catch {}
  };
  bellCount++;
}

function scheduleBeat(t, inBar, p) {
  const r = eventRnd;
  const hum = () => t + (r() * 0.024 - 0.012);
  const beatDur = 60 / p.bpm;

  if (inBar === 0 || inBar === 2) {
    const kick = ctx.createOscillator();
    kick.type = "sine";
    const kg = ctx.createGain();
    const kt = hum();
    kick.frequency.setValueAtTime(90, kt);
    kick.frequency.exponentialRampToValueAtTime(45, kt + 0.09);
    kg.gain.setValueAtTime(0.0001, kt);
    kg.gain.linearRampToValueAtTime(p.kickAmp, kt + 0.005);
    kg.gain.exponentialRampToValueAtTime(0.0001, kt + 0.13);
    kick.connect(kg);
    kg.connect(layerBeat);
    kick.start(kt);
    kick.stop(kt + 0.2);
    kick.onended = () => {
      try {
        kick.disconnect();
        kg.disconnect();
      } catch {}
    };
    beatCount++;
  }
  if (inBar === 1 || inBar === 3) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    bp.Q.value = 1.2;
    const sg = ctx.createGain();
    const st = hum();
    sg.gain.setValueAtTime(0.0001, st);
    sg.gain.linearRampToValueAtTime(0.025, st + 0.004);
    sg.gain.exponentialRampToValueAtTime(0.0001, st + 0.05);
    src.connect(bp);
    bp.connect(sg);
    sg.connect(layerBeat);
    src.start(st, r() * 1.5);
    src.stop(st + 0.08);
    src.onended = () => {
      try {
        src.disconnect();
        bp.disconnect();
        sg.disconnect();
      } catch {}
    };
    beatCount++;
  }

  if (r() < 0.75) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const hg = ctx.createGain();
    const ht = t + beatDur * p.swing + (r() * 0.016 - 0.008);
    hg.gain.setValueAtTime(0.0001, ht);
    hg.gain.linearRampToValueAtTime(0.012 + r() * 0.008, ht + 0.003);
    hg.gain.exponentialRampToValueAtTime(0.0001, ht + 0.03);
    src.connect(hp);
    hp.connect(hg);
    hg.connect(layerBeat);
    src.start(ht, r() * 1.5);
    src.stop(ht + 0.05);
    src.onended = () => {
      try {
        src.disconnect();
        hp.disconnect();
        hg.disconnect();
      } catch {}
    };
    beatCount++;
  }
  if (r() < p.ghostProb) {
    const kick = ctx.createOscillator();
    kick.type = "sine";
    const kg = ctx.createGain();
    const kt = t + beatDur * 0.75;
    kick.frequency.setValueAtTime(80, kt);
    kick.frequency.exponentialRampToValueAtTime(44, kt + 0.08);
    kg.gain.setValueAtTime(0.0001, kt);
    kg.gain.linearRampToValueAtTime(p.kickAmp * 0.45, kt + 0.005);
    kg.gain.exponentialRampToValueAtTime(0.0001, kt + 0.11);
    kick.connect(kg);
    kg.connect(layerBeat);
    kick.start(kt);
    kick.stop(kt + 0.18);
    kick.onended = () => {
      try {
        kick.disconnect();
        kg.disconnect();
      } catch {}
    };
    beatCount++;
  }
}

function schedulePop(t, p) {
  const r = eventRnd;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 2500;
  const g = ctx.createGain();
  const base = engine === "anterior" ? 0.015 + r() * 0.045 : 0.007 + r() * 0.02;
  const amp = base * p.popScale;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(amp, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.006);
  src.connect(hp);
  hp.connect(g);
  g.connect(layerHiss);
  if (engine === "anterior") {
    if (r() < 0.2) g.connect(eventDelay);
  } else if (r() < 0.08) {
    g.connect(echoSend);
  }
  src.start(t, r() * 1.5);
  src.stop(t + 0.04);
  src.onended = () => {
    try {
      src.disconnect();
      hp.disconnect();
      g.disconnect();
    } catch {}
  };
  popCount++;
}

function scheduleNoteClassic(t, f, dur, amp, p, viaDelay) {
  const r = eventRnd;
  const short = dur < 0.25;
  const attack = short ? 0.006 : 0.35;
  const rel = short ? 0.05 : 1.6;
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  wowDepth.connect(osc.detune);
  flutterDepth.connect(osc.detune);
  osc.frequency.setValueAtTime(f * 1.015, t);
  osc.frequency.exponentialRampToValueAtTime(f, t + 0.06);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = short ? 2600 : 1800;
  lp.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(amp, t + attack);
  if (!short) g.gain.setValueAtTime(amp, t + Math.max(attack + 0.05, dur * 0.5));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + rel);
  osc.connect(lp);
  lp.connect(g);
  g.connect(layerMel);
  if (viaDelay) g.connect(eventDelay);

  let sq = null;
  let sqLP = null;
  if (p.normSat > 0.5) {
    sq = ctx.createOscillator();
    sq.type = "square";
    sq.frequency.setValueAtTime(f, t);
    sqLP = ctx.createBiquadFilter();
    sqLP.type = "lowpass";
    sqLP.frequency.value = 1000;
    sqLP.Q.value = 0.8;
    sq.connect(sqLP);
    sqLP.connect(g);
    sq.start(t);
    sq.stop(t + dur + rel + 0.1);
  }

  if (!short && r() < p.pDrop) {
    const dOsc = ctx.createOscillator();
    dOsc.type = "triangle";
    const dLP = ctx.createBiquadFilter();
    dLP.type = "lowpass";
    const dG = ctx.createGain();
    const dt = t + dur * 0.6;
    const dDur = 0.35;
    dOsc.frequency.setValueAtTime(f, dt);
    dOsc.frequency.exponentialRampToValueAtTime(f * 0.55, dt + dDur);
    dLP.frequency.setValueAtTime(1400, dt);
    dLP.frequency.exponentialRampToValueAtTime(300, dt + dDur);
    dG.gain.setValueAtTime(0.0001, dt);
    dG.gain.linearRampToValueAtTime(amp * 0.6, dt + 0.02);
    dG.gain.exponentialRampToValueAtTime(0.0001, dt + dDur);
    dOsc.connect(dLP);
    dLP.connect(dG);
    dG.connect(layerMel);
    if (viaDelay) dG.connect(eventDelay);
    dOsc.start(dt);
    dOsc.stop(dt + dDur + 0.1);
    dOsc.onended = () => {
      try {
        dOsc.disconnect();
        dLP.disconnect();
        dG.disconnect();
      } catch {}
    };
    glitchCount++;
  }

  osc.start(t);
  osc.stop(t + dur + rel + 0.1);
  osc.onended = () => {
    try {
      osc.disconnect();
      lp.disconnect();
      g.disconnect();
      wowDepth.disconnect(osc.detune);
      flutterDepth.disconnect(osc.detune);
      if (sq) sq.disconnect();
      if (sqLP) sqLP.disconnect();
    } catch {}
  };
  noteCount++;
}

function schedulePhraseClassic(t, p) {
  const r = eventRnd;
  const short = p.mode === "grain";
  const viaDelay = p.mode === "diffraction";
  const beatDur = 60 / p.bpm;
  const baseSemi = p.chordRootSemi + p.hueSemi;
  let semi = snapPent(baseSemi) + 24;
  const amp = 0.04 + r() * 0.04;
  let tt = t;

  if (r() < p.pStutter) {
    const n = 3 + Math.floor(r() * 4);
    const step = beatDur / 4;
    for (let i = 0; i < n; i++) {
      scheduleNoteClassic(tt + i * step, BASE_HZ * Math.pow(2, semi / 12), 0.08, amp * 0.7, p, viaDelay);
    }
    tt += n * step;
    glitchCount++;
  }
  if (r() < p.pRetrig) {
    scheduleNoteClassic(tt, BASE_HZ * Math.pow(2, (semi + 12) / 12), 0.09, amp * 0.6, p, viaDelay);
    scheduleNoteClassic(
      tt + beatDur / 4,
      BASE_HZ * Math.pow(2, (semi - 12) / 12),
      0.09,
      amp * 0.6,
      p,
      viaDelay
    );
    tt += beatDur / 2;
    glitchCount++;
  }

  const n = short ? 2 + Math.floor(r() * 3) : 1 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const dur = short ? 0.12 + r() * 0.2 : 1.2 + r() * 2.6;
    scheduleNoteClassic(tt, BASE_HZ * Math.pow(2, semi / 12), dur, amp, p, viaDelay);
    const step = SCALE[Math.floor(r() * SCALE.length)] + 12 * (r() < 0.7 ? 0 : 1);
    semi += r() < 0.5 ? step : -Math.floor(r() * 4) * 2;
    while (semi > 48) semi -= 12;
    while (semi < 24) semi += 12;
    tt += dur * 0.7 + r() * 1.5;
  }
}

function scheduleStep(t, idx, p, breathe, stepDur) {
  const r = eventRnd;
  if (!pat.on[idx]) return;
  const density = clamp01(p.density * breathe);
  if (r() > density) return;
  const wave = idx % 2 === 0 ? "square" : "sawtooth";
  const semi =
    snapPent(p.chordRootSemi + p.hueSemi + SCALE[pat.deg[idx]]) + 12 * (1 + pat.oct[idx]);
  const f = BASE_HZ * Math.pow(2, semi / 12);
  const amp = (0.05 + r() * 0.03) * pat.amp[idx];

  if (r() < p.pStutter * breathe) {
    const n = 3 + Math.floor(r() * 4);
    const sub = stepDur / 4;
    for (let i = 0; i < n; i++) {
      scheduleBlip(t + i * sub, f, 0.05, amp * 0.7, wave, p);
    }
    glitchCount++;
    return;
  }
  if (r() < p.pLaser * breathe) {
    scheduleLaser(t, f);
    return;
  }
  if (r() < p.pExpl * breathe) {
    scheduleExplosion(t);
    return;
  }
  if (r() < 0.12 + p.ufoProb * breathe * 5) {
    scheduleUfo(t, p);
    return;
  }
  if (r() < p.arpProb) {
    const n = 4;
    const dir = r() < 0.5 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const ai = (idx + i * dir + STEPS * 2) % SCALE.length;
      const af = BASE_HZ * Math.pow(2, (snapPent(p.chordRootSemi + SCALE[ai]) + 36) / 12);
      scheduleBlip(t + (i * stepDur) / 2, af, 0.06, amp * 0.65, "square", p);
    }
    return;
  }
  if (r() < 0.1) {
    scheduleBlip(t, f, 0.8 + r() * 0.8, amp * 0.8, "sawtooth", p, { contour: true });
    return;
  }
  scheduleBlip(t, f, 0.08 + r() * 0.17, amp, wave, p);
  if (r() < p.pRetrig * 0.6) {
    scheduleBlip(t + stepDur / 4, f * 2, 0.05, amp * 0.6, "square", p);
    glitchCount++;
  }
}

function retuneChord(t, p) {
  const pattern = p.chordIsMaj7 ? CHORD_MAJ7 : CHORD_M7;
  const root = p.chordRootSemi + 12;
  for (let i = 0; i < 4; i++) {
    const semi = root + pattern[i];
    const f = BASE_HZ * Math.pow(2, semi / 12);
    const tt = t + i * 0.15;
    chordOscs[i].frequency.setTargetAtTime(f, tt, 0.12);
    chordGains[i].gain.setTargetAtTime(0.05, tt, 1.2);
    chordGains[i].gain.setTargetAtTime(0.0001, tt + 6.5, 1.5);
  }
  chordCount++;
}

function schedLoop() {
  if (!ctx || !running) return;
  const now = ctx.currentTime;
  const until = now + LOOKAHEAD_S;
  const p = curParams;
  if (!p) return;
  const breathe = 1 + 0.4 * Math.sin(now * 2 * Math.PI * 0.06);
  const beatDur = 60 / p.bpm;
  const stepDur = beatDur / 4;

  if (nextBeatTime < now) nextBeatTime = now + 0.05;
  while (nextBeatTime < until) {
    scheduleBeat(nextBeatTime, beatInBar, p);
    beatInBar = (beatInBar + 1) % 4;
    beatWalk = clamp(beatWalk + (eventRnd() - 0.5) * 0.012, -0.025, 0.025);
    nextBeatTime += beatDur * (1 + beatWalk + (eventRnd() * 0.04 - 0.02));
  }

  if (engine === "anterior") {
    nextStepTime = until;
    if (nextMelTime < now) nextMelTime = now + 1.5;
    while (nextMelTime < until) {
      schedulePhraseClassic(nextMelTime, p);
      nextMelTime += Math.max(1.4, (3.5 + eventRnd() * 5) / p.melRate);
    }
  } else {
    nextMelTime = until;
    if (nextStepTime < now) nextStepTime = now + 0.05;
    while (nextStepTime < until) {
      scheduleStep(nextStepTime, stepIdx, p, breathe, stepDur);
      stepIdx = (stepIdx + 1) % STEPS;
      stepWalk = clamp(stepWalk + (eventRnd() - 0.5) * 0.014, -0.03, 0.03);
      nextStepTime += stepDur * (1 + stepWalk + (eventRnd() * 0.01 - 0.005));
    }
  }

  if (nextPopTime < now) nextPopTime = now + 0.3;
  while (nextPopTime < until) {
    schedulePop(nextPopTime, p);
    nextPopTime += (0.6 + eventRnd() * 3.5) * p.popGap;
  }

  if (p.bellRate > 0) {
    if (nextBellTime < now) nextBellTime = now + 1;
    while (nextBellTime < until) {
      if (eventRnd() < 0.7) scheduleBell(nextBellTime);
      nextBellTime += (1.2 + eventRnd() * 3) / p.bellRate;
    }
  } else {
    nextBellTime = until;
  }

  if (nextChordTime < now) nextChordTime = now + 0.1;
  while (nextChordTime < until) {
    retuneChord(nextChordTime, p);
    nextChordTime += 8 + eventRnd() * 6;
  }
}

function startScheduler() {
  if (schedTimer) return;
  if (!eventRnd || !pat) seedScheduler(pending ? pending.seed : 1);
  nextBeatTime = ctx.currentTime + 0.15;
  nextStepTime = ctx.currentTime + 0.1;
  nextMelTime = ctx.currentTime + 1.5;
  if (nextChordTime < ctx.currentTime) nextChordTime = ctx.currentTime + 0.1;
  schedTimer = setInterval(schedLoop, TICK_MS);
}

function stopScheduler() {
  if (schedTimer) {
    clearInterval(schedTimer);
    schedTimer = null;
  }
}

function apply(force = false) {
  if (!ctx || !pending) return false;
  if (!force && ctx.currentTime - lastApply < UPDATE_S) return false;
  lastApply = ctx.currentTime;
  const p = compute(pending);
  curParams = p;
  const t = ctx.currentTime;
  const seed = pending.seed >>> 0;
  const mode = p.mode;
  if (seed !== lastSeed || mode !== lastMode) {
    lastSeed = seed;
    lastMode = mode;
    seedScheduler(seed);
  }
  for (let i = 0; i < MAX_VOICES; i++) {
    const v = voices[i];
    const q = p.voices[i];
    if (q) {
      shWalk[i] = clamp(shWalk[i] * 0.85 + (Math.random() - 0.5) * 30, -40, 40);
      v.osc.frequency.setTargetAtTime(q.f, t, 0.3);
      v.osc.detune.setTargetAtTime(q.detune + shWalk[i], t, 0.3);
      v.sub.frequency.setTargetAtTime(q.f / 2, t, 0.3);
      v.sub.detune.setTargetAtTime(shWalk[i] * 0.6, t, 0.3);
      v.gain.gain.setTargetAtTime(q.gain, t, 0.25);
      v.subGain.gain.setTargetAtTime(q.gain * 0.5, t, 0.25);
    } else {
      v.gain.gain.setTargetAtTime(0, t, 0.25);
      v.subGain.gain.setTargetAtTime(0, t, 0.25);
    }
  }
  focusLP.frequency.setTargetAtTime(p.cutoff, t, 0.2);
  wowDepth.gain.setTargetAtTime(p.wow, t, 0.3);
  const effBits = engine === "anterior" ? 8 : clamp(p.bits, 3, 8);
  if (effBits !== lastBits) {
    lastBits = effBits;
    melShaper.curve = makeBitCurve(effBits);
  }
  if (hissLPNode) {
    hissLPNode.frequency.setTargetAtTime(engine === "arcade" ? 4800 : 6500, t, 0.2);
  }
  if (pwr2Depth) {
    pwr2Depth.gain.setTargetAtTime(engine === "arcade" ? 0.0006 : 0.0015, t, 0.2);
  }
  layerPad.gain.setTargetAtTime(p.layers.pad, t, 0.3);
  layerBeat.gain.setTargetAtTime(p.layers.beat, t, 0.3);
  layerHiss.gain.setTargetAtTime(p.hissGain, t, 0.3);
  layerMel.gain.setTargetAtTime(p.layers.mel, t, 0.3);
  layerChord.gain.setTargetAtTime(p.layers.chord, t, 0.3);
  const gateOn = engine === "anterior" ? p.mode === "grain" || p.normSat > 0.6 : p.mode === "grain";
  melGate.gain.setTargetAtTime(gateOn ? 0.5 : 1, t, 0.05);
  melGateDepth.gain.setTargetAtTime(gateOn ? 0.5 : 0, t, 0.05);
  melGateLFO.frequency.setTargetAtTime((p.bpm * 8) / 60, t, 0.1);
  return true;
}

export function updateAudio(snapshot) {
  pending = snapshot;
  if (ctx) apply();
}

export async function startAudio() {
  const c = ensureContext();
  if (!c) return false;
  if (c.state === "suspended") {
    try {
      await c.resume();
    } catch {
      return false;
    }
  }
  if (running) return true;
  running = true;
  const t = c.currentTime;
  gate.gain.cancelScheduledValues(t);
  gate.gain.setValueAtTime(1, t);
  master.gain.cancelScheduledValues(t);
  master.gain.setValueAtTime(master.gain.value, t);
  master.gain.linearRampToValueAtTime(muted ? 0 : volume, t + 0.3);
  apply(true);
  startScheduler();
  return true;
}

export function stopAudio() {
  if (!ctx || !running) return;
  running = false;
  stopScheduler();
  const t = ctx.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setValueAtTime(master.gain.value, t);
  master.gain.linearRampToValueAtTime(0, t + 0.3);
}

export function toggleMute() {
  muted = !muted;
  if (ctx) {
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(!muted && running ? volume : 0, t, 0.05);
  }
  return muted;
}

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  if (ctx) {
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(!muted && running ? volume : 0, t, 0.05);
  }
  return volume;
}

export function isMuted() {
  return muted;
}

export function isRunning() {
  return running;
}

export function setEngine(name) {
  if (name !== "anterior" && name !== "arcade") return engine;
  if (name === engine) return engine;
  engine = name;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem("luminoise_engine", engine);
  } catch {}
  if (ctx && running) {
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(muted ? 0 : volume * 0.55, t + 0.1);
    master.gain.linearRampToValueAtTime(muted ? 0 : volume, t + 0.25);
    nextMelTime = t + 0.15;
    nextStepTime = t + 0.15;
  }
  if (ctx) apply(true);
  return engine;
}

export function getEngine() {
  return engine;
}

export function debug() {
  const activeNext = engine === "anterior" ? nextMelTime : nextStepTime;
  return {
    hasCtx: Boolean(ctx),
    state: ctx ? ctx.state : null,
    running,
    muted,
    volume,
    engine,
    shaperBits: lastBits,
    hasSnapshot: Boolean(pending),
    scheduler: {
      active: Boolean(schedTimer),
      beats: beatCount,
      steps: stepCount,
      notes: noteCount,
      pops: popCount,
      bells: bellCount,
      chords: chordCount,
      glitches: glitchCount,
      ufos: ufoCount,
      bpm: curParams ? Number(curParams.bpm.toFixed(1)) : null,
      mode: curParams ? curParams.mode : null,
      relNext:
        ctx && schedTimer ? Math.max(0, Number((activeNext - ctx.currentTime).toFixed(3))) : null,
    },
    ...(pending ? compute(pending) : {}),
  };
}
