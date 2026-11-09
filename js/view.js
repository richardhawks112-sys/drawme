// The on-screen view: zoom, pan, and drawing the document onto the screen.

export class Viewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.doc = null;
    this.scale = 1;
    this.x = 0;
    this.y = 0;
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    /** {stroke, layer} while a stroke is in progress */
    this.liveStroke = null;
    /** Pointer position in CSS pixels relative to the canvas, or null */
    this.cursor = null;
    /** Brush radius in document pixels; 0 hides the brush outline */
    this.cursorRadius = 0;
    /** Extra drawing hooks run after the layers, in document space: fn(ctx, view) */
    this.overlays = [];
    /** Called after every zoom or pan */
    this.listeners = [];
    this._raf = 0;
    this._compose = document.createElement('canvas');
    this._composeCtx = this._compose.getContext('2d');
    this._checker = this._makeChecker();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
  }

  _makeChecker() {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#d9d9d9';
    g.fillRect(0, 0, 8, 8);
    g.fillRect(8, 8, 8, 8);
    return this.ctx.createPattern(c, 'repeat');
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const first = this.width === 0;
    const oldW = this.width;
    const oldH = this.height;
    this.dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this._rect = this.canvas.getBoundingClientRect();
    // Keep the drawing fitted to the window until the user zooms or pans.
    if ((first || !this.userMoved) && this.doc) {
      this.fit();
    } else if (this.doc && rect.width > 0 && rect.height > 0 && oldW > 0 && oldH > 0) {
      // The user has zoomed or panned: keep the same spot in the middle of the
      // view (e.g. when side by side halves the width), and never lose the paper.
      this.x += (rect.width - oldW) / 2;
      this.y += (rect.height - oldH) / 2;
      this._keepVisible();
      this._changed();
    }
    this.requestRender();
  }

  setDocument(doc) {
    this.doc = doc;
    this._compose.width = doc.width;
    this._compose.height = doc.height;
    this.fit();
  }

  fit() {
    if (!this.doc || !this.width) return;
    const pad = 24;
    const s = Math.min((this.width - pad * 2) / this.doc.width, (this.height - pad * 2) / this.doc.height);
    this.scale = Math.max(0.02, Math.min(s, 8));
    this.x = (this.width - this.doc.width * this.scale) / 2;
    this.y = (this.height - this.doc.height * this.scale) / 2;
    this.userMoved = false;
    this._changed();
  }

  /** Zooms to `scale`, keeping the point under (cx, cy) in place. */
  zoomTo(scale, cx = this.width / 2, cy = this.height / 2) {
    const s = Math.max(0.02, Math.min(scale, 32));
    const dx = (cx - this.x) / this.scale;
    const dy = (cy - this.y) / this.scale;
    this.scale = s;
    this.x = cx - dx * s;
    this.y = cy - dy * s;
    this.userMoved = true;
    this._changed();
  }

  zoomBy(factor, cx, cy) {
    this.zoomTo(this.scale * factor, cx, cy);
  }

  panBy(dx, dy) {
    this.x += dx;
    this.y += dy;
    this.userMoved = true;
    this._keepVisible();
    this._changed();
  }

  /** Keeps at least a strip of the paper on screen so it can't get lost. */
  _keepVisible() {
    if (!this.doc || !this.width) return;
    const w = this.doc.width * this.scale;
    const h = this.doc.height * this.scale;
    const mx = Math.min(48, w, this.width / 2);
    const my = Math.min(48, h, this.height / 2);
    this.x = Math.min(this.width - mx, Math.max(mx - w, this.x));
    this.y = Math.min(this.height - my, Math.max(my - h, this.y));
  }

  /** Client (page) coordinates to document coordinates. */
  toDoc(clientX, clientY) {
    const r = this._rect;
    return { x: (clientX - r.left - this.x) / this.scale, y: (clientY - r.top - this.y) / this.scale };
  }

  /** Client coordinates to CSS pixels relative to the canvas. */
  toLocal(clientX, clientY) {
    const r = this._rect;
    return { x: clientX - r.left, y: clientY - r.top };
  }

  refreshRect() {
    this._rect = this.canvas.getBoundingClientRect();
  }

  _changed() {
    this.requestRender();
    for (const fn of this.listeners) fn();
  }

  requestRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.render();
    });
  }

  render() {
    const { ctx, dpr, doc } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = getComputedStyle(this.canvas).getPropertyValue('--stage-bg') || '#202124';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!doc) return;

    const s = this.scale;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * this.x, dpr * this.y);

    // Paper with a soft shadow.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 18 * dpr;
    ctx.fillStyle = doc.background || this._checker;
    ctx.fillRect(0, 0, doc.width, doc.height);
    ctx.restore();

    ctx.imageSmoothingEnabled = s < 2;
    ctx.imageSmoothingQuality = 'high';
    const ref = doc.reference;
    const showRef = ref && ref.visible && ref.opacity > 0;
    if (showRef && ref.placement !== 'above') ref.draw(ctx);
    const live = this.liveStroke;
    for (const layer of doc.layers) {
      if (!layer.visible) continue;
      let src = layer.canvas;
      if (live && live.layer === layer) {
        const c = this._composeCtx;
        c.globalCompositeOperation = 'copy';
        c.drawImage(layer.canvas, 0, 0);
        c.globalCompositeOperation = 'source-over';
        live.stroke.drawTo(c);
        src = this._compose;
      }
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(src, 0, 0);
    }
    ctx.globalAlpha = 1;
    if (showRef && ref.placement === 'above') ref.draw(ctx);
    for (const fn of this.overlays) fn(ctx, this);

    // Brush outline, in screen space.
    if (this.cursor && this.cursorRadius > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const { x, y } = this.cursor;
      const r = this.cursorRadius * s;
      ctx.lineWidth = 1;
      if (r >= 3) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.5, r - 1), 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.stroke();
      }
      // Small crosshair so tiny brushes are still easy to place.
      ctx.beginPath();
      ctx.moveTo(x - 4, y + 0.5); ctx.lineTo(x + 5, y + 0.5);
      ctx.moveTo(x + 0.5, y - 4); ctx.lineTo(x + 0.5, y + 5);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke();
    }
  }
}
