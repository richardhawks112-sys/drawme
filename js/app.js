import { DrawingDocument } from './document.js';
import { History, recordPixels } from './history.js';
import { TOOLS, TOOL_ORDER, Stroke } from './brushes.js';
import { Viewport } from './view.js';
import { floodFill, growRegion, regionToCanvas } from './fill.js';
import { ICONS } from './icons.js';
import { LayersPanel } from './layers-panel.js';
import * as storage from './storage.js';
import { Reference, blobToCanvas, canvasSizeFor, findImageIn, loadImageFromUrl } from './reference.js';
import { ImageSearch } from './search.js';
import { ReferencePane } from './ref-pane.js';

const $ = (sel) => document.querySelector(sel);

const SETTINGS_KEY = 'drawme.settings.v1';
const AUTOSAVE_KEY = 'autosave';
const SWATCHES = [
  '#000000', '#444444', '#888888', '#ffffff', '#7a4a2a', '#e53935', '#fb8c00', '#fdd835',
  '#43a047', '#00897b', '#1e88e5', '#3949ab', '#8e24aa', '#d81b60', '#f8bbd0', '#ffe0b2',
];

// ---------------------------------------------------------------------------
// State

const state = {
  doc: null,
  tool: 'pen',
  color: '#222222',
  shared: { stabilizer: 2, pressureCurve: 0, tolerance: 15, grow: 1, split: false },
  tools: {},
};
for (const id of TOOL_ORDER) {
  if (TOOLS[id].defaults) state.tools[id] = { ...TOOLS[id].defaults };
}
loadSettings();

const history = new History();
const viewCanvas = $('#view');
const view = new Viewport(viewCanvas);
const refPane = new ReferencePane($('#refview'), view);
const layersPanel = new LayersPanel($('#layer-list'), {
  onSelect(i) {
    state.doc.setActive(i);
    refreshLayers();
  },
  onToggleVisible(i) {
    const layer = state.doc.layers[i];
    layer.visible = !layer.visible;
    refreshLayers();
    scheduleAutosave();
  },
  onRename(i, name) {
    state.doc.layers[i].name = name;
    refreshLayers();
    scheduleAutosave();
  },
});

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (!saved) return;
    if (/^#[0-9a-f]{6}$/i.test(saved.color)) state.color = saved.color;
    Object.assign(state.shared, saved.shared || {});
    for (const id of Object.keys(saved.tools || {})) {
      if (state.tools[id]) Object.assign(state.tools[id], saved.tools[id]);
    }
    if (TOOLS[saved.tool]) state.tool = saved.tool;
  } catch { /* storage unavailable; use defaults */ }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      color: state.color, shared: state.shared, tools: state.tools, tool: state.tool,
    }));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Status bar and toast

let toastTimer = 0;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

let lastInputText = '';
function noteInput(e) {
  let text;
  if (e.pointerType === 'pen') {
    text = e.pressure > 0 ? `Pen · pressure ${e.pressure.toFixed(2)}` : 'Pen detected';
  } else if (e.pointerType === 'touch') {
    text = 'Touch';
  } else {
    text = 'Mouse';
  }
  if (text !== lastInputText) {
    lastInputText = text;
    $('#status-input').textContent = text;
  }
}

function updateDocStatus() {
  const doc = state.doc;
  $('#status-doc').textContent =
    `${doc.width} × ${doc.height} px · layer ${doc.activeIndex + 1} of ${doc.layers.length}`;
}

function setSaveStatus(text) {
  $('#status-save').textContent = text;
}

// ---------------------------------------------------------------------------
// Document lifecycle

let restoring = false;

function setDocument(doc) {
  state.doc = doc;
  restoring = true;
  history.clear();
  restoring = false;
  view.setDocument(doc);
  refreshLayers();
  refreshReference();
}

function refreshLayers() {
  layersPanel.render(state.doc);
  const layer = state.doc.activeLayer;
  $('#layer-opacity').value = Math.round(layer.opacity * 100);
  $('#out-layer-opacity').textContent = `${Math.round(layer.opacity * 100)}%`;
  const n = state.doc.layers.length;
  const i = state.doc.activeIndex;
  $('#layer-up').disabled = i >= n - 1;
  $('#layer-down').disabled = i <= 0;
  $('#layer-merge').disabled = i <= 0;
  $('#layer-delete').disabled = n <= 1;
  updateDocStatus();
  view.requestRender();
}

history.addEventListener('change', () => {
  $('#btn-undo').disabled = !history.canUndo;
  $('#btn-redo').disabled = !history.canRedo;
  if (state.doc) {
    refreshLayers();
    refreshReference();
    if (!restoring) scheduleAutosave();
  }
});

