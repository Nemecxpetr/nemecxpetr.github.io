// Phase CA from 03_phase.html, packaged so the player page and the admin
// previews run the exact same rules. States: 0 empty, 1 liquid, 2 ice.
// On top runs a second CA, the touch layer, and under both a touch map. Each
// role's touch carries the temperature it starts from, against its journey:
// cosi (cold -> warm) has cold touches (cyan), čímsi (warm -> cold) warm ones
// (amber).

export const EMPTY = 0, LIQUID = 1, ICE = 2;
const COLORS = [[0, 0, 0], [40, 110, 255], [215, 238, 255]];

export const PARAM_RANGES = {            // [min, max, step]
  birth_lo: [0, 8, 1], birth_hi: [0, 8, 1],
  surv_lo:  [0, 8, 1], surv_hi:  [0, 8, 1],
  freeze: [0, 1, 0.01], freeze_nb: [0, 8, 1],
  melt:   [0, 1, 0.01], melt_nb:   [0, 8, 1],
  noise: [0, 0.2, 0.001], rate: [1, 60, 0.5],
  // melt_nb gets +melt_swing on every other half of a swing_s cycle (same
  // clock on every phone), so the grid rocks between melting and holding.
  melt_swing: [0, 4, 1], swing_s: [1, 30, 0.5],
  // ice_target >= 0: freezing/melting is steered so the ice covers this
  // fraction of the screen (grows from one small seed). < 0 = off.
  ice_target: [-0.05, 1, 0.01],
};
export const INT_KEYS = new Set(['birth_lo', 'birth_hi', 'surv_lo', 'surv_hi', 'freeze_nb', 'melt_nb', 'melt_swing']);

