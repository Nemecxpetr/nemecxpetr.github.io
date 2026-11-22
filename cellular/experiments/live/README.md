# Live performance (07_live)

- `../07_live.html`: the **player** page. The audience opens it and picks **cosi** or **čímsi**.
  `07_live.html#cosi` / `#cimsi` skip the chooser (useful for QR codes).
- `../07_live_admin.html`: the **admin** page. Don't link it anywhere.
- `sim.js`: the phase CA from 03_phase plus the touch layer and touch map, shared by both pages.
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

## Touch: the audience layer

Touching a phone does three things on that phone:

- **Touch layer.** A second CA on top, in the role's touch colour: **cosi cyan** (cold), **čímsi amber**
  (warm). It's empty until touched. Rules: birth 3–4, surv 2–3, freeze 0.82/nb 2, melt 0.19/nb 6,
  noise 0, rate 16. It's only born where the touch map is above `need`, so it lives around fresh
  strokes. It flows while the stroke is fresh, freezes onto ice of either layer as the stroke fades
  (`fade` clears the frozen cells slowly), and dies out where the map is gone.
- **Touch map.** It spreads out and fades (`cool`, ~10 s half-life). It shows as a soft blurred glow
  (its own canvas, `#heat`), and it shifts the base layer's phase locally **against** the role's
  journey, by up to `span`. On cosi a touch re-freezes the thaw; on čímsi it holds back the freeze
  (the crystal melts under fingers and regrows elsewhere). `direct` also changes base cells
  outright: cold freezes liquid on cosi, warmth melts ice on čímsi.
- **Count.** Every 2 s while touching (plus a heartbeat every 10 s), the phone sends an anonymous
  8×16 touch map to `live/touch/<role>/<random id>`.

The admin page has a **touch layer + touch map** block per role (same lock / ↺ as the base
parameters, stored as `tover`). You can also touch a preview to try it out (not sent anywhere).

## Audience feedback, recording

The admin page adds up the phones' touch maps once a second. For each role it shows
players / touching / touches per minute and a small heat map. It writes a decaying crowd map
plus `activity` (the share of that role's phones touched in the last 8 s) to `live/crowd`. Two
switches with strength sliders (`live/fb`), both off by default:

- **shared crowd map**: one crowd map from everyone's touches, cosi and čímsi together. Every phone
  feels it as its own touch map plus sparks of its own touch colour, so screens react together.
  The admin cards still show each role's own touches.
- **crowd nudge**: activity pushes the role's progress the touch way (cosi colder, čímsi warmer), up
  to 0.15 × strength, on top of the progress slider. It eases in and out over a few seconds.

Both only work while the admin page is **open and signed in**: it is the one doing the adding
up. It resends the crowd map every 5 s (a worker timer keeps this going when the tab is in the
background), and the header shows `✓ shared glow: sending…` or the reason it isn't. Phones
ignore a crowd map older than 15 s, so closing the admin fades the shared glow out instead of
freezing it.

**● record** saves a snapshot every 10 s to `/log/<session>` (admin-only: progress, players,
activity, touches/min, crowd maps). **download log** exports it as JSON.

## More than 100 phones

The free Firebase plan allows 100 live connections. Phones use a live connection while fewer than
`WS_CAP` = 80 are live (the admin page publishes the count in `live/net`). Beyond that they poll
the state over HTTPS every ~4 s (short requests, no slot held), and they react up to ~4 s later.
Phones move between the two on their own as the room fills and empties. A phone that can't get a
live slot within 10 s polls too. The admin header shows `live n/80 · light m`.

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
themselves in the player count and write their own anonymous touch summary (size-checked).
**Whenever `database.rules.json` changes, paste it into the console again → Publish.**