// ---------------------------------------------------------------------------
// Autosave (IndexedDB in this browser)

let autosaveTimer = 0;
let autosavePending = false;

function scheduleAutosave() {
  autosavePending = true;
  setSaveStatus('Saving…');
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosaveNow, 1200);
}

async function autosaveNow() {
  clearTimeout(autosaveTimer);
  if (!autosavePending || !state.doc) return;
  autosavePending = false;
  try {
    const data = await storage.serializeDoc(state.doc, 'blob');
    await storage.idbSet(AUTOSAVE_KEY, data);
    setSaveStatus('Saved in this browser');
  } catch (err) {
    console.warn('Autosave failed', err);
    setSaveStatus('Autosave is not available here. Use Save to keep your work.');
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') autosaveNow();
});

// ---------------------------------------------------------------------------
// Toolbar

const toolbar = $('#toolbar');
for (const id of TOOL_ORDER) {
  const tool = TOOLS[id];
  const btn = document.createElement('button');
  btn.className = 'tool-btn';
  btn.dataset.tool = id;
  btn.innerHTML = ICONS[id];
  btn.title = `${tool.name} (${tool.key.toUpperCase()})`;
  btn.setAttribute('aria-label', tool.name);
  btn.addEventListener('click', () => selectTool(id));
  toolbar.appendChild(btn);
}

function selectTool(id) {
  state.tool = id;
  for (const btn of toolbar.children) btn.setAttribute('aria-pressed', String(btn.dataset.tool === id));
  syncOptions();
  updateCursor();
  saveSettings();
}

// ---------------------------------------------------------------------------
// Tool options

const SIZE_MIN = 1;
const SIZE_MAX = 300;
const sliderToSize = (v) => {
  const s = SIZE_MIN * Math.pow(SIZE_MAX / SIZE_MIN, v / 1000);
  return s < 10 ? Math.round(s * 2) / 2 : Math.round(s);
};
const sizeToSlider = (s) => Math.round((Math.log(s / SIZE_MIN) / Math.log(SIZE_MAX / SIZE_MIN)) * 1000);
const curveToGamma = (v) => Math.pow(2, v / 5);
const curveLabel = (v) => (v === 0 ? 'Even' : v < 0 ? `Soft ${-v}` : `Firm ${v}`);

function currentToolSettings() {
  return state.tools[state.tool];
}

function bindRange(id, outId, read, write, format) {
  const input = $(id);
  const out = $(outId);
  input.addEventListener('input', () => {
    write(Number(input.value));
    out.textContent = format(read());
    updateCursor();
  });
  input.addEventListener('change', saveSettings);
  return () => {
    input.value = toSlider(read());
    out.textContent = format(read());
  };
  function toSlider(v) { return id === '#opt-size' ? sizeToSlider(v) : v; }
}

const syncers = [
  bindRange('#opt-size', '#out-size',
    () => currentToolSettings()?.size ?? 1,
    (v) => { if (currentToolSettings()) currentToolSettings().size = sliderToSize(v); },
    (v) => `${v}px`),
  bindRange('#opt-opacity', '#out-opacity',
    () => Math.round((currentToolSettings()?.opacity ?? 1) * 100),
    (v) => { if (currentToolSettings()) currentToolSettings().opacity = v / 100; },
    (v) => `${v}%`),
  bindRange('#opt-hardness', '#out-hardness',
    () => Math.round((currentToolSettings()?.hardness ?? 1) * 100),
    (v) => { if (currentToolSettings()) currentToolSettings().hardness = v / 100; },
    (v) => `${v}%`),
  bindRange('#opt-stabilizer', '#out-stabilizer',
    () => state.shared.stabilizer, (v) => { state.shared.stabilizer = v; }, (v) => (v ? String(v) : 'Off')),
  bindRange('#opt-curve', '#out-curve',
    () => state.shared.pressureCurve, (v) => { state.shared.pressureCurve = v; }, curveLabel),
  bindRange('#opt-tolerance', '#out-tolerance',
    () => state.shared.tolerance, (v) => { state.shared.tolerance = v; }, (v) => `${v}%`),
  bindRange('#opt-grow', '#out-grow',
    () => state.shared.grow, (v) => { state.shared.grow = v; }, (v) => `${v}px`),
];

for (const [id, key] of [['#opt-psize', 'pressureSize'], ['#opt-popacity', 'pressureOpacity']]) {
  $(id).addEventListener('change', (e) => {
    const s = currentToolSettings();
    if (s) s[key] = e.target.checked;
    saveSettings();
  });
}

