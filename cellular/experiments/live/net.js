// Transport between the admin page and the players. Two interchangeable
// back ends with the same interface:
//   local    -- BroadcastChannel + localStorage, tabs of one browser only
//   firebase -- Firebase Realtime Database, works across the internet
//
// Shared state shape (what phones see):
//   roles: { cosi: Ramp, cimsi: Ramp }  Ramp = {from,to,start,dur,over,tover,running}
//   cmd:   { id, type, role }           one-shot action (random/clear/seed/...)
//   fb:    { share, shareK, nudge, nudgeK }   crowd feedback switches (admin)
//   crowd: { cosi: {m, a, t}, cimsi: ... }    combined touch map + activity (admin)
//   net:   { ws }                        phones on a live connection (admin)
//
// Phones send their touches to touch/<role>/<id> = {t, n, m} (anonymous id,
// coarse 8x16 map). The admin page adds them up into `crowd` and records
// snapshots to /log/<session> (admin-only, outside live/ so it isn't public).
//
// Big rooms: the free Firebase plan allows 100 live connections. Phones use a
// live connection while there's room (net.ws < WS_CAP) and otherwise poll the
// state over plain HTTPS every few seconds (short requests, no slot held).
// They move between the two on their own as the room fills and empties.

import { FIREBASE_CONFIG } from './config.js';

export const ROLES = ['cosi', 'cimsi'];
export const ROLE_LABEL = { cosi: 'cosi', cimsi: 'čímsi' };
export const WS_CAP = 80;                 // live phones; the rest poll (100 is the hard limit)
const POLL_MS = 4000;

export function defaultFb() { return { share: false, shareK: 0.5, nudge: false, nudgeK: 0.5 }; }
export function defaultState() {
  return {
    roles: {
      cosi:  { from: 0, to: 0, start: 0, dur: 0, over: {}, tover: {}, running: true },   // starts cold
      cimsi: { from: 1, to: 1, start: 0, dur: 0, over: {}, tover: {}, running: true },   // starts warm
    },
    cmd: null,
    fb: defaultFb(),
    crowd: { cosi: null, cimsi: null },
    net: { ws: 0 },
  };
}

function normalize(s) {
  const d = defaultState();
  s = s || {};
  for (const r of ROLES) {
    const src = (s.roles && s.roles[r]) || {};
    d.roles[r] = { ...d.roles[r], ...src, over: { ...(src.over || {}) }, tover: { ...(src.tover || {}) } };
    if (s.crowd && s.crowd[r]) d.crowd[r] = s.crowd[r];
  }
  d.cmd = s.cmd || null;
  d.fb = { ...d.fb, ...(s.fb || {}) };
  d.net = { ...d.net, ...(s.net || {}) };
  return d;
}

const randomId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// kind: 'player' | 'admin'
export async function connect(kind = 'player') {
  const forceLocal = new URLSearchParams(location.search).has('local');
  if (FIREBASE_CONFIG && !forceLocal) {
    try { return kind === 'admin' ? await connectFirebaseAdmin(FIREBASE_CONFIG) : await connectFirebasePlayer(FIREBASE_CONFIG); }
    catch (e) { console.error('Firebase failed, falling back to local mode', e); }
  }
  return connectLocal();
}

function makeEmitter() {
  const listeners = { state: [], presence: [], status: [], auth: [], touch: [] };
  return { listeners, emit: (k, v) => (listeners[k] || []).forEach(f => f(v)) };
}

