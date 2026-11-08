// Tools and the stroke engine.
//
// A stroke is drawn as a series of round "dabs" stamped along the pen path.
// Dabs go into a private buffer canvas; the buffer is then composited onto
// the layer with the tool's opacity and blend mode. That keeps a marker
// stroke evenly translucent where it overlaps itself, and lets the eraser
// preview live before it is committed.

export const TOOLS = {
  pen: {
    id: 'pen', name: 'Pen', key: 'b', kind: 'brush', paints: true,
    spacing: 0.08, minSize: 0.15,
    defaults: { size: 6, opacity: 1, hardness: 0.95, pressureSize: true, pressureOpacity: false },
  },
  pencil: {
    id: 'pencil', name: 'Pencil', key: 'p', kind: 'brush', paints: true,
    spacing: 0.12, minSize: 0.45, grain: true,
    defaults: { size: 4, opacity: 1, hardness: 0.85, pressureSize: true, pressureOpacity: true },
  },
  marker: {
    id: 'marker', name: 'Marker', key: 'm', kind: 'brush', paints: true,
    spacing: 0.06, minSize: 0.6,
    defaults: { size: 24, opacity: 0.5, hardness: 1, pressureSize: false, pressureOpacity: false },
  },
  airbrush: {
    id: 'airbrush', name: 'Airbrush', key: 'a', kind: 'brush', paints: true,
    spacing: 0.05, minSize: 1, buildUp: true, flow: 0.05,
    defaults: { size: 80, opacity: 0.6, hardness: 0, pressureSize: false, pressureOpacity: true },
  },
  eraser: {
    id: 'eraser', name: 'Eraser', key: 'e', kind: 'brush', paints: false,
    spacing: 0.08, minSize: 0.3, composite: 'destination-out',
    defaults: { size: 30, opacity: 1, hardness: 0.9, pressureSize: true, pressureOpacity: false },
  },
  fill: { id: 'fill', name: 'Fill', key: 'g', kind: 'fill', paints: true },
  eyedropper: { id: 'eyedropper', name: 'Pick color', key: 'i', kind: 'picker' },
  hand: { id: 'hand', name: 'Move view', key: 'h', kind: 'hand' },
};

export const TOOL_ORDER = ['pen', 'pencil', 'marker', 'airbrush', 'eraser', 'fill', 'eyedropper', 'hand'];

const MAX_SPRITE = 256;

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function makeSprite(color, hardness, diameter, grain) {
  const d = Math.max(8, Math.min(MAX_SPRITE, Math.ceil(diameter)));
  const c = document.createElement('canvas');
  c.width = c.height = d;
  const ctx = c.getContext('2d', { willReadFrequently: grain });
  const r = d / 2;
  const [cr, cg, cb] = hexToRgb(color);
  const solid = `rgba(${cr},${cg},${cb},1)`;
  const clear = `rgba(${cr},${cg},${cb},0)`;
  // A hard brush still gets about one pixel of soft edge so it stays smooth.
  const inner = Math.max(0, Math.min(hardness, 1 - 1.2 / r));
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, solid);
  g.addColorStop(inner, solid);
  g.addColorStop(1, clear);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, d, d);
  if (grain) {
    const img = ctx.getImageData(0, 0, d, d);
    const px = img.data;
    for (let i = 3; i < px.length; i += 4) px[i] = px[i] * (0.3 + 0.7 * Math.random());
    ctx.putImageData(img, 0, 0);
  }
  return c;
}

let sharedBuffer = null;

function getBuffer(width, height) {
  if (!sharedBuffer || sharedBuffer.width !== width || sharedBuffer.height !== height) {
    sharedBuffer = document.createElement('canvas');
    sharedBuffer.width = width;
    sharedBuffer.height = height;
  } else {
    sharedBuffer.getContext('2d').clearRect(0, 0, width, height);
  }
  return sharedBuffer;
}

