// The drawing document: a fixed-size stack of layers plus a background colour.

let nextLayerId = 1;

export class Layer {
  constructor(width, height, name = 'Layer') {
    this.id = nextLayerId++;
    this.name = name;
    this.visible = true;
    this.opacity = 1;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
  }

  clone(name) {
    const copy = new Layer(this.canvas.width, this.canvas.height, name ?? `${this.name} copy`);
    copy.visible = this.visible;
    copy.opacity = this.opacity;
    copy.ctx.drawImage(this.canvas, 0, 0);
    return copy;
  }
}

export class DrawingDocument {
  /**
   * @param {number} width
   * @param {number} height
   * @param {string|null} background  CSS colour, or null for transparent
   * @param {{emptyLayers?: boolean}} [options]
   */
  constructor(width, height, background = '#ffffff', { emptyLayers = false } = {}) {
    this.width = width;
    this.height = height;
    this.background = background;
    this.layers = [];
    this.activeIndex = 0;
    this._layerCounter = 0;
    if (!emptyLayers) this.insertLayer(0, this.createLayer());
  }

  get activeLayer() {
    return this.layers[this.activeIndex];
  }

  createLayer(name) {
    this._layerCounter += 1;
    return new Layer(this.width, this.height, name ?? `Layer ${this._layerCounter}`);
  }

  insertLayer(index, layer) {
    this.layers.splice(index, 0, layer);
    this.activeIndex = index;
  }

  removeLayer(index) {
    const [layer] = this.layers.splice(index, 1);
    this.activeIndex = Math.max(0, Math.min(this.activeIndex, this.layers.length - 1));
    return layer;
  }

  moveLayer(from, to) {
    const [layer] = this.layers.splice(from, 1);
    this.layers.splice(to, 0, layer);
    this.activeIndex = to;
  }

  setActive(index) {
    this.activeIndex = Math.max(0, Math.min(index, this.layers.length - 1));
  }

  /** Draws background + visible layers into ctx (in document coordinates). */
  drawInto(ctx, { background = true } = {}) {
    if (background && this.background) {
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    for (const layer of this.layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(layer.canvas, 0, 0);
    }
    ctx.globalAlpha = 1;
  }

  /** Returns a new canvas with everything flattened. */
  flatten({ background = true } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    this.drawInto(canvas.getContext('2d'), { background });
    return canvas;
  }

  /** Colour of the flattened image at a document point: [r, g, b, a]. */
  sampleColor(x, y) {
    if (!this._sampler) {
      this._sampler = document.createElement('canvas');
      this._sampler.width = this._sampler.height = 1;
      this._samplerCtx = this._sampler.getContext('2d', { willReadFrequently: true });
    }
    const ctx = this._samplerCtx;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.save();
    ctx.translate(-ix, -iy);
    this.drawInto(ctx);
    ctx.restore();
    return ctx.getImageData(0, 0, 1, 1).data;
  }
}
