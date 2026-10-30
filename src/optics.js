import { labDist } from "./color.js";

export function createOptics(beams, { focus = 0.4, step = 4, seed = 1, gridW, gridH } = {}) {
  for (const f of beams) {
    f.vx = 0;
    f.vy = 0;
  }
  return { focus, step, seed, gridW, gridH, t: 0 };
}

function buildHash(n, cxs, cys, cell) {
  let gx0 = Infinity;
  let gy0 = Infinity;
  let gx1 = -Infinity;
  let gy1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const gx = Math.floor(cxs[i] / cell);
    const gy = Math.floor(cys[i] / cell);
    if (gx < gx0) gx0 = gx;
    if (gx > gx1) gx1 = gx;
    if (gy < gy0) gy0 = gy;
    if (gy > gy1) gy1 = gy;
  }
  const spanX = gx1 - gx0 + 3;
  const spanY = gy1 - gy0 + 3;
  const buckets = new Array(spanX * spanY);
  const col = new Int32Array(n);
  const row = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const gx = Math.floor(cxs[i] / cell);
    const gy = Math.floor(cys[i] / cell);
    const ci = gx - gx0 + 1;
    const ri = gy - gy0 + 1;
    col[i] = ci;
    row[i] = ri;
    const slot = ri * spanX + ci;
    let bucket = buckets[slot];
    if (!bucket) {
      bucket = [];
      buckets[slot] = bucket;
    }
    bucket.push(i);
  }
  return { buckets, col, row, spanX, spanY };
}

export function propagate(beams, optics) {
  const { focus, step, gridW, gridH, t } = optics;
  const radius = Math.max(gridW, gridH) * 0.25;
  const damping = 0.84;
  const springK = 0.04;
  const noiseAmp = 0.05;
  const repel = 0.08;
  const quant = Math.max(1, step * 0.5);

  const n = beams.length;
  if (!n) {
    optics.t += 1;
    return;
  }

  const cxs = new Float64Array(n);
  const cys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    cxs[i] = beams[i].x + beams[i].w / 2;
    cys[i] = beams[i].y + beams[i].h / 2;
  }

  const cell = Math.max(radius, 1e-6);
  const { buckets, col, row, spanX, spanY } = buildHash(n, cxs, cys, cell);

  const ax = new Float64Array(n);
  const ay = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const f = beams[i];
    const ci = col[i];
    const ri = row[i];
    const c0 = ci > 0 ? ci - 1 : 0;
    const c1 = ci < spanX - 1 ? ci + 1 : spanX - 1;
    const r0 = ri > 0 ? ri - 1 : 0;
    const r1 = ri < spanY - 1 ? ri + 1 : spanY - 1;
    for (let ry = r0; ry <= r1; ry++) {
      const rowBase = ry * spanX;
      for (let cx = c0; cx <= c1; cx++) {
        const bucket = buckets[rowBase + cx];
        if (!bucket) continue;
        for (let b = 0; b < bucket.length; b++) {
          const j = bucket[b];
          if (j === i) continue;
          const g = beams[j];
          const dx = cxs[j] - cxs[i];
          const dy = cys[j] - cys[i];
          if (Math.abs(dx) > radius || Math.abs(dy) > radius) continue;

          const d2 = labDist(f.lab, g.lab);
          const dist = Math.hypot(dx, dy) + 1e-6;
          const pull = focus * 0.025 * Math.exp(-d2 / 900);
          ax[i] += (dx / dist) * pull;
          ay[i] += (dy / dist) * pull;

          const minDist = (f.w + g.w + f.h + g.h) * 0.22;
          if (dist < minDist) {
            const push = repel * ((minDist - dist) / minDist);
            ax[i] -= (dx / dist) * push;
            ay[i] -= (dy / dist) * push;
          }
        }
      }
    }
  }

  for (let i = 0; i < n; i++) {
    const f = beams[i];
    const qxMax = Math.max(0, Math.floor((gridW - f.w) / quant));
    const qyMax = Math.max(0, Math.floor((gridH - f.h) / quant));
    const oqx = Math.min(qxMax, Math.max(0, Math.round(f.ox / quant))) * quant;
    const oqy = Math.min(qyMax, Math.max(0, Math.round(f.oy / quant))) * quant;
    ax[i] += (oqx - f.x) * springK;
    ay[i] += (oqy - f.y) * springK;

    const nt = t * 0.18 + f.id * 0.41;
    ax[i] += Math.sin(nt * 1.7 + f.x * 0.35) * noiseAmp;
    ay[i] += Math.cos(nt * 1.3 + f.y * 0.35) * noiseAmp;

    f.vx = (f.vx + ax[i]) * damping;
    f.vy = (f.vy + ay[i]) * damping;

    const nx = f.x + f.vx * step;
    const ny = f.y + f.vy * step;

    f.x = Math.max(0, Math.min(gridW - f.w, Math.round(nx / quant) * quant));
    f.y = Math.max(0, Math.min(gridH - f.h, Math.round(ny / quant) * quant));
  }

  optics.t += 1;
}

export function meanDeltaE(beams) {
  if (beams.length < 2) return 0;
  let sum = 0;
  let count = 0;
  const sample = Math.min(beams.length, 60);
  for (let i = 0; i < sample; i++) {
    const a = beams[(i * 17) % beams.length];
    const b = beams[(i * 31 + 7) % beams.length];
    sum += Math.sqrt(labDist(a.lab, b.lab));
    count += 1;
  }
  return count ? sum / count : 0;
}
