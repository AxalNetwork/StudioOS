import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../../lib/api';
import { deckRemoteApi } from '../../../lib/api/deckRemote';
import { reportError } from '../../../lib/log';
import { useAuth } from '../../../hooks/useAuthSync';
import { PhoneRemote } from './PitchPresent';
import { cardsOf } from './presentExportModel';
import {
  CONNECT, CONNECTING, DIDNT_WORK, DISCONNECT, DISCONNECTED, ENTER_NEW, FIND_CODE, NOT_PRESENTING, PAGE_TITLE, REMOTE_OFF, SIGNED_OUT, STEP_FAILED, TOO_MANY,
  boxesOf, cardAfter, digitsOf, joinRefusal, signInHref, stepOutcome,
} from './remoteModel';

/**
 * D1581 (#3828, PR2 to PR6): `/remote`, the phone's side of Present's remote.
 *
 *   PR2  "Control a presentation": six one-digit boxes on a number keypad;
 *        paste fills all six. Opened from the QR code (`?code=…`), the boxes
 *        are filled and it connects at once.
 *   PR2a Connecting…; PR2b one answer for a wrong, expired or unreadable code;
 *        PR2c too many tries (429); PR2d signed out, with Sign in that comes
 *        back here with the code kept.
 *   PR3  ps5b's remote (`PhoneRemote`) with "Connected to [Deck title]" and ⋯
 *        Disconnect. Each press sends the card it lands on (`{ card: n }`), so
 *        the phone and the screen agree on which card is up.
 *   PR4  a step not delivered (Present not open on the screen) keeps the
 *        controls; a remote ended by a new code or Unpair goes back to the
 *        code; any other failure is said, never silent.
 *
 * The page follows the system's light or dark setting (PR6); the connected
 * remote is ps5b's dark view. Nothing records audio.
 */
const BOX = 'h-14 w-11 rounded-[10px] border border-axal-hairline bg-white text-center font-mono text-[24px] font-bold text-axal-ink focus:border-axal-violet focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const PRIMARY = 'inline-flex min-h-[48px] w-full items-center justify-center rounded-[12px] bg-axal-violet px-4 text-[15px] font-bold text-white disabled:opacity-50 dark:bg-violet-600';

