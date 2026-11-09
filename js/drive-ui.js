// The Google Drive dialog, plus saving to Drive in the background while
// the person draws.

import { Drive } from './drive.js';
import { GOOGLE_CLIENT_ID } from './config.js';
import * as storage from './storage.js';

const KEY = 'drawme.drive.v1';
const SYNC_DELAY = 4000;
const EXT = '.drawme';

const $ = (sel) => document.querySelector(sel);

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || 'null') || {};
    return {
      used: Boolean(p.used),
      auto: p.auto !== false,
      fileId: typeof p.fileId === 'string' ? p.fileId : null,
      name: typeof p.name === 'string' && p.name ? p.name : defaultName(),
    };
  } catch {
    return { used: false, auto: true, fileId: null, name: defaultName() };
  }
}

function defaultName() {
  return `Drawing ${storage.timestamp()}`;
}

function cleanName(name) {
  const n = String(name || '').replace(/\.drawme$/i, '').trim().slice(0, 100);
  return n || defaultName();
}

function timeText(iso) {
  const d = iso ? new Date(iso) : new Date();
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * @param {object} hooks
 * @param {() => import('./document.js').DrawingDocument} hooks.getDoc
 * @param {() => boolean} hooks.hasEdits  whether the drawing is worth saving yet
 * @param {(doc, file: {id: string, name: string}) => void} hooks.openDoc
 * @param {(msg: string) => void} hooks.toast
 */
export function setupDrive({ getDoc, hasEdits, openDoc, toast }) {
  const drive = new Drive(GOOGLE_CLIENT_ID);
  const prefs = loadPrefs();
  const dialog = $('#drive-dialog');
  const statusBtn = $('#status-drive');
  const nameInput = $('#drive-name');
  const autoBox = $('#drive-auto');
  const dialogStatus = $('#drive-status');
  const filesEl = $('#drive-files');

  let timer = 0;
  let busy = false;
  let again = false;
  let generation = 0;
  let lastSaved = '';
  let dirty = false; // changes not yet in Drive
  let justOpened = false; // the next local save is the file we just opened

  function savePrefs() {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  }

  function setStatus(text, { reconnect = false } = {}) {
    statusBtn.hidden = !text;
    statusBtn.textContent = text;
    statusBtn.classList.toggle('attention', reconnect);
    statusBtn.dataset.reconnect = reconnect ? '1' : '';
    dialogStatus.textContent = text;
  }

  function needsReconnect() {
    setStatus('Google Drive: click to reconnect', { reconnect: true });
  }

  function render() {
    $('#drive-off').hidden = drive.configured;
    $('#drive-signin').hidden = !drive.configured || drive.connected;
    $('#drive-on').hidden = !drive.connected;
    nameInput.value = prefs.name;
    autoBox.checked = prefs.auto;
  }

  async function connect() {
    await drive.connect();
    prefs.used = true;
    savePrefs();
    setStatus(lastSaved ? `Saved to Google Drive ${lastSaved}` : 'Connected to Google Drive');
    render();
  }

  // ---- Background saving ----

  function schedule(delay = SYNC_DELAY) {
    clearTimeout(timer);
    timer = setTimeout(sync, delay);
  }

  async function sync() {
    clearTimeout(timer);
    timer = 0;
    if (!drive.connected) {
      if (prefs.used) needsReconnect();
      return false;
    }
    if (busy) {
      again = true;
      return false;
    }
    busy = true;
    dirty = false;
    const gen = generation;
    setStatus('Saving to Google Drive…');
    try {
      const doc = getDoc();
      const blob = await storage.projectBlob(doc);
      let thumbnail;
      try { thumbnail = storage.thumbnailBase64(doc); } catch { /* optional */ }
      const file = await drive.save({ fileId: prefs.fileId, name: prefs.name + EXT, blob, thumbnail });
      if (gen === generation) {
        prefs.fileId = file.id;
        savePrefs();
      }
      lastSaved = timeText();
      setStatus(`Saved to Google Drive ${lastSaved}`);
      return true;
    } catch (err) {
      console.warn('Google Drive save failed', err);
      dirty = true;
      if (err.status === 401) needsReconnect();
      else setStatus(`Google Drive: couldn't save. ${err.message}`, { reconnect: false });
      throw err;
    } finally {
      busy = false;
      if (again) {
        again = false;
        schedule(500);
      }
    }
  }

  function syncQuietly(delay) {
    if (delay) schedule(delay);
    else sync().catch(() => {});
  }

  // ---- Dialog ----

  async function refreshList() {
    filesEl.textContent = 'Loading…';
    try {
      const files = await drive.list();
      filesEl.textContent = '';
      if (!files.length) {
        filesEl.innerHTML = '<p class="hint">Nothing saved yet.</p>';
        return;
      }
      for (const f of files) {
        const row = document.createElement('div');
        row.className = 'drive-file';
        if (f.id === prefs.fileId) row.classList.add('current');
        const name = document.createElement('span');
        name.className = 'drive-file-name';
        name.textContent = f.name.replace(/\.drawme$/i, '');
        const when = document.createElement('span');
        when.className = 'drive-file-when';
        when.textContent = f.id === prefs.fileId ? 'Open now' : timeText(f.modifiedTime);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Open';
        btn.disabled = f.id === prefs.fileId;
        btn.addEventListener('click', () => openFile(f));
        row.append(name, when, btn);
        filesEl.appendChild(row);
      }
    } catch (err) {
      if (err.status === 401) {
        render();
        needsReconnect();
      }
      filesEl.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = `Couldn't list your drawings: ${err.message}`;
      filesEl.appendChild(p);
    }
  }

  async function openFile(file) {
    try {
      // Make sure the drawing on screen is safely in Drive before replacing it.
      if (prefs.auto && prefs.fileId && dirty && drive.connected) await sync().catch(() => {});
      setStatus(`Opening ${file.name.replace(/\.drawme$/i, '')}…`);
      const text = await drive.download(file.id);
      const doc = await storage.deserializeDoc(JSON.parse(text));
      openDoc(doc, { id: file.id, name: file.name });
      lastSaved = timeText(file.modifiedTime);
      setStatus(`Opened from Google Drive`);
      dialog.close();
      toast(`Opened ${cleanName(file.name)} from Google Drive`);
    } catch (err) {
      setStatus('');
      toast(err instanceof SyntaxError ? 'That Drive file is not a DrawMe project.' : `Couldn't open it: ${err.message}`);
    }
  }

  async function openDialog() {
    render();
    if (!dialog.open) dialog.showModal();
    if (drive.connected) refreshList();
  }

  $('#btn-drive').addEventListener('click', openDialog);
  $('#drive-close').addEventListener('click', () => dialog.close());

  $('#drive-connect').addEventListener('click', async () => {
    try {
      await connect();
      refreshList();
      if (prefs.auto && (dirty || (!prefs.fileId && hasEdits()))) syncQuietly();
    } catch (err) {
      toast(err.message);
    }
  });

  $('#drive-save').addEventListener('click', async () => {
    prefs.name = cleanName(nameInput.value);
    savePrefs();
    try {
      await sync();
      refreshList();
      toast('Saved to your Google Drive, in the DrawMe folder.');
    } catch (err) {
      toast(`Couldn't save to Google Drive: ${err.message}`);
    }
  });

  $('#drive-disconnect').addEventListener('click', () => {
    clearTimeout(timer);
    drive.disconnect();
    prefs.used = false;
    savePrefs();
    setStatus('');
    render();
    toast('Disconnected from Google Drive. Your drawings stay in your Drive.');
  });

  nameInput.addEventListener('change', () => {
    prefs.name = cleanName(nameInput.value);
    nameInput.value = prefs.name;
    savePrefs();
    if (prefs.fileId && drive.connected) syncQuietly(300);
  });

  autoBox.addEventListener('change', () => {
    prefs.auto = autoBox.checked;
    savePrefs();
    if (prefs.auto && drive.connected && (prefs.fileId || hasEdits())) syncQuietly(300);
  });

  statusBtn.addEventListener('click', async () => {
    if (statusBtn.dataset.reconnect && drive.configured) {
      try {
        await connect();
        if (dirty) syncQuietly();
      } catch (err) {
        toast(err.message);
      }
    } else {
      openDialog();
    }
  });

  if (!drive.configured) $('#btn-drive').title = 'Save your drawings to Google Drive (not set up yet)';

  // Saving to Drive was on last time: show it needs a click to carry on.
  if (drive.configured && prefs.used && prefs.auto) needsReconnect();

  return {
    /** Call after the drawing changes (and has been saved in the browser). */
    docChanged() {
      if (justOpened) {
        justOpened = false;
        return;
      }
      if (!prefs.used || !prefs.auto) return;
      if (!prefs.fileId && !hasEdits()) return;
      dirty = true;
      if (!drive.connected) {
        if (drive.configured) needsReconnect();
        return;
      }
      schedule();
    },
    /** Call when a different drawing is put on screen. */
    docReplaced(file = null) {
      generation++;
      clearTimeout(timer);
      timer = 0;
      dirty = false;
      justOpened = Boolean(file);
      prefs.fileId = file?.id || null;
      prefs.name = file ? cleanName(file.name) : defaultName();
      savePrefs();
      if (!file) lastSaved = '';
      if (dialog.open) render();
    },
  };
}
