import { isAudioEnabled, playPluck, playSineTone, unlockAudioContext } from "../../js/audio-pluck.js";

const canvas = document.getElementById("bassoon-canvas");
const resetButton = document.getElementById("bassoon-reset");
const undoButton = document.getElementById("bassoon-undo");
const lightningButton = document.getElementById("bassoon-lightning");
const statusEl = document.getElementById("bassoon-status");
const ctx = canvas ? canvas.getContext("2d") : null;

const nodeSpecs = [
  { id: "g1", label: "Bassoon I", family: "bassoon", x: 0.16, y: 0.32, pitch: 196, breathMs: 5200, color: "#1daada", sampleIndex: 0 },
  { id: "g2", label: "Bassoon II", family: "bassoon", x: 0.38, y: 0.17, pitch: 247, breathMs: 6100, color: "#6b8d52", sampleIndex: 1 },
  { id: "g3", label: "Bassoon III", family: "bassoon", x: 0.62, y: 0.62, pitch: 311, breathMs: 5650, color: "#c67e2c", sampleIndex: 2 },
  { id: "g4", label: "Bassoon IV", family: "bassoon", x: 0.84, y: 0.34, pitch: 370, breathMs: 6900, color: "#3075bf", sampleIndex: 3 },
  { id: "cb1", label: "Contra I", family: "contrabassoon", x: 0.25, y: 0.76, pitch: 98, breathMs: 7600, color: "#9c563a", sampleIndex: 4 },
  { id: "cb2", label: "Contra II", family: "contrabassoon", x: 0.78, y: 0.78, pitch: 123, breathMs: 8350, color: "#624c9a", sampleIndex: 5 }
];

const nodes = nodeSpecs.map((spec) => ({
  ...spec,
  type: "giant",
  px: 0,
  py: 0,
  radius: spec.family === "contrabassoon" ? 23 : 18,
  active: false,
  struckUntil: 0,
  lastBreathAt: performance.now() + Math.random() * 2200,
  nextAvailableAt: performance.now() + 900 + Math.random() * 1900,
  breathVisualStartedAt: 0,
  pulse: 0
}));

const multifonicSampleUrls = [
  "../../assets/bassoon/trimmed/01_Multifonic rolmo.wav",
  "../../assets/bassoon/trimmed/06_Multifonic lower.wav",
  "../../assets/bassoon/trimmed/10_Multifonic higher.wav",
  "../../assets/bassoon/trimmed/14_Sing tone.wav",
  "../../assets/bassoon/trimmed/02_Multifonic lower.wav",
  "../../assets/bassoon/trimmed/07_Multifonic fujara - long shepherd pipe.wav"
];
let edges = [];
let dpr = 1;
let width = 1;
let height = 1;
let audioCtx = null;
let noiseBus = null;
const decodedBufferByUrl = new Map();
const loadingBufferByUrl = new Map();
let drag = null;
let lastTick = performance.now();
let lightningFlash = null;

function ensureAudioContext() {
  if (audioCtx) {
    return audioCtx;
  }
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) {
    return null;
  }
  audioCtx = new AudioCtor();
  noiseBus = audioCtx.createGain();
  const limiter = audioCtx.createDynamicsCompressor();
  noiseBus.gain.value = 0.32;
  limiter.threshold.value = -20;
  limiter.knee.value = 10;
  limiter.ratio.value = 12;
  noiseBus.connect(limiter);
  limiter.connect(audioCtx.destination);
  return audioCtx;
}

function unlockLocalAudio() {
  unlockAudioContext();
  const ac = ensureAudioContext();
  if (ac && ac.state === "suspended") {
    ac.resume().catch(() => {});
  }
}

