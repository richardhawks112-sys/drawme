// The left half of split screen: the reference picture on its own, zoomed
// and panned together with the drawing so the same spot lines up in both.
// A crosshair follows the pen so you can see where you are on the picture.

export class ReferencePane {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./view.js').Viewport} view  the drawing view to follow
   */
  constructor(canvas, view) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = view;
    this.ghost = null; // document point under the pen, or null
    this._raf = 0;
    this._drag = null;
    view.listeners.push(() => this.requestRender());
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this._bindInput();
  }

  get active() {
    return !this.canvas.parentElement.hidden;
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.requestRender();
  }

  setGhost(pt) {
    this.ghost = pt;
    if (this.active) this.requestRender();
  }

  requestRender() {
    if (this._raf || !this.active) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.render();
    });
  }

  render() {
    const { ctx, view } = this;
    const doc = view.doc;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = getComputedStyle(this.canvas).getPropertyValue('--stage-bg') || '#202124';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!doc) return;
    // Same zoom and position as the drawing, so both line up.
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 18 * dpr;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, doc.width, doc.height);
    ctx.restore();
    ctx.imageSmoothingEnabled = view.scale < 2;
    ctx.imageSmoothingQuality = 'high';
    const ref = doc.reference;
    if (ref) ref.draw(ctx, 1);

    if (this.ghost) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const x = view.x + this.ghost.x * view.scale;
      const y = view.y + this.ghost.y * view.scale;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      this._cross(x, y);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#e53935';
      this._cross(x, y);
    }
  }

  _cross(x, y) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x - 10, y); ctx.lineTo(x - 3, y);
    ctx.moveTo(x + 3, y); ctx.lineTo(x + 10, y);
    ctx.moveTo(x, y - 10); ctx.lineTo(x, y - 3);
    ctx.moveTo(x, y + 3); ctx.lineTo(x, y + 10);
    ctx.stroke();
  }

  _bindInput() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      c.style.cursor = 'grabbing';
    });
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      const v = this.view;
      this.setGhost({ x: (e.clientX - r.left - v.x) / v.scale, y: (e.clientY - r.top - v.y) / v.scale });
      if (!this._drag || this._drag.id !== e.pointerId) return;
      v.panBy(e.clientX - this._drag.x, e.clientY - this._drag.y);
      this._drag.x = e.clientX;
      this._drag.y = e.clientY;
    });
    const end = () => {
      this._drag = null;
      c.style.cursor = 'grab';
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => this.setGhost(null));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      this.view.zoomBy(Math.exp(-e.deltaY * unit * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
  }
}
