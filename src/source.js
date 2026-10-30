import { kmeansQuantize, quantizeToPalette, boostSaturation } from "./color.js";

function toGridCanvas(sourceImage, gridW, gridH) {
  const tmp = document.createElement("canvas");
  tmp.width = gridW;
  tmp.height = gridH;
  const ctx = tmp.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  try {
    if (sourceImage instanceof HTMLCanvasElement) {
      ctx.drawImage(sourceImage, 0, 0, gridW, gridH);
    } else if (sourceImage instanceof HTMLImageElement || sourceImage instanceof HTMLVideoElement || sourceImage instanceof ImageBitmap) {
      ctx.drawImage(sourceImage, 0, 0, gridW, gridH);
    } else if (sourceImage && sourceImage.data && sourceImage.width) {
      const full = document.createElement("canvas");
      full.width = sourceImage.width;
      full.height = sourceImage.height;
      full.getContext("2d").putImageData(sourceImage, 0, 0);
      ctx.drawImage(full, 0, 0, gridW, gridH);
    } else {
      throw new Error("Fuente de imagen no soportada");
    }
  } catch (err) {
    throw new Error("error dibujando en grid: " + (err && err.message ? err.message : err));
  }

  return ctx.getImageData(0, 0, gridW, gridH);
}

export function buildSpectrum(sourceImage, { gridW, kColors, sat, manualPalette = null }) {
  let srcW;
  let srcH;
  if (sourceImage instanceof HTMLCanvasElement) {
    srcW = sourceImage.width;
    srcH = sourceImage.height;
  } else if (sourceImage && sourceImage.width && !(sourceImage instanceof HTMLImageElement)) {
    srcW = sourceImage.width;
    srcH = sourceImage.height;
  } else {
    srcW = sourceImage.naturalWidth || sourceImage.videoWidth || 1;
    srcH = sourceImage.naturalHeight || sourceImage.videoHeight || 1;
  }

  const gridH = Math.max(1, Math.round((gridW * srcH) / Math.max(1, srcW)));
  const gridData = toGridCanvas(sourceImage, gridW, gridH);
  const px = gridData.data;

  if (sat > 1.001) {
    for (let i = 0; i < px.length; i += 4) {
      const boosted = boostSaturation(px[i], px[i + 1], px[i + 2], sat);
      px[i] = boosted[0];
      px[i + 1] = boosted[1];
      px[i + 2] = boosted[2];
    }
  }

  let result;
  if (manualPalette && manualPalette.length >= 2) {
    result = quantizeToPalette(px, manualPalette);
  } else {
    result = kmeansQuantize(px, kColors);
  }

  const colors = new Array(gridW * gridH);
  for (let i = 0; i < result.assign.length; i++) {
    colors[i] = result.palette[result.assign[i]];
  }

  return {
    gridW,
    gridH,
    colors,
    palette: result.palette,
    assign: result.assign,
    imageData: gridData,
  };
}

export async function loadImageFromFile(file) {
  // Intenta createImageBitmap (respeta EXIF). Si falla, fallback a Image.
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = null;
  }

  if (bitmap) {
    // Convertir ImageBitmap a canvas estándar para máxima compatibilidad en todo el pipeline
    try {
      const cv = document.createElement("canvas");
      cv.width = bitmap.width;
      cv.height = bitmap.height;
      const cx = cv.getContext("2d");
      cx.drawImage(bitmap, 0, 0);
      return cv;
    } catch (err) {
      throw new Error("error convirtiendo ImageBitmap: " + (err && err.message ? err.message : err));
    }
  }

  // Fallback: cargar mediante Image + objectURL
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // Convertir Image a canvas para consistencia
      try {
        const cv = document.createElement("canvas");
        cv.width = img.naturalWidth || img.width;
        cv.height = img.naturalHeight || img.height;
        const cx = cv.getContext("2d");
        cx.drawImage(img, 0, 0);
        resolve(cv);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(new Error("error convirtiendo imagen a canvas: " + (err && err.message ? err.message : err)));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo decodificar la imagen"));
    };
    img.src = url;
  });
}

export function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo cargar " + url));
    img.src = url;
  });
}
