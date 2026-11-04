import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { usePhoneWidth } from '../../../ui';
import { BlockGrid } from './BlockGrid';
import CardCompliance from './CardCompliance';
import { chromeOf } from './complianceModel';
import { aspectOf, ratioOf } from './gridModel';
import { asList, currentVersion, versionLabel } from './pitchStudioModel';
import { langAttrs } from './deckLanguage';
import {
  AUDIENCE, EMPTY_CARD, ESC_TO_EXIT, NO_CARDS, NO_VERSION, PRESENTER, READ_FAILED, SHOW_SOURCES, SOURCE_NOT_RECORDED,
  cardsOf, clock, countLabel, dotsOf, exitHref, notesOf, stepFor, swipeLine, swipeStep,
} from './presentExportModel';
import { REHEARSE } from './rehearseModel';
import { DEFAULT_PITCH_SECONDS, PITCH_CHOICES, PITCH_LENGTH, presentBudget, remoteMove, remoteSocketPath } from './presentTimingModel';
import { useWebSocket } from '../../../hooks/useWebSocket';
import { MOTION_CSS, areaMotion, presentStep, transitionMotion } from './motionModel';
import {
  BACK, END, LAST_CARD, MIRROR, NEXT_CARD, ON_SCREEN, PHONE_REMOTE, SIZE, SPEED, TELEPROMPTER, TELEPROMPTER_TITLE, THIS_CARD,
  SIZE_MAX, SIZE_MIN, cardLabel, isRemote, mirrorStyle, nextLine, nextSize, nextSpeed, readPrefs, scriptOf, speedOf, startView, writePrefs,
} from './teleprompterModel';

// D1580 F1 (#3827): Present › Rehearse, loaded when it is opened.
const RehearsePanel = lazy(() => import('./RehearsePanel'));

/**
 * D901 (#2680) — present mode at /raise/pitch/present (PD16; PD26 frame 2 on
 * a phone). `?deck=<id>` names the version; with only `?project_id=` it is
 * the venture's current version.
 *
 *   Presenter view  the current card, the next card, the notes, a timer and
 *                   the count, with "Esc to exit".
 *   Audience view   the card full-bleed, "Show sources" off, progress dots.
 *   Phone           the viewer: one card, swiping, sources on.
 *
 * Keys: ← → (and Page Up / Page Down, Space, Home, End); Esc leaves for the
 * studio. Present reads; it writes nothing.
 *
 * D1581 F2 (#3828): the presenter view times each card against its share of
 * the pitch length (2, 3 or 5 minutes, Rehearse's own split, `cardBudgetsMs`),
 * amber when over. A phone paired by code (`DeckRemote`) moves the cards
 * through Present's socket, as the keys do; pairing is not drawn yet.
 *
 * D4254 P2b (#4269): Teleprompter (ps5), beside the views, reads each card's
 * script (its speaker notes) in large type that scrolls at the viewer's
 * speed, with what is on screen, the next card and its first line, the timer
 * and the card's budget; Size, Speed and Mirror are the viewer's own (kept in
 * this browser). `?view=teleprompter` opens on it (P2a's Open teleprompter).
 * On a phone, `?remote=1` is the phone remote (ps5b): the card and its script,
 * the next line, and ‹ Back / Next card ›, which move this phone's view. It
 * writes nothing to the Worker.
 *
 * D1580 F1 (#3827): Rehearse, beside the two views, times the founder card by
 * card against the pitch length and writes a rehearsal and its report
 * (`RehearsePanel.jsx`). While it is open the keys are Rehearse's.
 *
 * D1112 (#2992): a card the editor laid out on D898's 12 × 6 grid is drawn
 * from its blocks, each at its range: text, metric tiles with their source
 * line under "Show sources", charts, images, and video, audio and link blocks
 * that open in a new tab.
 *
 * D1576 (#3823): a card's entrances play here, in the order the PowerPoint
 * plays them (`motionModel.entranceSequence`): → reveals the next area, then
 * moves on; ← hides the last, then goes back to the previous card with all of
 * its areas shown. The card's transition plays as it comes up. Under
 * `prefers-reduced-motion` the steps stay and nothing moves.
 */