function syncOptions() {
  const tool = TOOLS[state.tool];
  $('#tool-name').textContent = tool.name;
  const tags = new Set([tool.kind, tool.id]);
  if (tool.paints) tags.add('paint');
  for (const el of document.querySelectorAll('[data-show]')) {
    el.hidden = !el.dataset.show.split(' ').some((t) => tags.has(t));
  }
  for (const sync of syncers) sync();
  const s = currentToolSettings();
  if (s) {
    $('#opt-psize').checked = s.pressureSize;
    $('#opt-popacity').checked = s.pressureOpacity;
  }
}

// Colour
const colorInput = $('#color');
const swatchEl = $('#swatches');
for (const c of SWATCHES) {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.style.background = c;
  b.dataset.color = c;
  b.title = c;
  b.setAttribute('aria-label', `Color ${c}`);
  b.addEventListener('click', () => setColor(c));
  swatchEl.appendChild(b);
}
colorInput.addEventListener('input', () => setColor(colorInput.value, false));
colorInput.addEventListener('change', saveSettings);

function setColor(hex, save = true) {
  state.color = hex.toLowerCase();
  colorInput.value = state.color;
  $('#color-hex').textContent = state.color;
  for (const b of swatchEl.children) b.classList.toggle('current', b.dataset.color === state.color);
  if (save) saveSettings();
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

// ---------------------------------------------------------------------------
// Drawing input

let drag = null;
let spaceDown = false;

function brushToolFor() {
  return TOOLS[state.tool].kind === 'brush' ? state.tool : null;
}

function updateCursor() {
  const tool = TOOLS[state.tool];
  if (spaceDown || tool.kind === 'hand') {
    viewCanvas.style.cursor = drag?.mode === 'pan' ? 'grabbing' : 'grab';
    view.cursorRadius = 0;
  } else if (tool.kind === 'brush') {
    viewCanvas.style.cursor = 'none';
    view.cursorRadius = state.tools[tool.id].size / 2;
  } else {
    viewCanvas.style.cursor = 'crosshair';
    view.cursorRadius = 0;
  }
  view.requestRender();
}

function pressureOf(e) {
  if (e.pointerType !== 'pen') return 1;
  const p = e.pressure > 0 ? Math.min(1, e.pressure) : 0.02;
  return Math.pow(p, curveToGamma(state.shared.pressureCurve));
}

function smoothingFactor() {
  return 1 - state.shared.stabilizer * 0.085;
}

viewCanvas.addEventListener('pointerdown', (e) => {
  if (drag || !state.doc) return;
  e.preventDefault();
  view.refreshRect();
  noteInput(e);

  let toolId = state.tool;
  const penEraser = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);
  if (e.button === 1 || spaceDown) toolId = 'hand';
  else if (penEraser) toolId = 'eraser';
  else if (e.button === 2) toolId = 'eyedropper';
  else if (e.button !== 0) return;
  const tool = TOOLS[toolId];

  try { viewCanvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  const pt = view.toDoc(e.clientX, e.clientY);

  if (tool.kind === 'hand') {
    drag = { id: e.pointerId, mode: 'pan', lx: e.clientX, ly: e.clientY };
    viewCanvas.style.cursor = 'grabbing';
    return;
  }
  if (tool.kind === 'picker') {
    drag = { id: e.pointerId, mode: 'pick' };
    pickColor(pt);
    return;
  }
  if (tool.kind === 'fill') {
    fillAt(pt);
    return;
  }

  const layer = state.doc.activeLayer;
  if (!layer.visible) {
    toast('This layer is hidden. Click its eye icon to show it, then draw.');
    return;
  }
  const p = pressureOf(e);
  const stroke = new Stroke({
    width: state.doc.width,
    height: state.doc.height,
    tool,
    settings: state.tools[toolId],
    color: state.color,
  });
  drag = { id: e.pointerId, mode: 'draw', stroke, layer, smooth: { x: pt.x, y: pt.y, p }, raw: { x: pt.x, y: pt.y, p } };
  stroke.addPoint(pt.x, pt.y, p);
  view.liveStroke = { stroke, layer };
  view.requestRender();
});

viewCanvas.addEventListener('pointermove', (e) => {
  view.cursor = view.toLocal(e.clientX, e.clientY);
  if (refPane.active) refPane.setGhost(view.toDoc(e.clientX, e.clientY));
  if (e.pointerType === 'pen') noteInput(e);
  if (!drag || e.pointerId !== drag.id) {
    view.requestRender();
    return;
  }
  if (drag.mode === 'pan') {
    view.panBy(e.clientX - drag.lx, e.clientY - drag.ly);
    drag.lx = e.clientX;
    drag.ly = e.clientY;
    return;
  }
  if (drag.mode === 'pick') {
    pickColor(view.toDoc(e.clientX, e.clientY));
    return;
  }
  const events = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
  for (const ev of events.length ? events : [e]) {
    const pt = view.toDoc(ev.clientX, ev.clientY);
    feedPoint(pt.x, pt.y, pressureOf(ev));
  }
  view.requestRender();
});

function feedPoint(x, y, p) {
  const k = smoothingFactor();
  const s = drag.smooth;
  s.x += (x - s.x) * k;
  s.y += (y - s.y) * k;
  s.p += (p - s.p) * Math.min(1, k * 1.5);
  drag.raw = { x, y, p };
  drag.stroke.addPoint(s.x, s.y, s.p);
}

function endDrag(e, commit) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  if (d.mode === 'draw') {
    if (commit) {
      // Let smoothing catch up with where the pen actually lifted.
      if (state.shared.stabilizer > 0) {
        for (let i = 0; i < 24; i++) feedPoint(d.raw.x, d.raw.y, d.raw.p);
      }
      commitStroke(d);
    }
    view.liveStroke = null;
  }
  drag = null;
  updateCursor();
  if (d.mode === 'pick') saveSettings();
}

