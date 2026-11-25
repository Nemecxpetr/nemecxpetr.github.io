
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
const smoothstep01 = t => t * t * (3 - 2 * t);
export const SMOOTH_S = 3;                 // seconds for the IDLE look to fade in / out
// rounding of the standard (non-idle) look: 0 = square pixels, 1 = the full
// round IDLE look. A little, so the cells read as soft-cornered tiles.
export const ROUND = 0.4;
// pixel budget for the smooth drawing: each cell is drawn as S x S pixels,
// S as large as fits (2..8), then the browser scales it up smoothly
export const SMOOTH_PX = 60000;
// Dispersion glow: the light of the lit cells is split into a few colours of
// the spectrum and each is blurred by its own amount (violet least, red most),
// then added back, so the glow around the shapes fans out into a rainbow and
// fades deep into the dark. The spread breathes slowly (shimmer). Strength
// follows the look: some in standard, full in IDLE.
export const GLOW = 0.93;                     // overall glow (x the look's strength)
export const GLOW_GAIN = 0.5;              // brightness of the blurred light before the tone lift
export const GLOW_R = 0.8;                 // blur radius (sigma, in cells)
export const DISPERSION = 0.3;               // violet-to-red shift, in cells
export const GLOW_SAT = 1.2;               // colour saturation of the glow (1 = as split)
const SPECTRUM = [[0.55, 0, 1], [0, 0.35, 1], [0, 0.9, 0.85], [0.25, 1, 0.1], [1, 0.8, 0], [1, 0.12, 0]];
const SPEC_SUM = [0, 1, 2].map(c => SPECTRUM.reduce((a, s) => a + s[c], 0));
// Prisms: where a liquid cell and an ice cell sit side by side, light crossing
// from water into ice can split now and then: a small rainbow lights up on
// their shared edge. It is one cell big, half over each of the two cells, and
// the full spectrum runs across it in straight bands, violet on the liquid
// side to red on the ice side (soft in that direction, hard along the edge).
// It swells and fades over a second or two (goes out early only if both
// cells are gone). More of them the smoother the look.
export const PRISM_RATE = 15;               // new prisms per second on a whole screen (x the look's strength), if there are edges
export const PRISM = 0.95;                 // opacity at its brightest
export const PRISM_S = [1, 2.5];           // lifetime, seconds (random in range)
const PRISM_MAX = 100;
export const PRISM_BLUR = 0.15;            // blur of the prism layer, in cells
export const PRISM_GLOW = [0.6, 0.53];     // halo behind each prism: size (x the prism) and opacity
export const PRISM_TWINKLE = 0.25;         // how much a lit prism flickers (0 = steady)
const edgeList = [];                       // scratch: liquid-ice edges this generation
const rainbow = u => {                     // 0 violet .. 1 red, full saturation
  const h = 0.8 * (1 - clamp(u, 0, 1));
  return [0, 2 / 3, 1 / 3].map(o => 255 * clamp(Math.abs(((h + o) % 1) * 6 - 3) - 1, 0, 1));
};
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

// IDLE (between performances): the ice melts back from its edges until it
// covers about IDLE_ICE of the screen, and the water settles: nothing new is
// born, crowded or lonely liquid dies, and what's left sits in small still
// clumps (Life-like survival on 2-3). So some ice and water stay, calm, with
// room to draw around them. If there's no ice at all, one blob about IDLE_ICE
// big is planted (idle can't freeze, so a tiny seed would stay tiny). Touch
// layer + glow + crowd maps keep working as usual. The pages also switch the
// sim to its smooth look (setSmooth) while idle.
export const IDLE_ICE = 0.45;
export const IDLE_PARAMS = { ...BASE, birth_lo: 8, birth_hi: 0, surv_lo: 2, surv_hi: 3, freeze: 0, freeze_nb: 8,
  melt: 0.05, melt_nb: 0, melt_on: 0, noise: 0, rate: 8, ice_target: IDLE_ICE };

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

