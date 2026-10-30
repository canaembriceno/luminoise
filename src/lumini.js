import { boostSaturation, rgbToLab, linearToSrgb, mulberry32 } from "./color.js";

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

function labToRgb(L, a, b) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const finv = (t) => (t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787);
  const X = 0.95047 * finv(fx);
  const Y = finv(fy);
  const Z = 1.08883 * finv(fz);
  const r = 3.2406 * X - 1.5138 * Y - 0.4906 * Z;
  const g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  const bl = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(bl)];
}

function rgbToLch(r, g, b) {
  const lab = rgbToLab(r, g, b);
  const c = Math.hypot(lab[1], lab[2]);
  let h = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [lab[0], c, h];
}

function lchToRgb(L, c, h) {
  const rad = (h * Math.PI) / 180;
  return labToRgb(L, c * Math.cos(rad), c * Math.sin(rad));
}

function kuwahara(data, w, h, radius) {
  if (radius < 1) return;
  const rw = w + 1;
  const size = rw * (h + 1);
  const sumR = new Float64Array(size);
  const sumG = new Float64Array(size);
  const sumB = new Float64Array(size);
  const sumL2 = new Float64Array(size);
  for (let y = 0; y < h; y++) {
    let rowR = 0;
    let rowG = 0;
    let rowB = 0;
    let rowL2 = 0;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      rowR += r;
      rowG += g;
      rowB += b;
      rowL2 += l * l;
      const i = (y + 1) * rw + (x + 1);
      sumR[i] = sumR[i - rw] + rowR;
      sumG[i] = sumG[i - rw] + rowG;
      sumB[i] = sumB[i - rw] + rowB;
      sumL2[i] = sumL2[i - rw] + rowL2;
    }
  }
  const rect = (acc, x0, y0, x1, y1) =>
    acc[y1 * rw + x1] - acc[y0 * rw + x1] - acc[y1 * rw + x0] + acc[y0 * rw + x0];
  const out = new Uint8ClampedArray(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let bestVar = Infinity;
      let bestR = 0;
      let bestG = 0;
      let bestB = 0;
      for (let q = 0; q < 4; q++) {
        const ax = q & 1;
        const ay = q >> 1;
        const x0 = ax ? x : x - radius;
        const y0 = ay ? y : y - radius;
        const x1 = ax ? x + radius + 1 : x + 1;
        const y1 = ay ? y + radius + 1 : y + 1;
        const cx0 = x0 < 0 ? 0 : x0;
        const cy0 = y0 < 0 ? 0 : y0;
        const cx1 = x1 > w ? w : x1;
        const cy1 = y1 > h ? h : y1;
        const n = (cx1 - cx0) * (cy1 - cy0);
        if (n <= 0) continue;
        const sR = rect(sumR, cx0, cy0, cx1, cy1);
        const sG = rect(sumG, cx0, cy0, cx1, cy1);
        const sB = rect(sumB, cx0, cy0, cx1, cy1);
        const sL2 = rect(sumL2, cx0, cy0, cx1, cy1);
        const meanL = (0.299 * sR + 0.587 * sG + 0.114 * sB) / n;
        const variance = sL2 / n - meanL * meanL + 1e-6;
        if (variance < bestVar) {
          bestVar = variance;
          bestR = sR / n;
          bestG = sG / n;
          bestB = sB / n;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = clamp255(bestR);
      out[o + 1] = clamp255(bestG);
      out[o + 2] = clamp255(bestB);
    }
  }
  data.set(out);
}

function toneAdjust(data, sat, light) {
  const invGamma = 1 / light;
  for (let o = 0; o < data.length; o += 4) {
    const c = boostSaturation(data[o], data[o + 1], data[o + 2], sat);
    data[o] = clamp255(255 * Math.pow(c[0] / 255, invGamma));
    data[o + 1] = clamp255(255 * Math.pow(c[1] / 255, invGamma));
    data[o + 2] = clamp255(255 * Math.pow(c[2] / 255, invGamma));
  }
}

function interpretLight(data, intensity, hue, chroma) {
  if (intensity <= 0) return;
  const chromaBoost = 1 + (chroma - 1) * intensity;
  for (let o = 0; o < data.length; o += 4) {
    const [l, c, h] = rgbToLch(data[o], data[o + 1], data[o + 2]);
    const c2 = Math.min(150, c * chromaBoost);
    const h2 = (h + hue * intensity) % 360;
    const rgb = lchToRgb(l, c2, h2);
    data[o] = rgb[0];
    data[o + 1] = rgb[1];
    data[o + 2] = rgb[2];
  }
}

