// Saving and loading: autosave in the browser (IndexedDB), project files
// (.drawme JSON), and PNG export.

import { DrawingDocument, Layer } from './document.js';
import { Reference } from './reference.js';

const DB_NAME = 'drawme';
const STORE = 'kv';
export const PROJECT_FORMAT = 'drawme-project';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSet(key, value) {
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function idbGet(key) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, 0.92));
}

async function imageToCanvas(image) {
  let blob = image;
  if (typeof blob === 'string') {
    if (!blob.startsWith('data:image/')) throw new Error('The project contains an invalid picture.');
    blob = await (await fetch(blob)).blob();
  }
  if (!(blob instanceof Blob)) return null;
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  return canvas;
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * @param {DrawingDocument} doc
 * @param {'blob'|'dataURL'} encoding  blobs for IndexedDB, data URLs for files
 */
export async function serializeDoc(doc, encoding = 'blob') {
  const layers = [];
  for (const layer of doc.layers) {
    const blob = await canvasToBlob(layer.canvas);
    layers.push({
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      image: encoding === 'dataURL' ? await blobToDataURL(blob) : blob,
    });
  }
  let reference = null;
  const ref = doc.reference;
  if (ref) {
    const blob = await canvasToBlob(ref.canvas, 'image/jpeg');
    reference = {
      title: ref.title,
      creator: ref.creator,
      license: ref.license,
      licenseUrl: ref.licenseUrl,
      landingUrl: ref.landingUrl,
      opacity: ref.opacity,
      visible: ref.visible,
      rect: ref.rect,
      placement: ref.placement,
      outline: ref.outline,
      detail: ref.detail,
      lineColor: ref.lineColor,
      image: encoding === 'dataURL' ? await blobToDataURL(blob) : blob,
    };
  }
  return {
    format: PROJECT_FORMAT,
    version: 1,
    width: doc.width,
    height: doc.height,
    background: doc.background,
    activeIndex: doc.activeIndex,
    layerCounter: doc._layerCounter,
    layers,
    reference,
  };
}

export async function deserializeDoc(data) {
  if (!data || data.format !== PROJECT_FORMAT || !Array.isArray(data.layers)) {
    throw new Error('This is not a DrawMe project file.');
  }
  const w = data.width | 0;
  const h = data.height | 0;
  if (w < 1 || h < 1 || w > 8192 || h > 8192) throw new Error('The project has an invalid size.');
  const bg = typeof data.background === 'string' ? data.background : null;
  const doc = new DrawingDocument(w, h, bg, { emptyLayers: true });
  for (const item of data.layers) {
    const layer = new Layer(w, h, String(item.name || 'Layer'));
    layer.visible = item.visible !== false;
    layer.opacity = Math.max(0, Math.min(1, Number(item.opacity ?? 1)));
    let blob = item.image;
    if (typeof blob === 'string') {
      if (!blob.startsWith('data:image/')) throw new Error('The project contains an invalid layer.');
      blob = await (await fetch(blob)).blob();
    }
    if (blob instanceof Blob) {
      const bmp = await createImageBitmap(blob);
      layer.ctx.drawImage(bmp, 0, 0);
      bmp.close?.();
    }
    doc.layers.push(layer);
  }
  if (!doc.layers.length) doc.layers.push(doc.createLayer());
  doc._layerCounter = Math.max(Number(data.layerCounter) || 0, doc.layers.length);
  doc.setActive(Number(data.activeIndex) || 0);
  if (data.reference && data.reference.image) {
    const r = data.reference;
    const canvas = await imageToCanvas(r.image);
    if (canvas) {
      const rect = r.rect && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(r.rect[k]))
        ? { x: r.rect.x, y: r.rect.y, w: r.rect.w, h: r.rect.h } : null;
      doc.reference = new Reference(canvas, {
        title: String(r.title || ''),
        creator: String(r.creator || ''),
        license: String(r.license || ''),
        licenseUrl: /^https?:\/\//.test(r.licenseUrl || '') ? r.licenseUrl : '',
        landingUrl: /^https?:\/\//.test(r.landingUrl || '') ? r.landingUrl : '',
        opacity: Math.max(0, Math.min(1, Number(r.opacity ?? 0.5))),
        visible: r.visible !== false,
        rect,
        placement: r.placement,
        outline: r.outline,
        detail: r.detail,
        lineColor: typeof r.lineColor === 'string' ? r.lineColor : undefined,
      });
      if (!rect) doc.reference.fitTo(w, h);
    }
  }
  return doc;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export async function exportPNG(doc) {
  const blob = await canvasToBlob(doc.flatten({ background: true }));
  downloadBlob(blob, `drawing-${timestamp()}.png`);
}

/** The whole project as a .drawme file (JSON). */
export async function projectBlob(doc) {
  const data = await serializeDoc(doc, 'dataURL');
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

export async function saveProjectFile(doc) {
  downloadBlob(await projectBlob(doc), `drawing-${timestamp()}.drawme`);
}

/** A small PNG preview as URL-safe base64, for Google Drive's file list. */
export function thumbnailBase64(doc, max = 320) {
  const flat = doc.flatten({ background: true });
  const k = Math.min(1, max / Math.max(flat.width, flat.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(flat.width * k));
  c.height = Math.max(1, Math.round(flat.height * k));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(flat, 0, 0, c.width, c.height);
  return c.toDataURL('image/png').split(',')[1].replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
