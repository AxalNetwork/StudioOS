/**
 * D660 (#1473) — capturing an interview session in the browser.
 *
 * Two streams leave the microphone, and they are different on purpose:
 *   - LIVE: 16 kHz linear16 PCM over the session's WebSocket (D657's
 *     `GET /sessions/:id/live`), for the draft transcript. Hiding the live
 *     transcript CLOSES this socket — a hidden caption still being billed is
 *     not hidden.
 *   - CHUNKS: `MediaRecorder` audio, restarted every CHUNK_MS so each chunk
 *     decodes on its own (D657 transcribes chunk by chunk), PUT by sequence
 *     number. Every chunk goes into an IndexedDB queue FIRST and leaves it
 *     only when the Worker has it; offline, the queue simply waits. A repeat
 *     upload is answered `duplicate: true`, so a retry is always safe.
 *
 * Browser objects (getUserMedia, AudioContext, MediaRecorder, WebSocket,
 * indexedDB) are injected, so tests drive this module without a browser.
 */

export const LIVE_SAMPLE_RATE = 16000;
export const CHUNK_MS = 15000;
/** How long the microphone may read silence before the page says so. */
export const NO_SOUND_MS = 8000;

/** Float samples at `inRate` → 16 kHz signed 16-bit PCM. */
export function downsampleTo16k(input, inRate) {
  if (!input || !input.length) return new Int16Array(0);
  const ratio = inRate / LIVE_SAMPLE_RATE;
  const n = Math.floor(input.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i += 1) {
    const from = Math.floor(i * ratio), to = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0, c = 0;
    for (let j = from; j < to; j += 1) { sum += input[j]; c += 1; }
    const v = Math.max(-1, Math.min(1, c ? sum / c : input[from] || 0));
    out[i] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
  }
  return out;
}

/** Root-mean-square level of a float block, 0..1. */
export function rms(input) {
  if (!input || !input.length) return 0;
  let s = 0;
  for (let i = 0; i < input.length; i += 1) s += input[i] * input[i];
  return Math.sqrt(s / input.length);
}

// ---------------------------------------------------------------------------
// The offline queue
// ---------------------------------------------------------------------------

const DB_NAME = 'studioos-interview-audio';
const STORE = 'chunks';

/** A queue in memory: for tests, and when IndexedDB is unavailable. */
export function memoryQueue() {
  const rows = new Map();
  const k = (r) => `${r.sessionId}:${r.seq}`;
  return {
    durable: false,
    put: async (r) => { rows.set(k(r), r); },
    list: async (sessionId) => [...rows.values()].filter((r) => r.sessionId === sessionId).sort((a, b) => a.seq - b.seq),
    remove: async (sessionId, seq) => { rows.delete(`${sessionId}:${seq}`); },
  };
}

/** The same queue on IndexedDB, which survives a closed tab. */
export function indexedDbQueue(idb = (typeof indexedDB !== 'undefined' ? indexedDB : null)) {
  if (!idb) return memoryQueue();
  let opened = null;
  const open = () => opened || (opened = new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: ['sessionId', 'seq'] }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
      t.onerror = () => reject(t.error);
    });
  };
  return {
    durable: true,
    put: (r) => tx('readwrite', (s) => s.put(r)),
    list: async (sessionId) => {
      const all = await tx('readonly', (s) => s.getAll());
      return (all || []).filter((r) => r.sessionId === sessionId).sort((a, b) => a.seq - b.seq);
    },
    remove: (sessionId, seq) => tx('readwrite', (s) => s.delete([sessionId, seq])),
  };
}

/**
 * Upload every queued chunk of a session, in order. A chunk leaves the queue
 * only once the Worker has it (stored, or `duplicate`). The first failure
 * stops the pass: the rest wait for the next one, in order.
 */
export async function flushQueue(queue, sessionId, upload) {
  const rows = await queue.list(sessionId);
  let sent = 0;
  for (const r of rows) {
    try {
      await upload(r.seq, r.blob, r.startMs);
    } catch (e) {
      // 4xx other than a timeout is a refusal the queue cannot fix by waiting
      // (consent withdrawn, too large); keep it, and report it.
      return { sent, pending: rows.length - sent, error: e };
    }
    await queue.remove(sessionId, r.seq);
    sent += 1;
  }
  return { sent, pending: 0, error: null };
}

// ---------------------------------------------------------------------------
// The live socket
// ---------------------------------------------------------------------------

/**
 * The live transcript's socket. `close()` is what "Hide live transcript"
 * calls; after it, `send` drops audio instead of reopening anything.
 */
export function openLiveSocket({ url, WebSocketImpl, onEvent, onClose }) {
  const ws = new WebSocketImpl(url);
  ws.binaryType = 'arraybuffer';
  let open = false, closed = false;
  ws.onopen = () => { open = true; };
  ws.onmessage = (m) => {
    let ev = m.data;
    if (typeof ev === 'string') { try { ev = JSON.parse(ev); } catch { return; } }
    onEvent?.(ev);
  };
  ws.onclose = (e) => { open = false; closed = true; onClose?.(e); };
  return {
    get open() { return open && !closed; },
    send(pcm) { if (open && !closed) ws.send(pcm.buffer || pcm); },
    close() { if (!closed) { closed = true; open = false; try { ws.close(1000, 'hidden'); } catch { /* already gone */ } } },
  };
}

/** A live event, read for the caption line. Interim text is shown, not kept. */
export function readLiveEvent(ev) {
  if (!ev || typeof ev !== 'object') return null;
  if (ev.type === 'Results') {
    const text = String(ev.channel?.alternatives?.[0]?.transcript || '').trim();
    return text ? { text, final: ev.is_final === true } : null;
  }
  if (typeof ev.event === 'string' && 'transcript' in ev) {
    const text = String(ev.transcript || '').trim();
    return text ? { text, final: ev.event === 'EndOfTurn' } : null;
  }
  if (ev.error || ev.refusal) return { error: String(ev.message || ev.error || ev.refusal) };
  return null;
}

