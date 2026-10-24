import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { usePhoneWidth } from '../../../ui';
import { asList, currentVersion, versionLabel } from './pitchStudioModel';
import {
  AUDIENCE, EMPTY_CARD, ESC_TO_EXIT, NO_CARDS, NO_VERSION, PRESENTER, READ_FAILED, SHOW_SOURCES, SOURCE_NOT_RECORDED,
  cardsOf, clock, countLabel, dotsOf, exitHref, moveTo, notesOf, stepFor, swipeLine, swipeStep,
} from './presentExportModel';

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
 */

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

export default function PitchPresent() {
  const { status, deck, projectId } = useVersion();
  const navigate = useNavigate();
  const phone = usePhoneWidth();
  const [i, setI] = useState(0);
  const [view, setView] = useState('presenter');
  const [sources, setSources] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const touch = useRef(null);
  const cards = status === 'ok' ? cardsOf(deck) : [];
  const n = cards.length;
  const exit = exitHref(projectId);

  const step = useCallback((s) => {
    if (s === 'exit') { navigate(exit); return; }
    setI((at) => moveTo(at, s, n));
  }, [navigate, exit, n]);

  useEffect(() => {
    const onKey = (e) => {
      const s = stepFor(e.key);
      if (!s) return;
      e.preventDefault();
      step(s);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

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
          <Card card={card} sources small />
          {dots}
          <span className="text-center text-[12px] text-gray-400" data-testid="pitch-present-swipe">{swipeLine(i, n)}</span>
        </div>
      </div>
    );
  }

  const next = cards[i + 1] || null;
  return (
    <div className={SHELL} data-testid="pitch-present" data-view={view}>
      <div className={BAR}>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="View">
          <button type="button" className={view === 'presenter' ? ON : OFF} aria-pressed={view === 'presenter'} onClick={() => setView('presenter')}>{PRESENTER}</button>
          <button type="button" className={view === 'audience' ? ON : OFF} aria-pressed={view === 'audience'} onClick={() => setView('audience')}>{AUDIENCE}</button>
          <button type="button" className={sources ? ON : OFF} aria-pressed={sources} onClick={() => setSources((v) => !v)} data-testid="pitch-present-sources">{SHOW_SOURCES}</button>
        </div>
        <span data-testid="pitch-present-status">
          {view === 'presenter' ? `${clock(seconds)} · ` : ''}{countLabel(i, n)} · <Link to={exit} className="text-gray-300 hover:underline">{ESC_TO_EXIT}</Link>
        </span>
      </div>
      {view === 'presenter' ? (
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-4 pb-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card card={card} sources={sources} />
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] font-bold tracking-[.07em] text-gray-400">NEXT</span>
              {next ? <Card card={next} sources={false} small /> : <span className="text-[12.5px] text-gray-400">This is the last card.</span>}
            </div>
            <div className="flex flex-col gap-1.5 rounded-[10px] bg-[#111827] p-3.5" data-testid="pitch-present-notes">
              <span className="font-mono text-[11px] font-bold tracking-[.07em] text-gray-400">NOTES</span>
              <span className={`whitespace-pre-line text-[14px] leading-[1.55] ${card.notes ? 'text-gray-100' : 'text-gray-400'}`}>{notesOf(card)}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 pb-4">
          <div className="w-full max-w-[min(100%,calc((100vh-120px)*16/9))]"><Card card={card} sources={sources} /></div>
          {dots}
        </div>
      )}
    </div>
  );
}

function Card({ card, sources, small = false }) {
  const head = small ? 'text-[15px]' : 'text-[clamp(20px,3vw,40px)]';
  const body = small ? 'text-[12px]' : 'text-[clamp(13px,1.4vw,19px)]';
  return (
    <div className={FACE} style={{ fontFamily: 'Outfit, sans-serif' }} data-testid="pitch-present-card">
      <span className="text-[11px] font-bold uppercase tracking-[.08em] text-axal-violet">{card.n} · {card.title}{card.appendix ? ' · Appendix' : ''}</span>
      {card.sub ? <span className={`${head} font-bold leading-tight`}>{card.sub}</span> : null}
      {card.lines.map((l, k) => <p key={k} className={`m-0 whitespace-pre-line leading-[1.5] ${body}`}>{l}</p>)}
      {card.bullets.length ? <ul className={`m-0 list-disc pl-5 leading-[1.5] ${body}`}>{card.bullets.map((b, k) => <li key={k}>{b}</li>)}</ul> : null}
      {card.figures.length ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2">
          {card.figures.map((f, k) => (
            <div key={k} className="flex flex-col gap-0.5 rounded-[8px] border border-gray-200 p-2 dark:border-gray-200">
              <span className="text-[11px] text-slate-500">{f.k}</span>
              <span className={`${small ? 'text-[14px]' : 'text-[clamp(15px,1.8vw,24px)]'} font-bold`}>{f.v}</span>
              {sources ? <span className="text-[10.5px] text-slate-500">{SOURCE_NOT_RECORDED}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {card.image ? <img src={card.image} alt={card.title} className="max-h-[50%] self-start rounded-[8px] object-contain" /> : null}
      {card.empty ? <span className={`${body} text-slate-500`}>{EMPTY_CARD}</span> : null}
      {sources && !card.figures.length && !card.empty ? <span className="mt-auto text-[10.5px] text-slate-500">{SOURCE_NOT_RECORDED}</span> : null}
    </div>
  );
}