// ---------------------------------------------------------------- local ----
function connectLocal() {
  const KEY = 'cellular-live-state-v2', LOGKEY = 'cellular-live-log-v1';
  const ch = new BroadcastChannel('cellular-live-v1');
  const { listeners, emit } = makeEmitter();
  let state = defaultState();
  try { const raw = localStorage.getItem(KEY); if (raw) state = normalize(JSON.parse(raw)); } catch {}

  let isAdmin = false;
  const beats = new Map();                  // player id -> {role, t}
  const touch = { cosi: {}, cimsi: {} };    // admin: role -> id -> {t, n, m}

  ch.onmessage = ({ data: m }) => {
    if (m.t === 'state') { state = normalize(m.state); emit('state', state); }
    else if (m.t === 'hello' && isAdmin) ch.postMessage({ t: 'state', state });
    else if (m.t === 'beat' && isAdmin) { beats.set(m.id, { role: m.role, t: Date.now() }); countPresence(); }
    else if (m.t === 'bye' && isAdmin) { beats.delete(m.id); for (const r of ROLES) delete touch[r][m.id]; countPresence(); }
    else if (m.t === 'touch' && isAdmin && touch[m.role]) { touch[m.role][m.id] = { t: Date.now(), n: m.n, m: m.m }; emit('touch', touch); }
  };

  function countPresence() {
    const now = Date.now(), c = { cosi: 0, cimsi: 0, poll: { cosi: 0, cimsi: 0 } };
    for (const [id, b] of beats) { if (now - b.t > 6000) beats.delete(id); else if (b.role in c) c[b.role]++; }
    emit('presence', c);
  }

  function publish() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
    ch.postMessage({ t: 'state', state });
    emit('state', state);
  }

  let logs = {};
  try { logs = JSON.parse(localStorage.getItem(LOGKEY) || '{}'); } catch {}

  let myId = null, myRole = null;
  return {
    mode: 'local',
    link: () => 'local',
    now: () => Date.now(),
    getState: () => state,
    on(k, f) { listeners[k].push(f); if (k === 'state') f(state); if (k === 'status') f({ ok: true, text: 'local mode (this browser only)' }); if (k === 'auth') f({ uid: 'local' }); },
    // player
    join(role) {
      const id = myId = randomId(); myRole = role;
      const beat = () => ch.postMessage({ t: 'beat', id, role });
      beat(); const timer = setInterval(beat, 2000);
      addEventListener('pagehide', () => ch.postMessage({ t: 'bye', id }));
      ch.postMessage({ t: 'hello' });
      return () => { clearInterval(timer); ch.postMessage({ t: 'bye', id }); myId = null; };
    },
    sendTouch(t) { if (myId) ch.postMessage({ t: 'touch', id: myId, role: myRole, n: t.n, m: t.m }); },
    // admin
    becomeAdmin() { isAdmin = true; setInterval(countPresence, 2000); ch.postMessage({ t: 'state', state }); },
    async signIn() {}, async signOut() {},
    writeRole(role, ramp) { state.roles[role] = ramp; publish(); },
    sendCmd(type, role) { state.cmd = { id: randomId(), type, role, at: Date.now() }; publish(); },
    writeFb(fb) { state.fb = fb; publish(); },
    writeCrowd(crowd) { state.crowd = crowd; publish(); return Promise.resolve(true); },
    writeNet() { return Promise.resolve(true); },
    dropTouch(list) { for (const [r, id] of list) delete touch[r][id]; },
    writeLog(session, t, snap) { (logs[session] ||= {})[t] = snap; try { localStorage.setItem(LOGKEY, JSON.stringify(logs)); } catch {} },
    async readLog(session) { return logs[session] || null; },
  };
}

// ------------------------------------------------------------- firebase ----
const SDK = '10.12.2';
async function loadSdk(withAuth) {
  const mods = [
    import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-database.js`),
  ];
  if (withAuth) mods.push(import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js`));
  return Promise.all(mods);
}

