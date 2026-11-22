import { CanvasTexture, SRGBColorSpace, type Color } from 'three';

function hash2(ix: number, iy: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Una octava de ruido de valor, en [0, 1). */
function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const v00 = hash2(x0, y0);
  const v10 = hash2(x0 + 1, y0);
  const v01 = hash2(x0, y0 + 1);
  const v11 = hash2(x0 + 1, y0 + 1);
  const alongX0 = v00 + (v10 - v00) * tx;
  const alongX1 = v01 + (v11 - v01) * tx;
  return alongX0 + (alongX1 - alongX0) * ty;
}

function srgbByte(linear: number): number {
  const channel = Math.min(1, Math.max(0, linear));
  const encoded =
    channel <= 0.0031308
      ? channel * 12.92
      : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
}

function paint(
  size: number,
  write: (
    x: number,
    y: number,
    offset: number,
    data: Uint8ClampedArray,
  ) => void,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      write(x, y, offset, data);
      data[offset + 3] = 255;
    }
  }
  return data;
}

/** Seis segmentos claros de costura, apilados a lo largo del lomo. */
export function paintStitchPixels(size: number): Uint8ClampedArray {
  const x0 = Math.floor(size * 0.35);
  const x1 = Math.ceil(size * 0.65);
  return paint(size, (x, y, offset, data) => {
    let light = false;
    if (x >= x0 && x < x1) {
      for (let band = 0; band < 6; band += 1) {
        const y0 = Math.floor(((band + 0.32) * size) / 6);
        const y1 = Math.floor(((band + 0.68) * size) / 6);
        if (y >= y0 && y < y1) light = true;
      }
    }
    const value = light ? 236 : 28;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
  });
}

/**
 * Grano de una octava. El mismo desplazamiento de valor, en ±6 niveles
 * de 8 bits, se suma a cada canal del papel.
 */
export function paintGrainPixels(
  size: number,
  paper: [number, number, number],
): Uint8ClampedArray {
  return paint(size, (x, y, offset, data) => {
    const noise = valueNoise(x / 16, y / 16);
    let delta = Math.round((noise - 0.5) * 12);
    if (delta > 6) delta = 6;
    if (delta < -6) delta = -6;
    for (let channel = 0; channel < 3; channel += 1) {
      const base = Math.round(paper[channel] ?? 0);
      let value = base + delta;
      const lo = Math.max(0, base - 6);
      const hi = Math.min(255, base + 6);
      if (value < lo) value = lo;
      if (value > hi) value = hi;
      data[offset + channel] = value;
    }
  });
}

/** Pauta Seyès: línea fina cada 8 px, fuerte cada 32, margen rojo a la izquierda. */
export function paintSeyesPixels(size: number): Uint8ClampedArray {
  const margin = size * 0.08;
  return paint(size, (x, y, offset, data) => {
    let red = 252;
    let green = 249;
    let blue = 242;
    if (x < margin) {
      red = 188;
      green = 64;
      blue = 78;
    } else if (y % 32 === 0) {
      red = 72;
      green = 98;
      blue = 156;
    } else if (y % 8 === 0) {
      red = 168;
      green = 186;
      blue = 214;
    }
    data[offset] = red;
    data[offset + 1] = green;
    data[offset + 2] = blue;
  });
}

let canvas2d: boolean | null = null;

function canvasTexture(pixels: Uint8ClampedArray, size: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  if (canvas2d !== false) {
    const context = canvas.getContext('2d');
    if (canvas2d === null) canvas2d = context !== null;
    if (context) {
      const image = context.createImageData(size, size);
      image.data.set(pixels);
      context.putImageData(image, 0, 0);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.anisotropy = 1;
  texture.needsUpdate = true;
  return texture;
}

export function createNotebookTextures(
  tier: 'full' | 'lite',
  paper: Color,
): {
  stitch: CanvasTexture;
  grain: CanvasTexture;
  seyes: CanvasTexture;
} {
  const detail = tier === 'lite' ? 128 : 256;
  const rgb: [number, number, number] = [
    srgbByte(paper.r),
    srgbByte(paper.g),
    srgbByte(paper.b),
  ];
  return {
    stitch: canvasTexture(paintStitchPixels(128), 128),
    grain: canvasTexture(paintGrainPixels(detail, rgb), detail),
    seyes: canvasTexture(paintSeyesPixels(detail), detail),
  };
}