export class Stroke {
  /**
   * @param {{width:number, height:number, tool:object, settings:object, color:string}} o
   */
  constructor({ width, height, tool, settings, color }) {
    this.width = width;
    this.height = height;
    this.tool = tool;
    this.settings = { ...settings };
    this.buffer = getBuffer(width, height);
    this.ctx = this.buffer.getContext('2d');
    const spriteColor = tool.paints ? color : '#000000';
    const variants = tool.grain ? 4 : 1;
    this.sprites = [];
    for (let i = 0; i < variants; i++) {
      this.sprites.push(makeSprite(spriteColor, this.settings.hardness, this.settings.size, tool.grain));
    }
    this.last = null;
    this.toNext = 0;
    this.minX = Infinity; this.minY = Infinity; this.maxX = -Infinity; this.maxY = -Infinity;
  }

  diameterAt(p) {
    const { size, pressureSize } = this.settings;
    if (!pressureSize) return size;
    const min = this.tool.minSize;
    return size * (min + (1 - min) * p);
  }

  addPoint(x, y, p) {
    if (!this.last) {
      this.stamp(x, y, p);
      this.last = { x, y, p };
      this.toNext = this.spacingAt(p);
      return;
    }
    const { x: lx, y: ly, p: lp } = this.last;
    const dx = x - lx;
    const dy = y - ly;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6) {
      this.last.p = p;
      return;
    }
    let pos = this.toNext;
    while (pos <= dist) {
      const t = pos / dist;
      const pp = lp + (p - lp) * t;
      this.stamp(lx + dx * t, ly + dy * t, pp);
      pos += this.spacingAt(pp);
    }
    this.toNext = pos - dist;
    this.last = { x, y, p };
  }

  spacingAt(p) {
    return Math.max(0.4, this.diameterAt(p) * this.tool.spacing);
  }

  stamp(x, y, p) {
    const { tool, settings } = this;
    const d = Math.max(0.6, this.diameterAt(p));
    const r = d / 2;
    let alpha;
    if (tool.buildUp) {
      // Airbrush: each dab adds a little paint.
      alpha = tool.flow * (settings.pressureOpacity ? p : 1);
    } else if (settings.pressureOpacity) {
      // About 1/spacing dabs overlap at any spot; pick the per-dab alpha so
      // that together they reach the pressure-based target darkness.
      const target = 0.08 + 0.92 * p;
      const overlap = Math.max(1, 1 / tool.spacing);
      alpha = 1 - Math.pow(1 - target, 1 / overlap);
    } else {
      alpha = 1;
    }
    const sprite = this.sprites[this.sprites.length > 1 ? (Math.random() * this.sprites.length) | 0 : 0];
    this.ctx.globalAlpha = Math.min(1, alpha);
    this.ctx.drawImage(sprite, x - r, y - r, d, d);
    const m = r + 2;
    if (x - m < this.minX) this.minX = x - m;
    if (y - m < this.minY) this.minY = y - m;
    if (x + m > this.maxX) this.maxX = x + m;
    if (y + m > this.maxY) this.maxY = y + m;
  }

  /** Integer rectangle touched by the stroke, clipped to the document. */
  bounds() {
    const x = Math.max(0, Math.floor(this.minX));
    const y = Math.max(0, Math.floor(this.minY));
    const x2 = Math.min(this.width, Math.ceil(this.maxX));
    const y2 = Math.min(this.height, Math.ceil(this.maxY));
    if (x2 <= x || y2 <= y) return null;
    return { x, y, w: x2 - x, h: y2 - y };
  }

  /** Composites the stroke onto ctx (a layer, or a preview copy of one). */
  drawTo(ctx) {
    const b = this.bounds();
    if (!b) return;
    ctx.save();
    ctx.globalAlpha = this.settings.opacity;
    ctx.globalCompositeOperation = this.tool.composite || 'source-over';
    ctx.drawImage(this.buffer, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
    ctx.restore();
  }
}
