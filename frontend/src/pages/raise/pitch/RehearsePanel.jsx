import React, { useCallback, useEffect, useRef, useState } from 'react';
import { deckRehearsalsApi } from '../../../lib/api/deckRehearsals.js';
import { reportError } from '../../../lib/log';
import { useRailOption } from '../../../ui/railCrumbs';
import { rehearse as rehearsals, shown } from './deckV2Adapter.js';
import { refusalOf } from './newDeckModel';
import {
  AUDIO_BITS_PER_SECOND, AUDIO_GONE, KEEP_AUDIO, KEEP_AUDIO_OFF, KEEP_AUDIO_ON, MAX_RECORDING_MS, NO_FIGURES, NO_MIC, PITCH_CHOICES,
  QUESTIONS_LATER, RETENTION, TOO_SHORT, budgetLine, cardBudgetsMs, clock, figureGrade, holdLine, noteItemsOf, rowOf, spentByCard, summaryLine,
} from './rehearseModel';

/**
 * D1580 F1 (#3827) — Rehearse (pd38) and its report (pd39), from Present ›
 * Rehearse.
 *
 *   Setup      pitch length 2, 3 or 5 min; the quote's hold line; the
 *              retention line; earlier rehearsals of this version.
 *   Rehearsing the card, its time against its share of the pitch ("0:42 of
 *              0:30", amber when over), the whole clock, the microphone's
 *              level and the card's notes as a checklist. ← → move the cards;
 *              each move is a mark the report times the cards by.
 *   Report     per card: Time · WPM · Filler words · Pauses · Notes covered;
 *              each figure said that disagrees with a linked one; the "Likely
 *              questions" slot (#3829); "Keep the audio", off by default.
 *
 * The transcript is one run on the rail option `transcribe:rehearsal`: the
 * model is the member's pick in the AIRail, quoted and held before it runs.
 * Words a minute are counted from the transcript, so they are in the report,
 * not live.
 */
const PANEL = 'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6';
const BOX = 'flex flex-col gap-2 rounded-[10px] bg-[#111827] p-3.5';
const LABEL = 'font-mono text-[11px] font-bold tracking-[.07em] text-gray-400';
const BUTTON = 'inline-flex min-h-[36px] items-center justify-center rounded-[8px] px-4 text-[13px] font-bold';
const PRIMARY = `${BUTTON} bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-50`;
const QUIET = `${BUTTON} border border-gray-700 text-gray-200 hover:bg-gray-800`;
const CHOICE = 'inline-flex min-h-[32px] items-center rounded-[8px] border border-gray-700 px-3 text-[12px] font-bold';

const pickMime = () => {
  if (typeof MediaRecorder === 'undefined') return null;
  return ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
};

