// Turns a picture into an outline drawing (edge detection), so it can be
// faded from "full photo" to "just the lines".

/**
 * Measures how strongly each pixel sits on an edge.
 * @param {HTMLCanvasElement} canvas
 * @returns {{width:number, height:number, strength: Float32Array}} strength in 0..1
 */
export function edgeStrength(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const src = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const n = w * h;

  // Brightness, treating transparent areas as white paper.
  let gray = new Float32Array(n);
  for (let i = 0, p = 0; p < n; p++, i += 4) {
    const a = src[i + 3] / 255;
    const lum = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    gray[p] = lum * a + 255 * (1 - a);
  }

  // Blur a little first so photo grain and JPEG noise don't become lines.
  const radius = Math.max(1, Math.round(Math.max(w, h) / 900));
  gray = boxBlur(boxBlur(gray, w, h, radius), w, h, radius);

  // Sobel gradient magnitude.
  const mag = new Float32Array(n);
  let max = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const tl = gray[p - w - 1], t = gray[p - w], tr = gray[p - w + 1];
      const l = gray[p - 1], r = gray[p + 1];
      const bl = gray[p + w - 1], b = gray[p + w], br = gray[p + w + 1];
      const gx = tr + 2 * r + br - tl - 2 * l - bl;
      const gy = bl + 2 * b + br - tl - 2 * t - tr;
      const m = Math.sqrt(gx * gx + gy * gy);
      mag[p] = m;
      if (m > max) max = m;
    }
  }

  // Normalise against a high percentile rather than the single strongest
  // edge, so one very sharp edge doesn't make everything else faint.
  const bins = 1024;
  const hist = new Uint32Array(bins);
  if (max > 0) for (let p = 0; p < n; p++) hist[Math.min(bins - 1, (mag[p] / max * bins) | 0)]++;
  let cum = 0;
  let ref = max;
  for (let i = 0; i < bins; i++) {
    cum += hist[i];
    if (cum >= n * 0.985) { ref = ((i + 1) / bins) * max; break; }
  }
  ref = Math.max(ref, 1e-3);
  for (let p = 0; p < n; p++) mag[p] = Math.min(1, mag[p] / ref);
  return { width: w, height: h, strength: mag };
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const size = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / size;
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / size;
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/**
 * Draws the edges as coloured lines on a transparent canvas.
 * @param {{width:number, height:number, strength: Float32Array}} edges
 * @param {number} detail  0 = only the strongest outlines, 1 = lots of detail
 * @param {string} color  #rrggbb
 */
export function renderOutline(edges, detail, color) {
  const { width: w, height: h, strength } = edges;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const px = img.data;
  const n = parseInt(color.slice(1), 16) || 0;
  const cr = (n >> 16) & 255, cg = (n >> 8) & 255, cb = n & 255;
  const t = 0.7 - 0.62 * detail;    // threshold
  const band = 0.12 + 0.25 * t;     // soft edge above the threshold
  for (let p = 0, i = 0; p < strength.length; p++, i += 4) {
    const a = (strength[p] - t) / band;
    if (a <= 0) continue;
    px[i] = cr; px[i + 1] = cg; px[i + 2] = cb;
    px[i + 3] = a >= 1 ? 255 : a * 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