// Crowd nudge: the role's crowd pressure (0..1, see stepPressure) pushes that
// role's phase the way its touches do (against the journey), by up to
// NUDGE_MAX * strength.
export const NUDGE_MAX = 0.4;
// Crowd pressure builds while a role's phones are being touched and leaks back
// when they stop, so a short burst barely moves the water and a hall that keeps
// touching carries it. The push is share^NUDGE_GAMMA (share = part of the
// role's phones touched in the last 8 s), so a few phones count little and most
// of the hall counts a lot. At full touch it rises by 1/NUDGE_RISE_S a second at
// first (with the defaults it fills in about half a minute); it leaks back with a
// time constant of NUDGE_LEAK_S. Steady state = share^GAMMA * LEAK/RISE, capped at 1.
// These are the defaults; the admin's sliders override them (live/fb: nudgeRise,
// nudgeLeak, nudgeGamma).
export const NUDGE_GAMMA = 1.5, NUDGE_RISE_S = 20, NUDGE_LEAK_S = 30;
export function stepPressure(p, share, dt, { rise = NUDGE_RISE_S, leak = NUDGE_LEAK_S, gamma = NUDGE_GAMMA } = {}) {
  rise = Math.max(1, +rise || NUDGE_RISE_S); leak = Math.max(1, +leak || NUDGE_LEAK_S); gamma = Math.max(0.1, +gamma || NUDGE_GAMMA);
  const goal = Math.pow(clamp(+share || 0, 0, 1), gamma) * leak / rise;
  return clamp(goal + ((+p || 0) - goal) * Math.exp(-Math.max(0, dt) / leak), 0, 1);
}

