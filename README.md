# Sea Turtle Survey — Data Uploader

A mobile-friendly, offline-capable PWA for Black Turtle Conservation sea turtle snorkel surveys. Each survey records shared metadata once, then captures one row per turtle observed. All rows sync to a single Google Sheet tab in long-format (metadata duplicated per turtle).

Built as a sibling to the EMP Uploader, sharing the same brand and UX patterns.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell — screen templates and navigation |
| `styles.css` | Mobile-first UI (Montserrat + BTC blue/teal) |
| `app.js` | All app logic: state, persistence, syncing |
| `sw.js` | Service worker for offline use |
| `manifest.json` | PWA install manifest |
| `app-icon.png`, `logo.png`, `icon.svg` | Branding assets |
| `apps-script.gs` | Google Apps Script that receives submissions and writes to Sheets |

---

## Data captured

**Shared survey metadata:**

- Survey Leader
- Uploaded By
- Number of Surveyors
- Date
- Site (with picker + custom additions)
- Survey Duration (HH:MM)
- Number of Turtles Seen (auto-computed from the turtle list)

**Per-turtle fields (one row in the Sheet per turtle):**

- Turtle Number in Survey (auto, 1, 2, 3, …)
- Time Seen
- Depth Observed (m)
- Species (Green / Hawksbill / Other — with free-text "specify")
- Behaviour (F = Feeding, R = Resting, S = Swimming)
- Size (cm)
- Sex (M / F / JV / U)
- Turtle Name (if known)
- Markings (free text)

---

## Run locally (quick test)

Serve over HTTP — the service worker won't register from `file://`.

```bash
cd ~/sea-turtle-survey
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

---

## Deploy to GitHub Pages

1. Create a new repo on GitHub.
2. From this folder:
   ```bash
   cd ~/sea-turtle-survey
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
3. In the repo on GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)`** → Save.
4. After ~30 seconds, the app is live at `https://<your-username>.github.io/<repo-name>/`.
5. On a phone/tablet, open the URL in Chrome or Safari and choose **Add to Home Screen** to install as a PWA.

---

## Set up Google Sheets sync

1. Create a new Google Sheet (any name).
2. **Extensions → Apps Script**. Replace the placeholder code with the contents of [`apps-script.gs`](apps-script.gs).
3. Generate a shared secret (any long random string, e.g. `uuidgen` output) and set it in BOTH:
   - `apps-script.gs` → `SYNC_SECRET` constant
   - `app.js` → `SYNC_SECRET` constant
4. Save the script. Then **Deploy → New deployment**:
   - Type: **Web app**
   - Description: `Sea Turtle Survey sync`
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**.
5. The first deployment will ask for permissions — review and accept.
6. Copy the **Web app URL** (ends in `/exec`).
7. In the app, tap the ⚙ button → paste the URL into **Google Apps Script Web App URL** → Save.

Submissions will now append rows to your Sheet, creating the `Sea Turtle Survey` tab automatically on first use.

### Sheet layout

Long-format: one row per turtle. The tab has a two-row header:

- Row 1: merged category bands (*Survey Metadata*, *Turtle Observation*) in dark teal.
- Row 2: the actual column names.

A survey with 4 turtles appends 4 rows. The metadata columns repeat in every row.

---

## Offline behaviour

- All edits persist to browser storage (`localStorage`), so closing the tab or losing signal won't lose data.
- Submissions that can't reach the server queue locally. The pill in the top right shows the queue size.
- When the device comes back online, queued submissions auto-sync (if enabled in Settings).
- The app shell is cached by the service worker — works fully offline after first visit.

---

## Exports (CSV / TSV / JSON)

The Review screen offers:

- **Download CSV** — matches the Sheet tab columns exactly.
- **Copy as TSV** — tab-separated copy of the same rows. Paste directly into the Sheet under the header rows.
- **Export JSON** — full structured payload for analysis in R / Python.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Sync URL set, but submissions still queue | Open the Apps Script URL in a browser — it should return `{"ok": true}`. If it asks you to sign in or shows an error, the deployment may not be set to "Anyone". |
| `"Unauthorized"` response from Apps Script | The `SYNC_SECRET` in `app.js` doesn't match the one in `apps-script.gs`. Make them identical, redeploy the Apps Script, and bump `CACHE_VERSION` in `sw.js` so users get the new client. |
| `"Authorization required"` error | Re-deploy the web app and accept the OAuth scopes for your Google account. |
| App won't install as PWA | Some browsers require multiple visits. Make sure you're on HTTPS (GitHub Pages provides this) and that the service worker registered (DevTools → Application → Service Workers). |
| Need to clear a stuck draft | Tap **Reset All Data** on the Review screen, or in DevTools: `localStorage.clear()`. |