export default function RehearsePanel({ deck, cards, renderCard, onClose }) {
  const deckId = deck?.id;
  const n = cards.length;
  const [stage, setStage] = useState('setup');
  const [pitch, setPitch] = useState(180);
  const [quote, setQuote] = useState(null);
  const [problem, setProblem] = useState(null);
  const [report, setReport] = useState(null);
  const [earlier, setEarlier] = useState(null);
  const [at, setAt] = useState(0);
  const [now, setNow] = useState(0);
  const [level, setLevel] = useState(0);
  const rec = useRef(null);
  // The rail shows this option's models while Rehearse is open; the member's pick is the run's model.
  useRailOption('transcribe:rehearsal', 'Rehearse');

  useEffect(() => {
    if (!deckId) return undefined;
    let live = true;
    setQuote(null);
    deckRehearsalsApi.quote(deckId, { pitch_seconds: pitch })
      .then((q) => { if (live) setQuote(q); })
      .catch((e) => { if (live) setQuote({ refused: refusalOf(e) }); });
    return () => { live = false; };
  }, [deckId, pitch]);

  useEffect(() => {
    if (!deckId || stage !== 'setup') return undefined;
    let live = true;
    rehearsals(deckId).then((a) => { if (live) setEarlier(a); });
    return () => { live = false; };
  }, [deckId, stage]);

  const release = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    cancelAnimationFrame(r.frame);
    clearInterval(r.tick);
    r.stream?.getTracks().forEach((t) => t.stop());
    r.ctx?.close().catch(() => undefined);
  }, []);
  useEffect(() => release, [release]);

  const start = async () => {
    setProblem(null);
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { setProblem({ message: NO_MIC }); return; }
    const mime = pickMime();
    if (mime == null) { stream.getTracks().forEach((t) => t.stop()); setProblem({ message: NO_MIC }); return; }
    const recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    const r = { stream, recorder, chunks, started: performance.now(), marks: [{ card: 1, at_ms: 0 }], frame: 0, tick: 0, ctx: null };
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      r.ctx = new Ctx();
      const analyser = r.ctx.createAnalyser();
      analyser.fftSize = 512;
      r.ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const draw = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
        r.frame = requestAnimationFrame(draw);
      };
      draw();
    } catch { /* the level meter is a help, never a requirement */ }
    r.tick = setInterval(() => {
      const t = performance.now() - r.started;
      setNow(t);
      if (t >= MAX_RECORDING_MS) stop();
    }, 250);
    rec.current = r;
    recorder.start(1000);
    setAt(0);
    setNow(0);
    setStage('recording');
  };

  const move = useCallback((step) => {
    const r = rec.current;
    if (!r || stage !== 'recording') return;
    setAt((i) => {
      const next = Math.max(0, Math.min(n - 1, i + step));
      if (next !== i) r.marks.push({ card: next + 1, at_ms: Math.round(performance.now() - r.started) });
      return next;
    });
  }, [n, stage]);

  useEffect(() => {
    if (stage !== 'recording') return undefined;
    const onKey = (e) => {
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); move(1); }
      if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); move(-1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [stage, move]);

  function stop() {
    const r = rec.current;
    if (!r || r.stopping) return;
    r.stopping = true;
    const durationMs = Math.min(MAX_RECORDING_MS, Math.round(performance.now() - r.started));
    r.recorder.onstop = async () => {
      release();
      if (durationMs < 3000) { setProblem({ message: TOO_SHORT }); setStage('setup'); return; }
      const type = (r.recorder.mimeType || r.chunks[0]?.type || 'audio/webm').split(';')[0];
      const audio = new Blob(r.chunks, { type });
      setStage('sending');
      try {
        const res = await deckRehearsalsApi.run(deckId, { audio, pitchSeconds: pitch, durationMs, marks: r.marks });
        setReport(res?.rehearsal || null);
        setStage('report');
      } catch (e) {
        reportError('RehearsePanel:run', e);
        setProblem(refusalOf(e));
        setStage('setup');
      }
    };
    r.recorder.stop();
  }

  const open = async (uid) => {
    try { const res = await deckRehearsalsApi.read(deckId, uid); setReport(res?.rehearsal || null); setStage('report'); }
    catch (e) { setProblem(refusalOf(e)); }
  };
  const keep = async (on) => {
    try { const res = await deckRehearsalsApi.keepAudio(deckId, report.uid, on); if (res?.rehearsal) setReport(res.rehearsal); }
    catch (e) { setProblem(refusalOf(e)); }
  };

  if (stage === 'recording') {
    const budgets = cardBudgetsMs(pitch, n);
    const spent = spentByCard(rec.current?.marks || [], now, n);
    const over = spent[at] > budgets[at];
    const notes = noteItemsOf(cards[at]?.notes);
    return (
      <div className={PANEL} data-testid="rehearse-recording">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            {renderCard(at)}
            <div className="flex items-center justify-between gap-2">
              <button type="button" className={QUIET} onClick={() => move(-1)} disabled={at === 0}>← Back</button>
              <span className="font-mono text-[12px] text-gray-400">Card {at + 1} of {n}</span>
              <button type="button" className={QUIET} onClick={() => move(1)} disabled={at === n - 1}>Next →</button>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <div className={BOX}>
              <span className={LABEL}>THIS CARD</span>
              <span className={`font-mono text-[22px] font-bold ${over ? 'text-amber-300' : 'text-gray-100'}`} data-testid="rehearse-card-time" data-over={over ? '1' : '0'}>
                {budgetLine(spent[at], budgets[at])}
              </span>
              <span className="font-mono text-[12px] text-gray-400" data-testid="rehearse-total-time">Whole pitch {budgetLine(now, pitch * 1000)}</span>
            </div>
            <div className={BOX}>
              <span className={LABEL}>MICROPHONE</span>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
                <div className="h-full bg-emerald-400 transition-[width]" style={{ width: `${Math.round(level * 100)}%` }} />
              </div>
              <span className="text-[12px] text-gray-400">Words a minute are counted from the transcript, in the report.</span>
            </div>
            <div className={BOX} data-testid="rehearse-notes">
              <span className={LABEL}>NOTES</span>
              {notes.length ? (
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {notes.map((t, k) => <li key={k} className="text-[13.5px] leading-[1.45] text-gray-100">☐ {t}</li>)}
                </ul>
              ) : <span className="text-[13px] text-gray-400">This card has no notes.</span>}
            </div>
            <button type="button" className={PRIMARY} onClick={stop} data-testid="rehearse-stop">Stop and get the report</button>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'sending') {
    return (
      <div className={PANEL} data-testid="rehearse-sending">
        <div className="m-auto flex flex-col items-center gap-2 text-center">
          <span className="text-[15px] font-bold text-gray-100">Transcribing your rehearsal…</span>
          <span className="text-[12.5px] text-gray-400">{RETENTION}</span>
        </div>
      </div>
    );
  }

  if (stage === 'report' && report) return <Report report={report} onKeep={keep} onAgain={() => { setReport(null); setStage('setup'); }} onClose={onClose} problem={problem} />;

  const hold = holdLine(quote);
  const list = earlier?.available ? earlier.value?.rehearsals || [] : [];
  return (
    <div className={PANEL} data-testid="rehearse-setup">
      <div className={BOX}>
        <span className={LABEL}>PITCH LENGTH</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Pitch length">
          {PITCH_CHOICES.map((c) => (
            <button key={c.seconds} type="button" aria-pressed={pitch === c.seconds} onClick={() => setPitch(c.seconds)}
              className={`${CHOICE} ${pitch === c.seconds ? 'bg-gray-100 text-gray-900' : 'text-gray-300 hover:bg-gray-800'}`}>{c.label}</button>
          ))}
        </div>
        <span className="text-[12.5px] text-gray-400">Each of the {n} cards gets an even share: {clock(cardBudgetsMs(pitch, n)[0] ?? 0)} a card.</span>
      </div>
      <div className={BOX}>
        <span className="text-[13px] text-gray-200" data-testid="rehearse-hold">
          {hold || (quote?.refused ? quote.refused.message : 'Reading the price…')}
        </span>
        {quote?.balance && !quote.balance.ok ? <span className="text-[12.5px] text-amber-300">{quote.balance.message}</span> : null}
        <span className="text-[12.5px] text-gray-400" data-testid="rehearse-retention">{RETENTION}</span>
      </div>
      {problem ? <Problem problem={problem} /> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={PRIMARY} onClick={start} disabled={!deckId || !n || !!quote?.refused || (quote?.balance && !quote.balance.ok)} data-testid="rehearse-start">Start rehearsing</button>
        <button type="button" className={QUIET} onClick={onClose}>Back to presenting</button>
      </div>
      <div className={BOX} data-testid="rehearse-earlier">
        <span className={LABEL}>EARLIER REHEARSALS</span>
        {earlier == null ? <span className="text-[12.5px] text-gray-400">Reading…</span>
          : !earlier.available ? <span className="text-[12.5px] text-gray-400">{shown(earlier)}</span>
          : !list.length ? <span className="text-[12.5px] text-gray-400">None yet for this version.</span>
          : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {list.map((r) => (
                <li key={r.uid}>
                  <button type="button" className="text-left text-[13px] text-violet-300 hover:underline" onClick={() => open(r.uid)}>
                    {new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleString()} · {r.time_line || 'No report'}{r.figures ? ` · ${r.figures} figure${r.figures === 1 ? '' : 's'} to check` : ''}
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}

function Problem({ problem }) {
  return (
    <div className="rounded-[10px] border border-amber-700 bg-[#1f1a0d] p-3 text-[13px] text-amber-200" role="alert" data-testid="rehearse-problem">
      {problem.message}{problem.link ? <> <a href={problem.link.href} className="font-bold underline">{problem.link.text}</a></> : null}
    </div>
  );
}

function Report({ report, onKeep, onAgain, onClose, problem }) {
  const r = report.report;
  const rows = (r?.cards || []).map(rowOf);
  return (
    <div className={PANEL} data-testid="rehearse-report">
      <div className={BOX}>
        <span className={LABEL}>REPORT</span>
        <span className="text-[15px] font-bold text-gray-100" data-testid="rehearse-summary">{summaryLine(r) || 'The report could not be read.'}</span>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto rounded-[10px] bg-[#111827]">
          <table className="w-full min-w-[560px] border-collapse text-left text-[13px]" data-testid="rehearse-table">
            <thead className="font-mono text-[11px] tracking-[.05em] text-gray-400">
              <tr>{['Card', 'Time', 'WPM', 'Filler words', 'Pauses', 'Notes covered'].map((h) => <th key={h} className="px-3 py-2 font-bold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.card} className="border-t border-gray-800 text-gray-100">
                  <td className="px-3 py-2">{row.card} · {row.title}</td>
                  <td className={`px-3 py-2 font-mono ${row.over ? 'text-amber-300' : ''}`} data-over={row.over ? '1' : '0'}>{row.time}</td>
                  <td className="px-3 py-2 font-mono">{row.wpm}</td>
                  <td className="px-3 py-2 font-mono" title={row.fillerWords || undefined}>{row.fillers}</td>
                  <td className="px-3 py-2 font-mono">{row.pauses}</td>
                  <td className="px-3 py-2 font-mono">{row.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className={BOX} data-testid="rehearse-figures">
        <span className={LABEL}>FIGURES</span>
        {r?.figures?.length ? r.figures.map((f, k) => (
          <div key={k} className="flex flex-wrap items-baseline gap-x-2 text-[13.5px] text-gray-100">
            <span>Card {f.card}: {f.message}</span>
            <span className="font-mono text-[11px] text-gray-400">{figureGrade(f)}</span>
          </div>
        )) : <span className="text-[13px] text-gray-400">{NO_FIGURES}</span>}
      </div>
      <div className={BOX} data-testid="rehearse-questions">
        <span className={LABEL}>LIKELY QUESTIONS</span>
        <span className="text-[13px] text-gray-400">{QUESTIONS_LATER}</span>
      </div>
      <div className={BOX} data-testid="rehearse-keep-audio">
        {report.audio === 'deleted' ? <span className="text-[13px] text-gray-400">{AUDIO_GONE}</span> : (
          <label className="flex items-center gap-2 text-[13.5px] font-bold text-gray-100">
            <input type="checkbox" role="switch" checked={report.audio === 'kept'} onChange={(e) => onKeep(e.target.checked)} />
            {KEEP_AUDIO}
          </label>
        )}
        {report.audio === 'deleted' ? null : <span className="text-[12.5px] text-gray-400">{report.audio === 'kept' ? KEEP_AUDIO_ON : KEEP_AUDIO_OFF}</span>}
      </div>
      {problem ? <Problem problem={problem} /> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={PRIMARY} onClick={onAgain}>Rehearse again</button>
        <button type="button" className={QUIET} onClick={onClose}>Back to presenting</button>
      </div>
    </div>
  );
}