viewCanvas.addEventListener('pointerup', (e) => endDrag(e, true));
viewCanvas.addEventListener('pointercancel', (e) => endDrag(e, false));
viewCanvas.addEventListener('lostpointercapture', (e) => endDrag(e, true));
viewCanvas.addEventListener('pointerleave', () => {
  view.cursor = null;
  refPane.setGhost(null);
  view.requestRender();
});
viewCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

viewCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  view.refreshRect();
  const local = view.toLocal(e.clientX, e.clientY);
  const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
  view.zoomBy(Math.exp(-e.deltaY * unit * 0.0015), local.x, local.y);
}, { passive: false });

function commitStroke(d) {
  const rect = d.stroke.bounds();
  if (!rect) return;
  const cmd = recordPixels(d.layer, rect, d.stroke.tool.name, (ctx) => d.stroke.drawTo(ctx));
  history.push(cmd);
}

function pickColor(pt) {
  const c = state.doc.sampleColor(pt.x, pt.y);
  if (!c || c[3] === 0) return;
  setColor(rgbToHex(c[0], c[1], c[2]), false);
}

function fillAt(pt) {
  const doc = state.doc;
  const layer = doc.activeLayer;
  if (!layer.visible) {
    toast('This layer is hidden. Click its eye icon to show it, then fill.');
    return;
  }
  if (pt.x < 0 || pt.y < 0 || pt.x >= doc.width || pt.y >= doc.height) return;
  const flat = doc.flatten({ background: true });
  const src = flat.getContext('2d').getImageData(0, 0, doc.width, doc.height);
  const region = floodFill(src, pt.x, pt.y, Math.round(state.shared.tolerance * 2.55));
  if (!region) return;
  growRegion(region, doc.width, doc.height, state.shared.grow);
  const hex = state.color.slice(1);
  const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const patch = regionToCanvas(region, doc.width, rgb);
  const rect = { x: region.minX, y: region.minY, w: patch.width, h: patch.height };
  history.push(recordPixels(layer, rect, 'Fill', (ctx) => ctx.drawImage(patch, rect.x, rect.y)));
}

// ---------------------------------------------------------------------------
// Layer actions (all undoable)

function addLayer() {
  const doc = state.doc;
  const prev = doc.activeIndex;
  const index = prev + 1;
  const layer = doc.createLayer();
  doc.insertLayer(index, layer);
  history.push({
    label: 'Add layer',
    undo() { doc.removeLayer(index); doc.setActive(prev); },
    redo() { doc.insertLayer(index, layer); },
  });
}

function duplicateLayer() {
  const doc = state.doc;
  const prev = doc.activeIndex;
  const index = prev + 1;
  const layer = doc.activeLayer.clone();
  doc.insertLayer(index, layer);
  history.push({
    label: 'Duplicate layer',
    bytes: doc.width * doc.height * 4,
    undo() { doc.removeLayer(index); doc.setActive(prev); },
    redo() { doc.insertLayer(index, layer); },
  });
}

function deleteLayer() {
  const doc = state.doc;
  if (doc.layers.length <= 1) return;
  const index = doc.activeIndex;
  const layer = doc.removeLayer(index);
  doc.setActive(Math.max(0, index - 1));
  history.push({
    label: 'Delete layer',
    bytes: doc.width * doc.height * 4,
    undo() { doc.insertLayer(index, layer); },
    redo() { doc.removeLayer(index); doc.setActive(Math.max(0, index - 1)); },
  });
}

