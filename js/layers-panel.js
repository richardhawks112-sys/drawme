// The list of layers in the side panel.

import { ICONS } from './icons.js';

const THUMB_W = 48;
const THUMB_H = 36;

export class LayersPanel {
  /**
   * @param {HTMLElement} el
   * @param {{onSelect(i:number):void, onToggleVisible(i:number):void, onRename(i:number, name:string):void}} handlers
   */
  constructor(el, handlers) {
    this.el = el;
    this.handlers = handlers;
    this.thumbs = new Map(); // layer -> canvas
  }

  render(doc) {
    this.el.replaceChildren();
    this.thumbs.clear();
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const layer = doc.layers[i];
      const active = i === doc.activeIndex;
      const row = document.createElement('div');
      row.className = `layer-row${active ? ' active' : ''}${layer.visible ? '' : ' hidden-layer'}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(active));
      row.tabIndex = 0;

      const eye = document.createElement('button');
      eye.className = 'icon-btn eye';
      eye.innerHTML = layer.visible ? ICONS.eye : ICONS.eyeOff;
      eye.title = layer.visible ? 'Hide layer' : 'Show layer';
      eye.setAttribute('aria-label', eye.title);
      eye.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handlers.onToggleVisible(i);
      });

      const thumb = document.createElement('canvas');
      thumb.className = 'thumb';
      thumb.width = THUMB_W * 2;
      thumb.height = THUMB_H * 2;
      this.thumbs.set(layer, thumb);

      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = layer.name;
      name.title = 'Double-click to rename';
      name.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this._rename(name, i, layer.name);
      });

      const pct = document.createElement('span');
      pct.className = 'layer-pct';
      pct.textContent = layer.opacity < 1 ? `${Math.round(layer.opacity * 100)}%` : '';

      row.append(eye, thumb, name, pct);
      row.addEventListener('click', () => this.handlers.onSelect(i));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.handlers.onSelect(i); }
      });
      this.el.appendChild(row);
    }
    this.refreshThumbs(doc);
  }

  refreshThumbs(doc, only) {
    for (const [layer, thumb] of this.thumbs) {
      if (only && layer !== only) continue;
      const ctx = thumb.getContext('2d');
      ctx.clearRect(0, 0, thumb.width, thumb.height);
      const s = Math.min(thumb.width / doc.width, thumb.height / doc.height);
      const w = doc.width * s;
      const h = doc.height * s;
      const x = (thumb.width - w) / 2;
      const y = (thumb.height - h) / 2;
      if (doc.background) {
        ctx.fillStyle = doc.background;
        ctx.fillRect(x, y, w, h);
      }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(layer.canvas, x, y, w, h);
    }
  }

  _rename(span, index, current) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'layer-rename';
    input.value = current;
    input.maxLength = 40;
    span.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      if (commit && value && value !== current) this.handlers.onRename(index, value);
      else input.replaceWith(span);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
  }
}
