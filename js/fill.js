// Paint-bucket flood fill.

/**
 * Finds the connected region around (sx, sy) whose colour is within
 * `tolerance` (0-255 per channel) of the starting pixel.
 * @param {ImageData} src
 * @returns {{mask: Uint8Array, minX:number, minY:number, maxX:number, maxY:number} | null}
 */
export function floodFill(src, sx, sy, tolerance) {
  const { width: w, height: h, data } = src;
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;

  const i0 = (sy * w + sx) * 4;
  const r0 = data[i0], g0 = data[i0 + 1], b0 = data[i0 + 2], a0 = data[i0 + 3];
  const tol = tolerance;
  const mask = new Uint8Array(w * h);
  const match = (p) => {
    const i = p * 4;
    return Math.abs(data[i] - r0) <= tol && Math.abs(data[i + 1] - g0) <= tol &&
      Math.abs(data[i + 2] - b0) <= tol && Math.abs(data[i + 3] - a0) <= tol;
  };

  let minX = sx, maxX = sx, minY = sy, maxY = sy;
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop();
    let x = stack.pop();
    let p = y * w + x;
    if (mask[p]) continue;
    while (x > 0 && !mask[p - 1] && match(p - 1)) { x--; p--; }
    let up = false;
    let down = false;
    while (x < w && !mask[p] && match(p)) {
      mask[p] = 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y > 0) {
        const q = p - w;
        if (!mask[q] && match(q)) { if (!up) { stack.push(x, y - 1); up = true; } } else up = false;
      }
      if (y < h - 1) {
        const q = p + w;
        if (!mask[q] && match(q)) { if (!down) { stack.push(x, y + 1); down = true; } } else down = false;
      }
      x++; p++;
    }
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { mask, minX, minY, maxX, maxY };
}

/** Grows the filled region by `radius` pixels so it tucks under soft line edges. */
export function growRegion(region, w, h, radius) {
  let { mask } = region;
  for (let n = 0; n < radius; n++) {
    const out = mask.slice();
    const x0 = Math.max(0, region.minX - 1), x1 = Math.min(w - 1, region.maxX + 1);
    const y0 = Math.max(0, region.minY - 1), y1 = Math.min(h - 1, region.maxY + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const p = y * w + x;
        if (mask[p]) continue;
        if ((x > 0 && mask[p - 1]) || (x < w - 1 && mask[p + 1]) ||
            (y > 0 && mask[p - w]) || (y < h - 1 && mask[p + w])) out[p] = 1;
      }
    }
    mask = out;
    region.minX = x0; region.maxX = x1; region.minY = y0; region.maxY = y1;
  }
  region.mask = mask;
  return region;
}

/** A canvas covering the region's bounding box, painted `rgb` where the mask is set. */
export function regionToCanvas(region, w, rgb) {
  const bw = region.maxX - region.minX + 1;
  const bh = region.maxY - region.minY + 1;
  const canvas = document.createElement('canvas');
  canvas.width = bw;
  canvas.height = bh;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(bw, bh);
  const px = img.data;
  const { mask } = region;
  for (let y = 0; y < bh; y++) {
    let p = (region.minY + y) * w + region.minX;
    let i = y * bw * 4;
    for (let x = 0; x < bw; x++, p++, i += 4) {
      if (!mask[p]) continue;
      px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
