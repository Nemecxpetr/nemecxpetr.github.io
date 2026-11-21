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
};

// phase 0 = FROZEN (cold), phase 1 = LIQUID_PRESET (warm)
const FROZEN = { birth_lo: 4, birth_hi: 5, surv_lo: 2, surv_hi: 3, freeze: 0.9, freeze_nb: 1, melt: 0.01, melt_nb: 8, noise: 0.01, rate: 12 };
const LIQUID_PRESET = { birth_lo: 3, birth_hi: 5, surv_lo: 2, surv_hi: 4, freeze: 0.02, freeze_nb: 7, melt: 0.4, melt_nb: 2, noise: 0.001, rate: 22 };
const INT_KEYS = new Set(['birth_lo', 'birth_hi', 'surv_lo', 'surv_hi', 'freeze_nb', 'melt_nb']);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mix = (a, b, t) => a + (b - a) * t;

export function clampParam(name, v) {
  const [min, max] = PARAM_RANGES[name] || [0, Infinity];
  return clamp(v, min, max);
}

// Phase blend, then any admin overrides on top (override = fixed value that
// ignores phase until cleared).
export function paramsFor(phase, overrides = {}) {
  const p = {};
  for (const k in FROZEN) {
    let v = mix(FROZEN[k], LIQUID_PRESET[k], phase);
    if (INT_KEYS.has(k)) v = Math.round(v);
    p[k] = clampParam(k, +v.toFixed(3));
  }
  for (const k in overrides) if (k in p && overrides[k] != null) p[k] = clampParam(k, +overrides[k]);
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

export function createSim(canvas, { cols, rows, cell = 12 } = {}) {
  const W = cols || Math.max(8, Math.floor(innerWidth / cell));
  const H = rows || Math.max(8, Math.floor(innerHeight / cell));
  canvas.width = W; canvas.height = H;
  canvas.style.imageRendering = 'pixelated';
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  let grid = new Uint8Array(W * H);
  let params = paramsFor(0.5);
  let acc = 0;

  function neighbourCounts(g, x, y, counts) {
    counts[0] = counts[1] = counts[2] = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      counts[g[((y + dy + H) % H) * W + (x + dx + W) % W]]++;
    }
    return counts;
  }

  function update() {
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
        else if (nIce >= params.freeze_nb && Math.random() < params.freeze) ns = ICE;
      } else if (nLiquid >= params.melt_nb && Math.random() < params.melt) ns = LIQUID;
      if (Math.random() < params.noise) {
        const r = Math.floor(Math.random() * 2);     // one of the two other states
        ns = (ns + 1 + r) % 3;
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

  // advance by dt seconds at params.rate generations per second
  function tick(dt) {
    acc += Math.min(dt, 0.1) * params.rate;
    let n = 0;
    while (acc >= 1 && n++ < 8) { update(); acc -= 1; }
    if (acc >= 1) acc = 0;                           // slow device: drop frames, don't spiral
  }

  function randomize(density = 0.3) {
    for (let i = 0; i < grid.length; i++) grid[i] = Math.random() < density ? LIQUID : EMPTY;
  }
  function clear() { grid.fill(EMPTY); }
  function iceSeed(size = Math.max(4, Math.round(Math.min(W, H) / 4))) {
    const x0 = (W - size) >> 1, y0 = (H - size) >> 1;
    for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) grid[y * W + x] = ICE;
  }
  function freezeAll() { for (let i = 0; i < grid.length; i++) if (grid[i] === LIQUID) grid[i] = ICE; }
  function meltAll()   { for (let i = 0; i < grid.length; i++) if (grid[i] === ICE) grid[i] = LIQUID; }

  function paintAt(clientX, clientY, state) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((clientX - r.left) / r.width * W);
    const y = Math.floor((clientY - r.top) / r.height * H);
    if (x >= 0 && x < W && y >= 0 && y < H) grid[y * W + x] = state;
  }

  randomize(0.3);
  return {
    W, H, tick, draw, update, randomize, clear, iceSeed, freezeAll, meltAll, paintAt,
    setParams(p) { params = p; },
    get params() { return params; },
    command(type) {
      if (type === 'random') randomize(0.3);
      else if (type === 'clear') clear();
      else if (type === 'seed') iceSeed();
      else if (type === 'freeze') freezeAll();
      else if (type === 'melt') meltAll();
    },
  };
}