function moveLayer(delta) {
  const doc = state.doc;
  const from = doc.activeIndex;
  const to = from + delta;
  if (to < 0 || to >= doc.layers.length) return;
  doc.moveLayer(from, to);
  history.push({
    label: 'Move layer',
    undo() { doc.moveLayer(to, from); },
    redo() { doc.moveLayer(from, to); },
  });
}

function mergeDown() {
  const doc = state.doc;
  const index = doc.activeIndex;
  if (index <= 0) return;
  const upper = doc.layers[index];
  const lower = doc.layers[index - 1];
  const full = { x: 0, y: 0, w: doc.width, h: doc.height };
  const pixels = recordPixels(lower, full, 'Merge', (ctx) => {
    if (!upper.visible) return;
    ctx.globalAlpha = upper.opacity;
    ctx.drawImage(upper.canvas, 0, 0);
    ctx.globalAlpha = 1;
  });
  doc.removeLayer(index);
  doc.setActive(index - 1);
  history.push({
    label: 'Merge down',
    bytes: pixels.bytes,
    undo() { pixels.undo(); doc.insertLayer(index, upper); },
    redo() { pixels.redo(); doc.removeLayer(index); doc.setActive(index - 1); },
  });
}

function clearLayer() {
  const doc = state.doc;
  const full = { x: 0, y: 0, w: doc.width, h: doc.height };
  history.push(recordPixels(doc.activeLayer, full, 'Clear layer', (ctx) => ctx.clearRect(0, 0, doc.width, doc.height)));
}

$('#layer-add').addEventListener('click', addLayer);
$('#layer-dup').addEventListener('click', duplicateLayer);
$('#layer-delete').addEventListener('click', deleteLayer);
$('#layer-up').addEventListener('click', () => moveLayer(1));
$('#layer-down').addEventListener('click', () => moveLayer(-1));
$('#layer-merge').addEventListener('click', mergeDown);
$('#layer-clear').addEventListener('click', clearLayer);

const layerOpacity = $('#layer-opacity');
layerOpacity.addEventListener('input', () => {
  state.doc.activeLayer.opacity = Number(layerOpacity.value) / 100;
  $('#out-layer-opacity').textContent = `${layerOpacity.value}%`;
  view.requestRender();
});
layerOpacity.addEventListener('change', () => {
  refreshLayers();
  scheduleAutosave();
});

// ---------------------------------------------------------------------------
// Top bar: files, undo, zoom

$('#btn-undo').addEventListener('click', () => history.undo());
$('#btn-redo').addEventListener('click', () => history.redo());

async function exportImage() {
  try {
    await storage.exportPNG(state.doc);
  } catch (err) {
    toast(`Couldn't export: ${err.message}`);
  }
}

async function saveProject() {
  try {
    await storage.saveProjectFile(state.doc);
    toast('Project downloaded. Use Open to load it again later.');
  } catch (err) {
    toast(`Couldn't save: ${err.message}`);
  }
}

$('#btn-export').addEventListener('click', exportImage);
$('#btn-save').addEventListener('click', saveProject);

const fileInput = $('#file-open');
$('#btn-open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const doc = await storage.deserializeDoc(JSON.parse(await file.text()));
    setDocument(doc);
    scheduleAutosave();
    toast(`Opened ${file.name}`);
  } catch (err) {
    toast(err instanceof SyntaxError ? 'That file is not a DrawMe project.' : err.message);
  }
});

// New drawing dialog
const newDialog = $('#new-dialog');
const presetSelect = $('#new-preset');
presetSelect.addEventListener('change', () => {
  $('#new-custom').hidden = presetSelect.value !== 'custom';
});
$('#btn-new').addEventListener('click', () => newDialog.showModal());
newDialog.addEventListener('close', () => {
  if (newDialog.returnValue !== 'ok') return;
  let w;
  let h;
  if (presetSelect.value === 'custom') {
    w = Math.round(Number($('#new-w').value));
    h = Math.round(Number($('#new-h').value));
  } else {
    [w, h] = presetSelect.value.split('x').map(Number);
  }
  w = Math.max(16, Math.min(4096, w || 1600));
  h = Math.max(16, Math.min(4096, h || 1200));
  const bg = $('#new-bg').value || null;
  setDocument(new DrawingDocument(w, h, bg));
  scheduleAutosave();
});

const zoomLabel = $('#zoom-label');
view.listeners.push(() => { zoomLabel.textContent = `${Math.round(view.scale * 100)}%`; });
const zoomStep = (f) => view.zoomBy(f);
$('#btn-zoom-in').addEventListener('click', () => zoomStep(1.25));
$('#btn-zoom-out').addEventListener('click', () => zoomStep(0.8));
$('#btn-fit').addEventListener('click', () => view.fit());
$('#btn-actual').addEventListener('click', () => view.zoomTo(1));

