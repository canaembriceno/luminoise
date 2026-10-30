export function expose(
  ctx,
  canvas,
  spectrum,
  beams,
  {
    mode = "continuous",
    halos = true,
    halosPct = 100,
    streaks = true,
    maxStreaks = 40,
    shadows = true,
    shadowChains = 1,
    frame = 0,
  } = {},
) {
  const { gridW, gridH } = spectrum;
  const sx = canvas.width / gridW;
  const sy = canvas.height / gridH;
  const pal = spectrum.palette || [];

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  const ground = groundColor(spectrum);

  if (mode === "grain") {
    drawGrainField(ctx, canvas, spectrum, frame);
  } else if (mode === "glass") {
    drawGlass(ctx, spectrum, sx, sy);
    drawBeams(ctx, beams, sx, sy, { hard: true, pal, canvas });
  } else if (mode === "diffraction") {
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawBeams(ctx, beams, sx, sy, { hard: true, pal, canvas });
  } else {
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawBeamsPlain(ctx, beams, sx, sy);
  }

  if (halos) drawHalosLayer(ctx, beams, sx, sy, halosPct);
  if (streaks) drawStreaks(ctx, beams, sx, sy, maxStreaks, gridW);
  if (shadows) {
    drawShadowChains(ctx, beams, sx, sy, shadowChains);
    drawShadowLine(ctx, canvas, beams, sx, sy);
  }

  ctx.restore();
}

function groundColor(spectrum) {
  if (spectrum.palette && spectrum.palette.length) {
    const p = spectrum.palette[0];
    return `rgb(${p[0]},${p[1]},${p[2]})`;
  }
  return "#1a1a20";
}

function rgbCss(c) {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function invertCss(c) {
  return `rgb(${255 - c[0]},${255 - c[1]},${255 - c[2]})`;
}

function drawBeamsPlain(ctx, beams, sx, sy) {
  for (const f of beams) {
    if (f.kind === "circle") continue;
    const x = Math.floor(f.x * sx);
    const y = Math.floor(f.y * sy);
    const w = Math.max(1, Math.ceil(f.w * sx));
    const h = Math.max(1, Math.ceil(f.h * sy));
    const [r, g, b] = f.color;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y, w, h);

    if (f.w >= 4 && f.h >= 4 && f.id % 5 === 0) {
      ctx.fillStyle = `rgb(${255 - r},${255 - g},${255 - b})`;
      ctx.fillRect(x + Math.floor(sx * 0.5), y + Math.floor(sy * 0.5), Math.max(1, w - Math.ceil(sx)), Math.max(1, h - Math.ceil(sy)));
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x + Math.ceil(sx), y + Math.ceil(sy), Math.max(1, w - Math.ceil(sx) * 2), Math.max(1, h - Math.ceil(sy) * 2));
    }
  }
}

function drawBeams(ctx, beams, sx, sy, { hard = true, pal = [], canvas = null } = {}) {
  for (const f of beams) {
    ctx.fillStyle = rgbCss(f.color);

    if (f.parts && f.parts.length) {
      const ox = f.x * sx;
      const oy = f.y * sy;
      for (const p of f.parts) {
        const x = Math.floor(ox + p.x * sx);
        const y = Math.floor(oy + p.y * sy);
        const w = Math.max(1, Math.ceil(p.w * sx));
        const h = Math.max(1, Math.ceil(p.h * sy));
        ctx.fillRect(x, y, w, h);
      }
      continue;
    }

    if (f.kind === "circle") continue;

    const x = Math.floor(f.x * sx);
    const y = Math.floor(f.y * sy);
    const w = Math.max(1, Math.ceil(f.w * sx));
    const h = Math.max(1, Math.ceil(f.h * sy));
    ctx.fillRect(x, y, w, h);

    if (hard && f.nest > 0 && w >= 4 && h >= 4) {
      drawNested(ctx, x, y, w, h, f, sx, sy, pal);
    }

    if (f.strip && canvas) {
      const stripH = Math.max(2, Math.ceil(sy * 2));
      ctx.fillStyle = invertCss(f.color);
      const sxPos = Math.floor(f.x * sx);
      const sw = Math.max(1, Math.ceil(f.w * sx));
      ctx.fillRect(sxPos, canvas.height - stripH, sw, stripH);
      ctx.fillStyle = rgbCss(f.color);
    }
  }
}

