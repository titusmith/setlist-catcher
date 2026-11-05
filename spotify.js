// Spotify for Setlist Buddy: sign-in (Authorization Code with PKCE, no secret),
// track matching, and playlist creation. Uses the Web API as it stands after
// Spotify's February 2026 changes: POST /me/playlists, POST and PUT
// /playlists/{id}/items, and search with limit <= 10.
// Matching logic is carried over from the Setlist to Spotify extension.
(function () {
  'use strict';
  const API = 'https://api.spotify.com/v1';
  const AUTH = 'https://accounts.spotify.com/authorize';
  const TOKEN = 'https://accounts.spotify.com/api/token';
  const SCOPES = 'playlist-modify-private playlist-modify-public';
  const K = { client: 'sc.spotify.clientId', tok: 'sc.spotify.tokens', pkce: 'sc.spotify.pkce' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} }
  };

  class SpotifyError extends Error { constructor(code, message) { super(message); this.code = code; } }

  // The app folder, e.g. https://titusmith.github.io/setlist-catcher/
  const base = () => new URL('./', location.origin + location.pathname).href;
  const redirectUri = () => base() + 'callback.html';

  const clientId = () => ls.get(K.client) || '';
  const setClientId = (id) => ls.set(K.client, id.trim());

  // ---------- PKCE ----------
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const randomString = (n = 64) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); };
  const challenge = async (v) => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));

  // Sends the browser to Spotify. `resume` is remembered so the app can pick up where it left off.
  async function login(resume) {
    const id = clientId();
    if (!id) throw new SpotifyError('no_client', 'Add your Spotify Client ID first.');
    const verifier = randomString();
    const state = randomString(16);
    ls.set(K.pkce, { verifier, state, resume: resume || null, at: Date.now() });
    const url = new URL(AUTH);
    url.search = new URLSearchParams({
      client_id: id, response_type: 'code', redirect_uri: redirectUri(),
      code_challenge_method: 'S256', code_challenge: await challenge(verifier),
      scope: SCOPES, state
    });
    location.assign(url.href);
  }

  async function tokenRequest(params) {
    let res;
    try {
      res = await fetch(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
    } catch { throw new SpotifyError('offline', 'No connection to Spotify. Try again when you have signal.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new SpotifyError(data.error || 'token', data.error_description || data.error || `Spotify sign-in failed (${res.status})`);
    return data;
  }

  function saveTokens(t) {
    const old = ls.get(K.tok) || {};
    ls.set(K.tok, {
      access: t.access_token,
      refresh: t.refresh_token || old.refresh, // Spotify rotates refresh tokens; keep the newest
      expiresAt: Date.now() + ((t.expires_in || 3600) - 60) * 1000
    });
  }

  // Called by callback.html with the query string Spotify sent back.
  async function finishLogin(search) {
    const p = new URLSearchParams(search);
    const saved = ls.get(K.pkce);
    ls.del(K.pkce);
    if (p.get('error')) throw new SpotifyError(p.get('error'), p.get('error') === 'access_denied' ? 'You cancelled the Spotify sign-in.' : 'Spotify sign-in failed: ' + p.get('error'));
    if (!saved || saved.state !== p.get('state')) throw new SpotifyError('state', 'That sign-in link expired. Tap Connect Spotify again.');
    const tok = await tokenRequest({
      grant_type: 'authorization_code', code: p.get('code'), redirect_uri: redirectUri(),
      client_id: clientId(), code_verifier: saved.verifier
    });
    saveTokens(tok);
    return saved.resume;
  }

  let refreshing = null;
  async function getToken(force) {
    const t = ls.get(K.tok);
    if (!t || (!t.access && !t.refresh)) throw new SpotifyError('not_connected', 'Connect Spotify first.');
    if (!force && t.access && Date.now() < t.expiresAt) return t.access;
    if (!t.refresh) { ls.del(K.tok); throw new SpotifyError('not_connected', 'Connect Spotify again.'); }
    refreshing = refreshing || tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: clientId() })
      .then((tok) => { saveTokens(tok); return tok.access_token; })
      .catch((e) => { if (e.code !== 'offline') ls.del(K.tok); throw e.code === 'offline' ? e : new SpotifyError('not_connected', 'Your Spotify sign-in expired. Connect again.'); })
      .finally(() => { refreshing = null; });
    return refreshing;
  }
  const isConnected = () => { const t = ls.get(K.tok); return !!(t && (t.access || t.refresh)); };
  const disconnect = () => ls.del(K.tok);

  async function api(path, opts = {}) {
    let retried401 = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const token = await getToken();
      let res;
      try {
        res = await fetch(API + path, { ...opts, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
      } catch { throw new SpotifyError('offline', 'No connection to Spotify. Try again when you have signal.'); }
      if (res.status === 429) { await sleep((Number(res.headers.get('Retry-After')) || 2) * 1000); continue; }
      if (res.status === 401 && !retried401) { retried401 = true; await getToken(true); continue; }
      if (!res.ok) {
        let msg = '';
        try { msg = (await res.json()).error?.message || ''; } catch {}
        if (res.status === 403) throw new SpotifyError('forbidden', 'Spotify blocked this account. In the Spotify developer dashboard, add your Spotify account under User Management for this app' + (msg ? ` (${msg})` : '') + '.');
        throw new SpotifyError('api', `Spotify returned ${res.status}${msg ? ': ' + msg : ''}`);
      }
      return res.status === 204 ? null : res.json().catch(() => null);
    }
    throw new SpotifyError('rate', 'Spotify is rate-limiting requests. Wait a minute and try again.');
  }

  // ---------- matching (from the extension's spotify.js) ----------
  const norm = (s) => (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\s[-–]\s.*(remaster|version|edit|mix|live|mono|stereo).*$/i, '')
    .replace(/[([].*?[)\]]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  function score(item, title, artist) {
    const nt = norm(title);
    const ni = norm(item.name);
    let s = 0;
    if (ni === nt) s += 50;
    else if (ni.startsWith(nt) || nt.startsWith(ni)) s += 30;
    else if (ni.includes(nt) || nt.includes(ni)) s += 15;
    else s -= 20;

    if (artist) {
      const na = norm(artist);
      const names = item.artists.map((a) => norm(a.name));
      if (names.includes(na)) s += 40;
      else if (names.some((n) => n.includes(na) || na.includes(n))) s += 20;
      else s -= 30;
    }

    const wanted = title.toLowerCase();
    const name = item.name.toLowerCase();
    const all = `${name} ${item.album?.name || ''}`.toLowerCase();
    if (!/live/.test(wanted) && /\blive\b/.test(all)) s -= 8;
    if (/karaoke|tribute|instrumental|made famous|in the style of|cover version/.test(all)) s -= 40;
    for (const w of ['demo', 'acoustic', 'remix', 'edit']) {
      if (!wanted.includes(w) && name.includes(w)) s -= 6;
    }
    if (item.album?.album_type === 'compilation') s -= 3;
    return s;
  }

  async function search(q) {
    const data = await api(`/search?type=track&limit=10&q=${encodeURIComponent(q)}`);
    return data?.tracks?.items || [];
  }

  // "Morning Glory (Oasis cover)" -> { title: 'Morning Glory', coverOf: 'Oasis' }
  function splitCover(raw) {
    const m = (raw || '').match(/\(([^()]+?)\s+cover\)/i);
    return { title: (raw || '').replace(/\s*\([^()]*cover\)\s*/i, ' ').trim(), coverOf: m ? m[1].trim() : '' };
  }

  // Returns { track, confident } or { track: null }
  async function findTrack({ title, artist, coverOf }, preferOriginal) {
    const t = title.replace(/[([].*?[)\]]/g, '').replace(/["“”]/g, '').trim() || title;
    const artists = (preferOriginal && coverOf ? [coverOf, artist] : [artist, coverOf]).filter(Boolean);
    const attempts = artists.map((a) => ({ q: `track:${t} artist:${a}`, a }));
    attempts.push({ q: artists[0] ? `${t} ${artists[0]}` : t, a: artists[0] || '' });

    let best = null;
    for (const { q, a } of attempts) {
      for (const item of await search(q)) {
        const s = score(item, t, a);
        if (!best || s > best.s) best = { item, s };
      }
      const enough = artists.length ? 70 : 45;
      if (best && best.s >= enough) return { track: best.item, confident: true };
    }
    if (best && best.s > 10) return { track: best.item, confident: false };
    return { track: null };
  }

  async function createPlaylist({ name, description, uris }) {
    const pl = await api('/me/playlists', {
      method: 'POST',
      body: JSON.stringify({ name: name.slice(0, 100), description: description.slice(0, 300), public: false })
    });
    for (let i = 0; i < uris.length; i += 100) {
      await api(`/playlists/${pl.id}/items`, { method: 'POST', body: JSON.stringify({ uris: uris.slice(i, i + 100) }) });
    }
    return { id: pl.id, url: pl.external_urls?.spotify || `https://open.spotify.com/playlist/${pl.id}` };
  }

  // Replaces every song in a playlist this app made (no duplicate playlist).
  async function replaceItems(id, uris) {
    await api(`/playlists/${id}/items`, { method: 'PUT', body: JSON.stringify({ uris: uris.slice(0, 100) }) });
    for (let i = 100; i < uris.length; i += 100) {
      await api(`/playlists/${id}/items`, { method: 'POST', body: JSON.stringify({ uris: uris.slice(i, i + 100) }) });
    }
  }

  window.SPOT = { SpotifyError, redirectUri, clientId, setClientId, login, finishLogin, getToken, isConnected, disconnect,
    findTrack, splitCover, createPlaylist, replaceItems, norm };
})();
