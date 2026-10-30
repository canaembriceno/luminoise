import { kmeansQuantize, quantizeToPalette, boostSaturation } from "./color.js";

function toGridCanvas(sourceImage, gridW, gridH) {
  const tmp = document.createElement("canvas");
  tmp.width = gridW;
  tmp.height = gridH;
  const ctx = tmp.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

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
  // createImageBitmap respeta la orientación EXIF. Sin opciones de redimensionado
  // para máxima compatibilidad en móvil (Safari iOS, Chrome antiguo).
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Fallback: cargar mediante Image + objectURL
    const url = URL.createObjectURL(file);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("No se pudo decodificar la imagen"));
      };
      img.src = url;
    });
  }
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