/** Whether the viewer asked for reduced motion. */
function useReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const read = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [reduced, setReduced] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const m = window.matchMedia(query);
    const on = () => setReduced(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/** Present's card colours: the face is always the light one. */
const FACE_COLOURS = { bg: '#fbfaf7', ink: '#0f2a3d', accent: '#6d28d9', muted: '#64748b' };

const SHELL = 'fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#0b1220] text-gray-200';
const BAR = 'flex flex-wrap items-center justify-between gap-2 px-4 py-3 font-mono text-[12px] text-gray-400';
const TOGGLE = 'inline-flex min-h-[32px] items-center rounded-[8px] border border-gray-700 px-3 text-[12px] font-bold';
const ON = `${TOGGLE} bg-gray-100 text-gray-900`;
const OFF = `${TOGGLE} text-gray-300 hover:bg-gray-800`;
const FACE = 'flex aspect-video w-full flex-col gap-3 overflow-hidden rounded-[12px] bg-[#fbfaf7] p-[5%] text-[#0f2a3d]';

function useVersion() {
  const [params] = useSearchParams();
  const deckId = params.get('deck');
  const projectId = params.get('project_id');
  const [state, setState] = useState({ status: 'loading', deck: null });

  useEffect(() => {
    let live = true;
    const done = (s) => { if (live) setState(s); };
    (async () => {
      try {
        let id = deckId;
        if (!id && projectId) {
          const current = currentVersion(asList(await api.deckListVersions(projectId), 'versions', 'decks'));
          id = current?.id;
        }
        if (!id) { done({ status: 'none', deck: null }); return; }
        const r = await api.deckGet(id);
        done({ status: 'ok', deck: r?.deck || r });
      } catch (e) {
        reportError('PitchPresent:read', e);
        done({ status: 'error', deck: null });
      }
    })();
    return () => { live = false; };
  }, [deckId, projectId]);

  return { ...state, projectId: projectId || state.deck?.project_id || null };
}

/** This browser's store, or null where it is blocked (a private window, a sandbox). */
function viewerStore() {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

export default function PitchPresent() {
  const { status, deck, projectId } = useVersion();
  const navigate = useNavigate();
  const phone = usePhoneWidth();
  const [params] = useSearchParams();
  // D4254 P2b: the teleprompter's size and speed, the viewer's own; Mirror is this screen's only.
  const [prompt, setPrompt] = useState(() => readPrefs(viewerStore()));
  const [mirror, setMirror] = useState(false);
  const setPrefs = useCallback((patch) => setPrompt((was) => { const next = { ...was, ...patch }; writePrefs(viewerStore(), next); return next; }), []);
  // D1576: the card, and how many of its entrances have played.
  const [pos, setPos] = useState({ card: 0, shown: 0 });
  const i = pos.card;
  const reduced = useReducedMotion();
  const [view, setView] = useState(() => startView(params));
  const [sources, setSources] = useState(false);
  const [seconds, setSeconds] = useState(0);
  // D1581: the pitch length, and when each card came up (Rehearse's marks).
  const [pitchSeconds, setPitchSeconds] = useState(DEFAULT_PITCH_SECONDS);
  const [marks, setMarks] = useState([]);
  const touch = useRef(null);
  const cards = useMemo(() => (status === 'ok' ? cardsOf(deck) : []), [status, deck]);
  // D1499: the deck's slide size, from its theme; 16:9 unless the theme says 4:3.
  const aspect = aspectOf(deck?.theme?.aspect);
  const n = cards.length;
  const exit = exitHref(projectId);

  const step = useCallback((s) => {
    if (s === 'exit') { navigate(exit); return; }
    setPos((at) => presentStep(at, s, cards));
  }, [navigate, exit, cards]);

  useEffect(() => {
    const onKey = (e) => {
      if (view === 'rehearse') return;
      const s = stepFor(e.key);
      if (!s) return;
      e.preventDefault();
      step(s);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, view]);

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // D1581: a mark each time a card comes up, so each card's time is its own.
  useEffect(() => {
    if (!n) return;
    setMarks((m) => (m.length && m[m.length - 1].card === i + 1 ? m : [...m, { card: i + 1, at_ms: Date.now() }]));
  }, [i, n]);

  // D1581: the phone remote. Its steps are Present's keys, or a card by number; Rehearse keeps its own keys.
  const onRemote = useCallback((frame) => {
    if (frame?.type !== 'step' || view === 'rehearse') return;
    setPos((at) => (frame.step && typeof frame.step === 'object' ? { card: remoteMove(at.card, frame.step, n), shown: 0 } : presentStep(at, frame.step, cards)));
  }, [view, n, cards]);
  useWebSocket(status === 'ok' && deck?.id && !phone ? remoteSocketPath(deck.id) : null, { enabled: status === 'ok' && !!deck?.id && !phone, onMessage: onRemote });

  if (status !== 'ok' || !n) {
    const line = status === 'loading' ? null : status === 'error' ? READ_FAILED : status === 'none' ? NO_VERSION : NO_CARDS;
    return (
      <div className={SHELL} data-testid="pitch-present">
        <div className="m-auto flex flex-col items-center gap-3 px-4 text-center" data-testid={`pitch-present-${status}`}>
          {line ? <span className="text-[15px] font-bold">{line}</span> : <span className="h-6 w-48 animate-pulse rounded bg-gray-800" aria-label="Loading" />}
          <Link to={exit} className="text-[12.5px] font-bold text-violet-300">Back to the studio</Link>
        </div>
      </div>
    );
  }

  const card = cards[i];
  const dots = (
    <div className="flex flex-wrap justify-center gap-1.5" aria-label={`Card ${i + 1} of ${n}`} data-testid="pitch-present-dots">
      {dotsOf(i, n).map((d) => (
        <span key={d.k} className={`h-1.5 rounded-full ${d.on ? 'w-5 bg-violet-400' : 'w-1.5 bg-gray-600'}`} />
      ))}
    </div>
  );

  // D4254 P2b (ps5b): the phone remote — the card, its script, the next line, and Back / Next card.
  if (phone && isRemote(params)) {
    // A remote moves a whole card, as D1581's remote steps do (`remoteMove`), never one entrance at a time.
    return <PhoneRemote card={card} next={cards[i + 1] || null} i={i} n={n} seconds={seconds} exit={exit} onStep={(s) => setPos((at) => ({ card: remoteMove(at.card, s, n), shown: 0 }))} />;
  }

  if (phone) {
    return (
      <div
        className={SHELL}
        data-testid="pitch-present"
        onTouchStart={(e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; }}
        onTouchEnd={(e) => {
          const from = touch.current; touch.current = null;
          const t = e.changedTouches[0];
          const s = from ? swipeStep(t.clientX - from.x, t.clientY - from.y) : null;
          if (s) step(s);
        }}
      >
        <div className={BAR}><span>{versionLabel(deck)}</span><Link to={exit} className="font-bold text-violet-300">Exit</Link></div>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3.5 pb-4">
          <Card card={card} sources small aspect={aspect} theme={deck?.theme} />
          {dots}
          <span className="text-center text-[12px] text-gray-400" data-testid="pitch-present-swipe">{swipeLine(i, n)}</span>
        </div>
      </div>
    );
  }

  const next = cards[i + 1] || null;
  return (
    <div className={SHELL} data-testid="pitch-present" data-view={view}>
      <style>{MOTION_CSS}</style>
      <div className={BAR}>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="View">
          <button type="button" className={view === 'presenter' ? ON : OFF} aria-pressed={view === 'presenter'} onClick={() => setView('presenter')}>{PRESENTER}</button>
          <button type="button" className={view === 'audience' ? ON : OFF} aria-pressed={view === 'audience'} onClick={() => setView('audience')}>{AUDIENCE}</button>
          <button type="button" className={sources ? ON : OFF} aria-pressed={sources} onClick={() => setSources((v) => !v)} data-testid="pitch-present-sources">{SHOW_SOURCES}</button>
          <button type="button" className={view === 'teleprompter' ? ON : OFF} aria-pressed={view === 'teleprompter'} onClick={() => setView('teleprompter')} data-testid="pitch-present-teleprompter">{TELEPROMPTER}</button>
          <button type="button" className={view === 'rehearse' ? ON : OFF} aria-pressed={view === 'rehearse'} onClick={() => setView('rehearse')} data-testid="pitch-present-rehearse">{REHEARSE}</button>
        </div>
        <span data-testid="pitch-present-status">
          {view === 'presenter' || view === 'teleprompter' ? `${clock(seconds)} · ` : ''}{countLabel(i, n)} · <Link to={exit} className="text-gray-300 hover:underline">{ESC_TO_EXIT}</Link>
        </span>
      </div>
      {view === 'rehearse' ? (
        <Suspense fallback={<span className="mx-4 h-6 w-48 animate-pulse rounded bg-gray-800" aria-label="Loading" />}>
          <RehearsePanel
            deck={deck}
            cards={cards}
            renderCard={(k) => <Card card={cards[k]} sources={false} aspect={aspect} chrome={chromeOf(deck, k)} />}
            onClose={() => setView('presenter')}
          />
        </Suspense>
      ) : view === 'teleprompter' ? (
        <Teleprompter card={card} next={next} i={i} n={n} seconds={seconds} exit={exit} aspect={aspect} theme={deck?.theme}
          prefs={prompt} setPrefs={setPrefs} mirror={mirror} setMirror={setMirror}
          budget={<Budget marks={marks} seconds={seconds} n={n} i={i} pitchSeconds={pitchSeconds} setPitchSeconds={setPitchSeconds} />} />
      ) : view === 'presenter' ? (
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-4 pb-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card key={`${i}`} card={card} sources={sources} aspect={aspect} chrome={chromeOf(deck, i)} theme={deck?.theme} shown={pos.shown} reduced={reduced} />
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] font-bold tracking-[.07em] text-gray-400">NEXT</span>
              {next ? <Card card={next} sources={false} small aspect={aspect} theme={deck?.theme} /> : <span className="text-[12.5px] text-gray-400">This is the last card.</span>}
            </div>
            <div className="flex flex-col gap-1.5 rounded-[10px] bg-[#111827] p-3.5" data-testid="pitch-present-notes">
              <span className="font-mono text-[11px] font-bold tracking-[.07em] text-gray-400">NOTES</span>
              <span className={`whitespace-pre-line text-[14px] leading-[1.55] ${card.notes ? 'text-gray-100' : 'text-gray-400'}`}>{notesOf(card)}</span>
            </div>
            <Budget marks={marks} seconds={seconds} n={n} i={i} pitchSeconds={pitchSeconds} setPitchSeconds={setPitchSeconds} />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 pb-4">
          <div className="w-full" style={{ maxWidth: `min(100%, calc((100vh - 120px) * ${aspect === '4:3' ? '4 / 3' : '16 / 9'}))` }}><Card key={`${i}`} card={card} sources={sources} aspect={aspect} chrome={chromeOf(deck, i)} theme={deck?.theme} shown={pos.shown} reduced={reduced} /></div>
          {dots}
        </div>
      )}
    </div>
  );
}

/** D4254 P2b: the script moves up at the viewer's speed, and starts again at the top on each card. */
function useAutoScroll(ref, pxPerSec, key) {
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0; }, [ref, key]);
  useEffect(() => {
    if (!pxPerSec) return undefined;
    const t = setInterval(() => { if (ref.current) ref.current.scrollTop += pxPerSec / 20; }, 50);
    return () => clearInterval(t);
  }, [ref, pxPerSec, key]);
}

