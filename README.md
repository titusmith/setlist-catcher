# Setlist Catcher

A phone web app for logging a concert setlist while you watch.

- **Tap** the big button when a song starts: it saves a 20-second clip, the time, and which act is on stage.
- **Hold** the button to pick the song from a list of likely songs (from recent setlists) or type it in.
- Add a typed or spoken note to any song, swipe to remove, and fix everything afterward on the setlist screen.
- **Copy setlist** gives setlist.fm-ready text. **Save clips + show file** exports a zip of every clip plus `show.json` for matching later.

Everything is stored on the phone and the app works offline after the first visit.

**Shows.** Tap the venue and date at the top (or **Shows** on the setlist screen) to switch shows or add a new one. On the first open of a show day the app jumps to that day's show. A band that plays more than one set gets one entry per set (Set 1, Set 2, Encore); add one from the bill with **Add another set**. The setlist.fm text keeps the set breaks, and the Spotify playlist includes every set.

Preloaded: Goose at The Midland Theatre, Kansas City (Nov 3 2026, two sets and an encore) and Lowertown / Big Boy / High Vis / Basement at Liberty Hall, Lawrence (Nov 4 2026).

Live at https://titusmith.github.io/setlist-catcher/ once GitHub Pages is on (Settings → Pages → Deploy from a branch → main → / (root)).

## Send to Spotify

From the setlist screen, **Send to Spotify** matches every named song on Spotify, flags weak matches (amber) and misses (red) so you can fix titles, then creates a private playlist named "BandName M-D-YY" (for example "Basement 11-4-26"), using the last act you included. After that the button opens the playlist, and if you change songs it offers **Update the Spotify playlist**, which replaces the songs in the same playlist instead of making a new one.

One-time setup, reusing an existing Spotify developer app:
1. In the Spotify developer dashboard, open the app and add this Redirect URI exactly: `https://titusmith.github.io/setlist-catcher/callback.html`
2. In Setlist Catcher, open **Send to Spotify** and paste the app's Client ID.
3. Tap **Connect Spotify** and approve.

Sign-in uses Authorization Code with PKCE (no client secret). Tokens live in this phone's browser storage and refresh automatically. Spotify's 2026 Development Mode rules apply: the app owner needs Premium, and every Spotify account that uses it must be listed under the app's User Management.
