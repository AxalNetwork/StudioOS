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
/** How long the microphone may read silence before the page says so (D685 §5.7: 30 seconds). */
export const NO_SOUND_MS = 30000;
/** How often the level is checked, so silence shows within a quarter second, not at a chunk boundary. */
export const LEVEL_MS = 250;
/** The relay's close code when the member's AI budget runs out (liveTranscription.ts). It is never reopened. */
export const BUDGET_CLOSE = 4402;

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
    sessions: async (userId) => [...new Set([...rows.values()].filter((r) => userId == null || r.userId === userId).map((r) => r.sessionId))],
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
    /**
     * Every session with a chunk still on this device, so app load can flush
     * them all (D685 §5.6.7). Given a member, only the chunks tagged with
     * that member: another member's never flush under this one.
     */
    sessions: async (userId) => [...new Set(((await tx('readonly', (s) => s.getAll())) || [])
      .filter((r) => userId == null || r.userId === userId).map((r) => r.sessionId))],
  };
}

/**
 * Where a capture resumed in this tab continues: one past the highest seq the
 * Worker holds or this device still queues (D685 §5.6.6). Starting at 0 again
 * would PUT seq 0, be answered `duplicate`, and lose that audio without a word.
 */
export function nextSeq(storedSeqs = [], queuedSeqs = []) {
  const all = [...storedSeqs, ...queuedSeqs].map(Number).filter(Number.isFinite);
  return all.length ? Math.max(...all) + 1 : 0;
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
 * One capture. `deps` carries the browser: { getUserMedia, getDisplayMedia,
 * AudioContext, MediaStream, MediaRecorder, WebSocket, now, setTimeout,
 * clearTimeout, setInterval, clearInterval, liveUrl }. `startSeq` and
 * `baseOffsetMs` continue a session the Worker already holds audio for.
 * `api` carries the Worker: { uploadChunk(seq, blob, startMs) }.
 */
export function createCapture({ deps, api, queue, sessionId, liveOn, onState, startSeq = 0, baseOffsetMs = 0, userId = null }) {
  const s = {
    stream: null, ctx: null, analyser: null, processor: null, recorder: null, socket: null,
    seq: Number.isFinite(startSeq) && startSeq > 0 ? startSeq : 0, startedAt: 0, pausedMs: 0, pausedAt: null, chunkTimer: null, lastSoundAt: 0,
    live: !!liveOn, caption: '', online: true, flushing: false, pending: 0, error: null,
    levelTimer: null, mic: null, display: null, displayVideo: null, shareNote: null, recordStream: null, budget: false, discarded: false, holding: false,
  };
  const emit = (extra = {}) => onState?.({
    analyser: s.analyser, live: s.live, liveOpen: !!s.socket?.open, caption: s.caption, mic: s.mic,
    pending: s.pending, online: s.online, error: s.error, silentMs: s.startedAt && s.pausedAt == null ? deps.now() - s.lastSoundAt : 0,
    shareNote: s.shareNote, displayVideo: s.displayVideo, budget: s.budget, ...extra,
  });
  // D685 §5.7.6: the level is read every LEVEL_MS, not only when a caption or a chunk arrives.
  const startLevel = () => {
    if (s.levelTimer != null || typeof deps.setInterval !== 'function') return;
    s.levelTimer = deps.setInterval(() => emit(), LEVEL_MS);
  };
  const stopLevel = () => {
    if (s.levelTimer != null && typeof deps.clearInterval === 'function') deps.clearInterval(s.levelTimer);
    s.levelTimer = null;
  };

  const flush = async () => {
    if (s.flushing) return;
    s.flushing = true;
    try {
      const r = await flushQueue(queue, sessionId, api.uploadChunk);
      s.pending = r.pending;
      s.online = !r.error;
    } finally { s.flushing = false; emit(); }
  };

  // Offsets continue from what the Worker already holds (`active_ms`), so a resumed capture's chunks and marks line up.
  const offsetMs = () => baseOffsetMs + (s.startedAt ? deps.now() - s.startedAt - s.pausedMs - (s.pausedAt != null ? deps.now() - s.pausedAt : 0) : 0);

  const startRecorderSlice = () => {
    const stream = s.recordStream || s.stream;
    if (!deps.MediaRecorder || !stream) return;
    // Audio only, always (D685 §5.8.2): the Worker refuses anything but audio/* with 415.
    const rec = new deps.MediaRecorder(stream);
    const seq = s.seq; const startMs = offsetMs();
    s.seq += 1;
    const parts = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
    rec.onstop = async () => {
      if (!parts.length || s.discarded) return;
      const blob = new Blob(parts, { type: parts[0].type || 'audio/webm' });
      // Tagged with the member, so app load never flushes it under another one (D685 §5.6.6).
      await queue.put({ sessionId, seq, blob, startMs, userId });
      s.lastSeq = Math.max(s.lastSeq ?? -1, seq);
      s.pending += 1;
      emit();
      // A sign-out's stop holds the last slice on this device (D685 §5.6.8).
      if (!s.holding) flush();
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
      onClose: (e) => {
        s.socket = null;
        // The budget ran out: say so, and never reopen this socket (D685 §5.7.8).
        if (e?.code === BUDGET_CLOSE) { s.budget = true; s.live = false; s.caption = ''; }
        emit();
      },
    });
  };
  const openSocketIfLive = () => { if (!s.budget && s.startedAt && s.pausedAt == null) openSocket(); };

  /** Watch the microphone track: losing it shows at once, not 30 seconds later as "no sound". */
  const watchMic = (track) => {
    if (!track || typeof track.addEventListener !== 'function') return;
    track.addEventListener('ended', () => { s.mic = 'ended'; emit(); });
    track.addEventListener('mute', () => { s.mic = 'muted'; emit(); });
    track.addEventListener('unmute', () => { s.mic = 'granted'; emit(); });
  };

  /** The call's tab stopped sharing: keep recording the microphone, and say so. */
  const shareLost = () => { s.shareNote = 'not_shared'; s.displayVideo = null; emit(); };

  return {
    /**
     * Ask for the microphone, and with `{ display: true }` the call's tab too
     * (D685 §5.8). Resolves 'granted' or 'denied'; a refused or audio-less
     * share is never 'denied': it records the microphone and sets `shareNote`.
     * Call it inside the click that asked for it (Safari, Firefox).
     */
    async open({ display = false } = {}) {
      // The share is asked for first, while the click's activation is fresh.
      let shared = null;
      s.shareNote = null;
      if (display) {
        if (typeof deps.getDisplayMedia !== 'function') {
          s.shareNote = 'unsupported';
        } else {
          try {
            shared = await deps.getDisplayMedia({ video: true, audio: true });
          } catch { s.shareNote = 'not_shared'; }
        }
      }
      try {
        s.stream = await deps.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch {
        shared?.getTracks?.().forEach((t) => t.stop());
        s.mic = 'denied';
        emit();
        return 'denied';
      }
      s.mic = 'granted';
      watchMic(s.stream.getAudioTracks?.()[0]);
      if (shared) {
        s.display = shared;
        const audio = shared.getAudioTracks?.() || [];
        const video = shared.getVideoTracks?.() || [];
        if (!audio.length) s.shareNote = 'no_audio';
        // The tile shows the tab's picture; nothing of it is recorded or stored.
        s.displayVideo = video.length ? shared : null;
        [...audio, ...video].forEach((t) => t.addEventListener?.('ended', shareLost));
      }
      if (deps.AudioContext) {
        s.ctx = new deps.AudioContext();
        const mic = s.ctx.createMediaStreamSource(s.stream);
        // One mix of the microphone and the tab's audio feeds the recorder,
        // the ring and the live feed, so every chunk is audio (§5.8.2).
        const mix = typeof s.ctx.createGain === 'function' ? s.ctx.createGain() : null;
        const into = mix || mic;
        if (mix) mic.connect(mix);
        if (mix && shared && (shared.getAudioTracks?.() || []).length) {
          s.ctx.createMediaStreamSource(new (deps.MediaStream || MediaStream)(shared.getAudioTracks())).connect(mix);
        }
        if (mix && typeof s.ctx.createMediaStreamDestination === 'function') {
          const dest = s.ctx.createMediaStreamDestination();
          mix.connect(dest);
          s.recordStream = dest.stream;
        }
        s.analyser = s.ctx.createAnalyser();
        s.analyser.fftSize = 2048;
        into.connect(s.analyser);
        if (typeof s.ctx.createScriptProcessor === 'function') {
          s.processor = s.ctx.createScriptProcessor(4096, 1, 1);
          s.processor.onaudioprocess = (e) => {
            if (s.pausedAt != null || !s.startedAt) return;
            const block = e.inputBuffer.getChannelData(0);
            if (rms(block) > 0.01) s.lastSoundAt = deps.now();
            if (s.socket) s.socket.send(downsampleTo16k(block, s.ctx.sampleRate));
          };
          into.connect(s.processor);
          s.processor.connect(s.ctx.destination);
        }
      }
      emit();
      return 'granted';
    },
    /** Called after the Worker accepted `start`. */
    start() {
      s.startedAt = deps.now(); s.lastSoundAt = s.startedAt;
      startRecorderSlice();
      openSocket();
      startLevel();
      emit();
    },
    pause() { s.pausedAt = deps.now(); stopRecorderSlice(); stopLevel(); s.socket?.close(); s.socket = null; emit(); },
    resume() {
      if (s.pausedAt != null) s.pausedMs += deps.now() - s.pausedAt;
      s.pausedAt = null; s.lastSoundAt = deps.now();
      startRecorderSlice(); openSocketIfLive(); startLevel(); emit();
    },
    /** Hide or show the live transcript. Hiding closes the socket; a spent budget keeps it shut. */
    setLive(on) {
      s.live = !!on && !s.budget;
      if (!s.live) { s.socket?.close(); s.socket = null; s.caption = ''; } else openSocketIfLive();
      emit();
    },
    /** Back online (D685 §5.7.7): flush what waited, and reopen the live socket if it is on. */
    reconnect() {
      s.online = true;
      flush();
      if (s.live) openSocketIfLive();
      emit();
    },
    /** Offline: chunks keep queueing on the device; the screen says so at once. */
    offline() { s.online = false; emit(); },
    offsetMs,
    flush,
    async stop({ flush: flushOnStop = true } = {}) {
      if (!flushOnStop) s.holding = true;
      stopRecorderSlice();
      stopLevel();
      s.socket?.close(); s.socket = null;
      try { s.processor?.disconnect(); } catch { /* gone */ }
      s.stream?.getTracks?.().forEach((t) => t.stop());
      // The call's tab stops sharing with the recording (§5.8.4).
      s.display?.getTracks?.().forEach((t) => t.stop());
      s.display = null; s.displayVideo = null;
      try { await s.ctx?.close?.(); } catch { /* gone */ }
      // Let the last slice's onstop queue it before the final flush. A sign-out
      // passes `flush: false`: the chunks stay on this device, never sent as
      // someone else (D685 §5.6.8).
      await new Promise((r) => deps.setTimeout(r, 0));
      if (flushOnStop) await flush();
      // The last seq queued, for `finish` (D685 §5.9.1). A slice that held no
      // sound was never queued, so it is not counted as one to wait for.
      return { pending: s.pending, lastSeq: s.lastSeq ?? null };
    },
    /**
     * Discard this recording (D685 §5.7.9): nothing more is queued or sent,
     * and what waited on this device for it is removed.
     */
    async discard() {
      s.discarded = true;
      await this.stop({ flush: false });
      for (const r of await queue.list(sessionId)) await queue.remove(sessionId, r.seq);
      s.pending = 0;
      emit();
    },
    get state() { return s; },
  };
}
