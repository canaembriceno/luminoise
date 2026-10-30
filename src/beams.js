import { mulberry32, rgbToLab } from "./color.js";

export function extractBeams(spectrum, { minArea = 2, density = 0.55, dispersion = 0.15, seed = 1 } = {}) {
  const { gridW, gridH, colors } = spectrum;
  const n = gridW * gridH;
  const label = new Int32Array(n).fill(-1);
  const beams = [];
  let id = 0;

  for (let i = 0; i < n; i++) {
    if (label[i] !== -1) continue;
    const color = colors[i];
    if (!color) {
      label[i] = -2;
      continue;
    }
    const stack = [i];
    label[i] = id;
    let minX = i % gridW;
    let maxX = minX;
    let minY = (i / gridW) | 0;
    let maxY = minY;
    let filled = 0;

    while (stack.length) {
      const p = stack.pop();
      filled += 1;
      const x = p % gridW;
      const y = (p / gridW) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const tryPush = (q) => {
        if (q < 0 || q >= n || label[q] !== -1) return;
        const c = colors[q];
        if (!c || c[0] !== color[0] || c[1] !== color[1] || c[2] !== color[2]) return;
        label[q] = id;
        stack.push(q);
      };

      if (x > 0) tryPush(p - 1);
      if (x < gridW - 1) tryPush(p + 1);
      if (y > 0) tryPush(p - gridW);
      if (y < gridH - 1) tryPush(p + gridW);
    }

    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const area = w * h;
    if (area >= minArea && filled >= minArea) {
      const beam = {
        id,
        x0: minX,
        y0: minY,
        w,
        h,
        area,
        filled,
        color,
        lab: rgbToLab(color[0], color[1], color[2]),
        ox: minX,
        oy: minY,
        x: minX,
        y: minY,
        vx: 0,
        vy: 0,
        kind: classify(w, h, filled),
        nest: nestDepth(w, h),
        strip: minY + h >= gridH - 1 && h <= 3,
      };
      beams.push(beam);
    }
    id += 1;
  }

  beams.sort((a, b) => b.area - a.area);

  const rnd = mulberry32(seed * 9973 + 17);
  const totalCells = gridW * gridH;
  const target = totalCells * density;
  const kept = [];
  const used = new Set();
  let coverage = 0;

  const keep = (f) => {
    kept.push(f);
    used.add(f.id);
    coverage += f.filled;
  };

  const circleTarget = target * 0.1;
  let circleCov = 0;
  let circleCount = 0;
  if (target > 0) {
    for (const f of beams) {
      if (f.kind !== "circle") continue;
      if (circleCov >= circleTarget && circleCount >= 3) break;
      keep(f);
      circleCov += f.filled;
      circleCount++;
    }

    const chainTarget = target * 0.15;
    let chainCov = 0;
    for (const f of beams) {
      if (chainCov >= chainTarget) break;
      if (used.has(f.id) || f.kind === "circle" || f.w > 8 || f.h > 8) continue;
      keep(f);
      chainCov += f.filled;
    }
  }

  for (const f of beams) {
    if (used.has(f.id)) continue;
    if (coverage < target) {
      keep(f);
    } else if (f.area <= 6 && rnd() < density * 0.12) {
      keep(f);
    }
  }

  kept.sort((a, b) => b.area - a.area);
  if (!kept.length && beams.length) kept.push(beams[0]);

  if (dispersion > 0) {
    for (const f of kept) {
      const dx = (rnd() * 2 - 1) * dispersion * gridW * 0.35;
      const dy = (rnd() * 2 - 1) * dispersion * gridH * 0.35;
      f.x = Math.max(0, Math.min(gridW - f.w, f.ox + dx));
      f.y = Math.max(0, Math.min(gridH - f.h, f.oy + dy));
      f.x0 = Math.round(f.x);
      f.y0 = Math.round(f.y);
    }
  }

  markChains(kept, gridW);
  return kept;
}

function classify(w, h, filled) {
  const area = w * h;
  if (area <= 0) return "rect";
  const ratio = filled / area;
  const sideDiff = Math.abs(w - h);
  if (sideDiff <= 1 && w >= 3 && ratio > 0.68 && ratio < 0.88) return "circle";
  if (w >= 4 && h >= 4 && ratio > 0.92) return "square";
  return "rect";
}

function nestDepth(w, h) {
  const m = Math.min(w, h);
  if (m >= 10) return 3;
  if (m >= 6) return 2;
  if (m >= 4) return 1;
  return 0;
}

function markChains(beams, gridW) {
  const maxDist = Math.max(24, gridW * 0.55);
  const maxLabD = 100;
  const minRatio = 0.35;
  const small = beams.filter((f) => f.w <= 8 && f.h <= 8 && f.kind !== "circle");
  const used = new Set();
  const labD = (a, b) =>
    Math.abs(a.lab[0] - b.lab[0]) +
    Math.abs(a.lab[1] - b.lab[1]) +
    Math.abs(a.lab[2] - b.lab[2]);
  const areaRatio = (a, b) => Math.min(a.area, b.area) / Math.max(a.area, b.area);

  for (const f of small) {
    if (used.has(f.id)) continue;
    const members = [f];
    let cur = f;
    for (let k = 0; k < 8; k++) {
      let best = null;
      let bestScore = Infinity;
      for (const g of small) {
        if (g.id === f.id || used.has(g.id)) continue;
        if (labD(cur, g) > maxLabD) continue;
        if (areaRatio(cur, g) < minRatio) continue;
        const dx = g.ox - cur.ox;
        const dy = g.oy - cur.oy;
        const dist = Math.hypot(dx, dy);
        if (dist < 1 || dist > maxDist) continue;
        const cardinal = dx === 0 || dy === 0 ? 2 : 0;
        const score = dist + cardinal;
        if (score < bestScore) {
          bestScore = score;
          best = g;
        }
      }
      if (!best) break;
      used.add(best.id);
      members.push(best);
      cur = best;
    }
    if (members.length >= 4) {
      f.chain = members.length;
      f.chainMembers = members;
    }
    used.add(f.id);
  }
}

export function coverageRatio(beams, gridW, gridH) {
  let a = 0;
  for (const f of beams) a += f.filled;
  return a / Math.max(1, gridW * gridH);
}
