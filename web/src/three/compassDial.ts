// Dial 256² en RGBA. 0° es el norte (arriba) y el ángulo crece en sentido horario.
// El módulo no importa three: el buffer se prueba en jsdom y la escena lo sube a textura.

export interface DialColors {
  ink: readonly [number, number, number];
  paper: readonly [number, number, number];
}

const DEFAULT_INK: readonly [number, number, number] = [35, 36, 48];

const GLYPH_N = [
  '10001',
  '11001',
  '10101',
  '10011',
  '10001',
  '10001',
  '10001',
] as const;

function setPixel(
  data: Uint8ClampedArray,
  size: number,
  x: number,
  y: number,
  ink: readonly [number, number, number],
): void {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= size || iy >= size) return;
  const offset = (iy * size + ix) * 4;
  data[offset] = ink[0];
  data[offset + 1] = ink[1];
  data[offset + 2] = ink[2];
  data[offset + 3] = 255;
}

function stampDisc(
  data: Uint8ClampedArray,
  size: number,
  x: number,
  y: number,
  ink: readonly [number, number, number],
  radius: number,
): void {
  const reach = Math.ceil(radius);
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      if (dx * dx + dy * dy <= radius * radius) {
        setPixel(data, size, x + dx, y + dy, ink);
      }
    }
  }
}

function stampGlyphN(
  data: Uint8ClampedArray,
  size: number,
  cx: number,
  cy: number,
  ink: readonly [number, number, number],
): void {
  const scale = Math.max(1, Math.round(size / 64));
  const originX = Math.round(cx - (5 * scale) / 2);
  const originY = Math.round(cy - size * 0.24);
  for (const [row, line] of GLYPH_N.entries()) {
    for (let col = 0; col < line.length; col += 1) {
      if (line[col] !== '1') continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          setPixel(
            data,
            size,
            originX + col * scale + dx,
            originY + row * scale + dy,
            ink,
          );
        }
      }
    }
  }
}

export function paintCompassDialPixels(
  size: number,
  withLetter: boolean,
  colors?: DialColors,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  const ink = colors?.ink ?? DEFAULT_INK;
  const paper = colors?.paper;
  if (paper) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = paper[0];
      data[i + 1] = paper[1];
      data[i + 2] = paper[2];
      data[i + 3] = 255;
    }
  }

  const cx = size / 2;
  const cy = size / 2;
  const outer = size * 0.46;
  const minor = size * 0.04;
  const major = size * 0.062;

  for (let deg = 0; deg < 360; deg += 10) {
    const strong = deg % 30 === 0;
    let length = strong ? major : minor;
    if (deg === 0 && !withLetter) length = major * 2;
    const inner = outer - length;
    const thick = strong ? 1.8 : 1.35;
    const rad = (deg * Math.PI) / 180;
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    for (let radius = inner; radius <= outer; radius += 0.45) {
      stampDisc(data, size, cx + sin * radius, cy - cos * radius, ink, thick);
    }
  }

  if (withLetter) stampGlyphN(data, size, cx, cy, ink);
  return data;
}

export function drawCompassDialCanvas(
  canvas: HTMLCanvasElement,
  withLetter: boolean,
  colors?: DialColors,
): void {
  const size = canvas.width;
  const ctx = canvas.getContext('2d');
  if (!ctx || size <= 0 || canvas.height !== size) return;
  const pixels = paintCompassDialPixels(size, withLetter, colors);
  const image = ctx.createImageData(size, size);
  image.data.set(pixels);
  ctx.putImageData(image, 0, 0);
}
