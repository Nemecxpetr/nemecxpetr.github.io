// Phase CA from 03_phase.html, packaged so the player page and the admin
// previews run the exact same rules. States: 0 empty, 1 liquid, 2 ice.

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

// čímsi (warm -> cold): stays liquid until SEED_AT of the way cold, then one
// small seed appears and slowly freezes over the screen. Coverage follows the
// phase (ice_target), not the clock, so a 2-minute and a 20-minute glide end
// up equally frozen at the same progress.
export const SEED_AT = 0.15;                       // coldness where the seed appears
const CIMSI_COLD = { ...LIQUID_PRESET, birth_lo: 2, surv_hi: 5, freeze: 0.6, freeze_nb: 1, melt: 0.3, melt_nb: 2, noise: 0.003, rate: 16 };

const PROFILES = {
  cosi: phase => blend(FROZEN, COSI_WARM, phase),
  cimsi: phase => {
    const cold = 1 - phase;
    if (cold < SEED_AT) return { ...LIQUID_PRESET, ice_target: 0 };   // warm: any ice melts away
    const p = blend(LIQUID_PRESET, CIMSI_COLD, smooth(SEED_AT, SEED_AT + 0.1, cold));
    p.ice_target = Math.pow((cold - SEED_AT) / (1 - SEED_AT), 1.7);   // starts tiny, then picks up
    p.surv_hi = mix(p.surv_hi, 8, smooth(0.65, 0.95, cold));         // late: liquid in the gaps survives long enough to freeze, so it closes up
    return p;
  },
};

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

export function createSim(canvas, { cols, rows, cell = 12, seed = true } = {}) {
  const W = cols || Math.max(8, Math.floor(innerWidth / cell));
  const H = rows || Math.max(8, Math.floor(innerHeight / cell));
  canvas.width = W; canvas.height = H;
  canvas.style.imageRendering = 'pixelated';
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  let grid = new Uint8Array(W * H);
  let params = paramsFor(0.5);
  let acc = 0, speed = null;

  function neighbourCounts(g, x, y, counts) {
    counts[0] = counts[1] = counts[2] = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      counts[g[((y + dy + H) % H) * W + (x + dx + W) % W]]++;
    }
    return counts;
  }

  function update() {
    // ice_target: steer freezing (below target) and melting (above it) so
    // coverage tracks the target; a small seed starts it when there's no ice.
    let freeze = params.freeze, melt = params.melt;
    const target = params.ice_target;
    if (target >= 0) {
      if (target > 0 && countIce() === 0) plantSeed();
      const frac = countIce() / grid.length;
      freeze *= clamp((target - frac) * 25, 0, 1);
      melt *= clamp((frac - target) * 25, 0, 1);
    }
    const g = grid, next = new Uint8Array(W * H), c = [0, 0, 0];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, s = g[i];
      neighbourCounts(g, x, y, c);
      const nLiquid = c[1], nIce = c[2], nOccupied = nLiquid + nIce;
      let ns = s;
      if (s === EMPTY) {
        if (nLiquid >= params.birth_lo && nLiquid <= params.birth_hi) ns = LIQUID;
      } else if (s === LIQUID) {
        if (nOccupied < params.surv_lo || nOccupied > params.surv_hi) ns = EMPTY;
        else if (nIce >= params.freeze_nb && Math.random() < freeze) ns = ICE;
      } else if (target >= 0 ? (nIce < 8 || Math.random() < 0.01) && Math.random() < melt   // steered: recede from the edges
                             : nLiquid >= params.melt_on && Math.random() < melt) ns = LIQUID;
      if (Math.random() < params.noise) {
        if (target >= 0) { if (ns !== ICE) ns = LIQUID - ns; }   // steered ice: noise never makes ice, only the seed does
        else ns = (ns + 1 + Math.floor(Math.random() * 2)) % 3;  // one of the two other states
      }
      next[i] = ns;
    }
    grid = next;
  }

  function draw() {
    const d = img.data;
    for (let i = 0; i < grid.length; i++) {
      const col = COLORS[grid[i]];
      d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  // advance by dt seconds at params.rate generations per second. `running`
  // false doesn't stop time dead: the speed eases down over ~3 s (and back up
  // over ~2 s on resume). The first call snaps, so a phone that joins while
  // paused starts still.
  function tick(dt, running = true) {
    dt = Math.min(dt, 0.1);
    const goal = running ? 1 : 0;
    if (speed == null) speed = goal;
    else {
      speed += (goal - speed) * (1 - Math.exp(-dt / (running ? 0.6 : 0.9)));
      if (Math.abs(goal - speed) < 0.02) speed = goal;
    }
    acc += dt * params.rate * speed;
    let n = 0;
    while (acc >= 1 && n++ < 8) { update(); acc -= 1; }
    if (acc >= 1) acc = 0;                           // slow device: drop frames, don't spiral
  }

  function randomize(density = 0.3) {
    for (let i = 0; i < grid.length; i++) grid[i] = Math.random() < density ? LIQUID : EMPTY;
  }
  function clear() { grid.fill(EMPTY); }
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
  function countIce() { let n = 0; for (let i = 0; i < grid.length; i++) if (grid[i] === ICE) n++; return n; }
  // new random liquid, with or without the big starting seed
  function fresh(withSeed = true) { randomize(0.3); if (withSeed) iceSeed(); }

  function freezeAll() { for (let i = 0; i < grid.length; i++) if (grid[i] === LIQUID) grid[i] = ICE; }
  function meltAll()   { for (let i = 0; i < grid.length; i++) if (grid[i] === ICE) grid[i] = LIQUID; }

  function paintAt(clientX, clientY, state) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((clientX - r.left) / r.width * W);
    const y = Math.floor((clientY - r.top) / r.height * H);
    if (x >= 0 && x < W && y >= 0 && y < H) grid[y * W + x] = state;
  }

  fresh(seed);
  return {
    W, H, tick, draw, update, randomize, clear, iceSeed, freezeAll, meltAll, paintAt, fresh, countIce,
    setParams(p) { params = p; },
    get params() { return params; },
    get grid() { return grid; },
    command(type) {
      if (type === 'random') randomize(0.3);
      else if (type === 'clear') clear();
      else if (type === 'seed') iceSeed();
      else if (type === 'freeze') freezeAll();
      else if (type === 'melt') meltAll();
    },
  };
}
