# Live performance (07_live)

- `../07_live.html`: the **player** page. The audience opens it and picks **cosi** or **čímsi**.
  `07_live.html#cosi` / `#cimsi` skip the chooser (useful for QR codes).
- `../07_live_admin.html`: the **admin** page. Don't link it anywhere.
- `sim.js`: the phase CA from 03_phase, shared by both pages.
- `net.js`: the connection between admin and players (local or Firebase).
- `config.js`: Firebase config. `null` means local mode.

## Roles

One `progress` slider drives both roles (linked):

| progress | cosi | čímsi |
|---|---|---|
| 0 | cold (frozen) | warm (liquid) |
| 1 | warm (liquid) | cold (frozen) |

Untick **linked** to steer the two roles separately. **glide** sets how long phones take to
reach a new value. Every phone follows the same clock, so a 10-minute glide stays in sync and
latecomers join mid-glide.

## Rehearse locally (no setup)

With `config.js` left as `null`, open the admin page and a few player tabs **in the same browser**.
A local server is fine, e.g. `python -m http.server` in the repo root, then
`http://localhost:8000/cellular/experiments/07_live_admin.html`.
Adding `?local` to both URLs forces local mode even after Firebase is configured.

## Real phones: Firebase (about 10 minutes, free tier is plenty)

1. https://console.firebase.google.com → **Add project** (Analytics not needed).
2. **Build → Realtime Database → Create database** (pick the `europe-west1` location, start in *locked mode*).
3. **Build → Authentication → Get started → Sign-in method → Google → Enable**.
   Then **Settings → Authorized domains → Add** `pjotrgerman.xyz`.
4. **Project settings (gear) → Your apps → Web `</>`** → register → copy the `firebaseConfig`
   object into `config.js` (it must include `databaseURL`). These keys are not secret. The
   rules below protect the data.
5. Open the admin page on pjotrgerman.xyz → **sign in** → copy the `uid` it shows.
6. **Realtime Database → Rules**: paste `database.rules.json` with your uid in place of
   `PASTE_ADMIN_UID` → **Publish**.

After that, only your Google account can change anything. Players can only read, plus register
themselves in the player count.