// ---------------------------------------------------------------------------
// The recorder
// ---------------------------------------------------------------------------

/**
 * One capture. `deps` carries the browser: { getUserMedia, AudioContext,
 * MediaRecorder, WebSocket, now, setTimeout, clearTimeout, liveUrl }.
 * `api` carries the Worker: { uploadChunk(seq, blob, startMs) }.
 */
export function createCapture({ deps, api, queue, sessionId, liveOn, onState }) {
  const s = {
    stream: null, ctx: null, analyser: null, processor: null, recorder: null, socket: null,
    seq: 0, startedAt: 0, pausedMs: 0, pausedAt: null, chunkTimer: null, lastSoundAt: 0,
    live: !!liveOn, caption: '', online: true, flushing: false, pending: 0, error: null,
  };
  const emit = (extra = {}) => onState?.({
    analyser: s.analyser, live: s.live, liveOpen: !!s.socket?.open, caption: s.caption,
    pending: s.pending, online: s.online, error: s.error, silentMs: s.startedAt ? deps.now() - s.lastSoundAt : 0, ...extra,
  });

  const flush = async () => {
    if (s.flushing) return;
    s.flushing = true;
    try {
      const r = await flushQueue(queue, sessionId, api.uploadChunk);
      s.pending = r.pending;
      s.online = !r.error;
    } finally { s.flushing = false; emit(); }
  };

  const offsetMs = () => deps.now() - s.startedAt - s.pausedMs;

  const startRecorderSlice = () => {
    if (!deps.MediaRecorder || !s.stream) return;
    const rec = new deps.MediaRecorder(s.stream);
    const seq = s.seq; const startMs = offsetMs();
    s.seq += 1;
    const parts = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
    rec.onstop = async () => {
      if (!parts.length) return;
      const blob = new Blob(parts, { type: parts[0].type || 'audio/webm' });
      await queue.put({ sessionId, seq, blob, startMs });
      s.pending += 1;
      emit();
      flush();
    };
    rec.start();
    s.recorder = rec;
    s.chunkTimer = deps.setTimeout(() => { rec.stop(); startRecorderSlice(); }, CHUNK_MS);
  };

  const stopRecorderSlice = () => {
    if (s.chunkTimer != null) deps.clearTimeout(s.chunkTimer);
    s.chunkTimer = null;
    if (s.recorder && s.recorder.state !== 'inactive') s.recorder.stop();
    s.recorder = null;
  };

  const openSocket = () => {
    if (!s.live || s.socket || !deps.WebSocket) return;
    s.socket = openLiveSocket({
      url: deps.liveUrl, WebSocketImpl: deps.WebSocket,
      onEvent: (ev) => {
        const r = readLiveEvent(ev);
        if (!r) return;
        if (r.error) { s.error = r.error; } else { s.caption = r.text; }
        emit();
      },
      onClose: () => { s.socket = null; emit(); },
    });
  };

  return {
    /** Ask for the microphone. Resolves 'granted' or 'denied'. */
    async open() {
      try {
        s.stream = await deps.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch {
        emit({ mic: 'denied' });
        return 'denied';
      }
      if (deps.AudioContext) {
        s.ctx = new deps.AudioContext();
        const src = s.ctx.createMediaStreamSource(s.stream);
        s.analyser = s.ctx.createAnalyser();
        s.analyser.fftSize = 2048;
        src.connect(s.analyser);
        if (typeof s.ctx.createScriptProcessor === 'function') {
          s.processor = s.ctx.createScriptProcessor(4096, 1, 1);
          s.processor.onaudioprocess = (e) => {
            if (s.pausedAt != null || !s.startedAt) return;
            const block = e.inputBuffer.getChannelData(0);
            if (rms(block) > 0.01) s.lastSoundAt = deps.now();
            if (s.socket) s.socket.send(downsampleTo16k(block, s.ctx.sampleRate));
          };
          src.connect(s.processor);
          s.processor.connect(s.ctx.destination);
        }
      }
      emit({ mic: 'granted' });
      return 'granted';
    },
    /** Called after the Worker accepted `start`. */
    start() {
      s.startedAt = deps.now(); s.lastSoundAt = s.startedAt;
      startRecorderSlice();
      openSocket();
      emit();
    },
    pause() { s.pausedAt = deps.now(); stopRecorderSlice(); s.socket?.close(); s.socket = null; emit(); },
    resume() {
      if (s.pausedAt != null) s.pausedMs += deps.now() - s.pausedAt;
      s.pausedAt = null; s.lastSoundAt = deps.now();
      startRecorderSlice(); openSocket(); emit();
    },
    /** Hide or show the live transcript. Hiding closes the socket. */
    setLive(on) {
      s.live = !!on;
      if (!s.live) { s.socket?.close(); s.socket = null; s.caption = ''; } else if (s.startedAt && s.pausedAt == null) openSocket();
      emit();
    },
    offsetMs,
    flush,
    async stop() {
      stopRecorderSlice();
      s.socket?.close(); s.socket = null;
      try { s.processor?.disconnect(); } catch { /* gone */ }
      s.stream?.getTracks?.().forEach((t) => t.stop());
      try { await s.ctx?.close?.(); } catch { /* gone */ }
      // Let the last slice's onstop queue it before the final flush.
      await new Promise((r) => deps.setTimeout(r, 0));
      await flush();
      return { pending: s.pending };
    },
    get state() { return s; },
  };
}