function drawNested(ctx, x, y, w, h, f, sx, sy, pal) {
  const levels = f.nest;
  let cx = x;
  let cy = y;
  let cw = w;
  let ch = h;
  for (let i = 0; i < levels; i++) {
    const inx = Math.max(1, Math.ceil(sx));
    const iny = Math.max(1, Math.ceil(sy));
    if (cw - inx * 2 < 1 || ch - iny * 2 < 1) break;
    if (i % 2 === 0) {
      ctx.fillStyle = invertCss(f.color);
    } else if (pal.length > 1) {
      const alt = pal[(f.id + i) % pal.length];
      ctx.fillStyle = rgbCss(alt);
    } else {
      ctx.fillStyle = rgbCss(f.color);
    }
    ctx.fillRect(cx + inx, cy + iny, cw - inx * 2, ch - iny * 2);
    cx += inx;
    cy += iny;
    cw -= inx * 2;
    ch -= iny * 2;
  }
  ctx.fillStyle = rgbCss(f.color);
}

function drawHalo(ctx, f, sx, sy) {
  const cx = (f.x + f.w / 2) * sx;
  const cy = (f.y + f.h / 2) * sy;
  const rx = (f.w * sx) / 2;
  const ry = (f.h * sy) / 2;
  ctx.fillStyle = rgbCss(f.color);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  if (f.w >= 4) {
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = Math.max(1, Math.floor(sx * 0.35));
    ctx.stroke();
  }
}

function drawHalosLayer(ctx, beams, sx, sy, pct = 100) {
  if (pct <= 0) return;
  const halos = beams.filter((f) => f.kind === "circle");
  if (!halos.length) return;
  halos.sort((a, b) => b.area - a.area);
  const n = Math.max(1, Math.ceil((halos.length * pct) / 100));
  for (let i = 0; i < n && i < halos.length; i++) {
    drawHalo(ctx, halos[i], sx, sy);
  }
}

function drawGlass(ctx, spectrum, sx, sy) {
  const { gridW, gridH, colors } = spectrum;
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const c = colors[y * gridW + x];
      if (!c) continue;
      ctx.fillStyle = rgbCss(c);
      ctx.fillRect(Math.floor(x * sx), Math.floor(y * sy), Math.ceil(sx), Math.ceil(sy));
    }
  }
}

function drawStreaks(ctx, beams, sx, sy, maxLines, gridW) {
  if (beams.length < 2 || maxLines <= 0) return;
  const sorted = [...beams].sort((a, b) => b.area - a.area);
  const k = Math.min(maxLines, sorted.length);
  const maxDist = gridW * 0.3;
  const maxDE = 30;
  const seen = new Set();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(120,90,50,0.55)";
  ctx.beginPath();
  let count = 0;
  for (let i = 0; i < k && count < maxLines; i++) {
    const a = sorted[i];
    let bestForm = null;
    let bestKey = null;
    let bestScore = Infinity;
    for (const b of beams) {
      if (b === a) continue;
      const colorD =
        Math.abs(a.lab[0] - b.lab[0]) +
        Math.abs(a.lab[1] - b.lab[1]) +
        Math.abs(a.lab[2] - b.lab[2]);
      if (colorD > maxDE) continue;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist > maxDist) continue;
      const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
      if (seen.has(key)) continue;
      const score = colorD + dist * 2.5;
      if (score < bestScore) {
        bestScore = score;
        bestForm = b;
        bestKey = key;
      }
    }
    if (!bestForm) continue;
    seen.add(bestKey);
    ctx.moveTo((a.x + a.w / 2) * sx, (a.y + a.h / 2) * sy);
    ctx.lineTo((bestForm.x + bestForm.w / 2) * sx, (bestForm.y + bestForm.h / 2) * sy);
    count += 1;
  }
  ctx.stroke();
}

function drawShadowLine(ctx, canvas, beams, sx, sy) {
  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  ctx.lineWidth = Math.max(2, Math.floor(canvas.height * 0.005));
  ctx.beginPath();
  if (beams.length) {
    const top = [...beams].sort((a, b) => b.area - a.area).slice(0, 4);
    top.sort((a, b) => a.x - b.x);
    const first = top[0];
    const last = top[top.length - 1];
    ctx.moveTo(0, (first.y + first.h / 2) * sy);
    for (const f of top) {
      ctx.lineTo((f.x + f.w / 2) * sx, (f.y + f.h / 2) * sy);
    }
    ctx.lineTo(canvas.width, (last.y + last.h / 2) * sy);
  } else {
    ctx.moveTo(0, canvas.height * 0.25);
    ctx.lineTo(canvas.width, canvas.height * 0.7);
  }
  ctx.stroke();
}

function drawShadowChains(ctx, beams, sx, sy, maxChains) {
  if (!maxChains) return;
  const chains = beams
    .filter((f) => f.chainMembers && f.chainMembers.length >= 4)
    .sort((a, b) => b.chainMembers.length - a.chainMembers.length)
    .slice(0, maxChains);
  if (!chains.length) return;
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = Math.max(2, Math.floor(Math.min(sx, sy) * 0.6));
  ctx.lineJoin = "miter";
  ctx.beginPath();
  for (const f of chains) {
    const m = f.chainMembers;
    ctx.moveTo((m[0].x + m[0].w / 2) * sx, (m[0].y + m[0].h / 2) * sy);
    for (let i = 1; i < m.length; i++) {
      ctx.lineTo((m[i].x + m[i].w / 2) * sx, (m[i].y + m[i].h / 2) * sy);
    }
  }
  ctx.stroke();
}

