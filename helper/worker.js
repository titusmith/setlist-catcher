// Setlist Buddy helper: a Cloudflare Worker.
//
// What it does
//   GET  /setlist?artist=&date=YYYY-MM-DD&city=   Finds that artist's setlist for that date on setlist.fm.
//   GET  /vapid                                   The public key the app needs to turn on notifications.
//   POST /watch    {sub, subscription, shows}     Remember shows to check on, and where to send notifications.
//   GET  /notices?sub=                            Notifications waiting for this phone (read by the app's service worker).
//   Every few hours (Cron Trigger)                Checks setlist.fm for watched shows and notifies when one is posted,
//                                                 or reminds you to post yours if none has appeared after two days.
//
// Setup (Cloudflare dashboard)
//   1. Workers & Pages → Create → Worker → paste this file → Deploy.
//   2. Settings → Variables and Secrets → add a Secret named SETLISTFM_KEY (your setlist.fm API key).
//   3. Storage & Databases → KV → create a namespace; then Worker → Settings → Bindings → KV namespace, name it SB.
//   4. Settings → Triggers → Cron Triggers → add "0 */3 * * *" (every 3 hours).
//
// Notifications carry no content. The phone wakes up, then asks /notices what to show. That keeps this file
// simple and means nothing about your shows passes through the push service.

const APP_ORIGINS = ['https://titusmith.github.io'];
const APP_URL = 'https://titusmith.github.io/setlist-catcher/';
const SETLISTFM = 'https://api.setlist.fm/rest/1.0';
const REMIND_AFTER_DAYS = 2;   // no setlist posted by then → remind you to post yours
const STOP_AFTER_DAYS = 7;     // stop checking a show after this
const DAY = 86400000;

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': APP_ORIGINS.includes(origin) ? origin : APP_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    // Only the app may use this helper (keeps your setlist.fm key's quota yours).
    if (origin && !APP_ORIGINS.includes(origin)) return json({ error: 'not_allowed' }, 403, cors);
    const url = new URL(req.url);
    try {
      if (url.pathname === '/' || url.pathname === '/health') {
        return json({ ok: true, setlistfmKey: !!env.SETLISTFM_KEY, storage: !!env.SB }, 200, cors);
      }
      if (url.pathname === '/setlist' && req.method === 'GET') {
        const artist = url.searchParams.get('artist'), date = url.searchParams.get('date');
        if (!artist || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return json({ error: 'bad_request' }, 400, cors);
        const found = await findSetlist(env, artist, date, url.searchParams.get('city') || '');
        return json(found, 200, cors);
      }
      if (url.pathname === '/vapid' && req.method === 'GET') {
        const k = await vapidKeys(env);
        return json({ publicKey: k.publicKey }, 200, cors);
      }
      if (url.pathname === '/watch' && req.method === 'POST') {
        need(env);
        const body = await req.json();
        if (!body || !/^[\w-]{8,64}$/.test(body.sub || '') || !Array.isArray(body.shows)) return json({ error: 'bad_request' }, 400, cors);
        const key = 'sub:' + body.sub;
        const old = (await env.SB.get(key, 'json')) || { shows: [] };
        const shows = body.shows.slice(0, 20).map(s => {
          const prev = old.shows.find(o => o.id === s.id) || {};
          return { id: String(s.id).slice(0, 80), name: String(s.name || '').slice(0, 120), date: s.date, city: String(s.city || '').slice(0, 80),
            acts: (s.acts || []).slice(0, 8).map(a => String(a).slice(0, 80)), found: prev.found || {}, remindedAt: prev.remindedAt || null };
        }).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s.date || ''));
        await env.SB.put(key, JSON.stringify({ subscription: body.subscription || old.subscription || null, shows }));
        return json({ ok: true, watching: shows.length }, 200, cors);
      }
      if (url.pathname === '/notices' && req.method === 'GET') {
        need(env);
        const sub = url.searchParams.get('sub') || '';
        if (!/^[\w-]{8,64}$/.test(sub)) return json({ error: 'bad_request' }, 400, cors);
        const list = (await env.SB.get('notices:' + sub, 'json')) || [];
        await env.SB.delete('notices:' + sub);
        return json({ notices: list }, 200, cors);
      }
      return json({ error: 'not_found' }, 404, cors);
    } catch (e) {
      return json({ error: e.code || 'helper_error', message: e.message }, e.status || 500, cors);
    }
  },

  // Cron Trigger: check every watched show.
  async scheduled(_event, env, ctx) { ctx.waitUntil(checkAll(env)); }
};

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
function need(env) { if (!env.SB) { const e = new Error('Add the KV binding named SB.'); e.code = 'no_storage'; e.status = 500; throw e; } }
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');

// ---------- setlist.fm ----------
async function setlistfm(env, path) {
  if (!env.SETLISTFM_KEY) { const e = new Error('Add your setlist.fm API key as the secret SETLISTFM_KEY.'); e.code = 'no_setlistfm_key'; e.status = 500; throw e; }
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(SETLISTFM + path, { headers: { 'x-api-key': env.SETLISTFM_KEY, 'Accept': 'application/json', 'Accept-Language': 'en' } });
    if (r.status === 404) return null;                       // setlist.fm answers 404 when nothing matches
    if (r.status === 429) { await new Promise(res => setTimeout(res, 1200)); continue; }
    if (!r.ok) { const e = new Error('setlist.fm returned ' + r.status); e.code = 'setlistfm_' + r.status; e.status = 502; throw e; }
    return r.json();
  }
  const e = new Error('setlist.fm is busy. Try again in a minute.'); e.code = 'setlistfm_busy'; e.status = 503; throw e;
}

