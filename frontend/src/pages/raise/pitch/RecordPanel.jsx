import React, { useCallback, useEffect, useRef, useState } from 'react';
import { deckRecordingsApi } from '../../../lib/api/deckRecordings.js';
import { reportError } from '../../../lib/log';
import { investorLinks, shown, walkthrough } from './deckV2Adapter.js';
import { refusalOf } from './newDeckModel';
import {
  ATTACH_NEEDS_TAKE, AUDIO_BITS_PER_SECOND, CAPTIONS_NOT_RECORDED, DELETE_BODY, DELETE_FAILED, DELETE_TITLE, DEVICES_LATER, LINKS_UNREAD,
  MAX_TAKE_MS, NO_LINKS, NO_RECORDER, ONE_TAKE_A_CARD, PLAY_FAILED, READING, RECORD_TITLE, SEND_AGAIN, STORED, TRY_AGAIN, UNREADABLE,
  baseMime, captionHoldLine, chipOf, cueAt, linkName, permissionProblem, pickAudioMime, pickVideoMime, recordingLine, takeFor, takeProblem,
  uploadProblem, walkthroughOf,
} from './walkthroughModel';

/**
 * D4599 part 2 (#4599; D1590 F11, #3837) — Present › Record (pd36, "Record a
 * pitch"): a take per card, camera and microphone, sent to the Worker's
 * `POST /api/decks/:id/recordings` as each card ends.
 *
 *   Read     `deckV2Adapter.walkthrough`: Reading…, "Not switched on yet."
 *            while HQ has `deck:walkthrough` off (the Worker's 404), or
 *            "could not be read" with Try again. Never an empty walkthrough
 *            in place of a failed read.
 *   Record   the card on the stage, "Recording · 0:42 · Slide 2 of 3 · use
 *            ← → to move", the camera in its circle, Camera and Microphone
 *            once the browser has given them. Moving to another card ends
 *            this card's take and starts the next one's; Stop ends the last.
 *   Chips    one per card: "Slide 1 · Take 2 ✓" with Play, Retake and
 *            Delete; "Recording"; "Not recorded"; "Sending…"; or "Not sent"
 *            with the reason and Send again (the take is kept in the browser).
 *   Attach   "Attach to [Fund]'s link" over the version's live investor
 *            links (`deckV2Adapter.investorLinks`), and Remove; "Stored with
 *            your deck; delete it any time." (owner decision W = A).
 *
 * A refused camera or microphone says so in words the founder can act on
 * (`permissionProblem`). The Worker's limits are checked before sending
 * (`takeProblem`); its refusals are shown in its own words (`uploadProblem`).
 *
 * `deps` is the browser (getUserMedia, MediaRecorder, the clock): the tests
 * pass their own.
 */
const PANEL = 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-6';
const BOX = 'flex flex-col gap-2 rounded-[10px] bg-[#111827] p-3.5';
const LABEL = 'font-mono text-[11px] font-bold tracking-[.07em] text-gray-400';
const BUTTON = 'inline-flex min-h-[32px] items-center justify-center rounded-[8px] px-3 text-[12.5px] font-bold disabled:opacity-50';
const PRIMARY = `${BUTTON} bg-violet-500 text-white hover:bg-violet-400`;
const QUIET = `${BUTTON} border border-gray-700 text-gray-200 hover:bg-gray-800`;
const SMALL = 'inline-flex min-h-[24px] items-center rounded-[6px] border border-gray-600 px-2 text-[11px] font-bold text-gray-200 hover:bg-gray-800 disabled:opacity-50';
const CHIP = 'inline-flex flex-wrap items-center gap-2 rounded-[8px] bg-[#1f2937] px-2.5 py-1.5 text-[12px] text-gray-200';
const SELECT = 'min-h-[30px] rounded-[8px] border border-gray-700 bg-[#1f2937] px-2 text-[12px] text-gray-200';

/** The browser's recording parts, read when Record is opened. */
export function browserDeps() {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  const media = g.navigator?.mediaDevices;
  return {
    getUserMedia: media?.getUserMedia ? (c) => media.getUserMedia(c) : null,
    enumerateDevices: media?.enumerateDevices ? () => media.enumerateDevices() : async () => [],
    MediaRecorder: g.MediaRecorder,
    MediaStream: g.MediaStream,
    now: () => g.performance.now(),
    setInterval: (f, ms) => g.setInterval(f, ms),
    clearInterval: (t) => g.clearInterval(t),
  };
}