function nearestIndex(pal, r, g, b) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const dr = pal[i][0] - r;
    const dg = pal[i][1] - g;
    const db = pal[i][2] - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

let fsLut = null;
let fsLutPal = null;
let fsBuf = null;

function drawGrainField(ctx, canvas, spectrum, frame = 0) {
  const { gridW, gridH, palette, imageData, colors } = spectrum;
  if (!palette?.length) return;

  const off = document.createElement("canvas");
  off.width = gridW;
  off.height = gridH;
  const octx = off.getContext("2d", { willReadFrequently: true });
  if (imageData) {
    octx.putImageData(imageData, 0, 0);
  } else {
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const c = colors?.[y * gridW + x];
        if (!c) continue;
        octx.fillStyle = rgbCss(c);
        octx.fillRect(x, y, 1, 1);
      }
    }
  }

  const W = canvas.width;
  const H = canvas.height;

  const dx = Math.sin(frame * 0.06) * W * 0.12;
  const dy = Math.cos(frame * 0.045) * H * 0.12;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(off, dx - W * 0.12, dy - H * 0.12, W * 1.24, H * 1.24);
  ctx.imageSmoothingEnabled = false;

  const px = W * H;
  const img = ctx.getImageData(0, 0, W, H);
  const out = img.data;

  if (!fsLut) fsLut = new Uint16Array(32 * 32 * 32);
  if (fsLutPal !== palette) {
    for (let r = 0; r < 32; r++) {
      const rv = (r << 3) | (r >> 2);
      for (let g = 0; g < 32; g++) {
        const gv = (g << 3) | (g >> 2);
        for (let b = 0; b < 32; b++) {
          const bv = (b << 3) | (b >> 2);
          fsLut[(r << 10) | (g << 5) | b] = nearestIndex(palette, rv, gv, bv);
        }
      }
    }
    fsLutPal = palette;
  }

  if (!fsBuf || fsBuf.length < px * 3) fsBuf = new Float32Array(px * 3);
  const buf = fsBuf;
  for (let o = 0, p = 0; o < px; o++, p += 3) {
    const i = o * 4;
    buf[p] = out[i];
    buf[p + 1] = out[i + 1];
    buf[p + 2] = out[i + 2];
  }

  for (let y = 0; y < H; y++) {
    const ltr = (y & 1) === 0;
    const step = ltr ? 1 : -1;
    const k0 = ltr ? 0 : W - 1;
    const kEnd = ltr ? W : -1;
    for (let x = k0; x !== kEnd; x += step) {
      const o = y * W + x;
      const pi = o * 4;
      const pf = o * 3;

      const r = buf[pf] < 0 ? 0 : buf[pf] > 255 ? 255 : buf[pf];
      const g = buf[pf + 1] < 0 ? 0 : buf[pf + 1] > 255 ? 255 : buf[pf + 1];
      const b = buf[pf + 2] < 0 ? 0 : buf[pf + 2] > 255 ? 255 : buf[pf + 2];

      const c = palette[fsLut[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)]];
      const er = r - c[0];
      const eg = g - c[1];
      const eb = b - c[2];

      out[pi] = c[0];
      out[pi + 1] = c[1];
      out[pi + 2] = c[2];
      out[pi + 3] = 255;

      const xr = x + step;
      const xd = x - step;
      if (xr >= 0 && xr < W) {
        const q = (y * W + xr) * 3;
        buf[q] += er * 0.4375;
        buf[q + 1] += eg * 0.4375;
        buf[q + 2] += eb * 0.4375;
      }
      if (y + 1 < H) {
        const q = ((y + 1) * W + x) * 3;
        buf[q] += er * 0.3125;
        buf[q + 1] += eg * 0.3125;
        buf[q + 2] += eb * 0.3125;
        if (xd >= 0 && xd < W) {
          const q2 = ((y + 1) * W + xd) * 3;
          buf[q2] += er * 0.1875;
          buf[q2 + 1] += eg * 0.1875;
          buf[q2 + 2] += eb * 0.1875;
        }
        if (xr >= 0 && xr < W) {
          const q3 = ((y + 1) * W + xr) * 3;
          buf[q3] += er * 0.0625;
          buf[q3 + 1] += eg * 0.0625;
          buf[q3 + 2] += eb * 0.0625;
        }
      }
    }
  }

  ctx.putImageData(img, 0, 0);
}
