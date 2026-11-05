# Setlist Buddy

A phone web app for logging a concert setlist while you watch.

- **Tap** the big button when a song starts: it saves a 20-second clip, the time, and which act is on stage.
- **Hold** the button to pick the song from a list of likely songs (from recent setlists) or type it in.
- Add a note to any song (it opens straight to typing; a lyric you caught works best), swipe to remove, and fix everything afterward on the setlist screen.
- Flag a set as **incomplete** (the small flag) if you arrived late or missed songs.
- **Copy setlist** gives setlist.fm-ready text. **Save clips + show file** exports a zip of every clip plus `show.json` for matching later.

Everything is stored on the phone and the app works offline after the first visit.

**Shows.** Tap the venue and date at the top (or **Shows** on the setlist screen) to switch shows or add a new one. On the first open of a show day the app jumps to that day's show. A band that plays more than one set gets one entry per set (Set 1, Set 2, Encore); add one from the bill with **Add another set**. The setlist.fm text keeps the set breaks, and the Spotify playlist includes every set.

Preloaded: Goose at The Midland Theatre, Kansas City (Nov 3 2026, two sets and an encore) and Lowertown / Big Boy / High Vis / Basement at Liberty Hall, Lawrence (Nov 4 2026).

Live at https://titusmith.github.io/setlist-catcher/ once GitHub Pages is on (Settings → Pages → Deploy from a branch → main → / (root)).

## Send to Spotify

From the setlist screen, **Send to Spotify** matches every named song on Spotify, flags weak matches (amber) and misses (red) so you can fix titles, then creates a private playlist named "BandName M-D-YY" (for example "Basement 11-4-26"), using the last act you included. After that the button opens the playlist, and if you change songs it offers **Update the Spotify playlist**, which replaces the songs in the same playlist instead of making a new one.

One-time setup, reusing an existing Spotify developer app:
1. In the Spotify developer dashboard, open the app and add this Redirect URI exactly: `https://titusmith.github.io/setlist-catcher/callback.html`
2. In Setlist Buddy, open **Send to Spotify** and paste the app's Client ID.
3. Tap **Connect Spotify** and approve.

Sign-in uses Authorization Code with PKCE (no client secret). Tokens live in this phone's browser storage and refresh automatically. Spotify's 2026 Development Mode rules apply: the app owner needs Premium, and every Spotify account that uses it must be listed under the app's User Management.

## Review and approve

On the setlist screen, **Review and approve** lines your captures up with what the band played:

- **setlist.fm**: if someone has posted the setlist, songs you named confirm your place in it, unnamed captures get the songs in between, and songs you missed are added in the right spot.
- **Lyrics**: a lyric you typed in a note is searched on Genius (only songs by that band count). When the lyric and the setlist agree, the song is marked Confirmed.
- **Tour order**: with no posted setlist, unnamed captures between named songs are guessed from the band's recent order and marked Check. If the songs you named didn't follow that order, it doesn't guess.

Tap any song to change it, use the other suggestion, or leave it unnamed. **Approve** writes the full setlist and creates or updates the Spotify playlist in one step. Approve again later (for example after setlist.fm posts) and the same playlist is updated.

## Settings

Open Settings from the gear on the setlist screen or from **Shows**.

- **Genius access token**: from https://genius.com/api-clients. Only titles come back from Genius; no lyrics are stored.
- **Helper**: the address of your Cloudflare helper (below).
- **Notifications**: a notification when a setlist is posted for a show you logged, and a reminder after 2 days if nobody has posted one. Tapping it opens the review (or the setlist text, ready to copy).

## The helper (Cloudflare Worker)

setlist.fm doesn't let web pages call its API directly, and notifications need something running while the app is closed. `helper/worker.js` does both. The free Cloudflare plan is enough.

1. Get a setlist.fm API key: https://www.setlist.fm/settings/api (sign in, apply for a key; non-commercial).
2. In Cloudflare: **Workers & Pages → Create → Worker**, name it `setlist-buddy`, **Deploy**, then **Edit code**, replace everything with `helper/worker.js`, and **Deploy** again.
3. **Storage & Databases → KV → Create** a namespace (any name). In the worker: **Settings → Bindings → Add → KV namespace**, variable name `SB`.
4. In the worker: **Settings → Variables and Secrets → Add**, type Secret, name `SETLISTFM_KEY`, value your setlist.fm key.
5. In the worker: **Settings → Triggers → Cron Triggers → Add** `0 */3 * * *` (every 3 hours).
6. Copy the worker's address (like `https://setlist-buddy.yourname.workers.dev`), paste it into Settings → Helper in the app, and tap **Test the helper**.

Keys stay in Cloudflare and on your phone; none are in this repo. The helper only answers requests from the app's address.