const stopped = (r) => new Promise((done) => {
  if (!r || r.state === 'inactive') { done(); return; }
  r.onstop = () => done();
  try { r.stop(); } catch { done(); }
});

export default function RecordPanel({ deck, cards, slideNos, renderCard, onClose, deps: given = null }) {
  const deps = useRef(given || browserDeps()).current;
  const deckId = deck?.id;
  const n = cards.length;
  const [read, setRead] = useState(null);
  const [walk, setWalk] = useState(null);
  const [at, setAt] = useState(0);
  const [stage, setStage] = useState('idle');
  const [now, setNow] = useState(0);
  const [problem, setProblem] = useState(null);
  const [pending, setPending] = useState({});
  const [quote, setQuote] = useState(null);
  const [devices, setDevices] = useState(null);
  const [camId, setCamId] = useState('');
  const [micId, setMicId] = useState('');
  const [playing, setPlaying] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [links, setLinks] = useState(null);
  const [linkId, setLinkId] = useState('');
  const [attachLine, setAttachLine] = useState(null);
  const rec = useRef(null);
  const preview = useRef(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const load = useCallback(() => {
    if (!deckId) return;
    setRead(null);
    walkthrough(deckId).then((a) => {
      if (!live.current) return;
      setRead(a);
      setWalk(a.available ? walkthroughOf(a.value) : null);
    });
  }, [deckId]);
  useEffect(() => { load(); }, [load]);
  const ready = read?.available === true;

  // The captions' price for a full take, read once the walkthrough is on.
  useEffect(() => {
    if (!ready) return undefined;
    let on = true;
    deckRecordingsApi.quote(deckId, MAX_TAKE_MS).then((q) => { if (on) setQuote(q); }, (e) => { if (on) setQuote({ refused: refusalOf(e) }); });
    return () => { on = false; };
  }, [ready, deckId]);

  const loadLinks = useCallback(() => {
    if (!deckId) return;
    setLinks(null);
    investorLinks(deckId).then((a) => { if (live.current) setLinks(a); });
  }, [deckId]);
  useEffect(() => { if (ready) loadLinks(); }, [ready, loadLinks]);
  const liveLinks = links?.available ? (Array.isArray(links.value?.links) ? links.value.links : []).filter((r) => r.status === 'live') : [];
  useEffect(() => { if (!linkId && liveLinks.length) setLinkId(String(liveLinks[0].id)); }, [linkId, liveLinks]);

  const release = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    deps.clearInterval(r.tick);
    r.stream?.getTracks?.().forEach((t) => t.stop?.());
    rec.current = null;
  }, [deps]);
  useEffect(() => release, [release]);

  // The camera in its circle, while the stream is open.
  useEffect(() => {
    const v = preview.current;
    if (v && stage === 'recording' && rec.current?.stream) {
      v.srcObject = rec.current.stream;
      v.play?.()?.catch?.(() => undefined);
    }
  }, [stage]);

  const setOne = (i, value) => setPending((p) => {
    const next = { ...p };
    if (value) next[i] = value; else delete next[i];
    return next;
  });

  const send = useCallback(async (i, item) => {
    const before = takeProblem({ durationMs: item.durationMs, size: item.media?.size ?? 0 });
    if (before) { setOne(i, { ...before, item }); return; }
    setOne(i, { status: 'sending', item });
    try {
      const res = await deckRecordingsApi.record(deckId, { card: slideNos[i], durationMs: item.durationMs, media: item.media, audio: item.audio });
      if (!live.current) return;
      setWalk((w) => ({ ...walkthroughOf({ ...res?.walkthrough, links: w?.links || [] }) }));
      setOne(i, null);
    } catch (e) {
      reportError('RecordPanel:send', e);
      if (live.current) setOne(i, { ...uploadProblem(e), item });
    }
  }, [deckId, slideNos]);

  const startTake = useCallback((session, i) => {
    const MR = deps.MediaRecorder;
    const vMime = pickVideoMime(MR);
    const aMime = pickAudioMime(MR);
    const video = new MR(session.stream, vMime ? { mimeType: vMime } : {});
    const vChunks = [];
    video.ondataavailable = (e) => { if (e?.data?.size) vChunks.push(e.data); };
    // The take's own sound, which the captions read: the Worker does not caption a video file itself.
    let audio = null;
    const aChunks = [];
    const tracks = session.stream.getAudioTracks?.() || [];
    if (tracks.length && typeof deps.MediaStream === 'function') {
      try {
        audio = new MR(new deps.MediaStream(tracks), { ...(aMime ? { mimeType: aMime } : {}), audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
        audio.ondataavailable = (e) => { if (e?.data?.size) aChunks.push(e.data); };
      } catch { audio = null; }
    }
    video.start(1000);
    audio?.start(1000);
    session.take = { i, video, vChunks, vMime, audio, aChunks, aMime, started: deps.now() };
    setOne(i, null);
    setNow(0);
  }, [deps]);

  const finishTake = useCallback(async (session) => {
    const t = session.take;
    if (!t) return null;
    session.take = null;
    const durationMs = Math.min(MAX_TAKE_MS, Math.round(deps.now() - t.started));
    await Promise.all([stopped(t.video), stopped(t.audio)]);
    const media = new Blob(t.vChunks, { type: baseMime(t.video.mimeType || t.vChunks[0]?.type, t.vMime || 'video/webm') });
    const audio = t.audio && t.aChunks.length ? new Blob(t.aChunks, { type: baseMime(t.audio.mimeType || t.aChunks[0]?.type, t.aMime || 'audio/webm') }) : null;
    return { i: t.i, item: { media, audio, durationMs } };
  }, [deps]);

  const stop = useCallback(async () => {
    const session = rec.current;
    if (!session || session.stopping) return;
    session.stopping = true;
    const done = await finishTake(session);
    release();
    if (live.current) setStage('idle');
    if (done) await send(done.i, done.item);
  }, [finishTake, release, send]);

  const start = async (i = at) => {
    if (stage !== 'idle') return;
    setProblem(null);
    setPlaying(null);
    if (!deps.getUserMedia || typeof deps.MediaRecorder !== 'function') { setProblem({ kind: 'unsupported', message: NO_RECORDER }); return; }
    setStage('starting');
    let stream;
    try {
      stream = await deps.getUserMedia({ video: camId ? { deviceId: { exact: camId } } : true, audio: micId ? { deviceId: { exact: micId } } : true });
    } catch (e) {
      if (live.current) { setProblem(permissionProblem(e)); setStage('idle'); }
      return;
    }
    if (!live.current) { stream?.getTracks?.().forEach((t) => t.stop?.()); return; }
    // Device names are only given once the browser has granted access.
    deps.enumerateDevices().then((list) => {
      if (!live.current) return;
      const all = Array.isArray(list) ? list : [];
      setDevices({ cameras: all.filter((d) => d.kind === 'videoinput'), mics: all.filter((d) => d.kind === 'audioinput') });
    }, () => undefined);
    const session = { stream, take: null, tick: 0 };
    rec.current = session;
    try { startTake(session, i); } catch (e) {
      reportError('RecordPanel:start', e);
      release();
      setProblem({ kind: 'unsupported', message: NO_RECORDER });
      setStage('idle');
      return;
    }
    session.tick = deps.setInterval(() => {
      const t = session.take;
      if (!t) return;
      const ms = deps.now() - t.started;
      setNow(ms);
      if (ms >= MAX_TAKE_MS) stop();
    }, 250);
    setAt(i);
    setStage('recording');
  };

  const move = useCallback(async (step) => {
    const next = Math.max(0, Math.min(n - 1, at + step));
    if (next === at) return;
    const session = rec.current;
    if (session?.stopping) return;
    if (stage !== 'recording' || !session?.take) { setAt(next); setPlaying(null); return; }
    // Moving on ends this card's take and starts the next card's, on the same camera and microphone.
    const done = await finishTake(session);
    startTake(session, next);
    setAt(next);
    if (done) await send(done.i, done.item);
  }, [n, at, stage, finishTake, startTake, send]);

  useEffect(() => {
    if (!ready) return undefined;
    const onKey = (e) => {
      if (['ArrowRight', 'PageDown'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); move(1); }
      if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); move(-1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ready, move]);

  const retake = (i) => { setAt(i); start(i); };

  const remove = async () => {
    const take = confirm?.take;
    if (!take) return;
    setConfirm((c) => ({ ...c, failed: null, busy: true }));
    try {
      await deckRecordingsApi.remove(deckId, take.uid);
      setWalk((w) => {
        const list = [...(w?.cards || [])];
        list[take.card - 1] = null;
        return { ...w, cards: list, recorded: list.filter(Boolean).length };
      });
      if (playing?.uid === take.uid) setPlaying(null);
      setConfirm(null);
    } catch (e) {
      reportError('RecordPanel:delete', e);
      // The Worker keeps a take whose file could not be deleted (503), so it is still listed and can be tried again.
      setConfirm((c) => ({ ...c, busy: false, failed: DELETE_FAILED }));
    }
  };

  const attachTo = async (attach) => {
    const id = Number(linkId);
    if (!id) return;
    setAttachLine(null);
    try {
      const res = await deckRecordingsApi.attach(deckId, id, attach);
      setWalk((w) => ({ ...w, links: Array.isArray(res?.links) ? res.links.map(Number) : w.links }));
    } catch (e) {
      reportError('RecordPanel:attach', e);
      setAttachLine(refusalOf(e)?.message || 'The link could not be changed. Try again.');
    }
  };

  if (!read) {
    return <div className={PANEL} data-testid="record-reading"><span className="m-auto text-[13px] text-gray-400">{READING}</span></div>;
  }
  if (!read.available) {
    return (
      <div className={PANEL} data-testid={read.unreadable ? 'record-unreadable' : 'record-unavailable'}>
        <div className={`${BOX} m-auto max-w-[520px] items-start`}>
          <span className={LABEL}>{RECORD_TITLE.toUpperCase()}</span>
          <span className="text-[14px] font-bold text-gray-100">{read.unreadable ? UNREADABLE : read.reason || shown(read)}</span>
          {read.unreadable ? <span className="text-[12.5px] text-gray-400">{read.reason}</span> : null}
          <div className="flex flex-wrap gap-2">
            {read.unreadable ? <button type="button" className={PRIMARY} onClick={load} data-testid="record-retry">{TRY_AGAIN}</button> : null}
            <button type="button" className={QUIET} onClick={onClose}>Back to presenting</button>
          </div>
        </div>
      </div>
    );
  }

  const recording = stage === 'recording';
  const recordingCard = recording ? rec.current?.take?.i ?? at : null;
  const take = takeFor(walk, slideNos[at]);
  const hold = captionHoldLine(quote);
  const blocked = !!quote?.refused || quote?.balance?.ok === false;
  const attachedHere = liveLinks.find((r) => String(r.id) === linkId);
  const isAttached = attachedHere ? (walk?.links || []).includes(Number(attachedHere.id)) : false;

  return (
    <div className={PANEL} data-testid="record-panel" data-stage={stage}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-bold text-gray-100" data-testid="record-status">
          {recording ? <span className="h-2.5 w-2.5 rounded-full bg-violet-400 shadow-[0_0_0_4px_rgba(167,139,250,.3)]" aria-hidden="true" /> : null}
          {recording ? recordingLine(now, at, n) : `${RECORD_TITLE} · Slide ${at + 1} of ${n}`}
        </span>
        <span className="flex flex-wrap items-center gap-2" data-testid="record-devices">
          {devices ? (
            <>
              <label className="flex items-center gap-1 text-[12px] text-gray-300">Camera:
                <select className={SELECT} value={camId} disabled={recording} onChange={(e) => setCamId(e.target.value)} data-testid="record-camera">
                  <option value="">Default camera</option>
                  {devices.cameras.map((d, k) => <option key={d.deviceId || k} value={d.deviceId}>{d.label || `Camera ${k + 1}`}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1 text-[12px] text-gray-300">Microphone:
                <select className={SELECT} value={micId} disabled={recording} onChange={(e) => setMicId(e.target.value)} data-testid="record-mic">
                  <option value="">Default microphone</option>
                  {devices.mics.map((d, k) => <option key={d.deviceId || k} value={d.deviceId}>{d.label || `Microphone ${k + 1}`}</option>)}
                </select>
              </label>
            </>
          ) : <span className="text-[12px] text-gray-400">{DEVICES_LATER}</span>}
        </span>
      </div>

      <div className="relative flex flex-col items-center gap-3">
        <div className="w-full max-w-[900px]">
          {playing ? <Playback deckId={deckId} take={playing} onClose={() => setPlaying(null)} /> : renderCard(at)}
        </div>
        {recording ? (
          <video ref={preview} muted playsInline autoPlay aria-label="Camera"
            className="absolute bottom-3 right-3 h-[120px] w-[120px] rounded-full border-[3px] border-violet-400 bg-gray-700 object-cover" data-testid="record-camera-preview" />
        ) : null}
        <div className="flex w-full max-w-[900px] items-center justify-between gap-2">
          <button type="button" className={QUIET} onClick={() => move(-1)} disabled={at === 0} data-testid="record-back">← Back</button>
          {recording
            ? <button type="button" className={PRIMARY} onClick={stop} data-testid="record-stop">Stop</button>
            : <button type="button" className={PRIMARY} onClick={() => start(at)} disabled={stage !== 'idle' || !n || blocked} data-testid="record-start">{take ? `Retake slide ${at + 1}` : `Record slide ${at + 1}`}</button>}
          <button type="button" className={QUIET} onClick={() => move(1)} disabled={at >= n - 1} data-testid="record-next">Next →</button>
        </div>
      </div>

      {problem ? (
        <div className="rounded-[10px] border border-amber-700 bg-[#1f1a0d] p-3 text-[13px] text-amber-200" role="alert" data-testid="record-problem" data-kind={problem.kind}>
          {problem.message}
          {problem.kind !== 'unsupported' ? <> <button type="button" className="font-bold underline" onClick={() => start(at)} data-testid="record-problem-retry">{TRY_AGAIN}</button></> : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-2" data-testid="record-chips">
          {cards.map((_, i) => {
            const t = takeFor(walk, slideNos[i]);
            const p = pending[i] || null;
            const chip = chipOf({ index: i, take: t, recording: recordingCard === i, pending: p });
            return (
              <span key={i} className={`${CHIP} ${i === at ? 'ring-1 ring-violet-400' : ''}`} data-testid={`record-chip-${i}`} data-state={chip.state}>
                <button type="button" className="font-bold text-gray-100 hover:underline" onClick={() => { if (!recording) { setAt(i); setPlaying(null); } }}>{chip.line}</button>
                {t && !recording && !p ? (
                  <>
                    <button type="button" className={SMALL} onClick={() => { setAt(i); setPlaying(t); }} data-testid={`record-play-${i}`}>Play</button>
                    <button type="button" className={SMALL} onClick={() => retake(i)} disabled={blocked || stage !== 'idle'} data-testid={`record-retake-${i}`}>Retake</button>
                    <button type="button" className={SMALL} onClick={() => setConfirm({ take: t, failed: null })} data-testid={`record-delete-${i}`}>Delete</button>
                  </>
                ) : null}
                {p && p.status !== 'sending' ? (
                  <span className="flex w-full flex-col gap-1" data-testid={`record-pending-${i}`}>
                    <span role="alert" className="text-[11.5px] text-amber-200">{p.message}{p.topUp ? <> <a href={p.topUp.href} className="font-bold underline">{p.topUp.text}</a></> : null}</span>
                    <span className="flex gap-1">
                      {p.status === 'interrupted' || p.status === 'failed'
                        ? <button type="button" className={SMALL} onClick={() => send(i, p.item)} data-testid={`record-resend-${i}`}>{SEND_AGAIN}</button> : null}
                      {!recording ? <button type="button" className={SMALL} onClick={() => retake(i)} disabled={blocked || stage !== 'idle'} data-testid={`record-rerecord-${i}`}>Record again</button> : null}
                    </span>
                  </span>
                ) : null}
              </span>
            );
          })}
        </div>
        <div className="flex flex-col items-start gap-1.5 lg:items-end" data-testid="record-attach">
          {links == null ? <span className="text-[12px] text-gray-400">Reading your investor links…</span>
            : !links.available ? (
              <span className="flex items-center gap-2 text-[12px] text-gray-400">{links.unreadable ? LINKS_UNREAD : shown(links)}
                {links.unreadable ? <button type="button" className={SMALL} onClick={loadLinks} data-testid="record-links-retry">{TRY_AGAIN}</button> : null}</span>
            ) : !liveLinks.length ? <span className="max-w-[360px] text-[12px] text-gray-400" data-testid="record-no-links">{NO_LINKS}</span> : (
              <span className="flex flex-wrap items-center gap-2">
                {liveLinks.length > 1 ? (
                  <select className={SELECT} value={linkId} onChange={(e) => { setLinkId(e.target.value); setAttachLine(null); }} aria-label="Investor link" data-testid="record-link-pick">
                    {liveLinks.map((r) => <option key={r.id} value={String(r.id)}>{`${r.investor?.label || 'Not recorded'}${r.investor?.fund ? ` · ${r.investor.fund}` : ''}`}</option>)}
                  </select>
                ) : null}
                {isAttached
                  ? <button type="button" className={QUIET} onClick={() => attachTo(false)} data-testid="record-detach">{`Remove from ${linkName(attachedHere)}’s link`}</button>
                  : <button type="button" className={PRIMARY} onClick={() => attachTo(true)} disabled={!walk?.recorded} data-testid="record-attach-button">{`Attach to ${linkName(attachedHere)}’s link`}</button>}
              </span>
            )}
          {links?.available && liveLinks.length && !walk?.recorded && !isAttached ? <span className="text-[11.5px] text-gray-400">{ATTACH_NEEDS_TAKE}</span> : null}
          {attachLine ? <span role="alert" className="text-[11.5px] text-amber-200" data-testid="record-attach-problem">{attachLine}</span> : null}
          <span className="text-[11.5px] text-gray-400" data-testid="record-stored">{STORED}</span>
        </div>
      </div>

      <div className={BOX}>
        <span className="text-[12.5px] text-gray-300">{ONE_TAKE_A_CARD}</span>
        <span className="font-mono text-[11.5px] text-gray-400" data-testid="record-hold">{hold || (quote?.refused ? quote.refused.message : quote ? null : 'Reading the price…')}</span>
        {quote?.balance?.ok === false ? <span className="text-[12.5px] text-amber-300">{quote.balance.message}</span> : null}
        <button type="button" className={`${QUIET} self-start`} onClick={onClose} disabled={recording}>Back to presenting</button>
      </div>

      {confirm ? (
        <div role="alertdialog" aria-label={DELETE_TITLE} className={`${BOX} border border-gray-700`} data-testid="record-delete-confirm">
          <span className="text-[14px] font-bold text-gray-100">{DELETE_TITLE}</span>
          <span className="text-[12.5px] text-gray-300">{`Slide ${(slideNos.indexOf(confirm.take.card) + 1) || confirm.take.card} · Take ${confirm.take.take}. ${DELETE_BODY}`}</span>
          {confirm.failed ? <span role="alert" className="text-[12.5px] text-amber-200" data-testid="record-delete-failed">{confirm.failed}</span> : null}
          <span className="flex gap-2">
            <button type="button" className={QUIET} onClick={() => setConfirm(null)}>Keep</button>
            <button type="button" className={`${BUTTON} bg-red-600 text-white hover:bg-red-700`} onClick={remove} disabled={confirm.busy} data-testid="record-delete-yes">{confirm.failed ? TRY_AGAIN : 'Delete'}</button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** One take played back, its captions under it as the Listen job timed them (or "Captions not recorded"). */
function Playback({ deckId, take, onClose }) {
  const [ms, setMs] = useState(0);
  const [failed, setFailed] = useState(false);
  const cue = cueAt(take.captions, ms);
  return (
    <div className="flex flex-col items-center gap-2" data-testid="record-playback">
      {failed ? <span role="alert" className="text-[13px] text-amber-200" data-testid="record-play-failed">{PLAY_FAILED}</span> : (
        <video key={take.uid} controls playsInline src={deckRecordingsApi.mediaUrl(deckId, take.uid)} className="aspect-video w-full rounded-[12px] bg-black"
          onTimeUpdate={(e) => setMs(Math.round((e.currentTarget?.currentTime || 0) * 1000))} onError={() => setFailed(true)} data-testid="record-video" />
      )}
      <span className="max-w-[900px] rounded-[6px] bg-black/60 px-3 py-1.5 text-[15px] text-gray-100" data-testid="record-caption">
        {Array.isArray(take.captions) ? (cue || ' ') : CAPTIONS_NOT_RECORDED}
      </span>
      <button type="button" className={QUIET} onClick={onClose} data-testid="record-play-close">Back to the card</button>
    </div>
  );
}