// Crowd map: the admin adds up the phones' 2 s touch maps (0..1 per cell) into
// a fading sum. scaleCrowd turns that sum into what the phones get: divided by
// the size of the group, so a spot only fills up when a good part of the group
// draws there, and through a soft knee instead of a hard cut. 1 = CROWD_FULL of
// the group's phones drawing on a spot at full strength, shown as 0.86.
export const CROWD_DECAY = 0.93;                    // per second, ~10 s half-life
export const CROWD_FULL = 0.3;                      // default; the admin's slider overrides it (live/fb: crowdFull)
const CROWD_STEADY = 1 - CROWD_DECAY ** 2;           // one phone's steady sum (sends every 2 s) back to 0..1
// the crowd sliders (live/fb), falling back to the defaults above
export const crowdTuning = fb => ({
  full: +(fb && fb.crowdFull) || CROWD_FULL, rise: +(fb && fb.nudgeRise) || NUDGE_RISE_S,
  leak: +(fb && fb.nudgeLeak) || NUDGE_LEAK_S, gamma: +(fb && fb.nudgeGamma) || NUDGE_GAMMA,
});
export function scaleCrowd(acc, players, out = new Float32Array(acc.length), full = CROWD_FULL) {
  const k = 2 * CROWD_STEADY / (Math.max(1, players) * Math.max(0.02, +full || CROWD_FULL));
  for (let i = 0; i < acc.length; i++) out[i] = 1 - Math.exp(-k * Math.max(0, acc[i]));
  return out;
}
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
//   cool   how fast the map fades per generation (0.004 ~ 10 s half-life at rate 16;
//          the admin shows the half-life in seconds next to the slider)
//   show   opacity of the touch-layer cells over the base layer (the glow is separate)
export const TOUCH_RANGES = {
  birth_lo: [0, 8, 1], birth_hi: [0, 8, 1],
  surv_lo:  [0, 8, 1], surv_hi:  [0, 8, 1],
  freeze: [0, 1, 0.01], freeze_nb: [0, 9, 1],
  melt:   [0, 1, 0.01], melt_nb:   [0, 9, 1],
  noise: [0, 0.05, 0.001], rate: [1, 60, 0.5],
  need: [0, 1, 0.01], fade: [0, 0.05, 0.001], glow: [0, 0.05, 0.001], finger: [0, 1, 0.01],
  span: [0, 1, 0.05], direct: [0, 0.2, 0.005], cool: [0, 0.05, 0.0005], show: [0, 1, 0.05],
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
// touch-map glow: how much of the screen-wide average glow is taken off
// (exposure adaptation, 0 = none), and how much of the overlap of the two
// crowds still shows where they cancel out (0 = none, 1 = plain sum)
const GLOW_ADAPT = 0.6, GLOW_OVERLAP = 0.5;
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

export function createSim(canvas, { cols, rows, cell = 12, seed = true, role = 'cosi', heatCanvas = null, prismCanvas = null } = {}) {
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
  // prisms go on their own transparent canvas at full screen resolution, so
  // their rainbow stays crisp however coarse the cell drawing is
  let pctx = null, PW = 0, PH = 0, prismsShown = false;
  if (prismCanvas) {
    const r = prismCanvas.getBoundingClientRect(), dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
    PW = prismCanvas.width = Math.max(W, Math.round((r.width || W * cell) * dpr));
    PH = prismCanvas.height = Math.max(H, Math.round((r.height || H * cell) * dpr));
    pctx = prismCanvas.getContext('2d');
    // soft: the whole layer blurred (CSS, so it works on every browser), scaled to the cell size
    prismCanvas.style.filter = `blur(${(PRISM_BLUR * (r.width ? r.width / W : cell)).toFixed(2)}px)`;
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
  // smooth look: 0 = standard (pixels with slightly rounded corners, ROUND),
  // 1 = organic (IDLE). The cells are drawn S x finer and interpolated
  // between cell centres: lit cells fade softly into the dark (and neighbours
  // of the same colour melt together), while the border between two colours
  // (liquid blue, ice white, touch layer) stays hard. The more smooth, the
  // softer and rounder.
  // `smooth` eases towards `smoothGoal` over SMOOTH_S seconds.
  let smooth = 0, smoothGoal = 0;
  const S = clamp(Math.floor(Math.sqrt(SMOOTH_PX / N)), 2, 8), SW = W * S, SH = H * S;
  let simg = null, wKey = -1;
  const wx0 = new Int32Array(SW), wx1 = new Int32Array(SW), wxf = new Float32Array(SW);
  const wy0 = new Int32Array(SH), wy1 = new Int32Array(SH), wyf = new Float32Array(SH);
  const cat = new Uint8Array(N);          // kind of cell (base state x touch-layer state), 0 = dark
  const cxf = new Float32Array(SW), cyf = new Float32Array(SH);   // linear weights (for the glow)
  const gSrc = new Float32Array(N), gTmp = new Float32Array(N);
  const bR = new Float32Array(N), bG = new Float32Array(N), bB = new Float32Array(N);
  const hR = new Float32Array(N), hG = new Float32Array(N), hB = new Float32Array(N);
  let clock = 0, glowAt = -1;              // clock when the glow was last computed (-1 = stale)
  // lit prisms: {i, j (liquid cell, ice cell), x, y (top-left corner, in cells), horiz, flip, t0, dur}
  const prisms = [], prismAt = new Set();   // prismAt: edge keys (cell * 2 + 0 right / 1 down)
  // redraw only when something on screen changed (cells, touch map, the look,
  // prism cells); a repeated frame costs nothing. lastDraw = clock at the last one.
  let dirty = true, lastDraw = -1, heatLive = false;
  const touches = new Float32Array(MAP_W * MAP_H);
  let touchCount = 0;

  const idx = (x, y) => ((y + H) % H) * W + (x + W) % W;

  function update() {
    glowAt = -1; dirty = true;
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
    const before = top, hadHeat = heatLive;
    top = stepLayer(top, fheat);
    heatLive = false;                              // diffuse sets it if any map is still warm
    let t = diffuse(fheat, fheat2, top, null); fheat2 = fheat; fheat = t;
    t = diffuse(heat, heat2, top, crowd); heat2 = heat; heat = t;
    t = diffuse(oheat, oheat2, null, ocrowd); oheat2 = oheat; oheat = t;
    if (top !== before || heatLive || hadHeat) { glowAt = -1; dirty = true; }   // idle and cold: nothing to redraw
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
      if (o[i]) heatLive = true;
    }
    return o;
  }

  // interpolation weights for one axis at strength k: the blend between
  // neighbouring cells goes from a hard step (k 0, plain pixels) to a smooth
  // S-curve (k 1), so the squares round off gradually
  function axisWeights(n, o0, o1, of, k, linear = false) {
    const steep = 1 / Math.max(k, 0.001);
    for (let p = 0; p < n * S; p++) {
      const u = (p + 0.5) / S - 0.5, c = Math.floor(u);
      let t = clamp((u - c - 0.5) * steep + 0.5, 0, 1);
      o0[p] = clamp(c, 0, n - 1); o1[p] = clamp(c + 1, 0, n - 1); of[p] = linear ? t : t * t * (3 - 2 * t);
    }
  }
  // dispersion glow at cell resolution (hR/hG/hB, 0..255): each spectral
  // colour takes its share of the lit cells' light and is blurred with its
  // own radius, then the colours are added back together
  function blur1(src, dst, sigma) {
    const r = Math.min(Math.ceil(sigma * 2.5), Math.max(W, H) >> 1), ker = [];
    let sum = 0;
    for (let j = -r; j <= r; j++) { const v = Math.exp(-j * j / (2 * sigma * sigma)); ker.push(v); sum += v; }
    for (let j = 0; j < ker.length; j++) ker[j] /= sum;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = 0;
      for (let j = -r; j <= r; j++) v += src[y * W + (x + j + W) % W] * ker[j + r];
      gTmp[y * W + x] = v;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = 0;
      for (let j = -r; j <= r; j++) v += gTmp[((y + j + H) % H) * W + x] * ker[j + r];
      dst[y * W + x] = v;
    }
  }
  // the lit cells' light, blurred deep (blur is linear, so blur the colour
  // once), then split like in a prism: each spectral colour takes its share
  // of the blurred light, shifted along one direction by its own amount
  // (violet least, red most) and the shares are added back. Where they
  // overlap it adds up to the light's own colour, at the edges it fans out
  // into a rainbow fringe. The direction turns slowly (shimmer). Faint tails
  // are lifted (tone) so the glow reaches deep into the dark.
  function disperse(d) {
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < N; i++) gSrc[i] = cat[i] ? d[i * 4 + c] : 0;
      blur1(gSrc, c === 0 ? bR : c === 1 ? bG : bB, GLOW_R);
    }
    hR.fill(0); hG.fill(0); hB.fill(0);
    const K = SPECTRUM.length, ang = clock * 0.12, ux = Math.cos(ang), uy = Math.sin(ang);
    for (let s = 0; s < K; s++) {
      const sp = SPECTRUM[s], n = sp[0] + sp[1] + sp[2];
      const fr = sp[0] / SPEC_SUM[0], fg = sp[1] / SPEC_SUM[1], fb = sp[2] / SPEC_SUM[2];
      const off = DISPERSION * (s / (K - 1) - 0.5), ox = ux * off, oy = uy * off;
      const ix = Math.floor(ox), iy = Math.floor(oy), tx = ox - ix, ty = oy - iy;
      for (let y = 0; y < H; y++) {
        const y0 = ((y - iy) % H + H) % H, y1 = (y0 - 1 + H) % H;   // sample at (x - ox, y - oy)
        for (let x = 0; x < W; x++) {
          const x0 = ((x - ix) % W + W) % W, x1 = (x0 - 1 + W) % W;
          const p00 = y0 * W + x0, p01 = y0 * W + x1, p10 = y1 * W + x0, p11 = y1 * W + x1;
          const w00 = (1 - tx) * (1 - ty), w01 = tx * (1 - ty), w10 = (1 - tx) * ty, w11 = tx * ty;
          const r = bR[p00] * w00 + bR[p01] * w01 + bR[p10] * w10 + bR[p11] * w11;
          const g = bG[p00] * w00 + bG[p01] * w01 + bG[p10] * w10 + bG[p11] * w11;
          const b = bB[p00] * w00 + bB[p01] * w01 + bB[p10] * w10 + bB[p11] * w11;
          const v = (r * sp[0] + g * sp[1] + b * sp[2]) / n, i = y * W + x;
          hR[i] += v * fr; hG[i] += v * fg; hB[i] += v * fb;
        }
      }
    }
    // lift the brightness (not the colour: a per-channel lift would wash it
    // towards white) and push the colours apart (saturation)
    for (let i = 0; i < N; i++) {
      const r = hR[i] * GLOW_GAIN, g = hG[i] * GLOW_GAIN, b = hB[i] * GLOW_GAIN, m = (r + g + b) / 3, L = Math.max(r, g, b);
      if (L <= 0.01) { hR[i] = hG[i] = hB[i] = 0; continue; }
      const f = 255 * Math.pow(Math.min(L, 255) / 255, 0.55) / L;
      hR[i] = Math.max(0, m + (r - m) * GLOW_SAT) * f; hG[i] = Math.max(0, m + (g - m) * GLOW_SAT) * f; hB[i] = Math.max(0, m + (b - m) * GLOW_SAT) * f;
    }
  }

  function drawSmooth(k) {
    if (canvas.width !== SW || canvas.height !== SH) {
      canvas.width = SW; canvas.height = SH; canvas.style.imageRendering = 'auto';
      simg = ctx.createImageData(SW, SH);
    }
    if (wKey < 0) { axisWeights(W, wx0, wx1, cxf, 1, true); axisWeights(H, wy0, wy1, cyf, 1, true); }
    if (k !== wKey) { axisWeights(W, wx0, wx1, wxf, k); axisWeights(H, wy0, wy1, wyf, k); wKey = k; }
    const d = img.data, o = simg.data;
    for (let i = 0; i < N; i++) cat[i] = grid[i] || top[i] ? 1 + grid[i] * 3 + top[i] : 0;   // 0 = dark
    const glow = GLOW * k;
    // the glow only changes when the cells do (or slowly with the clock)
    if (glow > 0 && (glowAt < 0 || clock - glowAt > 0.25)) { disperse(d); glowAt = clock; }
    let q = 0;
    for (let py = 0; py < SH; py++) {
      const r0 = wy0[py] * W, r1 = wy1[py] * W, fy = wyf[py], gy = 1 - fy;
      for (let px = 0; px < SW; px++, q += 4) {
        const x0 = wx0[px], x1 = wx1[px], fx = wxf[px], gx = 1 - fx;
        const a = r0 + x0, b = r0 + x1, c = r1 + x0, e = r1 + x1;
        const A = cat[a], B = cat[b], C = cat[c], D = cat[e];
        const wa = A ? gx * gy : 0, wb = B ? fx * gy : 0, wc = C ? gx * fy : 0, we = D ? fx * fy : 0;
        const w = wa + wb + wc + we;                    // how lit this spot is: fades softly into the dark
        let gr = 0, gg = 0, gb = 0;                     // dispersion glow here
        if (glow > 0) {
          const cx = cxf[px], cy = cyf[py], hx = 1 - cx, hy = 1 - cy;
          const m = glow * (1 - smoothstep01(w > 1 ? 1 : w));   // only around the shapes, not on top
          gr += (hx * hy * hR[a] + cx * hy * hR[b] + hx * cy * hR[c] + cx * cy * hR[e]) * m;
          gg += (hx * hy * hG[a] + cx * hy * hG[b] + hx * cy * hG[c] + cx * cy * hG[e]) * m;
          gb += (hx * hy * hB[a] + cx * hy * hB[b] + hx * cy * hB[c] + cx * cy * hB[e]) * m;
        }
        if (w <= 0.004) { o[q] = gr; o[q + 1] = gg; o[q + 2] = gb; o[q + 3] = 255; continue; }
        // colour: whichever kind of cell (blue, white, touch...) covers the spot
        // most, so the borders between colours stay hard
        let best = a, bw = -1;
        if (A) { const s = wa + (B === A ? wb : 0) + (C === A ? wc : 0) + (D === A ? we : 0); if (s > bw) { bw = s; best = a; } }
        if (B) { const s = wb + (C === B ? wc : 0) + (D === B ? we : 0); if (s > bw) { bw = s; best = b; } }
        if (C) { const s = wc + (D === C ? we : 0); if (s > bw) { bw = s; best = c; } }
        if (D && we > bw) best = e;
        const t = smoothstep01(w > 1 ? 1 : w);
        o[q] = d[best * 4] * t + gr; o[q + 1] = d[best * 4 + 1] * t + gg; o[q + 2] = d[best * 4 + 2] * t + gb;
        o[q + 3] = 255;
      }
    }
    if (prisms.length && !pctx) drawPrisms(o);      // no prism canvas: into the cells (coarse)
    ctx.putImageData(simg, 0, 0);
  }
  // prism canvas: each prism a cell-sized rectangle over its edge, filled with
  // a rainbow gradient across the edge (soft at the two ends, hard sides)
  const PRISM_STOPS = [0, 0.18, 0.34, 0.5, 0.66, 0.82, 1];
  function drawPrismCanvas() {
    if (!prisms.length && !prismsShown) return;
    pctx.clearRect(0, 0, PW, PH);
    prismsShown = prisms.length > 0;
    const cw = PW / W, ch = PH / H;
    // one rainbow rectangle centred on the prism, f times its size
    const paint = (pr, f, alpha) => {
      const w = cw * f, h = ch * f, x = (pr.x + 0.5) * cw - w / 2, y = (pr.y + 0.5) * ch - h / 2;
      const g = pr.horiz ? pctx.createLinearGradient(pr.flip ? x + w : x, 0, pr.flip ? x : x + w, 0)
                         : pctx.createLinearGradient(0, pr.flip ? y + h : y, 0, pr.flip ? y : y + h);
      for (const u of PRISM_STOPS) {
        const c = rainbow(u), a = u === 0 || u === 1 ? 0 : 1;   // violet at the liquid end
        g.addColorStop(u, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);
      }
      pctx.globalAlpha = Math.min(1, alpha);
      pctx.fillStyle = g;
      pctx.fillRect(x, y, w, h);
    };
    for (const pr of prisms) {
      const age = clock - pr.t0, twinkle = 1 - PRISM_TWINKLE * (0.5 + 0.5 * Math.sin(age * 9 + pr.key));
      const env = PRISM * Math.sin(Math.PI * age / pr.dur) ** 2 * twinkle;
      if (env <= 0.002) continue;
      pctx.globalCompositeOperation = 'lighter';           // halos add up where they overlap: shine
      paint(pr, PRISM_GLOW[0], env * PRISM_GLOW[1]);
      pctx.globalCompositeOperation = 'source-over';
      paint(pr, 1, env);
    }
    pctx.globalAlpha = 1;
  }
  // each prism: a cell-sized square over the edge, a rainbow running across it
  // (fallback without a prism canvas: drawn into the cells, only as fine as S)
  function drawPrisms(o) {
    for (const pr of prisms) {
      const env = PRISM * Math.sin(Math.PI * (clock - pr.t0) / pr.dur) ** 2;
      if (env <= 0.002) continue;
      const X0 = Math.round(pr.x * S), Y0 = Math.round(pr.y * S);
      for (let py = Y0; py < Y0 + S; py++) for (let px = X0; px < X0 + S; px++) {
        let u = ((pr.horiz ? px - X0 : py - Y0) + 0.5) / S;      // 0..1 across the edge
        if (pr.flip) u = 1 - u;                                   // violet on the liquid side
        const a = env * smoothstep01(clamp(Math.min(u, 1 - u) / 0.18, 0, 1)), c = rainbow(u), q = (py * SW + px) * 4;
        o[q] += (c[0] - o[q]) * a; o[q + 1] += (c[1] - o[q + 1]) * a; o[q + 2] += (c[2] - o[q + 2]) * a;
      }
    }
  }

  // liquid / ice / nothing, counting the touch layer too (its ice wins)
  const phaseOf = i => (grid[i] === ICE || top[i] === ICE ? ICE : grid[i] || top[i] ? LIQUID : EMPTY);
  // one generation of the prism rule (runs with the base layer): find the
  // liquid-ice pairs of side-by-side cells and light up a few of them, about
  // PRISM_RATE per second however many edges there are
  function prismStep(look) {
    let want = PRISM_RATE * look / Math.max(1, params.rate);   // expected new prisms this generation
    if (want <= 0 || prisms.length >= PRISM_MAX) return;
    let n = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
    if (!n) return;
    edgeList.length = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, si = phaseOf(i);
      if (!si) continue;
      if (x < W - 1) { const sj = phaseOf(i + 1); if (sj && sj !== si && !prismAt.has(i * 2)) edgeList.push(i * 2); }
      if (y < H - 1) { const sj = phaseOf(i + W); if (sj && sj !== si && !prismAt.has(i * 2 + 1)) edgeList.push(i * 2 + 1); }
    }
    while (n-- > 0 && edgeList.length && prisms.length < PRISM_MAX) {
      const pick = Math.floor(Math.random() * edgeList.length), key = edgeList[pick];
      edgeList[pick] = edgeList[edgeList.length - 1]; edgeList.pop();
      const i = key >> 1, dir = key & 1, j = dir === 0 ? i + 1 : i + W, x = i % W, y = (i - x) / W;
      const liq = phaseOf(i) === LIQUID ? i : j, ice = liq === i ? j : i;
      prisms.push({ i: liq, j: ice, key, horiz: dir === 0, flip: liq !== i,
        x: dir === 0 ? x + 0.5 : x, y: dir === 0 ? y : y + 0.5,
        t0: clock, dur: mix(PRISM_S[0], PRISM_S[1], Math.random()) });
      prismAt.add(key);
    }
  }
  // put out the prisms that are done, or whose two cells have both gone
  // (liquid flickers every generation, so one changing doesn't count)
  function prismAge() {
    if (!prisms.length) return;
    for (let n = prisms.length - 1; n >= 0; n--) {
      const pr = prisms[n];
      if (clock - pr.t0 >= pr.dur || (!phaseOf(pr.i) && !phaseOf(pr.j))) { prismAt.delete(pr.key); prisms.splice(n, 1); }
    }
    dirty = dirty || clock - lastDraw >= 0.05;     // fading prisms: up to 20 redraws a second
  }

  function draw() {
    if (!dirty) return;
    dirty = false; lastDraw = clock;
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
    const sk = mix(ROUND, 1, smoothstep01(smooth));
    if (sk > 0) drawSmooth(sk);
    else {
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; canvas.style.imageRendering = 'pixelated'; }
      ctx.putImageData(img, 0, 0);
    }
    if (pctx) drawPrismCanvas();
    if (hctx) {
      // both glows on one canvas, showing the net tug (like the physics, which
      // uses heat - oheat): the stronger crowd's colour, as bright as it wins
      // by; where the two cancel only a dim trace of the overlap is left, so
      // they don't add up to a grey-white haze. Exposure adapts: the more of
      // the screen glows, the more the average is taken off, so a crowd that
      // warms everything still shows where it's hottest instead of a flat wash.
      // What's left is stretched back to the full range, so the hot spots
      // still shine at full strength: only the wash goes dark, not the peaks.
      const hd = himg.data, c = tc.glow, e = oc.glow;
      let sa = 0, sb = 0;
      for (let i = 0; i < N; i++) { sa += Math.sqrt(heat[i]); sb += Math.sqrt(oheat[i]); }
      const ma = GLOW_ADAPT * sa / N, mb = GLOW_ADAPT * sb / N, ka = 1 / (1 - ma), kb = 1 / (1 - mb);
      for (let i = 0; i < N; i++) {
        const a = Math.max(0, Math.sqrt(heat[i]) - ma) * ka, b = Math.max(0, Math.sqrt(oheat[i]) - mb) * kb;
        const s = (Math.abs(a - b) + GLOW_OVERLAP * Math.min(a, b)) * 150;
        if (s < 0.5) { hd[i * 4 + 3] = 0; continue; }
        const wa = a * a * a, wb = b * b * b, w = wa + wb;   // cubed: the colour leans hard to the winner
        hd[i * 4] = (c[0] * wa + e[0] * wb) / w; hd[i * 4 + 1] = (c[1] * wa + e[1] * wb) / w; hd[i * 4 + 2] = (c[2] * wa + e[2] * wb) / w;
        hd[i * 4 + 3] = Math.min(255, s);
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
    clock += dt;
    prismAge();
    if (smooth !== smoothGoal) dirty = true;
    if (smooth !== smoothGoal) smooth = smoothGoal > smooth ? Math.min(smoothGoal, smooth + dt / SMOOTH_S) : Math.max(smoothGoal, smooth - dt / SMOOTH_S);
    const goal = running ? 1 : 0;
    if (speed == null) speed = goal;
    else {
      speed += (goal - speed) * (1 - Math.exp(-dt / (running ? 0.6 : 0.9)));
      if (Math.abs(goal - speed) < 0.02) speed = goal;
    }
    acc += dt * params.rate * speed;
    tacc += dt * tparams.rate * speed;
    let n = 0;
    while (acc >= 1 && n++ < 8) { update(); prismStep(mix(ROUND, 1, smoothstep01(smooth))); acc -= 1; }
    if (acc >= 1) acc = 0;                           // slow device: drop frames, don't spiral
    n = 0;
    while (tacc >= 1 && n++ < 8) { updateTop(); tacc -= 1; }
    if (tacc >= 1) tacc = 0;
  }

  function randomize(density = 0.3) {
    dirty = true;
    for (let i = 0; i < N; i++) grid[i] = Math.random() < density ? LIQUID : EMPTY;
  }
  function clear() { dirty = true; prisms.length = 0; prismAt.clear(); if (pctx) pctx.clearRect(0, 0, PW, PH); grid.fill(EMPTY); top.fill(EMPTY); heat.fill(0); fheat.fill(0); oheat.fill(0); }
  // Organic ice blob covering roughly the area of a size x size square: a
  // circle whose radius wobbles with a few random harmonics, plus ragged
  // edges and a few stray crystals around it. New shape on every call.
  function iceSeed(size = Math.max(4, Math.round(Math.min(W, H) / 4)), at = null) {
    dirty = true;
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
  // the tiny seed čímsi freezes from: a few cells somewhere in the middle third.
  // When nothing can freeze (idle), the seed is planted at full target size.
  function plantSeed() {
    const at = [W * (0.33 + Math.random() * 0.34), H * (0.33 + Math.random() * 0.34)];
    if (params.freeze <= 0) { iceSeed(Math.max(2, Math.round(Math.sqrt(params.ice_target * N))), [W / 2, H / 2]); return; }
    for (let tries = 0; tries < 5 && countIce() === 0; tries++) iceSeed(2, at);
    if (countIce() === 0) grid[Math.floor(at[1]) * W + Math.floor(at[0])] = ICE;
  }
  function countIce() { let n = 0; for (let i = 0; i < N; i++) if (grid[i] === ICE) n++; return n; }
  // new random liquid, with or without the big starting seed; touch layer and touch map wiped
  function fresh(withSeed = true) { dirty = true; randomize(0.3); top.fill(EMPTY); heat.fill(0); fheat.fill(0); oheat.fill(0); if (withSeed) iceSeed(); }

  function freezeAll() { dirty = true; for (let i = 0; i < N; i++) if (grid[i] === LIQUID) grid[i] = ICE; }
  function meltAll()   { dirty = true; for (let i = 0; i < N; i++) if (grid[i] === ICE) grid[i] = LIQUID; }

  // touch-layer blob around a cell (Life-like rules need a few cells to get going)
  function brush(cx, cy, p = 0.55) {
    dirty = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (Math.random() < p) top[idx(cx + dx, cy + dy)] = LIQUID;
  }
  function warm(x, y, f, h = heat) {
    dirty = true; heatLive = true;
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
    setTouchParams(p) { if (p.show !== tparams.show) dirty = true; tparams = p; },
    // smooth look on (1) / off (0); eases over SMOOTH_S unless `snap`
    setSmooth(v, snap = false) { smoothGoal = clamp(+v || 0, 0, 1); if (snap && smooth !== smoothGoal) { smooth = smoothGoal; dirty = true; } },
    // own role's crowd map, the other role's, and the strength for both
    setCrowd(map, strength, other = null) { crowd = map; share = strength; ocrowd = other; },
    setRole(r) { role = r; dirty = true; },
    // after changing cells from outside (sim.grid / sim.top), so the next draw shows it
    invalidate() { dirty = true; },
    get params() { return params; },
    get prismCount() { return prisms.length; },
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
