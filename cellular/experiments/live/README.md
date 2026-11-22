# Live performance (07_live)

- `../07_live.html`: the **player** page. The audience opens it and picks **cosi** or **čímsi**.
  `07_live.html#cosi` / `#cimsi` skip the chooser (useful for QR codes).
- `../07_live_admin.html`: the **admin** page. Don't link it anywhere.
- `sim.js`: the phase CA from 03_phase, shared by both pages.
- `net.js`: the connection between admin and players (local or Firebase).
- `config.js`: Firebase config. `null` means local mode.
- QR code for the chooser page: `assets/qr_07_live.svg` (print) and `assets/qr_07_live.png`.
  Made with `segno` (`segno.make(url, error='h')`).
- Every phone starts with random liquid plus an organic ice seed (`iceSeed()` in `sim.js`, a new
  shape each time). The admin's **ice seed** button drops another one.
- Article about the piece (Melting Giants): `articles/melting-giants/`.

## Roles

One `progress` slider drives both roles (linked):

| progress | cosi | čímsi |
|---|---|---|
| 0 | cold (frozen) | warm (liquid) |
| 1 | warm (liquid) | cold (frozen) |

Each role has its own profile (`PROFILES` in `sim.js`):

- **cosi** thaws from the frozen preset into sparse liquid (birth 4–7). On the way, `melt_nb` swings
  back and forth (`melt_swing`, 2 ↔ 5 at the warm end, every `swing_s` = 10 s on the shared clock),
  so it balances on the edge of melting instead of just melting. In the admin readout, `*` marks
  melt_nb while it is swung up.
- **čímsi** stays liquid until 15% cold (`SEED_AT`). Then one small seed appears and freezes over the
  screen. Coverage follows the phase (`ice_target`, starts tiny and picks up), not the clock, so any
  glide length works and a phone that joins late catches up in a few seconds. Going warmer again
  melts it back from the edges. While steered, noise never makes ice, and the **ice seed / freeze /
  melt** buttons only nudge it: it drifts back to the target. Set `ice_target` to `off` (far left) to
  turn steering off.

**pause** doesn't stop time dead: the simulation eases to a stop over ~3 s (and back up over ~2 s on
**run**).

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