// Returns { found: false } or { found: true, url, venue, city, sets: [{ name, songs: [{ title, coverOf, info, tape }] }] }
async function findSetlist(env, artist, isoDate, city) {
  const cacheKey = 'sl:' + norm(artist) + ':' + isoDate + ':' + norm(city);
  if (env.SB) { const c = await env.SB.get(cacheKey, 'json'); if (c) return c; }
  const [y, m, d] = isoDate.split('-');
  const data = await setlistfm(env, `/search/setlists?artistName=${encodeURIComponent(artist)}&date=${d}-${m}-${y}&p=1`);
  const lists = (data && data.setlist) || [];
  const want = norm(artist), wantCity = norm((city || '').split(',')[0]);
  const scored = lists.map(s => ({ s, score: (norm(s.artist && s.artist.name) === want ? 2 : 0) + (wantCity && norm(s.venue && s.venue.city && s.venue.city.name) === wantCity ? 1 : 0) }))
    .filter(x => x.score >= 2).sort((a, b) => b.score - a.score);
  const best = scored[0] && scored[0].s;
  const sets = best ? ((best.sets && best.sets.set) || []).map((set, i, all) => ({
    name: set.encore ? (set.encore > 1 ? 'Encore ' + set.encore : 'Encore') : (set.name || (all.filter(x => !x.encore).length > 1 ? 'Set ' + (i + 1) : '')),
    songs: (set.song || []).filter(s => !s.tape).map(s => ({ title: s.name || '', coverOf: (s.cover && s.cover.name) || '', info: s.info || '' }))
  })).filter(set => set.songs.length) : [];
  const out = sets.length ? { found: true, url: best.url, venue: best.venue && best.venue.name, city: best.venue && best.venue.city && best.venue.city.name, sets } : { found: false };
  // Cache finds for a day; cache misses for 2 hours so new posts show up soon.
  if (env.SB) await env.SB.put(cacheKey, JSON.stringify(out), { expirationTtl: out.found ? 86400 : 7200 });
  return out;
}

// ---------- scheduled checks ----------
async function checkAll(env) {
  if (!env.SB || !env.SETLISTFM_KEY) return;
  const now = Date.now();
  let cursor;
  do {
    const page = await env.SB.list({ prefix: 'sub:', cursor });
    for (const k of page.keys) {
      const rec = await env.SB.get(k.name, 'json'); if (!rec) continue;
      const sub = k.name.slice(4), notices = [];
      const keep = [];
      for (const show of rec.shows) {
        const showDay = Date.parse(show.date + 'T12:00:00Z');
        if (now - showDay > STOP_AFTER_DAYS * DAY) continue;     // done with this one
        if (now < showDay - DAY / 2) { keep.push(show); continue; } // hasn't happened yet
        const newly = [];
        for (const act of show.acts) {
          if (show.found[act]) continue;
          try { const r = await findSetlist(env, act, show.date, show.city); if (r.found) { show.found[act] = true; newly.push(act); } }
          catch (e) { /* try again next run */ }
        }
        if (newly.length) notices.push({ title: 'Setlist posted: ' + show.name, body: newly.join(' and ') + ' on setlist.fm. Tap to review and approve.', showId: show.id });
        else if (!Object.keys(show.found).length && !show.remindedAt && now - showDay > REMIND_AFTER_DAYS * DAY) {
          show.remindedAt = now;
          notices.push({ title: 'No setlist yet for ' + show.name, body: 'Nobody has posted it on setlist.fm. Want to post yours? Your text is ready to copy.', showId: show.id, kind: 'reminder' });
        }
        keep.push(show);
      }
      rec.shows = keep;
      await env.SB.put(k.name, JSON.stringify(rec));
      if (notices.length) {
        const waiting = (await env.SB.get('notices:' + sub, 'json')) || [];
        await env.SB.put('notices:' + sub, JSON.stringify(waiting.concat(notices).slice(-20)), { expirationTtl: 14 * 86400 });
        if (rec.subscription && rec.subscription.endpoint) {
          const gone = await pushWake(env, rec.subscription.endpoint).catch(() => false);
          if (gone) { rec.subscription = null; await env.SB.put(k.name, JSON.stringify(rec)); }
        }
      }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
}

// ---------- web push (no payload; VAPID, RFC 8292) ----------
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uText = s => b64u(new TextEncoder().encode(s));

// Made once, kept in KV. Nothing for you to copy or paste.
async function vapidKeys(env) {
  need(env);
  const saved = await env.SB.get('vapid', 'json');
  if (saved) return saved;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const keys = { publicKey: b64u(await crypto.subtle.exportKey('raw', pair.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey) };
  await env.SB.put('vapid', JSON.stringify(keys));
  return keys;
}

async function vapidHeader(env, endpoint) {
  const keys = await vapidKeys(env);
  const priv = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64uText(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64uText(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: APP_URL }));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, new TextEncoder().encode(head + '.' + claims));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

// Returns true when the phone's subscription has expired (so we stop sending to it).
async function pushWake(env, endpoint) {
  const r = await fetch(endpoint, { method: 'POST', headers: { Authorization: await vapidHeader(env, endpoint), TTL: '86400', Urgency: 'normal', 'Content-Length': '0' } });
  return r.status === 404 || r.status === 410;
}

