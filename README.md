# DrawMe

A drawing-practice app that runs in your web browser. Draw with a pen tablet
(pressure works), a mouse, or a touch screen. There's nothing to install.

The plan is to let you find a photo or artwork, trace or copy it with
adjustable overlays and split screen, and then compare your drawing with the
original. So far you can draw, bring in a picture to draw from, and control how
that picture shows while you draw.

## What works now

- **Reference pictures:** click **Find photo** to search free-to-use photos and artwork from [Openverse](https://openverse.org). You can also paste any picture with **Ctrl+V** (right-click it on a website and choose *Copy image*), drag one onto the canvas from another tab or a folder, or use **Import picture**. You can start a new drawing the same shape as the picture or put it behind your current drawing, then fade it with the opacity slider. The picture saves with your drawing, it's left out of PNG exports, and the color picker can pick colors from it.
- **While you draw:** show the picture behind your lines or on top like tracing paper, and set its opacity. The **Outline** slider fades the photo into just its outlines, using edge detection, and you can choose line detail and line color. **Side by side** puts the picture next to your drawing. Both sides zoom and pan together, and a red crosshair on the picture shows where your pen is. Press **R** to show or hide the picture, and **S** for side by side.
- **Tools:** pen, pencil, marker, airbrush, eraser, fill bucket, color picker, and a move tool.
- **Pen tablets:** pressure changes size and/or opacity, with a "feel" setting for a soft or firm touch. The eraser end of the pen erases, and the side button picks a color.
- **Smoothing** steadies shaky lines.
- **Layers:** add, copy, reorder, hide, rename (double-click), opacity, merge down, and clear.
- **Undo and redo** for every stroke and layer change.
- **Saving:** your drawing saves automatically in your browser a moment after each change. **Save** downloads a `.drawme` project file with its layers, **Open** loads one back, and **Export PNG** downloads a picture.
- **Google Drive:** click **Google Drive** to connect your own Drive. Drawings save into a **DrawMe** folder there, and keep saving as you draw. You can open them again from any computer. DrawMe can only see the files it made, nothing else in your Drive. After you reload the page, click **Google Drive: click to reconnect** in the status bar to carry on.
- **Hover descriptions:** rest the pointer on a button for half a second to see what it does.
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

## Turning on Google Drive saving

Google only lets a website use Drive if it has its own OAuth client ID. It's free,
and the ID is not a secret.

1. Go to https://console.cloud.google.com and create a project (any name, e.g. "DrawMe").
2. **APIs & Services → Library**: search for **Google Drive API** and click **Enable**.
3. **APIs & Services → OAuth consent screen** (also called **Google Auth Platform**):
   choose **External**, enter the app name and your email, and save. Under **Data access**
   add the scope `.../auth/drive.file`. Under **Audience**, either add each family member's
   Google address as a test user, or click **Publish app** so anyone can use it.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   type **Web application**, and under **Authorized JavaScript origins** add
   `https://<your-username>.github.io` (and `http://localhost:8000` for testing).
5. Copy the client ID (it ends in `.apps.googleusercontent.com`) into
   `GOOGLE_CLIENT_ID` in `js/config.js`.

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
| `js/config.js` | The Google OAuth client ID for Drive saving |
| `js/drive.js`, `js/drive-ui.js` | Google Drive sign-in, saving and opening, and its dialog |
| `js/tooltip.js` | Hover descriptions |
| `js/layers-panel.js` | The layers list |
| `js/reference.js` | Loading reference pictures from files, the clipboard, drops and the web |
| `js/search.js` | The Openverse picture search |
| `js/outline.js` | Turns a picture into outlines (edge detection) |
| `js/ref-pane.js` | The picture half of side-by-side view |

Some websites don't let other pages download their pictures directly. In that case
DrawMe fetches the picture through the free [images.weserv.nl](https://images.weserv.nl)
image proxy instead. Copying and pasting a picture always works.
