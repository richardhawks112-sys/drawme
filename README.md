# DrawMe

A drawing-practice app that runs in your web browser. Draw with a pen tablet
(pressure works), a mouse, or a touch screen. There's nothing to install.

The plan is to let you find a photo or artwork, trace or copy it with
adjustable overlays and split screen, and then compare your drawing with the
original. This first version is the drawing canvas itself.

## What works now

- **Tools:** pen, pencil, marker, airbrush, eraser, fill bucket, color picker, and a move tool.
- **Pen tablets:** pressure changes size and/or opacity, with a "feel" setting for a soft or firm touch. The eraser end of the pen erases, and the side button picks a color.
- **Smoothing** steadies shaky lines.
- **Layers:** add, copy, reorder, hide, rename (double-click), opacity, merge down, and clear.
- **Undo and redo** for every stroke and layer change.
- **Saving:** your drawing saves automatically in your browser. **Save** downloads a `.drawme` project file with its layers, **Open** loads one back, and **Export PNG** downloads a picture.
- **Zoom and pan:** scroll to zoom. Hold Space and drag, or middle-drag, to move around.

## Using a pen tablet on Windows

Use Chrome or Edge. Most Wacom, XP-Pen and Huion tablets work as they are. If
lines don't get thicker when you press harder, open your tablet's settings app
and turn on **Windows Ink** (Wacom calls it "Use Windows Ink"). The status bar at
the bottom shows the pressure it's reading as you draw.

## Running it on your own computer

The app is plain HTML, CSS, and JavaScript with no build step. Browsers won't
run it straight from a double-clicked file, so serve the folder locally. Either
of these works:

```
python -m http.server 8000
npx serve .
```

Then open http://localhost:8000.

## Sharing it (GitHub Pages)

In the repository go to **Settings → Pages**. Under "Build and deployment" choose
**Deploy from a branch**, then pick `main` and `/ (root)` and save. After a minute
the app is live at `https://<your-username>.github.io/drawme/`.

## Code layout

| File | What it does |
| --- | --- |
| `index.html`, `css/style.css` | Page layout and styling |
| `js/app.js` | Wires everything together: input, tools, panels, shortcuts |
| `js/brushes.js` | Tool definitions and the stroke engine |
| `js/document.js` | The drawing: size, background, layers |
| `js/view.js` | Zoom, pan, and drawing it all on screen |
| `js/history.js` | Undo and redo |
| `js/fill.js` | Fill bucket |
| `js/storage.js` | Autosave, project files, PNG export |
| `js/layers-panel.js` | The layers list |