export default function RemotePage() {
  const { user } = useAuth() || {};
  const [params] = useSearchParams();
  const fromQr = digitsOf(params.get('code'));
  const [code, setCode] = useState(fromQr);
  const [phase, setPhase] = useState('enter');
  const [problem, setProblem] = useState(null);
  const [link, setLink] = useState(null);
  const [deck, setDeck] = useState(null);
  const [at, setAt] = useState(0);
  const [notice, setNotice] = useState(null);
  const [menu, setMenu] = useState(false);
  const boxes = useRef([]);
  const tried = useRef(false);
  const signedIn = Boolean(user);

  const connect = useCallback(async (value) => {
    const c = digitsOf(value);
    if (c.length !== 6) return;
    setPhase('connecting'); setProblem(null);
    try {
      const j = await deckRemoteApi.join(c);
      const d = await api.deckGet(j.deck_id);
      setLink({ deckId: j.deck_id, remoteId: j.remote_id }); setDeck(d); setAt(0); setNotice(null); setPhase('connected');
    } catch (e) {
      setProblem(joinRefusal(e)); setPhase('enter');
      reportError('pitch-remote:join', e);
    }
  }, []);

  // PR2: a QR scan arrives with the code and connects at once.
  useEffect(() => {
    if (tried.current || !signedIn || fromQr.length !== 6) return;
    tried.current = true;
    connect(fromQr);
  }, [signedIn, fromQr, connect]);

  const setDigit = (i, v) => {
    const d = digitsOf(v);
    if (d.length > 1) { setCode(d); boxes.current[Math.min(d.length, 6) - 1]?.focus?.(); return; }
    const next = boxesOf(code); next[i] = d; const joined = next.join('');
    setCode(joined);
    if (d && i < 5) boxes.current[i + 1]?.focus?.();
  };

  const cards = cardsOf(deck);
  const n = cards.length;
  const press = async (step) => {
    if (!link) return;
    const to = cardAfter(at, step, n);
    try {
      const r = await deckRemoteApi.step(link.deckId, link.remoteId, { card: to + 1 });
      const out = stepOutcome(r);
      setAt(to);
      setNotice(out === 'not_presenting' ? NOT_PRESENTING : null);
    } catch (e) {
      if (stepOutcome(null, e) === 'disconnected') { setLink(null); setPhase('disconnected'); return; }
      setNotice(STEP_FAILED);
      reportError('pitch-remote:step', e);
    }
  };

  if (phase === 'connected' && link && n) {
    const top = (
      <div className="relative mx-4 mb-2 flex items-center justify-between gap-2 rounded-[10px] bg-[#111827] px-3 py-2" data-testid="remote-connected">
        <span className="min-w-0 truncate text-[13px] font-bold text-gray-100">Connected to {deck?.title || 'the deck'}</span>
        <button type="button" className="min-h-[40px] rounded-[8px] px-2 text-gray-300" aria-haspopup="menu" aria-expanded={menu} aria-label="Remote options" onClick={() => setMenu((v) => !v)} data-testid="remote-menu">⋯</button>
        {menu ? (
          <div role="menu" className="absolute right-2 top-full z-30 mt-1 rounded-[8px] border border-gray-700 bg-[#111827] p-1">
            <button type="button" role="menuitem" className="min-h-[40px] rounded-[6px] px-3 text-[13px] text-gray-100" onClick={() => { setMenu(false); setLink(null); setDeck(null); setCode(''); setPhase('enter'); }} data-testid="remote-disconnect">{DISCONNECT}</button>
          </div>
        ) : null}
      </div>
    );
    return <PhoneRemote card={cards[at]} next={cards[at + 1] || null} i={at} n={n} seconds={null} exit={null} onStep={press} top={top} notice={notice} />;
  }

  return (
    <main className="flex min-h-screen flex-col items-center bg-axal-ground px-4 py-10 text-axal-ink dark:bg-gray-950 dark:text-gray-100" data-testid="remote-page">
      <div className="flex w-full max-w-[400px] flex-col gap-5">
        <h1 className="m-0 text-[24px] font-extrabold">{PAGE_TITLE}</h1>
        {phase === 'disconnected' ? (
          <div className="flex flex-col gap-3" data-testid="remote-disconnected">
            <p className="m-0 text-[14px] leading-[1.5]">{DISCONNECTED}</p>
            <button type="button" className={PRIMARY} onClick={() => { setCode(''); setPhase('enter'); }} data-testid="remote-enter-new">{ENTER_NEW}</button>
          </div>
        ) : !signedIn ? (
          <div className="flex flex-col gap-3" data-testid="remote-signed-out">
            <p className="m-0 text-[14px] leading-[1.5]">{SIGNED_OUT}</p>
            <Link to={signInHref(code)} className={PRIMARY} data-testid="remote-sign-in">Sign in</Link>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); connect(code); }}>
            <fieldset className="m-0 flex justify-between gap-1.5 border-0 p-0" aria-label="Code" data-testid="remote-boxes">
              {boxesOf(code).map((d, i) => (
                <input key={i} ref={(el) => { boxes.current[i] = el; }} className={BOX} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} pattern="[0-9]*"
                  aria-label={`Digit ${i + 1} of 6`} value={d} disabled={phase === 'connecting'}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Backspace' && !d && i > 0) boxes.current[i - 1]?.focus?.(); }}
                  onPaste={(e) => { const t = e.clipboardData?.getData?.('text'); if (t) { e.preventDefault(); setDigit(i, t); } }}
                  data-testid={`remote-box-${i}`} />
              ))}
            </fieldset>
            {phase === 'connecting' ? <span role="status" className="text-[13px]" data-testid="remote-connecting">{CONNECTING}</span> : null}
            {problem ? (
              <span role="alert" className="text-[13px] font-semibold text-red-700 dark:text-red-300" data-testid={`remote-problem-${problem}`}>
                {problem === 'too_many' ? TOO_MANY : problem === 'off' ? REMOTE_OFF : problem === 'signed_out' ? SIGNED_OUT : DIDNT_WORK}
              </span>
            ) : null}
            <button type="submit" className={PRIMARY} disabled={digitsOf(code).length !== 6 || phase === 'connecting'} data-testid="remote-connect">{CONNECT}</button>
            <span className="text-center text-[12.5px] text-axal-muted dark:text-gray-400">{FIND_CODE}</span>
          </form>
        )}
      </div>
    </main>
  );
}