// ---------------------------------------------------------------------------
// Reference pictures: search, import, paste, drag-and-drop

const refCard = {
  empty: $('#ref-empty'),
  filled: $('#ref-filled'),
  thumb: $('#ref-thumb'),
  title: $('#ref-title'),
  link: $('#ref-link'),
  visible: $('#ref-visible'),
  opacity: $('#ref-opacity'),
  opacityOut: $('#out-ref-opacity'),
  modeOverlay: $('#ref-mode-overlay'),
  modeSplit: $('#ref-mode-split'),
  behind: $('#ref-behind'),
  above: $('#ref-above'),
  outline: $('#ref-outline'),
  outlineOut: $('#out-ref-outline'),
  detail: $('#ref-detail'),
  detailOut: $('#out-ref-detail'),
  lineOpts: $('#ref-line-opts'),
  lineColors: [...document.querySelectorAll('[data-line]')],
};
let refThumbFor = null;

function refreshReference() {
  const ref = state.doc?.reference;
  refCard.empty.hidden = !!ref;
  refCard.filled.hidden = !ref;
  if (!ref) {
    refThumbFor = null;
    if (state.shared.split) {
      state.shared.split = false;
      applySplit();
    }
    return;
  }
  if (refThumbFor !== ref) {
    refThumbFor = ref;
    const t = document.createElement('canvas');
    const s = Math.min(1, 160 / Math.max(ref.canvas.width, ref.canvas.height));
    t.width = Math.round(ref.canvas.width * s);
    t.height = Math.round(ref.canvas.height * s);
    t.getContext('2d').drawImage(ref.canvas, 0, 0, t.width, t.height);
    refCard.thumb.src = t.toDataURL('image/jpeg', 0.8);
  }
  refCard.title.textContent = ref.title || 'Your picture';
  refCard.title.title = ref.credit || ref.title || '';
  const by = [ref.creator && `by ${ref.creator}`, ref.license].filter(Boolean).join(' · ');
  refCard.link.textContent = ref.landingUrl ? (by || 'View original') : by;
  if (ref.landingUrl) refCard.link.href = ref.landingUrl;
  else refCard.link.removeAttribute('href');
  refCard.visible.checked = ref.visible;
  refCard.opacity.value = Math.round(ref.opacity * 100);
  refCard.opacityOut.textContent = `${Math.round(ref.opacity * 100)}%`;
  refCard.behind.setAttribute('aria-pressed', String(ref.placement !== 'above'));
  refCard.above.setAttribute('aria-pressed', String(ref.placement === 'above'));
  refCard.outline.value = Math.round(ref.outline * 100);
  refCard.outlineOut.textContent = outlineLabel(ref.outline);
  refCard.detail.value = Math.round(ref.detail * 100);
  refCard.detailOut.textContent = `${Math.round(ref.detail * 100)}%`;
  refCard.lineOpts.hidden = ref.outline <= 0;
  for (const b of refCard.lineColors) b.classList.toggle('current', b.dataset.line === ref.lineColor);
  refPane.requestRender();
}

function outlineLabel(v) {
  if (v <= 0) return 'Photo';
  if (v >= 1) return 'Lines';
  return `${Math.round(v * 100)}%`;
}

// ---- Split screen: the picture on the left, the drawing on the right.

const stageEl = $('#stage');
const refPaneEl = $('#ref-pane');

function applySplit() {
  const on = state.shared.split;
  stageEl.classList.toggle('split', on);
  refPaneEl.hidden = !on;
  refCard.modeOverlay.setAttribute('aria-pressed', String(!on));
  refCard.modeSplit.setAttribute('aria-pressed', String(on));
  if (on) refPane.resize();
}

function setSplit(on) {
  if (on && !state.doc.reference) {
    toast('Add a picture first, then you can show it side by side.');
    return;
  }
  state.shared.split = on;
  const ref = state.doc.reference;
  // Side by side usually means drawing without the picture underneath,
  // so hide it on the drawing (and bring it back when leaving).
  if (ref) {
    if (on && ref.visible) { ref.visible = false; ref._hiddenForSplit = true; }
    else if (!on && ref._hiddenForSplit) { ref.visible = true; }
    if (!on) ref._hiddenForSplit = false;
  }
  applySplit();
  refreshReference();
  view.requestRender();
  saveSettings();
  scheduleAutosave();
}

function toggleReferenceVisible() {
  const ref = state.doc.reference;
  if (!ref) return;
  ref.visible = !ref.visible;
  ref._hiddenForSplit = false;
  refreshReference();
  view.requestRender();
  scheduleAutosave();
}

function setReference(next, label) {
  const doc = state.doc;
  const prev = doc.reference;
  doc.reference = next;
  history.push({
    label,
    undo() { doc.reference = prev; },
    redo() { doc.reference = next; },
  });
}