// Player: picks live (websocket) or poll (HTTPS) and switches between them.
async function connectFirebasePlayer(config) {
  const base = config.databaseURL.replace(/\/$/, '');
  const rest = async (path, opt) => {
    const r = await fetch(`${base}/${path}.json`, opt);
    if (!r.ok) throw new Error(`${r.status} ${path}`);
    return r.json();
  };
  const { listeners, emit } = makeEmitter();
  let state = defaultState(), offset = 0, lastStatus = { ok: false, text: 'connecting…' };
  const status = s => { lastStatus = s; emit('status', s); };
  const setPart = (k, v) => { const s = { ...state }; s[k] = v; state = normalize(s); emit('state', state); };

  let role = null, id = randomId(), link = null;  // link: 'live' | 'poll'
  let sdk = null, db = null, subs = [], presenceRef = null, touchRef = null, connected = false, liveSince = 0;
  let pollTimer = null, blockedUntil = 0, lastSwitch = 0;

  // ---- live link
  async function startLive() {
    link = 'live'; lastSwitch = Date.now(); liveSince = Date.now();
    status({ ok: false, text: 'connecting…' });
    if (!sdk) {
      const [{ initializeApp }, d] = await loadSdk(false);
      sdk = d; db = sdk.getDatabase(initializeApp(config));
    } else sdk.goOnline(db);
    const { ref, onValue } = sdk;
    const sub = (path, f) => subs.push(onValue(ref(db, path), s => f(s.val()), e => status({ ok: false, text: 'read denied: ' + e.message })));
    sub('.info/serverTimeOffset', v => { offset = v || 0; });
    sub('.info/connected', v => {
      connected = !!v;
      status(connected ? { ok: true, text: 'online' } : { ok: false, text: 'reconnecting…' });
      if (connected) enterPresence();
    });
    sub('live/roles', v => setPart('roles', v));
    sub('live/cmd', v => setPart('cmd', v));
    sub('live/fb', v => setPart('fb', v));
    sub('live/crowd', v => setPart('crowd', v));
    sub('live/net', v => { setPart('net', v); balance(); });
    // the 101st connection is refused and the SDK just keeps retrying: give up
    // after 10 s and poll instead
    setTimeout(() => { if (link === 'live' && !connected) { blockedUntil = Date.now() + 60000; switchTo('poll'); } }, 10000);
  }
  function enterPresence() {
    if (!role || !db || link !== 'live') return;
    const { ref, set, onDisconnect } = sdk;
    presenceRef = ref(db, `live/presence/${role}/${id}`);
    touchRef = ref(db, `live/touch/${role}/${id}`);
    onDisconnect(presenceRef).remove(); onDisconnect(touchRef).remove();
    set(presenceRef, true).catch(() => {});
  }
  function stopLive() {
    subs.forEach(u => u()); subs = [];
    if (presenceRef) sdk.set(presenceRef, null).catch(() => {});
    presenceRef = touchRef = null; connected = false;
    if (db) sdk.goOffline(db);
  }

  // ---- poll link
  async function pollOnce() {
    try {
      const [roles, cmd, fb, crowd, net] = await Promise.all([
        rest('live/roles'), rest('live/cmd'), rest('live/fb'), role ? rest('live/crowd') : null, rest('live/net'),
      ]);
      const s = { ...state, roles, cmd, fb, net, crowd: { ...state.crowd } };
      if (role && crowd) for (const r of ROLES) s.crowd[r] = crowd[r];        // both: the other role's glow shows too
      state = normalize(s); emit('state', state);
      status({ ok: true, text: 'online · light' });
      balance();
    } catch (e) { status({ ok: false, text: 'reconnecting… (' + e.message + ')' }); }
  }
  // clock offset without a live link: write a server timestamp, read it back
  async function syncClock() {
    if (!role) return;
    try {
      const t0 = Date.now();
      await rest(`live/touch/${role}/${id}`, { method: 'PUT', body: JSON.stringify({ t: { '.sv': 'timestamp' }, n: 0, m: '' }) });
      const v = await rest(`live/touch/${role}/${id}/t`);
      const t1 = Date.now();
      if (typeof v === 'number') offset = v - (t0 + t1) / 2;
    } catch {}
  }
  function startPoll() {
    link = 'poll'; lastSwitch = Date.now();
    let n = 0;
    const loop = async () => {
      if (link !== 'poll') return;
      if (n++ % 15 === 0) await syncClock();               // about once a minute
      await pollOnce();
      pollTimer = setTimeout(loop, POLL_MS * (0.75 + Math.random() * 0.5));   // jitter: don't all hit at once
    };
    loop();
  }
  function stopPoll() { clearTimeout(pollTimer); pollTimer = null; }

  function switchTo(next) {
    if (next === link) return;
    if (link === 'live') stopLive(); else if (link === 'poll') stopPoll();
    if (next === 'live') startLive(); else startPoll();
  }
  // move between live and poll as the room fills/empties (random, so not all
  // phones jump at once; at most every 20 s per phone)
  function balance() {
    const ws = +(state.net && state.net.ws) || 0, now = Date.now();
    if (now - lastSwitch < 20000) return;
    if (link === 'live' && ws > WS_CAP && Math.random() < 0.25) switchTo('poll');
    else if (link === 'poll' && now > blockedUntil && ws < WS_CAP - 10 && Math.random() < 0.25) switchTo('live');
  }

  // start: ask how full the room is, then pick a link
  let ws0 = 0;
  try { ws0 = +((await rest('live/net')) || {}).ws || 0; } catch {}
  if (ws0 >= WS_CAP) startPoll(); else await startLive();

  return {
    mode: 'firebase',
    link: () => link,
    now: () => Date.now() + offset,
    getState: () => state,
    on(k, f) { listeners[k].push(f); if (k === 'state') f(state); if (k === 'status') f(lastStatus); },
    join(r) {
      role = r;
      if (link === 'live' && connected) enterPresence();
      if (link === 'poll') { syncClock(); pollOnce(); }
      const bye = () => {
        if (presenceRef) sdk.set(presenceRef, null).catch(() => {});
        if (touchRef) sdk.set(touchRef, null).catch(() => {});
        else fetch(`${base}/live/touch/${r}/${id}.json`, { method: 'DELETE', keepalive: true }).catch(() => {});
      };
      addEventListener('pagehide', bye);
      return () => { removeEventListener('pagehide', bye); bye(); role = null; presenceRef = touchRef = null; id = randomId(); };
    },
    // {n, m}: touch samples since last time + coarse map. Also the heartbeat
    // that counts poll phones as present.
    sendTouch(t) {
      if (!role) return;
      const body = { n: t.n, m: t.m };
      if (link === 'live' && touchRef) sdk.set(touchRef, { ...body, t: sdk.serverTimestamp() }).catch(() => {});
      else rest(`live/touch/${role}/${id}`, { method: 'PUT', body: JSON.stringify({ ...body, t: { '.sv': 'timestamp' } }) }).catch(() => {});
    },
  };
}

