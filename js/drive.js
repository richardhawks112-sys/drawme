// Saving to and opening from the person's own Google Drive, straight from
// the browser. Sign-in uses Google Identity Services; files go through the
// Drive API with the drive.file scope, so DrawMe can only see the files it
// made itself, nothing else in the person's Drive.

const GIS_URL = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FOLDER_NAME = 'DrawMe';
const FILE_MIME = 'application/json';
const MULTIPART_LIMIT = 4 * 1024 * 1024;

let gisPromise = null;
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_URL;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gisPromise = null;
        reject(new Error("Couldn't reach Google. Check your internet connection."));
      };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

export class DriveError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

export class Drive {
  constructor(clientId) {
    this.clientId = clientId;
    this.token = null;
    this.expiresAt = 0;
    this.folderId = null;
    this._client = null;
    this._pending = null;
  }

  get configured() { return Boolean(this.clientId); }

  get connected() { return Boolean(this.token) && Date.now() < this.expiresAt - 60_000; }

  /** Opens Google's sign-in popup. Must be called from a click. */
  async connect() {
    if (!this.configured) throw new DriveError('Google Drive is not set up for this copy of DrawMe.');
    await loadGis();
    if (!this._client) {
      this._client = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPE,
        callback: (resp) => {
          const p = this._pending;
          this._pending = null;
          if (!p) return;
          if (resp.error) {
            p.reject(new DriveError(resp.error === 'access_denied'
              ? 'Google Drive access was not allowed.' : `Google sign-in failed (${resp.error}).`));
          } else if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
            p.reject(new DriveError('DrawMe needs permission to save its files in your Drive. Tick the box when Google asks.'));
          } else {
            this.token = resp.access_token;
            this.expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
            p.resolve();
          }
        },
        error_callback: (err) => {
          const p = this._pending;
          this._pending = null;
          if (!p) return;
          p.reject(new DriveError(err?.type === 'popup_closed'
            ? 'The Google sign-in window was closed.'
            : err?.type === 'popup_failed_to_open'
              ? 'The Google sign-in window was blocked. Allow pop-ups for this site and try again.'
              : 'Google sign-in did not finish.'));
        },
      });
    }
    this._pending?.reject(new DriveError('Google sign-in was started again.'));
    await new Promise((resolve, reject) => {
      this._pending = { resolve, reject };
      this._client.requestAccessToken();
    });
  }

  disconnect() {
    if (this.token && window.google?.accounts?.oauth2) {
      google.accounts.oauth2.revoke(this.token, () => {});
    }
    this.token = null;
    this.expiresAt = 0;
    this.folderId = null;
  }

  async _fetch(url, options = {}) {
    if (!this.connected) throw new DriveError('Not connected to Google Drive.', 401);
    let res;
    try {
      res = await fetch(url, {
        ...options,
        headers: { Authorization: `Bearer ${this.token}`, ...(options.headers || {}) },
      });
    } catch {
      throw new DriveError("Couldn't reach Google Drive. Check your internet connection.");
    }
    if (res.status === 401) {
      this.token = null;
      this.expiresAt = 0;
      throw new DriveError('Google Drive sign-in has expired.', 401);
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch { /* not JSON */ }
      if (res.status === 403 && /quota|storage/i.test(detail)) {
        throw new DriveError('Your Google Drive is full.', 403);
      }
      throw new DriveError(detail || `Google Drive error ${res.status}.`, res.status);
    }
    return res;
  }

  async _folder() {
    if (this.folderId) return this.folderId;
    const q = `mimeType='${FOLDER_MIME}' and name='${FOLDER_NAME}' and trashed=false`;
    const res = await this._fetch(`${API}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`);
    const found = (await res.json()).files?.[0];
    if (found) {
      this.folderId = found.id;
    } else {
      const made = await this._fetch(`${API}/files?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
      });
      this.folderId = (await made.json()).id;
    }
    return this.folderId;
  }

  /**
   * Creates the file, or replaces its contents when fileId is given.
   * @returns {Promise<{id: string, name: string, modifiedTime: string}>}
   */
  async save({ fileId, name, blob, thumbnail }) {
    const meta = { name };
    if (thumbnail) meta.contentHints = { thumbnail: { image: thumbnail, mimeType: 'image/png' } };
    if (fileId) {
      try {
        return await this._upload(`${UPLOAD}/files/${encodeURIComponent(fileId)}`, 'PATCH', meta, blob);
      } catch (err) {
        if (err.status !== 404) throw err;
        // The file was deleted from Drive; make a new one.
      }
    }
    meta.mimeType = FILE_MIME;
    meta.parents = [await this._folder()];
    return this._upload(`${UPLOAD}/files`, 'POST', meta, blob);
  }

  async _upload(base, method, meta, blob) {
    const fields = 'id,name,modifiedTime';
    if (blob.size <= MULTIPART_LIMIT) {
      const boundary = `drawme${Math.random().toString(36).slice(2)}`;
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
        `--${boundary}\r\nContent-Type: ${FILE_MIME}\r\n\r\n`,
        blob,
        `\r\n--${boundary}--`,
      ]);
      const res = await this._fetch(`${base}?uploadType=multipart&fields=${fields}`, {
        method,
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      });
      return res.json();
    }
    // Big drawings: resumable upload.
    const start = await this._fetch(`${base}?uploadType=resumable&fields=${fields}`, {
      method,
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': FILE_MIME,
        'X-Upload-Content-Length': String(blob.size),
      },
      body: JSON.stringify(meta),
    });
    const location = start.headers.get('Location');
    if (!location) throw new DriveError('Google Drive did not accept the upload.');
    const res = await this._fetch(location, { method: 'PUT', body: blob });
    return res.json();
  }

  /** The DrawMe projects this app has saved in the person's Drive. */
  async list() {
    const params = new URLSearchParams({
      q: "trashed=false and name contains '.drawme'",
      orderBy: 'modifiedTime desc',
      fields: 'files(id,name,modifiedTime,size)',
      pageSize: '50',
      spaces: 'drive',
    });
    const res = await this._fetch(`${API}/files?${params}`);
    return (await res.json()).files || [];
  }

  async download(fileId) {
    const res = await this._fetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
    return res.text();
  }
}
