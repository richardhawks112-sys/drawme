// Searching for free photos and artwork with Openverse (https://openverse.org).
// Openverse needs no API key, so it works for anyone the app is shared with.

const API = 'https://api.openverse.org/v1/images/';
const PAGE_SIZE = 20;

function licenseName(code, version) {
  if (!code) return '';
  if (code === 'cc0') return 'CC0';
  if (code === 'pdm') return 'Public domain';
  return `CC ${code.toUpperCase()} ${version || ''}`.trim();
}

export class ImageSearch {
  /**
   * @param {{dialog: HTMLDialogElement, onPick(result: object): Promise<void>}} o
   */
  constructor({ dialog, onPick }) {
    this.dialog = dialog;
    this.onPick = onPick;
    this.form = dialog.querySelector('#search-form');
    this.input = dialog.querySelector('#search-q');
    this.category = dialog.querySelector('#search-cat');
    this.grid = dialog.querySelector('#search-results');
    this.status = dialog.querySelector('#search-status');
    this.more = dialog.querySelector('#search-more');
    this.webLink = dialog.querySelector('#search-web');
    this.query = '';
    this.page = 0;
    this.pageCount = 0;
    this.busy = false;

    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.search(this.input.value.trim());
    });
    this.category.addEventListener('change', () => {
      if (this.query) this.search(this.query);
    });
    this.input.addEventListener('input', () => this._updateWebLink());
    this.more.addEventListener('click', () => this._loadPage(this.page + 1));
    dialog.querySelector('#search-close').addEventListener('click', () => dialog.close());
    this._updateWebLink();
  }

  open() {
    this.dialog.showModal();
    this.input.focus();
    this.input.select();
  }

  _updateWebLink() {
    const q = this.input.value.trim() || 'drawing reference';
    this.webLink.href = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`;
  }

  async search(query) {
    if (!query) {
      this.input.focus();
      return;
    }
    this.query = query;
    this.grid.replaceChildren();
    this.page = 0;
    this.pageCount = 0;
    await this._loadPage(1);
  }

  async _loadPage(page) {
    if (this.busy) return;
    this.busy = true;
    this.more.hidden = true;
    this._setStatus(page === 1 ? 'Searching…' : 'Loading more…');
    const params = new URLSearchParams({ q: this.query, page: String(page), page_size: String(PAGE_SIZE) });
    if (this.category.value) params.set('category', this.category.value);
    try {
      const res = await fetch(`${API}?${params}`, { headers: { Accept: 'application/json' } });
      if (res.status === 429) throw new Error('The picture search is busy right now. Wait a minute and try again.');
      if (!res.ok) throw new Error(`The picture search didn't answer (error ${res.status}). Try again in a moment.`);
      const data = await res.json();
      this.page = page;
      this.pageCount = data.page_count || 0;
      const results = data.results || [];
      for (const r of results) this.grid.appendChild(this._tile(r));
      if (!this.grid.children.length) {
        this._setStatus(`No pictures found for “${this.query}”. Try a simpler word, or search the web below.`);
      } else {
        this._setStatus(`${data.result_count > 240 ? 'Lots of' : data.result_count} results for “${this.query}”. Click one to use it.`);
      }
      this.more.hidden = !(results.length && page < this.pageCount);
    } catch (err) {
      this._setStatus(err instanceof TypeError
        ? "Couldn't reach the picture search. Check your internet connection."
        : err.message);
    } finally {
      this.busy = false;
    }
  }

  _tile(r) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'result';
    const title = r.title || 'Untitled';
    btn.title = `${title}${r.creator ? ` by ${r.creator}` : ''}`;
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = title;
    img.referrerPolicy = 'no-referrer';
    img.src = r.thumbnail || r.url;
    img.addEventListener('error', () => btn.remove());
    btn.appendChild(img);
    btn.addEventListener('click', async () => {
      if (this.busy) return;
      this.busy = true;
      btn.classList.add('loading');
      this._setStatus('Downloading the picture…');
      try {
        await this.onPick({
          url: r.url,
          thumbnail: r.thumbnail,
          meta: {
            title,
            creator: r.creator || '',
            license: licenseName(r.license, r.license_version),
            licenseUrl: r.license_url || '',
            landingUrl: r.foreign_landing_url || '',
          },
        });
        this.dialog.close();
      } catch (err) {
        this._setStatus(err.message);
      } finally {
        btn.classList.remove('loading');
        this.busy = false;
      }
    });
    return btn;
  }

  _setStatus(text) {
    this.status.textContent = text;
  }
}
