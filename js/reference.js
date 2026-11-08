// Reference pictures: loading them from files, the clipboard, drag-and-drop,
// or the web, and keeping track of where they sit on the canvas.

const MAX_SIDE = 2048;
const PROXY = 'https://images.weserv.nl/?url=';

export class Reference {
  /**
   * @param {HTMLCanvasElement} canvas  the picture (never cross-origin tainted)
   * @param {object} [meta]  title, creator, license, licenseUrl, landingUrl
   */
  constructor(canvas, meta = {}) {
    this.canvas = canvas;
    this.title = meta.title || '';
    this.creator = meta.creator || '';
    this.license = meta.license || '';
    this.licenseUrl = meta.licenseUrl || '';
    this.landingUrl = meta.landingUrl || '';
    this.opacity = meta.opacity ?? 0.5;
    this.visible = meta.visible ?? true;
    /** Where the picture is drawn, in document pixels */
    this.rect = meta.rect || { x: 0, y: 0, w: canvas.width, h: canvas.height };
  }

  fitTo(docW, docH) {
    this.rect = fitRect(this.canvas.width, this.canvas.height, docW, docH);
  }

  get credit() {
    const parts = [];
    if (this.title) parts.push(`“${this.title}”`);
    if (this.creator) parts.push(`by ${this.creator}`);
    if (this.license) parts.push(`(${this.license})`);
    return parts.join(' ');
  }
}

/** Largest rectangle with the picture's shape that fits inside the document, centred. */
export function fitRect(w, h, docW, docH) {
  const s = Math.min(docW / w, docH / h);
  const rw = w * s;
  const rh = h * s;
  return { x: (docW - rw) / 2, y: (docH - rh) / 2, w: rw, h: rh };
}

/** A drawing size with the same shape as the picture, at a comfortable resolution. */
export function canvasSizeFor(w, h) {
  const long = Math.max(w, h);
  const target = Math.max(1200, Math.min(2400, long));
  const s = target / long;
  return { w: Math.max(16, Math.round(w * s)), h: Math.max(16, Math.round(h * s)) };
}

/** Decodes an image blob into a canvas, shrinking very large pictures. */
export async function blobToCanvas(blob) {
  let bmp;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    throw new Error("That file isn't a picture DrawMe can open. Try a JPG, PNG, GIF or WebP.");
  }
  const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * s));
  canvas.height = Math.max(1, Math.round(bmp.height * s));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return canvas;
}

async function fetchImage(url) {
  const res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (blob.type && !blob.type.startsWith('image/')) throw new Error('Not an image');
  return blob;
}

/**
 * Downloads a picture from the web. Many sites don't let other pages read
 * their images directly, so this falls back to a public image proxy and
 * then to any `fallbacks` (such as a smaller thumbnail).
 */
export async function loadImageFromUrl(url, fallbacks = []) {
  if (url.startsWith('data:image/')) return (await fetch(url)).blob();
  const attempts = [url];
  if (/^https?:\/\//i.test(url)) {
    attempts.push(`${PROXY}${encodeURIComponent(url)}&w=${MAX_SIDE}&h=${MAX_SIDE}&fit=inside&we`);
  }
  attempts.push(...fallbacks);
  for (const attempt of attempts) {
    try {
      return await fetchImage(attempt);
    } catch { /* try the next way */ }
  }
  throw new Error("Couldn't download that picture. Try right-clicking it, choosing Copy image, and pressing Ctrl+V here.");
}

const URL_RE = /^(https?:\/\/\S+|data:image\/[a-z+]+;base64,\S+)$/i;

/** Finds a picture in a paste or drop: {file} or {url}, or null. */
export function findImageIn(dataTransfer) {
  if (!dataTransfer) return null;
  for (const item of dataTransfer.items || []) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return { file };
    }
  }
  for (const file of dataTransfer.files || []) {
    if (file.type.startsWith('image/')) return { file };
  }
  // An image dragged from another tab usually arrives as HTML with an <img>.
  const html = dataTransfer.getData('text/html');
  if (html) {
    const img = new DOMParser().parseFromString(html, 'text/html').querySelector('img[src]');
    const src = img?.getAttribute('src');
    if (src && URL_RE.test(src)) return { url: src };
  }
  const uri = (dataTransfer.getData('text/uri-list') || '').split('\n').find((l) => l && !l.startsWith('#'));
  if (uri && URL_RE.test(uri.trim())) return { url: uri.trim() };
  const text = (dataTransfer.getData('text/plain') || '').trim();
  if (URL_RE.test(text)) return { url: text };
  return null;
}