// Admin: always live, plus Google sign-in.
async function connectFirebaseAdmin(config) {
  const [{ initializeApp }, db_, auth_] = await loadSdk(true);
  const { getDatabase, ref, onValue, set, update, get } = db_;
  const app = initializeApp(config);
  const db = getDatabase(app);

  const { listeners, emit } = makeEmitter();
  let state = defaultState(), offset = 0, connected = false, lastStatus = { ok: false, text: 'connecting…' };
  const status = s => { lastStatus = s; emit('status', s); };
  const setPart = (k, v) => { const s = { ...state }; s[k] = v; state = normalize(s); emit('state', state); };

  onValue(ref(db, '.info/serverTimeOffset'), s => { offset = s.val() || 0; });
  onValue(ref(db, '.info/connected'), s => {
    connected = !!s.val();
    status(connected ? { ok: true, text: 'online' } : { ok: false, text: 'reconnecting…' });
  });
  const denied = e => status({ ok: false, text: 'read denied: ' + e.message });
  onValue(ref(db, 'live/roles'), s => setPart('roles', s.val()), denied);
  onValue(ref(db, 'live/cmd'), s => setPart('cmd', s.val()));
  onValue(ref(db, 'live/fb'), s => setPart('fb', s.val()));
  onValue(ref(db, 'live/crowd'), s => setPart('crowd', s.val()));
  onValue(ref(db, 'live/net'), s => setPart('net', s.val()));

  let authApi = null;
  const getAuthApi = () => {
    if (authApi) return authApi;
    const { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } = auth_;
    const auth = getAuth(app);
    onAuthStateChanged(auth, u => emit('auth', u ? { uid: u.uid, name: u.displayName } : null));
    return authApi = { auth, signIn: () => signInWithPopup(auth, new GoogleAuthProvider()), signOut: () => signOut(auth) };
  };

  const fail = e => status({ ok: false, text: 'write failed: ' + (e && e.message || e) + ' (signed in as the admin uid? rules published?)' });

  return {
    mode: 'firebase',
    link: () => 'live',
    now: () => Date.now() + offset,
    getState: () => state,
    on(k, f) { listeners[k].push(f); if (k === 'state') f(state); if (k === 'status') f(lastStatus); },
    becomeAdmin() {
      getAuthApi();
      onValue(ref(db, 'live/presence'), s => {
        const v = s.val() || {};
        emit('presence', { cosi: Object.keys(v.cosi || {}).length, cimsi: Object.keys(v.cimsi || {}).length, ids: { cosi: v.cosi || {}, cimsi: v.cimsi || {} } });
      });
      onValue(ref(db, 'live/touch'), s => { const v = s.val() || {}; emit('touch', { cosi: v.cosi || {}, cimsi: v.cimsi || {} }); });
    },
    signIn: () => getAuthApi().signIn().catch(fail),
    signOut: () => getAuthApi().signOut(),
    writeRole(role, ramp) { state.roles[role] = ramp; emit('state', state); set(ref(db, `live/roles/${role}`), ramp).catch(fail); },
    sendCmd(type, role) { set(ref(db, 'live/cmd'), { id: randomId(), type, role, at: Date.now() + offset }).catch(fail); },
    writeFb(fb) { state.fb = fb; emit('state', state); set(ref(db, 'live/fb'), fb).catch(fail); },
    // resolve true/false so the aggregator can retry a rejected write
    writeCrowd(crowd) { return set(ref(db, 'live/crowd'), crowd).then(() => true, e => { fail(e); return false; }); },
    writeNet(n) { return set(ref(db, 'live/net'), n).then(() => true, e => { fail(e); return false; }); },
    // remove stale touch entries: list of [role, id]
    dropTouch(list) {
      if (!list.length) return;
      const u = {};
      for (const [r, id] of list) u[`${r}/${id}`] = null;
      update(ref(db, 'live/touch'), u).catch(() => {});
    },
    writeLog(session, t, snap) { set(ref(db, `log/${session}/${t}`), snap).catch(fail); },
    async readLog(session) { const s = await get(ref(db, `log/${session}`)); return s.val(); },
  };
}
