// Searching for free photos and artwork with Openverse (https://openverse.org).
// Openverse needs no API key, so it works for anyone the app is shared with.

const API = 'https://api.openverse.org/v1/images/';
const PAGE_SIZE = 20;

// "Anime and manga" isn't an Openverse category, so we add a style word to the
// search and leave out Flickr, which is mostly cosplay photos rather than drawings.
const ANIME_WORDS = /\b(anime|manga|chibi|kawaii|otaku|shoujo|shojo|shonen|shounen)\b/i;
const ANIME_EXCLUDED_SOURCES = 'flickr';

// The app is used by children. Openverse already hides results marked mature or
// sensitive; this is a second check on each result's title and tags.
const UNSAFE = new RegExp('\\b(' + [
  'nsfw', 'nude', 'nudes', 'nudity', 'naked', 'topless', 'nipple', 'nipples', 'sex', 'sexy', 'sexual',
  'erotic', 'erotica', 'porn', 'porno', 'hentai', 'ecchi', 'lewd', 'fetish', 'bdsm', 'bondage',
  'lingerie', 'underwear', 'panties', 'pantsu', 'bikini', 'swimsuit', 'boobs', 'breasts', 'busty',
  'cleavage', 'butt', 'ass', 'oppai', 'yaoi', 'yuri', 'futanari', 'loli', 'lolicon', 'shota',
  'seductive', 'sultry', 'pinup', 'pin-up', 'stripper', 'gore', 'gory', 'blood', 'bloody',
  'corpse', 'dead', 'death', 'kill', 'killing', 'murder', 'suicide', 'drugs', 'weed', 'beer',
].join('|') + ')\\b', 'i');

function isKidSafe(r) {
  if (r.mature) return false;
  const text = [r.title, ...(r.tags || []).map((t) => t && t.name)].filter(Boolean).join(' ');
  return !UNSAFE.test(text);
}

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
    this.ideas = dialog.querySelector('#search-ideas');
    this.query = '';
    this.page = 0;
    this.pageCount = 0;
    this.busy = false;

    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.search(this.input.value.trim());
    });
    this.category.addEventListener('change', () => {
      this._updateIdeas();
      this._updateWebLink();
      if (this.query) this.search(this.query);
    });
    this.ideas.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-q]');
      if (!btn) return;
      this.input.value = btn.dataset.q;
      this._updateWebLink();
      this.search(btn.dataset.q);
    });
    this.input.addEventListener('input', () => this._updateWebLink());
    this.more.addEventListener('click', () => this._loadPage(this.page + 1));
    dialog.querySelector('#search-close').addEventListener('click', () => dialog.close());
    this._updateIdeas();
    this._updateWebLink();
  }

  get _anime() {
    return this.category.value === 'anime';
  }

  _updateIdeas() {
    this.ideas.hidden = !this._anime;
  }

  open() {
    this.dialog.showModal();
    this.input.focus();
    this.input.select();
  }

  _updateWebLink() {
    let q = this.input.value.trim() || 'drawing reference';
    if (this._anime && !ANIME_WORDS.test(q)) q += ' anime';
    this.webLink.href = `https://www.google.com/search?tbm=isch&safe=active&q=${encodeURIComponent(q)}`;
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
    try {
      let data = await this._fetch(page, true);
      // If leaving out Flickr finds nothing, try again with every source.
      if (this._anime && page === 1 && !(data.results || []).length) data = await this._fetch(page, false);
      this.page = page;
      this.pageCount = data.page_count || 0;
      const results = data.results || [];
      for (const r of results) if (isKidSafe(r)) this.grid.appendChild(this._tile(r));
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

  async _fetch(page, excludeSources) {
    let q = this.query;
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE), mature: 'false' });
    if (this._anime) {
      if (!ANIME_WORDS.test(q)) q += ' anime';
      if (excludeSources) params.set('excluded_source', ANIME_EXCLUDED_SOURCES);
    } else if (this.category.value) {
      params.set('category', this.category.value);
    }
    params.set('q', q);
    const res = await fetch(`${API}?${params}`, { headers: { Accept: 'application/json' } });
    // Fall back to every source if Openverse ever stops accepting excluded_source.
    if (res.status === 400 && params.has('excluded_source')) return this._fetch(page, false);
    if (res.status === 429) throw new Error('The picture search is busy right now. Wait a minute and try again.');
    if (!res.ok) throw new Error(`The picture search didn't answer (error ${res.status}). Try again in a moment.`);
    return res.json();
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