const BIG = 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[10px] border border-gray-700 px-3 text-[13px] font-bold text-gray-200 hover:bg-gray-800 disabled:opacity-40';

/** D4254 P2b (ps5): Present · Teleprompter. */
function Teleprompter({ card, next, i, n, seconds, exit, aspect, theme, prefs, setPrefs, mirror, setMirror, budget }) {
  const box = useRef(null);
  const speed = speedOf(prefs.speed);
  useAutoScroll(box, speed.pxPerSec, i);
  const script = scriptOf(card);
  const after = nextLine(next);
  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-hidden px-4 pb-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)]" data-testid="teleprompter-view">
      <div className="flex min-w-0 flex-col gap-3 overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[12px] font-bold text-gray-300">{TELEPROMPTER_TITLE}</span>
          <span className="flex items-center gap-2">
            <span className="font-mono text-[15px] font-bold text-gray-100" data-testid="teleprompter-timer">{clock(seconds)}</span>
            <Link to={exit} className={BIG} data-testid="teleprompter-end">{END}</Link>
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] font-bold tracking-[.07em] text-gray-400">{ON_SCREEN.toUpperCase()}</span>
          <Card card={card} sources={false} small aspect={aspect} theme={theme} />
        </div>
        {budget}
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Teleprompter controls" data-testid="teleprompter-controls">
          <span className="font-mono text-[11px] font-bold tracking-[.07em] text-gray-400">{SIZE.toUpperCase()}</span>
          <button type="button" className={BIG} aria-label="Smaller text" disabled={prefs.size <= SIZE_MIN} onClick={() => setPrefs({ size: nextSize(prefs.size, -1) })} data-testid="teleprompter-smaller">A−</button>
          <button type="button" className={BIG} aria-label="Larger text" disabled={prefs.size >= SIZE_MAX} onClick={() => setPrefs({ size: nextSize(prefs.size, 1) })} data-testid="teleprompter-larger">A+</button>
          <span className="ms-2 font-mono text-[11px] font-bold tracking-[.07em] text-gray-400">{SPEED.toUpperCase()}</span>
          <button type="button" className={BIG} onClick={() => setPrefs({ speed: nextSpeed(prefs.speed) })} aria-label={`Scroll speed: ${speed.label}`} data-testid="teleprompter-speed">{speed.label}</button>
          <button type="button" className={mirror ? ON : OFF} aria-pressed={mirror} onClick={() => setMirror((v) => !v)} data-testid="teleprompter-mirror">{MIRROR}</button>
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-col gap-3">
        <span className="font-mono text-[11px] font-bold tracking-[.07em] text-gray-400">{THIS_CARD.toUpperCase()} · {cardLabel(card)}</span>
        <div ref={box} className="min-h-0 flex-1 overflow-y-auto rounded-[12px] bg-black px-6 py-5" data-testid="teleprompter-script" data-speed={speed.id}>
          <div style={{ fontSize: `${prefs.size}px`, ...mirrorStyle(mirror) }} className={`flex flex-col gap-[0.6em] font-semibold leading-[1.35] ${script.empty ? 'text-gray-500' : 'text-white'}`} data-testid="teleprompter-text" data-size={prefs.size} data-mirror={mirror ? 'true' : 'false'}>
            {script.paragraphs.map((p, k) => <p key={k} className="m-0 whitespace-pre-line">{p}</p>)}
          </div>
        </div>
        <div className="flex flex-col gap-0.5 rounded-[10px] bg-[#111827] p-3.5" data-testid="teleprompter-next">
          {after ? (<>
            <span className="font-mono text-[11px] font-bold tracking-[.07em] text-gray-400">{after.label.toUpperCase()} · <span className="normal-case tracking-normal text-gray-200">{after.title}</span></span>
            {after.first ? <span className="text-[14px] leading-[1.5] text-gray-300">{after.first}</span> : null}
          </>) : <span className="text-[13px] text-gray-400">{LAST_CARD}</span>}
        </div>
      </div>
    </div>
  );
}