async function loadBuffer(url) {
  if (decodedBufferByUrl.has(url)) {
    return decodedBufferByUrl.get(url);
  }
  if (loadingBufferByUrl.has(url)) {
    return loadingBufferByUrl.get(url);
  }
  const ac = ensureAudioContext();
  if (!ac) {
    return null;
  }
  const absoluteUrl = new URL(url, window.location.href).toString();
  const pending = fetch(absoluteUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Unable to fetch ${absoluteUrl}`);
      }
      return response.arrayBuffer();
    })
    .then((arrayBuffer) => ac.decodeAudioData(arrayBuffer.slice(0)))
    .then((buffer) => {
      decodedBufferByUrl.set(url, buffer);
      loadingBufferByUrl.delete(url);
      return buffer;
    })
    .catch(() => {
      loadingBufferByUrl.delete(url);
      return null;
    });
  loadingBufferByUrl.set(url, pending);
  return pending;
}

function resize() {
  if (!canvas || !ctx) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  dpr = Math.max(1, window.devicePixelRatio || 1);
  width = Math.max(1, rect.width);
  height = Math.max(1, rect.height);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const node of nodes) {
    node.px = node.x * width;
    node.py = node.y * height;
  }
}

function getPointer(ev) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ev.clientX - rect.left,
    y: ev.clientY - rect.top
  };
}

function getNodeAt(point) {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    if (Math.hypot(point.x - node.px, point.y - node.py) <= node.radius + 10) {
      return node;
    }
  }
  return null;
}

function edgeKey(a, b) {
  return [a, b].sort().join(":");
}

function hasEdge(a, b) {
  const key = edgeKey(a, b);
  return edges.some((edge) => edge.key === key);
}

function removeEdgeByKey(key) {
  const edgeCount = edges.length;
  edges = edges.filter((edge) => edge.key !== key);
  if (edges.length !== edgeCount) {
    updateGraphState();
  }
}

function removeLastEdge() {
  if (!edges.length) {
    return;
  }
  edges = edges.slice(0, -1);
  updateGraphState();
}

function addEdge(a, b) {
  if (!a || !b || a.id === b.id || hasEdge(a.id, b.id)) {
    return;
  }
  edges.push({
    key: edgeKey(a.id, b.id),
    a: a.id,
    b: b.id,
    bornAt: performance.now()
  });
  updateGraphState();
}

function removeEdgesForNode(nodeId) {
  edges = edges.filter((edge) => edge.a !== nodeId && edge.b !== nodeId);
  updateGraphState();
}

function connectedNeighbors(nodeId) {
  const ids = [];
  for (const edge of edges) {
    if (edge.a === nodeId) {
      ids.push(edge.b);
    } else if (edge.b === nodeId) {
      ids.push(edge.a);
    }
  }
  return ids.map((id) => nodes.find((node) => node.id === id)).filter(Boolean);
}

function getEdgeAt(point) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const edge of edges) {
    const a = nodes.find((node) => node.id === edge.a);
    const b = nodes.find((node) => node.id === edge.b);
    if (!a || !b) {
      continue;
    }
    const distance = distanceToSegment(point, a, b);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = edge;
    }
  }
  return nearestDistance <= 14 ? nearest : null;
}

function distanceToSegment(point, a, b) {
  const dx = b.px - a.px;
  const dy = b.py - a.py;
  const lengthSq = dx * dx + dy * dy;
  if (!lengthSq) {
    return Math.hypot(point.x - a.px, point.y - a.py);
  }
  const unit = Math.max(0, Math.min(1, ((point.x - a.px) * dx + (point.y - a.py) * dy) / lengthSq));
  const x = a.px + dx * unit;
  const y = a.py + dy * unit;
  return Math.hypot(point.x - x, point.y - y);
}

function collectComponentFrom(startId) {
  const visited = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift();
    for (const neighbor of connectedNeighbors(id)) {
      if (visited.has(neighbor.id)) {
        continue;
      }
      visited.add(neighbor.id);
      queue.push(neighbor.id);
    }
  }
  return visited;
}

function strikeComponentFrom(startNode, point = null) {
  if (!startNode) {
    return;
  }
  const now = performance.now();
  const struckIds = new Set();
  const visited = collectComponentFrom(startNode.id);
  for (const node of nodes) {
    if (node.type === "giant" && visited.has(node.id)) {
      struckIds.add(node.id);
      node.struckUntil = now + 4200;
      node.active = false;
      node.pulse = 1;
      playSineTone(node.pitch * 2);
    }
  }
  lightningFlash = {
    x: point ? point.x : startNode.px,
    y: point ? point.y : startNode.py,
    bornAt: now
  };
  playLightningNoise();
  window.setTimeout(() => {
    edges = edges.filter((edge) => {
      return !struckIds.has(edge.a)
        && !struckIds.has(edge.b);
    });
    updateGraphState();
  }, 220);
}

function playLightningNoise() {
  if (!isAudioEnabled()) {
    return;
  }
  const ac = ensureAudioContext();
  if (!ac || ac.state !== "running" || !noiseBus) {
    return;
  }
  const now = ac.currentTime;
  const duration = 0.58;
  const sampleCount = Math.max(1, Math.floor(ac.sampleRate * duration));
  const buffer = ac.createBuffer(1, sampleCount, ac.sampleRate);
  const data = buffer.getChannelData(0);
  let hold = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    if (i % Math.max(8, Math.floor(24 + Math.random() * 68)) === 0) {
      hold = Math.random() * 2 - 1;
    }
    const t = i / sampleCount;
    const crack = Math.random() * 2 - 1;
    const crushed = Math.sign(crack * 0.62 + hold * 0.9);
    data[i] = (crushed * 0.72 + hold * 0.28) * Math.pow(1 - t, 0.34);
  }

  const source = ac.createBufferSource();
  const shaper = ac.createWaveShaper();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();
  const lowOsc = ac.createOscillator();
  const lowGain = ac.createGain();
  const curve = new Float32Array(2048);
  for (let i = 0; i < curve.length; i += 1) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 9);
  }

  shaper.curve = curve;
  shaper.oversample = "4x";
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(180, now);
  filter.frequency.exponentialRampToValueAtTime(3200, now + 0.055);
  filter.frequency.exponentialRampToValueAtTime(420, now + 0.22);
  filter.frequency.exponentialRampToValueAtTime(5200, now + 0.34);
  filter.Q.setValueAtTime(0.8, now);
  filter.Q.linearRampToValueAtTime(12, now + 0.08);
  filter.Q.linearRampToValueAtTime(2.2, now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(1.38, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.buffer = buffer;
  source.playbackRate.setValueAtTime(0.5, now);
  source.playbackRate.exponentialRampToValueAtTime(2.8, now + 0.16);
  source.playbackRate.exponentialRampToValueAtTime(0.72, now + duration);
  source.connect(shaper);
  shaper.connect(filter);
  filter.connect(gain);
  gain.connect(noiseBus);
  source.start(now);
  source.stop(now + duration + 0.02);

  lowOsc.type = "sawtooth";
  lowOsc.frequency.setValueAtTime(42, now);
  lowOsc.frequency.exponentialRampToValueAtTime(27, now + duration);
  lowGain.gain.setValueAtTime(0.0001, now);
  lowGain.gain.linearRampToValueAtTime(0.54, now + 0.018);
  lowGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
  lowOsc.connect(lowGain);
  lowGain.connect(noiseBus);
  lowOsc.start(now);
  lowOsc.stop(now + 0.46);
}

function strikeNearestComponent(point = null) {
  const candidates = nodes.filter((node) => node.active);
  const pool = candidates.length ? candidates : nodes.filter((node) => connectedNeighbors(node.id).length);
  if (!pool.length) {
    return;
  }
  const target = point
    ? pool.reduce((nearest, node) => {
      const distance = Math.hypot(point.x - node.px, point.y - node.py);
      return !nearest || distance < nearest.distance ? { node, distance } : nearest;
    }, null).node
    : pool[Math.floor(Math.random() * pool.length)];
  strikeComponentFrom(target, point || { x: target.px, y: target.py });
}

function updateGraphState() {
  const now = performance.now();
  for (const node of nodes) {
    node.active = false;
  }
  const visited = new Set();
  for (const node of nodes) {
    if (visited.has(node.id)) {
      continue;
    }
    const component = [];
    const queue = [node.id];
    visited.add(node.id);
    while (queue.length) {
      const id = queue.shift();
      const item = nodes.find((candidate) => candidate.id === id);
      if (item) {
        component.push(item);
      }
      for (const neighbor of connectedNeighbors(id)) {
        if (!visited.has(neighbor.id)) {
          visited.add(neighbor.id);
          queue.push(neighbor.id);
        }
      }
    }
    const giantCount = component.filter((item) => item.type === "giant").length;
    const hasGiantGrid = giantCount >= 2;
    for (const item of component) {
      if (item.type === "giant" && now > item.struckUntil && hasGiantGrid) {
        item.active = true;
      }
    }
  }
  updateStatus();
}

function isGiantReady(node, now) {
  return node.active && now > node.struckUntil && now >= node.nextAvailableAt;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function humanDelay(baseMs, spreadMs) {
  return Math.max(120, baseMs + randomBetween(-spreadMs, spreadMs));
}

function getNextBreathInterval(node) {
  const expressiveDrift = randomBetween(-0.22, 0.38);
  const fatigue = randomBetween(0, node.family === "contrabassoon" ? 1600 : 1100);
  return node.breathMs * (1 + expressiveDrift) + fatigue;
}

function setBreathIn(node, untilMs, now = performance.now()) {
  if (!node || untilMs <= now) {
    return;
  }
  node.nextAvailableAt = Math.max(node.nextAvailableAt, untilMs);
  if (!node.breathVisualStartedAt || node.breathVisualStartedAt >= node.nextAvailableAt || now >= node.nextAvailableAt) {
    node.breathVisualStartedAt = now;
  }
}

function updateStatus() {
  if (!statusEl) {
    return;
  }
  const activeCount = nodes.filter((node) => node.active).length;
  const struckCount = nodes.filter((node) => node.type === "giant" && performance.now() < node.struckUntil).length;
  const gridState = activeCount ? `${activeCount} active in giant grid` : "no giant grid";
  const strikeState = struckCount ? ` / ${struckCount} struck` : "";
  statusEl.textContent = `${edges.length} strings / ${gridState}${strikeState}`;
}

async function playDefaultVoice(node) {
  if (!isAudioEnabled()) {
    return;
  }
  const ac = ensureAudioContext();
  if (!ac || ac.state !== "running" || !noiseBus) {
    return;
  }
  const buffer = await loadBuffer(multifonicSampleUrls[node.sampleIndex % multifonicSampleUrls.length]);
  if (!buffer || !node.active) {
    return;
  }
  const duration = Math.min(1.15, Math.max(0.56, buffer.duration * 0.18));
  const startOffset = Math.min(Math.max(0, buffer.duration - duration), 0.36 + Math.random() * 0.62);
  const now = ac.currentTime;
  const source = ac.createBufferSource();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(node.family === "contrabassoon" ? node.pitch * 2.1 : node.pitch * 2.25, now);
  filter.Q.setValueAtTime(node.family === "contrabassoon" ? 2.4 : 3.2, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.5, now + 0.16);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.04);
  source.buffer = buffer;
  source.playbackRate.setValueAtTime(node.family === "contrabassoon" ? 0.58 + node.sampleIndex * 0.025 : 0.84 + node.sampleIndex * 0.07, now);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(noiseBus);
  source.start(now, startOffset, duration);
  source.stop(now + duration + 0.02);
}

function playHighBassoonCall(node) {
  if (!isAudioEnabled()) {
    return;
  }
  const ac = ensureAudioContext();
  if (!ac || ac.state !== "running" || !noiseBus) {
    return;
  }
  const now = ac.currentTime;
  const root = node.family === "contrabassoon" ? node.pitch * 3.7 : node.pitch * 2.8;
  const output = ac.createGain();
  output.gain.setValueAtTime(0.0001, now);
  output.gain.linearRampToValueAtTime(0.24, now + 0.045);
  output.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
  output.connect(noiseBus);

  [1, 1.505, 2.01].forEach((ratio, index) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const filter = ac.createBiquadFilter();
    osc.type = index === 0 ? "sine" : "triangle";
    osc.frequency.setValueAtTime(root * ratio, now);
    osc.frequency.linearRampToValueAtTime(root * ratio * 1.018, now + 0.22);
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(root * ratio, now);
    filter.Q.setValueAtTime(7, now);
    gain.gain.value = index === 0 ? 0.9 : 0.34;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    osc.start(now);
    osc.stop(now + 0.5);
  });
}

function playPercussiveResponse(node) {
  if (!isAudioEnabled()) {
    return;
  }
  const sizeRange = { min: 8, max: 18 };
  const baseSize = node.family === "contrabassoon" ? 17.5 : 15.5;
  playPluck(baseSize, sizeRange);
  window.setTimeout(() => playPluck(baseSize * 0.86, sizeRange), 46);
  window.setTimeout(() => playPluck(baseSize * 0.72, sizeRange), 94);
}

function greetAndRespond(sourceNode) {
  const heardAt = performance.now();
  const neighbors = connectedNeighbors(sourceNode.id)
    .filter((node) => node.type === "giant" && node.active && heardAt > node.struckUntil);
  neighbors.forEach((neighbor, index) => {
    const listeningHesitationMs = humanDelay(520, 260);
    const inhaleBeforeCallMs = listeningHesitationMs
      + humanDelay(neighbor.family === "contrabassoon" ? 2450 : 1750, 620)
      + index * randomBetween(120, 420);
    const inhaleBeforeResponseMs = humanDelay(sourceNode.family === "contrabassoon" ? 2100 : 1450, 520);
    const recoveryAfterCallMs = randomBetween(760, 1600);
    const recoveryAfterResponseMs = randomBetween(1100, sourceNode.family === "contrabassoon" ? 2600 : 2100);
    setBreathIn(neighbor, heardAt + inhaleBeforeCallMs + 420, heardAt);
    setBreathIn(sourceNode, heardAt + inhaleBeforeCallMs + inhaleBeforeResponseMs + recoveryAfterResponseMs, heardAt);
    window.setTimeout(() => {
      if (!neighbor.active || !sourceNode.active || performance.now() < neighbor.struckUntil) {
        return;
      }
      playHighBassoonCall(neighbor);
      neighbor.pulse = 1;
      setBreathIn(neighbor, performance.now() + recoveryAfterCallMs);
      window.setTimeout(() => {
        if (!sourceNode.active || performance.now() < sourceNode.struckUntil) {
          return;
        }
        playPercussiveResponse(sourceNode);
        sourceNode.pulse = 1;
      }, inhaleBeforeResponseMs);
    }, inhaleBeforeCallMs);
  });
}

function tickAudio(now) {
  for (const node of nodes) {
    if (node.type !== "giant" || !isGiantReady(node, now)) {
      continue;
    }
    if (now - node.lastBreathAt >= node.breathMs) {
      node.lastBreathAt = now;
      node.breathMs = getNextBreathInterval(node);
      setBreathIn(node, now + humanDelay(node.family === "contrabassoon" ? 1700 : 1250, 360), now);
      node.pulse = 1;
      void playDefaultVoice(node);
      greetAndRespond(node);
    }
  }
}

function draw(now) {
  if (!ctx) {
    return;
  }
  const dt = Math.min(48, now - lastTick);
  lastTick = now;
  updateGraphState();
  tickAudio(now);

  ctx.clearRect(0, 0, width, height);
  drawEdges(now);
  drawLightning(now);
  drawDragLine();
  drawNodes(dt, now);
  window.requestAnimationFrame(draw);
}

function drawEdges(now) {
  ctx.lineCap = "round";
  for (const edge of edges) {
    const a = nodes.find((node) => node.id === edge.a);
    const b = nodes.find((node) => node.id === edge.b);
    if (!a || !b) {
      continue;
    }
    const age = Math.min(1, (now - edge.bornAt) / 260);
    const shimmer = 0.5 + 0.5 * Math.sin(now * 0.006 + a.px * 0.02);
    ctx.strokeStyle = `rgba(17, 17, 17, ${0.22 + shimmer * 0.18})`;
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      ctx.strokeStyle = `rgba(250, 245, 239, ${0.22 + shimmer * 0.2})`;
    }
    ctx.lineWidth = 1.2 + age * 1.4;
    ctx.beginPath();
    ctx.moveTo(a.px, a.py);
    const midX = (a.px + b.px) * 0.5;
    const midY = (a.py + b.py) * 0.5 + Math.sin(now * 0.004 + edge.bornAt) * 4;
    ctx.quadraticCurveTo(midX, midY, b.px, b.py);
    ctx.stroke();
  }
}

function drawDragLine() {
  if (!drag) {
    return;
  }
  ctx.strokeStyle = "rgba(29, 170, 218, 0.72)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(drag.from.px, drag.from.py);
  ctx.lineTo(drag.x, drag.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawLightning(now) {
  if (!lightningFlash) {
    return;
  }
  const age = now - lightningFlash.bornAt;
  if (age > 360) {
    lightningFlash = null;
    return;
  }
  const alpha = 1 - age / 360;
  ctx.save();
  ctx.strokeStyle = `rgba(185, 71, 53, ${alpha})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  const topX = lightningFlash.x + Math.sin(age * 0.04) * 28;
  ctx.moveTo(topX, 0);
  ctx.lineTo(lightningFlash.x - 18, lightningFlash.y * 0.45);
  ctx.lineTo(lightningFlash.x + 10, lightningFlash.y * 0.62);
  ctx.lineTo(lightningFlash.x - 4, lightningFlash.y);
  ctx.stroke();
  ctx.restore();
}


function drawNodes(dt, now) {
  for (const node of nodes) {
    node.pulse = Math.max(0, node.pulse - dt * 0.0042);
    const struck = node.type === "giant" && now < node.struckUntil;
    const activeBoost = node.active ? 4 + Math.sin(now * 0.006) * 2 : 0;
    const pulseBoost = node.pulse * 12;
    const radius = node.radius + activeBoost + pulseBoost;
    drawBreathRing(node, radius, now);

    ctx.fillStyle = node.color;
    ctx.globalAlpha = struck ? 0.34 : 0.92;
    ctx.beginPath();
    ctx.arc(node.px, node.py, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = node.active ? "#ffffff" : "rgba(255, 255, 255, 0.62)";
    ctx.lineWidth = node.family === "contrabassoon" ? 2.2 : (node.active ? 2.4 : 1.2);
    ctx.beginPath();
    ctx.arc(node.px, node.py, radius + 2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--fg").trim() || "#111";
    ctx.font = "600 12px IBM Plex Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(node.label, node.px, node.py + radius + 10);
  }
}

function drawBreathRing(node, radius, now) {
  if (!node.active || now >= node.nextAvailableAt || !node.breathVisualStartedAt) {
    return;
  }
  const total = Math.max(1, node.nextAvailableAt - node.breathVisualStartedAt);
  const elapsed = Math.max(0, now - node.breathVisualStartedAt);
  const progress = Math.max(0, Math.min(1, elapsed / total));
  const spin = now * (node.family === "contrabassoon" ? 0.0032 : 0.0048) + node.sampleIndex;
  const ringRadius = radius + 12 + progress * 8;
  const arcLength = Math.PI * (0.55 + progress * 0.95);
  const alpha = 0.28 + (1 - progress) * 0.34;

  ctx.save();
  ctx.strokeStyle = `rgba(29, 170, 218, ${alpha})`;
  if (node.family === "contrabassoon") {
    ctx.strokeStyle = `rgba(198, 126, 44, ${alpha})`;
  }
  ctx.lineWidth = node.family === "contrabassoon" ? 3.2 : 2.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(node.px, node.py, ringRadius, spin, spin + arcLength);
  ctx.stroke();

  ctx.globalAlpha = alpha * 0.74;
  ctx.setLineDash([2, 8]);
  ctx.beginPath();
  ctx.arc(node.px, node.py, ringRadius + 6, spin + Math.PI, spin + Math.PI + arcLength * 0.72);
  ctx.stroke();
  ctx.restore();
}

function onPointerDown(ev) {
  if (!canvas) {
    return;
  }
  unlockLocalAudio();
  const point = getPointer(ev);
  const node = getNodeAt(point);
  if (!node) {
    if (ev.button === 2) {
      strikeNearestComponent(point);
      ev.preventDefault();
      return;
    }
    const edge = getEdgeAt(point);
    if (edge) {
      removeEdgeByKey(edge.key);
      ev.preventDefault();
    }
    return;
  }
  if (ev.button === 2) {
    strikeComponentFrom(node, point);
    ev.preventDefault();
    return;
  }
  drag = {
    from: node,
    pointerId: ev.pointerId,
    x: point.x,
    y: point.y
  };
  if (typeof canvas.setPointerCapture === "function") {
    canvas.setPointerCapture(ev.pointerId);
  }
  ev.preventDefault();
}

function onPointerMove(ev) {
  if (!drag || ev.pointerId !== drag.pointerId) {
    return;
  }
  const point = getPointer(ev);
  drag.x = point.x;
  drag.y = point.y;
  ev.preventDefault();
}

function onPointerUp(ev) {
  if (!drag || ev.pointerId !== drag.pointerId) {
    return;
  }
  const point = getPointer(ev);
  const target = getNodeAt(point);
  addEdge(drag.from, target);
  if (typeof canvas.releasePointerCapture === "function") {
    canvas.releasePointerCapture(ev.pointerId);
  }
  drag = null;
  ev.preventDefault();
}

function reset() {
  edges = [];
  drag = null;
  const now = performance.now();
  for (const node of nodes) {
    node.active = false;
    node.struckUntil = 0;
    node.breathMs = getNextBreathInterval(node);
    node.lastBreathAt = now + Math.random() * 2200;
    node.nextAvailableAt = now + 900 + Math.random() * 1900;
    node.breathVisualStartedAt = now;
    node.pulse = 0;
  }
  updateGraphState();
}

if (canvas && ctx) {
  resize();
  canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
  canvas.addEventListener("pointermove", onPointerMove, { passive: false });
  canvas.addEventListener("pointerup", onPointerUp, { passive: false });
  canvas.addEventListener("pointercancel", onPointerUp, { passive: false });
  canvas.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
  });
  window.addEventListener("resize", resize, { passive: true });
  resetButton?.addEventListener("click", reset);
  undoButton?.addEventListener("click", removeLastEdge);
  lightningButton?.addEventListener("click", () => strikeNearestComponent());
  updateStatus();
  window.requestAnimationFrame(draw);
}