function paintRegions(data, k, seed) {
  const n = data.length / 4;
  k = Math.max(2, Math.min(k, 64, n));
  const rand = mulberry32((seed | 0) ^ 0x9e3779b9);
  const centers = [];
  for (let i = 0; i < k; i++) {
    const o = ((rand() * n) | 0) * 4;
    centers.push([data[o], data[o + 1], data[o + 2]]);
  }
  const sampleStep = Math.max(1, Math.floor(n / 4000));
  const sums = new Float64Array(k * 3);
  const counts = new Uint32Array(k);
  const assign = new Uint8Array(n);
  const labCache = new Float64Array(n * 3);
  const centerLab = new Float64Array(k * 3);
  const lab = [0, 0, 0];

  const labOf = (p) => {
    const i = p * 3;
    if (labCache[i] || labCache[i + 1] || labCache[i + 2]) {
      lab[0] = labCache[i];
      lab[1] = labCache[i + 1];
      lab[2] = labCache[i + 2];
      return lab;
    }
    const o = p * 4;
    const v = rgbToLab(data[o], data[o + 1], data[o + 2]);
    labCache[i] = v[0];
    labCache[i + 1] = v[1];
    labCache[i + 2] = v[2];
    lab[0] = v[0];
    lab[1] = v[1];
    lab[2] = v[2];
    return lab;
  };

  const refreshCenters = () => {
    for (let c = 0; c < k; c++) {
      const v = rgbToLab(centers[c][0], centers[c][1], centers[c][2]);
      centerLab[c * 3] = v[0];
      centerLab[c * 3 + 1] = v[1];
      centerLab[c * 3 + 2] = v[2];
    }
  };

  for (let iter = 0; iter < 8; iter++) {
    refreshCenters();
    sums.fill(0);
    counts.fill(0);
    for (let p = 0; p < n; p += sampleStep) {
      const pl = labOf(p);
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dl = pl[0] - centerLab[c * 3];
        const da = pl[1] - centerLab[c * 3 + 1];
        const db = pl[2] - centerLab[c * 3 + 2];
        const d = dl * dl + da * da + db * db;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      const o = p * 4;
      sums[best * 3] += data[o];
      sums[best * 3 + 1] += data[o + 1];
      sums[best * 3 + 2] += data[o + 2];
      counts[best]++;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        centers[c][0] = sums[c * 3] / counts[c];
        centers[c][1] = sums[c * 3 + 1] / counts[c];
        centers[c][2] = sums[c * 3 + 2] / counts[c];
      }
    }
  }

  refreshCenters();
  for (let p = 0; p < n; p++) {
    const pl = labOf(p);
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const dl = pl[0] - centerLab[c * 3];
      const da = pl[1] - centerLab[c * 3 + 1];
      const db = pl[2] - centerLab[c * 3 + 2];
      const d = dl * dl + da * da + db * db;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    assign[p] = best;
  }

  for (let p = 0; p < n; p++) {
    const c = centers[assign[p]];
    const o = p * 4;
    data[o] = clamp255(c[0]);
    data[o + 1] = clamp255(c[1]);
    data[o + 2] = clamp255(c[2]);
  }
  return assign;
}

function contour(data, assign, w, h, amount) {
  if (amount <= 0) return;
  const out = new Uint8ClampedArray(data);
  const dark = 1 - amount * 0.8;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const a = assign[p];
      if (
        a !== assign[p - 1] ||
        a !== assign[p + 1] ||
        a !== assign[p - w] ||
        a !== assign[p + w]
      ) {
        const o = p * 4;
        out[o] = data[o] * dark;
        out[o + 1] = data[o + 1] * dark;
        out[o + 2] = data[o + 2] * dark;
      }
    }
  }
  data.set(out);
}

function grain(data, amount, seed) {
  if (amount <= 0) return;
  const rand = mulberry32((seed | 0) ^ 0x85ebca6b);
  const amp = amount * 36;
  for (let o = 0; o < data.length; o += 4) {
    const g = (rand() - 0.5) * 2 * amp;
    data[o] = clamp255(data[o] + g);
    data[o + 1] = clamp255(data[o + 1] + g);
    data[o + 2] = clamp255(data[o + 2] + g);
  }
}

export function paintLumini(image, params) {
  const maxDim = params.maxDim || 1200;
  const scale = Math.min(1, maxDim / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(image, 0, 0, w, h);
  const img = cx.getImageData(0, 0, w, h);
  const data = img.data;
  const seed = params.seed | 0;

<<<<<<< HEAD
  try { kuwahara(data, w, h, params.smooth); } catch (err) {
    throw new Error("error en kuwahara: " + (err && err.message ? err.message : err));
  }
  try { toneAdjust(data, params.sat, params.light); } catch (err) {
    throw new Error("error en toneAdjust: " + (err && err.message ? err.message : err));
  }
  try { interpretLight(data, params.intensity, params.hue, params.chroma); } catch (err) {
    throw new Error("error en interpretLight: " + (err && err.message ? err.message : err));
  }
  try { const assign = paintRegions(data, params.colors, seed); } catch (err) {
    throw new Error("error en paintRegions: " + (err && err.message ? err.message : err));
  }
  try { contour(data, assign, w, h, params.contour); } catch (err) {
    throw new Error("error en contour: " + (err && err.message ? err.message : err));
  }
  try { grain(data, params.grain, seed); } catch (err) {
    throw new Error("error en grain: " + (err && err.message ? err.message : err));
  }
=======
  kuwahara(data, w, h, params.smooth);
  toneAdjust(data, params.sat, params.light);
  interpretLight(data, params.intensity, params.hue, params.chroma);
  const assign = paintRegions(data, params.colors, seed);
  contour(data, assign, w, h, params.contour);
  grain(data, params.grain, seed);
>>>>>>> fa699d704f08c1331de10857f75a330677b0b45e

  cx.putImageData(img, 0, 0);
  return { canvas: cv, w, h };
}