/** D4254 P2b (ps5b): the phone remote — the timer, this card and its script, the next line, Back and Next card. */
function PhoneRemote({ card, next, i, n, seconds, exit, onStep }) {
  const script = scriptOf(card);
  const after = nextLine(next);
  return (
    <div className={SHELL} data-testid="pitch-present" data-view="remote">
      <div className={BAR}>
        <span className="font-bold text-gray-200">{PHONE_REMOTE}</span>
        <span className="flex items-center gap-3"><span className="text-[15px] font-bold text-gray-100" data-testid="remote-timer">{clock(seconds)}</span><Link to={exit} className="font-bold text-violet-300">Exit</Link></span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3" data-testid="remote-script">
        <span className="text-[13px] font-bold text-violet-300" data-testid="remote-card">{cardLabel(card)}</span>
        {script.paragraphs.map((p, k) => <p key={k} className={`m-0 whitespace-pre-line text-[19px] leading-[1.45] ${script.empty ? 'text-gray-500' : 'text-white'}`}>{p}</p>)}
        {after ? <p className="m-0 text-[13px] text-gray-400" data-testid="remote-next">{after.label} · {after.title}{after.first ? ` — ${after.first}` : ''}</p> : <p className="m-0 text-[13px] text-gray-400" data-testid="remote-next">{LAST_CARD}</p>}
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-gray-800 px-4 py-3">
        <button type="button" className={BIG} disabled={i === 0} onClick={() => onStep('prev')} data-testid="remote-back">{BACK}</button>
        <button type="button" className={`${BIG} border-violet-500 bg-violet-600 text-white hover:bg-violet-500`} disabled={i >= n - 1} onClick={() => onStep('next')} data-testid="remote-next-card">{NEXT_CARD}</button>
      </div>
    </div>
  );
}