const BASE = { melt_swing: 0, swing_s: 10, ice_target: -1 };
// phase 0 = FROZEN (cold), phase 1 = LIQUID_PRESET (warm), as in 03_phase
const FROZEN = { ...BASE, birth_lo: 4, birth_hi: 5, surv_lo: 2, surv_hi: 3, freeze: 0.9, freeze_nb: 1, melt: 0.01, melt_nb: 8, noise: 0.01, rate: 12 };
const LIQUID_PRESET = { ...BASE, birth_lo: 3, birth_hi: 5, surv_lo: 2, surv_hi: 4, freeze: 0.02, freeze_nb: 7, melt: 0.4, melt_nb: 2, noise: 0.001, rate: 22 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const blend = (A, B, t) => { const p = {}; for (const k in A) p[k] = mix(A[k], B[k], t); return p; };

// ---- role profiles: phase (0 cold .. 1 warm) -> raw params -----------------
// cosi (cold -> warm): thaws into sparse liquid (birth 4-7) and then balances
// on the edge of melting, melt_nb switching back and forth.
const COSI_WARM = { ...LIQUID_PRESET, birth_lo: 4, birth_hi: 7, melt_nb: 2, melt_swing: 3 };   // melt_nb 2 <-> 5
// ...and at the very warm end (VAPOUR_AT -> 1) it boils over into vapour: a
// "Seeds" rule (born on exactly 2, nothing survives), fast and noisy, any ice
// melts at once. Sparse, restless spray, no ice left.
const VAPOUR_AT = 0.8;
const COSI_VAPOUR = { ...LIQUID_PRESET, birth_lo: 2, birth_hi: 2, surv_lo: 8, surv_hi: 0, freeze: 0, freeze_nb: 8,
  melt: 1, melt_nb: 1, melt_swing: 0, noise: 0.01, rate: 40 };

// čímsi (warm -> cold): stays liquid until SEED_AT of the way cold, then one
// small seed appears and slowly freezes over the screen. Coverage follows the
// phase (ice_target), not the clock, so a 2-minute and a 20-minute glide end
// up equally frozen at the same progress.
export const SEED_AT = 0.15;                       // coldness where the seed appears
const CIMSI_COLD = { ...LIQUID_PRESET, birth_lo: 2, surv_hi: 5, freeze: 0.6, freeze_nb: 1, melt: 0.3, melt_nb: 2, noise: 0.003, rate: 16 };

const PROFILES = {
  cosi: phase => {
    const p = blend(FROZEN, COSI_WARM, phase), v = smooth(VAPOUR_AT, 1, phase);
    if (v <= 0) return p;
    // birth + melting go first (else the liquid dies before the spray starts
    // and the ice just sits), survival / speed / noise follow
    const early = smooth(VAPOUR_AT, VAPOUR_AT + 0.1, phase), q = blend(p, COSI_VAPOUR, v);
    for (const k of ['birth_lo', 'birth_hi', 'melt', 'melt_nb', 'melt_swing', 'freeze', 'freeze_nb']) q[k] = mix(p[k], COSI_VAPOUR[k], early);
    return q;
  },
  cimsi: phase => {
    const cold = 1 - phase;
    if (cold < SEED_AT) return { ...LIQUID_PRESET, ice_target: 0 };   // warm: any ice melts away
    const p = blend(LIQUID_PRESET, CIMSI_COLD, smooth(SEED_AT, SEED_AT + 0.1, cold));
    p.ice_target = Math.pow((cold - SEED_AT) / (1 - SEED_AT), 1.7);   // starts tiny, then picks up
    p.surv_hi = mix(p.surv_hi, 8, smooth(0.65, 0.95, cold));         // late: liquid in the gaps survives long enough to freeze, so it closes up
    return p;
  },
};

// IDLE (between performances): the water melts away and dies out over a few
// seconds and nothing new is born, so the screen is left mostly blank for
// drawing. Touch layer + glow + crowd maps keep working as usual.
export const IDLE_PARAMS = { ...BASE, birth_lo: 8, birth_hi: 0, surv_lo: 8, surv_hi: 0, freeze: 0, freeze_nb: 8,
  melt: 0.06, melt_nb: 0, melt_on: 0, noise: 0, rate: 8 };

export function clampParam(name, v) {
  const [min, max] = PARAM_RANGES[name] || [0, Infinity];
  return clamp(v, min, max);
}

// Role profile at this phase, then any admin overrides on top (override =
// fixed value that ignores phase until cleared), then the melt swing.
// `now` is the shared clock (net.now()) so every phone swings in step.
export function paramsFor(phase, overrides = {}, role = 'cosi', now = 0) {
  const raw = (PROFILES[role] || PROFILES.cosi)(phase), p = {};
  for (const k in raw) {
    let v = raw[k];
    if (INT_KEYS.has(k)) v = Math.round(v);
    p[k] = clampParam(k, +v.toFixed(3));
  }
  for (const k in overrides) if (k in p && overrides[k] != null) p[k] = clampParam(k, +overrides[k]);
  p.melt_on = p.melt_nb;                           // melt_nb actually used right now
  if (p.melt_swing > 0 && Math.floor(now / (p.swing_s * 500)) % 2) p.melt_on = clampParam('melt_nb', p.melt_nb + p.melt_swing);
  return p;
}

// A ramp is {from, to, start, dur}: phase glides linearly from `from` to `to`
// starting at server time `start` over `dur` ms. Every phone evaluates it
// against the same clock, so they stay in step and late joiners land mid-ramp.
export function phaseAt(r, now) {
  if (!r) return 0.5;
  if (!r.dur || r.dur <= 0) return clamp(+r.to || 0, 0, 1);
  const u = clamp((now - r.start) / r.dur, 0, 1);
  return clamp(mix(+r.from, +r.to, u), 0, 1);
}

// Which way a role's touches push the phase (0 cold .. 1 warm): cosi's touch
// is cold, čímsi's is warm.
export const touchDir = role => (role === 'cimsi' ? 1 : -1);

// Crowd nudge: the share of a role's phones that are being touched (0..1)
// pushes that role's phase the way its touches do (against the journey), by
// up to NUDGE_MAX * strength.
export const NUDGE_MAX = 0.15;
export function nudgedPhase(phase, role, fb, activity) {
  if (!fb || !fb.nudge || !activity) return phase;
  return clamp(phase + touchDir(role) * NUDGE_MAX * clamp(+fb.nudgeK || 0, 0, 1) * clamp(activity, 0, 1), 0, 1);
}

// ---- touch layer + touch map ------------------------------------------------
// The touch layer is a second CA on top (cyan on cosi, amber on čímsi), empty
// until someone touches. Its own rules, plus the touch map knobs (the map
// holds how strongly touched a spot is; its temperature comes from the role):
//   need   touch-map level the layer needs to be born (so it lives around touches and
//          dies out where the map has cooled down)
//   fade   chance per generation that a frozen touch-layer cell disappears
//   glow   level each living touch-layer cell adds to the map per generation
//   finger level a touch adds at its centre, per touch sample
//   span   how far a fully touched spot shifts the base layer's phase
//   direct chance per generation that a fully touched base cell changes
//          state outright: cosi's cold freezes liquid, čímsi's warmth melts ice
//   cool   how fast the map fades per generation (0.004 ~ 10 s half-life)
//   show   opacity of the touch-layer cells over the base layer (the glow is separate)
export const TOUCH_RANGES = {
  birth_lo: [0, 8, 1], birth_hi: [0, 8, 1],
  surv_lo:  [0, 8, 1], surv_hi:  [0, 8, 1],
  freeze: [0, 1, 0.01], freeze_nb: [0, 9, 1],
  melt:   [0, 1, 0.01], melt_nb:   [0, 9, 1],
  noise: [0, 0.05, 0.001], rate: [1, 60, 0.5],
  need: [0, 1, 0.01], fade: [0, 0.05, 0.001], glow: [0, 0.05, 0.001], finger: [0, 1, 0.01],
  span: [0, 1, 0.05], direct: [0, 0.2, 0.005], cool: [0, 0.05, 0.001], show: [0, 1, 0.05],
};
const TOUCH_INT = new Set(['birth_lo', 'birth_hi', 'surv_lo', 'surv_hi', 'freeze_nb', 'melt_nb']);
export const TOUCH_DEFAULT = {
  birth_lo: 3, birth_hi: 4, surv_lo: 2, surv_hi: 3, freeze: 0.82, freeze_nb: 2, melt: 0.19, melt_nb: 6, noise: 0, rate: 16,
  need: 0.15, fade: 0.003, glow: 0.0005, finger: 0.12, span: 0.5, direct: 0.03, cool: 0.004, show: 0.4,
};
export function clampTouch(k, v) { const [a, b] = TOUCH_RANGES[k] || [0, Infinity]; return clamp(v, a, b); }
export function touchParamsFor(overrides = {}) {
  const p = { ...TOUCH_DEFAULT };
  for (const k in overrides) if (k in p && overrides[k] != null) p[k] = clampTouch(k, +overrides[k]);
  for (const k of TOUCH_INT) p[k] = Math.round(p[k]);
  return p;
}

// Touch moves the base layer's phase by up to `span`: the role's own touch
// map its touch way (cosi colder, čímsi warmer), the other role's crowd the
// other way. One param set per net touch level, -L..L; the middle is untouched.
export const HEAT_LEVELS = 9;
export function paramsTable(phase, overrides, role, now, span) {
  const t = [], L = HEAT_LEVELS - 1;
  for (let b = -L; b <= L; b++) t.push(paramsFor(clamp(phase + touchDir(role) * span * b / L, 0, 1), overrides, role, now));
  return t;
}
// the untouched param set of a table (or a single set)
export const tableCenter = t => (Array.isArray(t) ? t[(t.length - 1) >> 1] : t);
export const otherRole = role => (role === 'cimsi' ? 'cosi' : 'cimsi');

// coarse touch map shared with the admin: 8 x 16 cells, one base-36 char each
export const MAP_W = 8, MAP_H = 16;
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
export const encodeMap = vals => Array.from(vals, v => B36[clamp(Math.round(v), 0, 35)]).join('');
export function decodeMap(str) {
  const out = new Float32Array(MAP_W * MAP_H);
  if (typeof str === 'string') for (let i = 0; i < out.length && i < str.length; i++) out[i] = Math.max(0, B36.indexOf(str[i])) / 35;
  return out;
}

// touch layer colours per role: -, liquid, frozen; and the touch-map glow
export const TOUCH_COLORS = {
  cosi:  { cells: [[0, 0, 0], [0, 225, 200], [160, 255, 236]], glow: [0, 200, 255] },   // cold: cyan, frozen mint-white
  cimsi: { cells: [[0, 0, 0], [255, 140, 20], [255, 214, 140]], glow: [255, 90, 10] },  // warm: amber, frozen gold
};

export function createSim(canvas, { cols, rows, cell = 12, seed = true, role = 'cosi', heatCanvas = null } = {}) {
  const W = cols || Math.max(8, Math.floor(innerWidth / cell));
  const H = rows || Math.max(8, Math.floor(innerHeight / cell));
  const N = W * H;
  canvas.width = W; canvas.height = H;
  canvas.style.imageRendering = 'pixelated';
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  // the touch map goes on its own canvas, which the page shows smoothed and
  // blurred (a gradient, not pixels) and blended over the cells
  let hctx = null, himg = null;
  if (heatCanvas) {
    heatCanvas.width = W; heatCanvas.height = H;
    heatCanvas.style.imageRendering = 'auto';
    hctx = heatCanvas.getContext('2d'); himg = hctx.createImageData(W, H);
  }
  let grid = new Uint8Array(N);           // base layer
  let top = new Uint8Array(N);            // touch layer (cyan on cosi, amber on čímsi)
  let heat = new Float32Array(N), heat2 = new Float32Array(N);   // touch map, 0..1 = how strongly touched (temperature comes from the role)
  // this phone's own fingers only (no crowd): the touch layer lives only here,
  // so azure/amber cells are never seen on any other device
  let fheat = new Float32Array(N), fheat2 = new Float32Array(N);
  // the other role's crowd: only a touch map (glow in its colour), pushing the other way
  let oheat = new Float32Array(N), oheat2 = new Float32Array(N);
  const bin = new Uint8Array(N);
  let table = [paramsFor(0.5)], params = table[0];
  let tparams = touchParamsFor();
  let crowd = null, share = 0;            // own role's crowd map (8x16 floats 0..1) and its strength
  let ocrowd = null;                      // the other role's crowd map (same strength)
  let acc = 0, tacc = 0, speed = null;
  const touches = new Float32Array(MAP_W * MAP_H);
  let touchCount = 0;

  const idx = (x, y) => ((y + H) % H) * W + (x + W) % W;

  function update() {
    // per-cell params: the touch map picks one of the paramsTable levels.
    // ice_target: steer freezing (below target) and melting (above it) so
    // coverage tracks the target; a small seed starts it when there's no ice.
    const L = (table.length - 1) >> 1;
    for (let i = 0; i < N; i++) bin[i] = L + clamp(Math.round((heat[i] - oheat[i]) * L), -L, L);
    if (params.ice_target > 0 && countIce() === 0) plantSeed();
    const frac = countIce() / N;
    const fz = table.map(p => p.ice_target >= 0 ? p.freeze * clamp((p.ice_target - frac) * 25, 0, 1) : p.freeze);
    const ml = table.map(p => p.ice_target >= 0 ? p.melt * clamp((frac - p.ice_target) * 25, 0, 1) : p.melt);
    const g = grid, next = new Uint8Array(N), direct = tparams.direct;
    const warmH = role === 'cimsi' ? heat : oheat, coldH = role === 'cimsi' ? oheat : heat;   // amber warms, cyan cools
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, s = g[i], b = bin[i], P = table[b], steered = P.ice_target >= 0;
      let nLiquid = 0, nIce = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const v = g[idx(x + dx, y + dy)];
        if (v === LIQUID) nLiquid++; else if (v === ICE) nIce++;
      }
      const nOccupied = nLiquid + nIce;
      let ns = s;
      if (s === EMPTY) {
        if (nLiquid >= P.birth_lo && nLiquid <= P.birth_hi) ns = LIQUID;
      } else if (s === LIQUID) {
        if (nOccupied < P.surv_lo || nOccupied > P.surv_hi) ns = EMPTY;
        else if (nIce >= P.freeze_nb && Math.random() < fz[b]) ns = ICE;
      } else if (steered ? (nIce < 8 || Math.random() < 0.01) && Math.random() < ml[b]   // steered: recede from the edges
                         : nLiquid >= P.melt_on && Math.random() < ml[b]) ns = LIQUID;
      else if (direct && Math.random() < direct * warmH[i]) ns = LIQUID;               // warm (amber) touch melts ice
      if (ns === LIQUID && direct && Math.random() < direct * coldH[i]) ns = ICE;      // cold (cyan) touch freezes liquid
      if (Math.random() < P.noise) {
        if (steered) { if (ns !== ICE) ns = LIQUID - ns; }       // steered ice: noise never makes ice, only the seed does
        else ns = (ns + 1 + Math.floor(Math.random() * 2)) % 3;  // one of the two other states
      }
      next[i] = ns;
    }
    grid = next;
  }

  // touch layer: Life-like on its own cells, but only born where the touch map
  // is above `need`, and it dies off where the map has cooled. Freezes onto
  // ice of either layer (the base cell underneath counts too), melts from
  // liquid of either layer. It can only freeze once the map has cooled below
  // 2 x need, so a fresh stroke flows first and freezes as it fades.
  function stepLayer(g, h) {
    const T = tparams, b = grid;
    let any = T.noise > 0;
    if (!any) for (let i = 0; i < N; i++) if (g[i]) { any = true; break; }
    if (!any) return g;
    {
      const next = new Uint8Array(N);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, s = g[i];
        let tl = 0, ti = 0, bl = b[i] === LIQUID ? 1 : 0, bi = b[i] === ICE ? 1 : 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const j = idx(x + dx, y + dy), v = g[j], w = b[j];
          if (v === LIQUID) tl++; else if (v === ICE) ti++;
          if (w === LIQUID) bl++; else if (w === ICE) bi++;
        }
        let ns = s;
        if (s === EMPTY) {
          if (h[i] >= T.need && tl >= T.birth_lo && tl <= T.birth_hi) ns = LIQUID;
        } else if (s === LIQUID) {
          if (tl + ti < T.surv_lo || tl + ti > T.surv_hi) ns = EMPTY;
          else if (h[i] < T.need * 0.5 && Math.random() < 0.05) ns = EMPTY;
          else if (ti + bi >= T.freeze_nb && Math.random() < (h[i] < T.need * 2 ? T.freeze : 0)) ns = ICE;
        } else if (tl + bl >= T.melt_nb && Math.random() < T.melt) ns = LIQUID;
        else if (Math.random() < T.fade) ns = EMPTY;
        if (T.noise && Math.random() < T.noise) ns = ns === LIQUID ? EMPTY : LIQUID;
        next[i] = ns;
      }
      return next;
    }
  }
  // the crowds only share their glow (touch map), not touch-layer cells:
  // those are born and live only on this phone's own finger map
  function updateTop() {
    top = stepLayer(top, fheat);
    let t = diffuse(fheat, fheat2, top, null); fheat2 = fheat; fheat = t;
    t = diffuse(heat, heat2, top, crowd); heat2 = heat; heat = t;
    t = diffuse(oheat, oheat2, null, ocrowd); oheat2 = oheat; oheat = t;
  }

  // touch map: spread to neighbours, fade, and pick up from living
  // touch-layer cells and from the crowd map; returns the new map (written into o)
  function diffuse(h, o, layer, cmap) {
    const T = tparams, keep = 1 - T.cool, cm = cmap && share > 0 ? cmap : null;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const avg = (h[idx(x - 1, y)] + h[idx(x + 1, y)] + h[idx(x, y - 1)] + h[idx(x, y + 1)]) * 0.25;
      let v = (h[i] + (avg - h[i]) * 0.15) * keep;
      if (layer && layer[i] === LIQUID) v += T.glow;
      if (cm) v += share * 0.035 * cm[Math.floor(y * MAP_H / H) * MAP_W + Math.floor(x * MAP_W / W)];
      o[i] = v > 1 ? 1 : v < 0.0005 ? 0 : v;
    }
    return o;
  }

  function draw() {
    const d = img.data, tc = TOUCH_COLORS[role] || TOUCH_COLORS.cimsi, tcol = tc.cells;
    const oc = TOUCH_COLORS[otherRole(role)], k = clamp(+tparams.show, 0, 1), k0 = 1 - k;
    for (let i = 0; i < N; i++) {
      const base = COLORS[grid[i]], t = top[i];
      if (t) {                                       // touch-layer cell, faded over the base by `show`
        const c = tcol[t];
        d[i * 4] = base[0] * k0 + c[0] * k; d[i * 4 + 1] = base[1] * k0 + c[1] * k; d[i * 4 + 2] = base[2] * k0 + c[2] * k;
      } else { d[i * 4] = base[0]; d[i * 4 + 1] = base[1]; d[i * 4 + 2] = base[2]; }
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    if (hctx) {
      // both glows on one canvas: colour mixed by weight, alpha added
      const hd = himg.data, c = tc.glow, e = oc.glow;
      for (let i = 0; i < N; i++) {
        const a = Math.sqrt(heat[i]) * 150, b = Math.sqrt(oheat[i]) * 150, w = a + b;
        if (w < 0.5) { hd[i * 4 + 3] = 0; continue; }
        hd[i * 4] = (c[0] * a + e[0] * b) / w; hd[i * 4 + 1] = (c[1] * a + e[1] * b) / w; hd[i * 4 + 2] = (c[2] * a + e[2] * b) / w;
        hd[i * 4 + 3] = Math.min(255, w);
      }
      hctx.putImageData(himg, 0, 0);
    }
  }

  // advance by dt seconds: base layer at params.rate, touch layer + touch map
  // at tparams.rate. `running` false doesn't stop time dead: the speed eases
  // down over ~3 s (and back up over ~2 s on resume). The first call snaps,
  // so a phone that joins while paused starts still.
  function tick(dt, running = true) {
    dt = Math.min(dt, 0.1);
    const goal = running ? 1 : 0;
    if (speed == null) speed = goal;
    else {
      speed += (goal - speed) * (1 - Math.exp(-dt / (running ? 0.6 : 0.9)));
      if (Math.abs(goal - speed) < 0.02) speed = goal;
    }
    acc += dt * params.rate * speed;
    tacc += dt * tparams.rate * speed;
    let n = 0;
    while (acc >= 1 && n++ < 8) { update(); acc -= 1; }
    if (acc >= 1) acc = 0;                           // slow device: drop frames, don't spiral
    n = 0;
    while (tacc >= 1 && n++ < 8) { updateTop(); tacc -= 1; }
    if (tacc >= 1) tacc = 0;
  }

  function randomize(density = 0.3) {
    for (let i = 0; i < N; i++) grid[i] = Math.random() < density ? LIQUID : EMPTY;
  }
  function clear() { grid.fill(EMPTY); top.fill(EMPTY); heat.fill(0); fheat.fill(0); oheat.fill(0); }
  // Organic ice blob covering roughly the area of a size x size square: a
  // circle whose radius wobbles with a few random harmonics, plus ragged
  // edges and a few stray crystals around it. New shape on every call.
  function iceSeed(size = Math.max(4, Math.round(Math.min(W, H) / 4)), at = null) {
    const waves = [];
    for (let k = 2; k <= 6; k++) waves.push({ k, a: (Math.random() * 0.22) / Math.sqrt(k - 1), ph: Math.random() * Math.PI * 2 });
    const wobble = th => { let f = 1; for (const w of waves) f += w.a * Math.sin(w.k * th + w.ph); return Math.max(0.35, f); };
    // scale so the blob's area matches size^2: area = 0.5 * R^2 * integral of wobble^2
    let m = 0;
    for (let i = 0; i < 360; i++) m += wobble(i / 360 * Math.PI * 2) ** 2;
    const R = size / Math.sqrt(Math.PI * (m / 360));
    const cx = at ? at[0] : W / 2 + (Math.random() - 0.5) * size * 0.3;
    const cy = at ? at[1] : H / 2 + (Math.random() - 0.5) * size * 0.3;
    const reach = Math.ceil(R * 1.8) + 2;
    for (let y = Math.floor(cy - reach); y <= cy + reach; y++) for (let x = Math.floor(cx - reach); x <= cx + reach; x++) {
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy) / (R * wobble(Math.atan2(dy, dx)));    // 1 = on the outline
      const p = d < 0.85 ? 1 : d < 1.15 ? (1.15 - d) / 0.3 : d < 1.5 ? 0.04 : 0;
      if (Math.random() < p) grid[y * W + x] = ICE;
    }
  }
  // the tiny seed čímsi freezes from: a few cells somewhere in the middle third
  function plantSeed() {
    const at = [W * (0.33 + Math.random() * 0.34), H * (0.33 + Math.random() * 0.34)];
    for (let tries = 0; tries < 5 && countIce() === 0; tries++) iceSeed(2, at);
    if (countIce() === 0) grid[Math.floor(at[1]) * W + Math.floor(at[0])] = ICE;
  }
  function countIce() { let n = 0; for (let i = 0; i < N; i++) if (grid[i] === ICE) n++; return n; }
  // new random liquid, with or without the big starting seed; touch layer and touch map wiped
  function fresh(withSeed = true) { randomize(0.3); top.fill(EMPTY); heat.fill(0); fheat.fill(0); oheat.fill(0); if (withSeed) iceSeed(); }

  function freezeAll() { for (let i = 0; i < N; i++) if (grid[i] === LIQUID) grid[i] = ICE; }
  function meltAll()   { for (let i = 0; i < N; i++) if (grid[i] === ICE) grid[i] = LIQUID; }

  // touch-layer blob around a cell (Life-like rules need a few cells to get going)
  function brush(cx, cy, p = 0.55) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (Math.random() < p) top[idx(cx + dx, cy + dy)] = LIQUID;
  }
  function warm(x, y, f, h = heat) {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const j = idx(x + dx, y + dy);
      h[j] = Math.min(1, h[j] + f * Math.exp(-(dx * dx + dy * dy) / 4));
    }
  }
  // one touch sample at a grid cell: touch layer + touch map + count for the admin
  function touchCell(x, y) {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    brush(x, y);
    warm(x, y, tparams.finger);                  // glow + base layer (shared with the crowd)
    warm(x, y, tparams.finger, fheat);           // own finger map: gates the touch layer
    touches[Math.floor(y * MAP_H / H) * MAP_W + Math.floor(x * MAP_W / W)]++;
    touchCount++;
  }
  const toCell = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    return [Math.floor((clientX - r.left) / r.width * W), Math.floor((clientY - r.top) / r.height * H)];
  };
  // touch from screen coordinates; with `from` (previous point) the stroke is
  // filled in cell by cell so fast swipes don't leave gaps
  function touchAt(clientX, clientY, from = null) {
    const [x, y] = toCell(clientX, clientY);
    if (!from) return touchCell(x, y);
    const [x0, y0] = toCell(from[0], from[1]);
    const steps = Math.max(1, Math.abs(x - x0), Math.abs(y - y0));
    for (let s = 1; s <= steps; s++) touchCell(Math.round(x0 + (x - x0) * s / steps), Math.round(y0 + (y - y0) * s / steps));
  }
  // touches since the last call, as the coarse map for the admin
  function takeTouches() {
    const n = touchCount, m = encodeMap(Array.from(touches, c => (c ? Math.sqrt(c) * 4 : 0)));
    touches.fill(0); touchCount = 0;
    return { n, m };
  }

  fresh(seed);
  return {
    W, H, tick, draw, update, randomize, clear, iceSeed, freezeAll, meltAll, fresh, countIce,
    touchAt, touchCell, takeTouches,
    // a single param set, or a paramsTable (one set per touch level)
    setParams(p) { table = Array.isArray(p) ? p : [p]; params = tableCenter(table); },
    setTouchParams(p) { tparams = p; },
    // own role's crowd map, the other role's, and the strength for both
    setCrowd(map, strength, other = null) { crowd = map; share = strength; ocrowd = other; },
    setRole(r) { role = r; },
    get params() { return params; },
    get touchParams() { return tparams; },
    get grid() { return grid; },
    get top() { return top; },
    get heat() { return heat; },
    command(type) {
      if (type === 'random') randomize(0.3);
      else if (type === 'clear') clear();
      else if (type === 'seed') iceSeed();
      else if (type === 'freeze') freezeAll();
      else if (type === 'melt') meltAll();
    },
  };
}