refCard.visible.addEventListener('change', () => {
  const ref = state.doc.reference;
  if (!ref) return;
  ref.visible = refCard.visible.checked;
  view.requestRender();
  scheduleAutosave();
});
refCard.opacity.addEventListener('input', () => {
  const ref = state.doc.reference;
  if (!ref) return;
  ref.opacity = Number(refCard.opacity.value) / 100;
  if (ref.opacity > 0 && !ref.visible) {
    ref.visible = true;
    refCard.visible.checked = true;
  }
  refCard.opacityOut.textContent = `${refCard.opacity.value}%`;
  view.requestRender();
});
refCard.opacity.addEventListener('change', scheduleAutosave);

refCard.modeOverlay.addEventListener('click', () => setSplit(false));
refCard.modeSplit.addEventListener('click', () => setSplit(true));

function setPlacement(placement) {
  const ref = state.doc.reference;
  if (!ref) return;
  ref.placement = placement;
  if (!ref.visible) { ref.visible = true; ref._hiddenForSplit = false; }
  refreshReference();
  view.requestRender();
  scheduleAutosave();
}
refCard.behind.addEventListener('click', () => setPlacement('behind'));
refCard.above.addEventListener('click', () => setPlacement('above'));

let outlineTimer = 0;
function updateOutline(apply) {
  const ref = state.doc.reference;
  if (!ref) return;
  apply(ref);
  refCard.outlineOut.textContent = outlineLabel(ref.outline);
  refCard.detailOut.textContent = `${Math.round(ref.detail * 100)}%`;
  refCard.lineOpts.hidden = ref.outline <= 0;
  // Building the outline takes a moment on big pictures, so coalesce slider moves.
  cancelAnimationFrame(outlineTimer);
  outlineTimer = requestAnimationFrame(() => {
    view.requestRender();
    refPane.requestRender();
  });
}
refCard.outline.addEventListener('input', () => updateOutline((ref) => { ref.outline = Number(refCard.outline.value) / 100; }));
refCard.detail.addEventListener('input', () => updateOutline((ref) => { ref.detail = Number(refCard.detail.value) / 100; }));
refCard.outline.addEventListener('change', scheduleAutosave);
refCard.detail.addEventListener('change', scheduleAutosave);
for (const b of refCard.lineColors) {
  b.addEventListener('click', () => {
    updateOutline((ref) => { ref.lineColor = b.dataset.line; });
    refreshReference();
    scheduleAutosave();
  });
}
$('#ref-remove').addEventListener('click', () => {
  if (state.doc.reference) setReference(null, 'Remove picture');
});

const placeDialog = $('#place-dialog');

/** Asks whether to start a new drawing or put the picture behind the current one. */
function askPlacement(canvas, credit) {
  $('#place-preview').src = canvas.toDataURL('image/jpeg', 0.85);
  $('#place-credit').textContent = credit || '';
  return new Promise((resolve) => {
    placeDialog.addEventListener('close', () => resolve(placeDialog.returnValue || 'cancel'), { once: true });
    placeDialog.returnValue = 'cancel';
    placeDialog.showModal();
  });
}

let importing = false;

/**
 * Brings a picture in as the reference.
 * @param {{blob?: Blob, url?: string, fallbacks?: string[], meta?: object}} src
 * @returns {Promise<boolean>} true if a picture was placed
 */
async function importPicture(src) {
  if (importing) return false;
  importing = true;
  try {
    let blob = src.blob;
    if (!blob && src.url) {
      toast('Downloading the picture…');
      blob = await loadImageFromUrl(src.url, src.fallbacks || []);
    }
    const canvas = await blobToCanvas(blob);
    const ref = new Reference(canvas, src.meta || {});
    if (searchDialog.open) searchDialog.close();
    const choice = await askPlacement(canvas, ref.credit);
    if (choice === 'cancel') return false;
    if (choice === 'new') {
      const size = canvasSizeFor(canvas.width, canvas.height);
      const doc = new DrawingDocument(size.w, size.h, '#ffffff');
      ref.fitTo(size.w, size.h);
      doc.reference = ref;
      setDocument(doc);
    } else {
      ref.fitTo(state.doc.width, state.doc.height);
      setReference(ref, 'Add picture');
    }
    scheduleAutosave();
    toast('Picture added. Use the Reference picture panel to fade it in or out.');
    return true;
  } catch (err) {
    toast(err.message);
    throw err;
  } finally {
    importing = false;
  }
}

