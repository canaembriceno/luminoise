export function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c) {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

export function rgbToLab(r, g, b) {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x);
  y = f(y);
  z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export function labDist(a, b) {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

export function boostSaturation(r, g, b, amount) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return [r, g, b];
  const mid = (max + min) / 2;
  const f = (c) => mid + (c - mid) * amount;
  return [
    Math.max(0, Math.min(255, Math.round(f(r)))),
    Math.max(0, Math.min(255, Math.round(f(g)))),
    Math.max(0, Math.min(255, Math.round(f(b)))),
  ];
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pixelLab(pixels, i, cache, idx) {
  if (cache[idx] !== undefined) return cache[idx];
  const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
  const lab = rgbToLab(r, g, b);
  cache[idx] = lab;
  return lab;
}

export function kmeansQuantize(pixels, k, iterations = 8) {
  const n = pixels.length / 4;
  if (n === 0) return { palette: [], assign: new Uint8Array(0) };
  k = Math.max(1, Math.min(k, 256));

  const sampleStep = Math.max(1, Math.floor(n / 4000));
  const centers = [];
  const stride = Math.max(1, Math.floor(n / k));
  for (let i = 0; i < k; i++) {
    const p = Math.min(n - 1, i * stride + ((i * 7919) % stride));
    const o = p * 4;
    centers.push([pixels[o], pixels[o + 1], pixels[o + 2]]);
  }

  const assign = new Uint8Array(n);
  const sums = new Float64Array(k * 3);
  const counts = new Uint32Array(k);
  const labCache = new Map();

  for (let iter = 0; iter < iterations; iter++) {
    sums.fill(0);
    counts.fill(0);
    for (let p = 0; p < n; p += sampleStep) {
      const o = p * 4;
      const r = pixels[o], g = pixels[o + 1], b = pixels[o + 2];
      let lab = labCache.get(p);
      if (!lab) { lab = rgbToLab(r, g, b); labCache.set(p, lab); }
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const cr = centers[c][0], cg = centers[c][1], cb = centers[c][2];
        const cl = rgbToLab(cr, cg, cb);
        const d = labDist(lab, cl);
        if (d < bestD) { bestD = d; best = c; }
      }
      assign[p] = best;
      sums[best * 3] += r;
      sums[best * 3 + 1] += g;
      sums[best * 3 + 2] += b;
      counts[best]++;
    }
    for (let c = 0; c < centers.length; c++) {
      if (counts[c] > 0) {
        centers[c] = [
          sums[c * 3] / counts[c],
          sums[c * 3 + 1] / counts[c],
          sums[c * 3 + 2] / counts[c],
        ];
      }
    }
  }

  for (let p = 0; p < n; p++) {
    const o = p * 4;
    const lab = pixelLab(pixels, o, labCache, p);
    let best = 0, bestD = Infinity;
    for (let c = 0; c < centers.length; c++) {
      const d = labDist(lab, rgbToLab(centers[c][0], centers[c][1], centers[c][2]));
      if (d < bestD) { bestD = d; best = c; }
    }
    assign[p] = best;
  }

  const palette = centers.map(([r, g, b]) => [
    Math.max(0, Math.min(255, Math.round(r))),
    Math.max(0, Math.min(255, Math.round(g))),
    Math.max(0, Math.min(255, Math.round(b))),
  ]);

  return { palette, assign };
}

export function quantizeToPalette(pixels, palette) {
  const n = pixels.length / 4;
  const assign = new Uint8Array(n);
  const labPal = palette.map(([r, g, b]) => rgbToLab(r, g, b));
  for (let p = 0; p < n; p++) {
    const o = p * 4;
    const lab = rgbToLab(pixels[o], pixels[o + 1], pixels[o + 2]);
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < labPal.length; c++) {
      const d = labDist(lab, labPal[c]);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    assign[p] = best;
  }
  return { palette, assign };
}