/** D1581: the pitch length and this card's time against its share; `seconds` ticks it. */
function Budget({ marks, seconds, n, i, pitchSeconds, setPitchSeconds }) {
  const b = presentBudget(marks, Date.now(), n, i, pitchSeconds);
  return (
    <div className="flex flex-col gap-2 rounded-[10px] bg-[#111827] p-3.5" data-testid="pitch-present-budget" data-tick={seconds}>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={PITCH_LENGTH}>
        <span className="me-1 font-mono text-[11px] font-bold tracking-[.07em] text-gray-400">{PITCH_LENGTH.toUpperCase()}</span>
        {PITCH_CHOICES.map((c) => (
          <button key={c.seconds} type="button" className={pitchSeconds === c.seconds ? ON : OFF} aria-pressed={pitchSeconds === c.seconds} onClick={() => setPitchSeconds(c.seconds)} data-testid={`pitch-present-length-${c.seconds}`}>{c.label}</button>
        ))}
      </div>
      {b ? (
        <span className={`font-mono text-[15px] font-bold ${b.over ? 'text-amber-400' : 'text-gray-100'}`} data-testid="pitch-present-card-time" data-over={b.over ? 'true' : 'false'}>{b.line}</span>
      ) : null}
    </div>
  );
}

function Card({ card, sources, small = false, aspect = '16:9', chrome = null, theme = null, shown = null, reduced = false }) {
  // D1576: with `shown`, the card plays: its transition as it comes up and its areas in their order.
  const playing = shown != null;
  const enter = playing ? transitionMotion(card, reduced) : null;
  // D1571 (#3818): the card reads in the deck's language and direction; its text aligns to the start.
  const words = langAttrs(theme);
  const head = small ? 'text-[15px]' : 'text-[clamp(20px,3vw,40px)]';
  const body = small ? 'text-[12px]' : 'text-[clamp(13px,1.4vw,19px)]';
  if (card.blocks?.length) {
    return (
      <div className="relative w-full overflow-hidden rounded-[12px] bg-[#fbfaf7] text-[#0f2a3d]" style={{ fontFamily: 'Outfit, sans-serif', aspectRatio: ratioOf(aspect), ...(enter ? { animation: enter } : {}) }} {...words} data-testid="pitch-present-card" data-layout="grid" data-transition={enter ? card.transition : undefined}>
        <BlockGrid blocks={card.blocks} colours={FACE_COLOURS} live sources={sources} aspect={aspect} lang={words.lang} dir={words.dir} testId="pitch-present-blocks"
          motion={playing ? (b) => areaMotion(card, b.id, shown, reduced) : null} />
        {small ? null : <CardCompliance chrome={chrome} testId="pitch-present-compliance" />}
      </div>
    );
  }
  return (
    <div className={`relative ${FACE} text-start`} style={{ fontFamily: 'Outfit, sans-serif' }} {...words} data-testid="pitch-present-card">
      <span className="text-[11px] font-bold uppercase tracking-[.08em] text-axal-violet">{card.n} · {card.title}{card.appendix ? ' · Appendix' : ''}</span>
      {card.sub ? <span className={`${head} font-bold leading-tight`}>{card.sub}</span> : null}
      {card.lines.map((l, k) => <p key={k} className={`m-0 whitespace-pre-line leading-[1.5] ${body}`}>{l}</p>)}
      {card.bullets.length ? <ul className={`m-0 list-disc ps-5 leading-[1.5] ${body}`}>{card.bullets.map((b, k) => <li key={k}>{b}</li>)}</ul> : null}
      {card.figures.length ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2">
          {card.figures.map((f, k) => (
            <div key={k} className="flex flex-col gap-0.5 rounded-[8px] border border-gray-200 p-2 dark:border-gray-200">
              <span className="text-[11px] text-slate-500">{f.k}</span>
              <span className={`${small ? 'text-[14px]' : 'text-[clamp(15px,1.8vw,24px)]'} font-bold`}>{f.v}</span>
              {sources ? <span className="text-[10.5px] text-slate-500">{f.source || SOURCE_NOT_RECORDED}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {card.image ? <img src={card.image} alt={card.title} className="max-h-[50%] self-start rounded-[8px] object-contain" /> : null}
      {card.empty ? <span className={`${body} text-slate-500`}>{EMPTY_CARD}</span> : null}
      {sources && !card.figures.length && !card.empty ? <span className="mt-auto text-[10.5px] text-slate-500">{SOURCE_NOT_RECORDED}</span> : null}
      {small ? null : <CardCompliance chrome={chrome} testId="pitch-present-compliance" />}
    </div>
  );
}

/** D1571 (#3818): the card face, exported for the language snapshots. */
export { Card as PresentCard };