const searchDialog = $('#search-dialog');
const imageSearch = new ImageSearch({
  dialog: searchDialog,
  async onPick(result) {
    await importPicture({ url: result.url, fallbacks: result.thumbnail ? [result.thumbnail] : [], meta: result.meta });
  },
});
const openSearch = () => imageSearch.open();
$('#btn-find').addEventListener('click', openSearch);
$('#ref-find').addEventListener('click', openSearch);
$('#ref-replace').addEventListener('click', openSearch);

const imageInput = $('#file-image');
const pickImageFile = () => imageInput.click();
$('#btn-import').addEventListener('click', pickImageFile);
$('#ref-import').addEventListener('click', pickImageFile);
imageInput.addEventListener('change', () => {
  const file = imageInput.files[0];
  imageInput.value = '';
  if (file) importPicture({ blob: file, meta: { title: file.name.replace(/\.[^.]+$/, '') } }).catch(() => {});
});

async function importFound(found, fallbackTitle) {
  if (!found) return false;
  if (found.file) {
    return importPicture({ blob: found.file, meta: { title: found.file.name && found.file.name !== 'image.png' ? found.file.name.replace(/\.[^.]+$/, '') : fallbackTitle } });
  }
  return importPicture({ url: found.url, meta: { title: fallbackTitle } });
}

document.addEventListener('paste', (e) => {
  if (isTyping(e.target) || placeDialog.open || newDialog.open) return;
  const found = findImageIn(e.clipboardData);
  if (found) {
    e.preventDefault();
    importFound(found, 'Pasted picture').catch(() => {});
  } else {
    toast('No picture to paste. On a website, right-click a picture and choose Copy image, then press Ctrl+V here.');
  }
});

const stage = $('#stage');
let dragDepth = 0;
stage.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth += 1;
  stage.classList.add('dragging');
});
stage.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});
stage.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) stage.classList.remove('dragging');
});
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  stage.classList.remove('dragging');
  const found = findImageIn(e.dataTransfer);
  if (found) importFound(found, 'Dropped picture').catch(() => {});
  else toast("That doesn't look like a picture. Try dragging the image itself.");
});
// Don't let a drop outside the canvas navigate away from the app.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ---------------------------------------------------------------------------
// Keyboard

function isTyping(target) {
  return target instanceof HTMLElement &&
    (target.matches('input[type="text"], input[type="search"], input[type="number"], textarea, select') || target.isContentEditable);
}

window.addEventListener('keydown', (e) => {
  if (isTyping(e.target) || newDialog.open || placeDialog.open || searchDialog.open) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (mod) {
    if (key === 'z' && e.shiftKey) { e.preventDefault(); history.redo(); }
    else if (key === 'z') { e.preventDefault(); history.undo(); }
    else if (key === 'y') { e.preventDefault(); history.redo(); }
    else if (key === 's') { e.preventDefault(); saveProject(); }
    else if (key === 'e') { e.preventDefault(); exportImage(); }
    return;
  }
  if (e.altKey) return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (!spaceDown) { spaceDown = true; updateCursor(); }
    return;
  }
  const brush = brushToolFor();
  if ((key === '[' || key === ']') && brush) {
    const s = state.tools[brush];
    const next = key === ']' ? s.size * 1.2 : s.size / 1.2;
    s.size = Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(next * 2) / 2));
    syncOptions();
    updateCursor();
    saveSettings();
    return;
  }
  if (key === '0') { view.fit(); return; }
  if (key === '1') { view.zoomTo(1); return; }
  if (key === '+' || key === '=') { zoomStep(1.25); return; }
  if (key === '-' || key === '_') { zoomStep(0.8); return; }
  if (key === 'r') { toggleReferenceVisible(); return; }
  if (key === 's') { setSplit(!state.shared.split); return; }
  const tool = TOOL_ORDER.find((id) => TOOLS[id].key === key);
  if (tool) selectTool(tool);
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    spaceDown = false;
    updateCursor();
  }
});
window.addEventListener('blur', () => {
  spaceDown = false;
  updateCursor();
});

// ---------------------------------------------------------------------------
// Start up: restore the last drawing from this browser if there is one.

setColor(state.color, false);
selectTool(state.tool);
$('#btn-undo').disabled = true;
$('#btn-redo').disabled = true;

(async () => {
  let doc = null;
  try {
    const saved = await storage.idbGet(AUTOSAVE_KEY);
    if (saved) doc = await storage.deserializeDoc(saved);
  } catch (err) {
    console.warn('Could not restore the last drawing', err);
  }
  setDocument(doc || new DrawingDocument(1600, 1200, '#ffffff'));
  applySplit();
  setSaveStatus(doc ? 'Restored your last drawing' : 'Your work saves automatically in this browser');
})();

// Handy for debugging from the browser console.
window.drawme = { state, history, view, importPicture };
