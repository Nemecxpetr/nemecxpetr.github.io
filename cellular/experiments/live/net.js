// Transport between the admin page and the players. Two interchangeable
// back ends with the same interface:
//   local    -- BroadcastChannel + localStorage, tabs of one browser only
//   firebase -- Firebase Realtime Database, works across the internet
//
// Shared state shape:
//   roles: { cosi: Ramp, cimsi: Ramp }   Ramp = {from,to,start,dur,over,running}
//   cmd:   { id, type, role }            one-shot action (random/clear/seed/...)

import { FIREBASE_CONFIG } from './config.js';

export const ROLES = ['cosi', 'cimsi'];
export const ROLE_LABEL = { cosi: 'cosi', cimsi: 'čímsi' };

export function defaultState() {
  return {
    roles: {
      cosi:  { from: 0, to: 0, start: 0, dur: 0, over: {}, running: true },   // starts cold
      cimsi: { from: 1, to: 1, start: 0, dur: 0, over: {}, running: true },   // starts warm
    },
    cmd: null,
  };
}

function normalize(s) {
  const d = defaultState();
  s = s || {};
  for (const r of ROLES) d.roles[r] = { ...d.roles[r], ...(s.roles && s.roles[r]), over: { ...((s.roles && s.roles[r] && s.roles[r].over) || {}) } };
  d.cmd = s.cmd || null;
  return d;
}

const randomId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export async function connect() {
  const forceLocal = new URLSearchParams(location.search).has('local');
  if (FIREBASE_CONFIG && !forceLocal) {
    try { return await connectFirebase(FIREBASE_CONFIG); }
    catch (e) { console.error('Firebase failed, falling back to local mode', e); }
  }
  return connectLocal();
}

// ---------------------------------------------------------------- local ----
function connectLocal() {
  const KEY = 'cellular-live-state-v1';
  const ch = new BroadcastChannel('cellular-live-v1');
  const listeners = { state: [], presence: [], status: [], auth: [] };
  const emit = (k, v) => listeners[k].forEach(f => f(v));
  let state = defaultState();
  try { const raw = localStorage.getItem(KEY); if (raw) state = normalize(JSON.parse(raw)); } catch {}

  let isAdmin = false;
  const beats = new Map();                  // player id -> {role, t}

  ch.onmessage = ({ data: m }) => {
    if (m.t === 'state') { state = normalize(m.state); emit('state', state); }
    else if (m.t === 'hello' && isAdmin) ch.postMessage({ t: 'state', state });
    else if (m.t === 'beat' && isAdmin) { beats.set(m.id, { role: m.role, t: Date.now() }); countPresence(); }
    else if (m.t === 'bye' && isAdmin) { beats.delete(m.id); countPresence(); }
  };

  function countPresence() {
    const now = Date.now(), c = { cosi: 0, cimsi: 0 };
    for (const [id, b] of beats) { if (now - b.t > 6000) beats.delete(id); else if (b.role in c) c[b.role]++; }
    emit('presence', c);
  }

  function publish() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
    ch.postMessage({ t: 'state', state });
    emit('state', state);
  }

  return {
    mode: 'local',
    now: () => Date.now(),
    getState: () => state,
    on(k, f) { listeners[k].push(f); if (k === 'state') f(state); if (k === 'status') f({ ok: true, text: 'local mode (this browser only)' }); if (k === 'auth') f({ uid: 'local' }); },
    // player
    join(role) {
      const id = randomId();
      const beat = () => ch.postMessage({ t: 'beat', id, role });
      beat(); const timer = setInterval(beat, 2000);
      addEventListener('pagehide', () => ch.postMessage({ t: 'bye', id }));
      ch.postMessage({ t: 'hello' });
      return () => { clearInterval(timer); ch.postMessage({ t: 'bye', id }); };
    },
    // admin
    becomeAdmin() { isAdmin = true; setInterval(countPresence, 2000); ch.postMessage({ t: 'state', state }); },
    async signIn() {}, async signOut() {},
    writeRole(role, ramp) { state.roles[role] = ramp; publish(); },
    sendCmd(type, role) { state.cmd = { id: randomId(), type, role, at: Date.now() }; publish(); },
  };
}

// ------------------------------------------------------------- firebase ----
async function connectFirebase(config) {
  const V = '10.12.2';
  const [{ initializeApp }, db_, auth_] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-database.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
  ]);
  const { getDatabase, ref, onValue, set, push, onDisconnect } = db_;
  const app = initializeApp(config);
  const db = getDatabase(app);

  const listeners = { state: [], presence: [], status: [], auth: [] };
  const emit = (k, v) => listeners[k].forEach(f => f(v));
  let state = defaultState(), offset = 0, connected = false, lastStatus = { ok: false, text: 'connecting…' };
  const status = s => { lastStatus = s; emit('status', s); };

  onValue(ref(db, '.info/serverTimeOffset'), s => { offset = s.val() || 0; });
  const rejoin = [];
  onValue(ref(db, '.info/connected'), s => {
    connected = !!s.val();
    status(connected ? { ok: true, text: 'online' } : { ok: false, text: 'reconnecting…' });
    if (connected) rejoin.forEach(f => f());
  });
  onValue(ref(db, 'live/roles'), s => { state = normalize({ roles: s.val(), cmd: state.cmd }); emit('state', state); },
    e => status({ ok: false, text: 'read denied: ' + e.message }));
  onValue(ref(db, 'live/cmd'), s => { state = { ...state, cmd: s.val() }; emit('state', state); });

  let authApi = null;
  const getAuthApi = () => {
    if (authApi) return authApi;
    const { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } = auth_;
    const auth = getAuth(app);
    onAuthStateChanged(auth, u => emit('auth', u ? { uid: u.uid, name: u.displayName } : null));
    return authApi = { auth, signIn: () => signInWithPopup(auth, new GoogleAuthProvider()), signOut: () => signOut(auth) };
  };

  const fail = e => status({ ok: false, text: 'write failed: ' + (e && e.message || e) + ' (signed in as the admin uid?)' });

  return {
    mode: 'firebase',
    now: () => Date.now() + offset,
    getState: () => state,
    on(k, f) { listeners[k].push(f); if (k === 'state') f(state); if (k === 'status') f(lastStatus); },
    join(role) {
      const me = push(ref(db, `live/presence/${role}`));
      const enter = () => { onDisconnect(me).remove(); set(me, true).catch(() => {}); };
      rejoin.push(enter); if (connected) enter();
      return () => set(me, null);
    },
    becomeAdmin() {
      getAuthApi();
      onValue(ref(db, 'live/presence'), s => {
        const v = s.val() || {};
        emit('presence', { cosi: Object.keys(v.cosi || {}).length, cimsi: Object.keys(v.cimsi || {}).length });
      });
    },
    signIn: () => getAuthApi().signIn().catch(fail),
    signOut: () => getAuthApi().signOut(),
    writeRole(role, ramp) { state.roles[role] = ramp; emit('state', state); set(ref(db, `live/roles/${role}`), ramp).catch(fail); },
    sendCmd(type, role) { set(ref(db, 'live/cmd'), { id: randomId(), type, role, at: Date.now() + offset }).catch(fail); },
  };
}
