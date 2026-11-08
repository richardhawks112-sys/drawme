// Undo / redo. Every command is pushed *after* it has been applied and must
// provide undo() and redo(). `bytes` is used to keep memory use bounded.

export class History extends EventTarget {
  constructor({ limit = 100, maxBytes = 400 * 1024 * 1024 } = {}) {
    super();
    this.limit = limit;
    this.maxBytes = maxBytes;
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  push(cmd) {
    this.undoStack.push(cmd);
    this.redoStack.length = 0;
    this._trim();
    this._emit();
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
    this._emit();
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.redo();
    this.undoStack.push(cmd);
    this._emit();
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this._emit();
  }

  _trim() {
    let bytes = 0;
    for (const c of this.undoStack) bytes += c.bytes || 0;
    while (this.undoStack.length > 1 && (this.undoStack.length > this.limit || bytes > this.maxBytes)) {
      bytes -= this.undoStack.shift().bytes || 0;
    }
  }

  _emit() {
    this.dispatchEvent(new Event('change'));
  }
}

/** A change to a rectangle of pixels on one layer. */
export function pixelCommand(layer, rect, before, after, label = 'Draw') {
  return {
    label,
    bytes: before.data.length + after.data.length,
    undo() { layer.ctx.putImageData(before, rect.x, rect.y); },
    redo() { layer.ctx.putImageData(after, rect.x, rect.y); },
  };
}

/** Runs fn() on layer and records the pixels it changed inside rect. */
export function recordPixels(layer, rect, label, fn) {
  const before = layer.ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
  fn(layer.ctx);
  const after = layer.ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
  return pixelCommand(layer, rect, before, after, label);
}
