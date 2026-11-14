import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { deckRemoteApi } from '../../../lib/api/deckRemote';
import { reportError } from '../../../lib/log';
import {
  EXPIRED, MAKING, NEW_CODE, PAIR_FAILED, PANEL_TITLE, REMOTE_BUTTON, REMOTE_OFF, REMOTE_ON, REMOTE_PATH, UNPAIR,
  expiresLine, groupCode, pairRefusal, remoteLink, secondsLeft, spokenCode, spokenMinute,
} from './remoteModel';

/**
 * D1581 (#3828, PR1 to PR1e): Present's "Phone remote". Pressing it makes a
 * code (`deckRemoteApi.pair`) and opens a compact panel over the presenter
 * view: the code, large and grouped; a QR code for `/remote?code=…`; "Expires
 * in 9:42", counting down; Get a new code and Close. When the phone joins,
 * Present's socket says `paired` (the page passes `paired`), the panel closes
 * by itself and a chip "Phone remote · on" stays, its ⋯ holding Unpair phone.
 * A Worker without the remote says so ("off"); a failed press says it could
 * not make a code. Nothing records audio here.
 */
const BTN = 'inline-flex min-h-[36px] items-center justify-center rounded-[8px] px-3 font-mono text-[12px] font-bold';
const GHOST = `${BTN} border border-gray-700 text-gray-200 hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-violet-600 text-white hover:bg-violet-500`;

export default function RemotePair({ deckId, paired = false, onUnpaired = null }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ status: 'idle', code: null, expiresAt: null });
  const [qr, setQr] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [menu, setMenu] = useState(false);

  const make = useCallback(async () => {
    setState({ status: 'making', code: null, expiresAt: null }); setQr(null);
    try {
      const r = await deckRemoteApi.pair(deckId);
      setState({ status: 'ok', code: r?.code ?? null, expiresAt: r?.expires_at ?? null });
    } catch (e) {
      setState({ status: pairRefusal(e), code: null, expiresAt: null });
      reportError('pitch-present:remote-pair', e);
    }
  }, [deckId]);

  // The panel closes by itself once the phone is paired (PR1c).
  useEffect(() => { if (paired) setOpen(false); }, [paired]);
  useEffect(() => {
    if (!open || state.status !== 'ok') return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open, state.status]);
  useEffect(() => {
    if (!state.code || typeof window === 'undefined') { setQr(null); return undefined; }
    let live = true;
    QRCode.toDataURL(remoteLink(window.location.origin, state.code), { margin: 1, width: 168 })
      .then((url) => { if (live) setQr(url); }, () => { if (live) setQr(null); });
    return () => { live = false; };
  }, [state.code]);

  const unpair = async () => {
    setMenu(false);
    try { await deckRemoteApi.unpair(deckId); onUnpaired?.(); } catch (e) { reportError('pitch-present:remote-unpair', e); }
  };

  if (paired) {
    return (
      <span className="relative inline-flex items-center gap-1" data-testid="remote-pair-on">
        <span className="rounded-full border border-violet-500/60 px-2.5 py-1 font-mono text-[11.5px] font-bold text-violet-200">{REMOTE_ON}</span>
        <button type="button" className="min-h-[32px] rounded-[8px] px-2 text-gray-300 hover:bg-gray-800" aria-haspopup="menu" aria-expanded={menu} aria-label="Phone remote options" onClick={() => setMenu((v) => !v)} data-testid="remote-pair-menu">⋯</button>
        {menu ? (
          <div role="menu" className="absolute right-0 top-full z-30 mt-1 rounded-[8px] border border-gray-700 bg-[#111827] p-1">
            <button type="button" role="menuitem" className="min-h-[36px] whitespace-nowrap rounded-[6px] px-3 text-left font-mono text-[12px] text-gray-100 hover:bg-gray-800" onClick={unpair} data-testid="remote-pair-unpair">{UNPAIR}</button>
          </div>
        ) : null}
      </span>
    );
  }

  const left = state.status === 'ok' ? secondsLeft(state.expiresAt, now) : null;
  const expired = state.status === 'ok' && left === 0;
  return (
    <span className="relative inline-flex">
      <button type="button" className={GHOST} aria-expanded={open} onClick={() => { setOpen(true); if (state.status !== 'ok' || expired) make(); }} data-testid="remote-pair-open">{REMOTE_BUTTON}</button>
      {open ? (
        <div role="dialog" aria-label={PANEL_TITLE} className="absolute right-0 top-full z-40 mt-2 flex w-[320px] flex-col gap-3 rounded-[12px] border border-gray-700 bg-[#111827] p-4 font-sans text-gray-100 shadow-2xl" data-testid="remote-pair-panel" data-state={expired ? 'expired' : state.status}>
          <span className="text-[14px] font-extrabold">{PANEL_TITLE}</span>
          {state.status === 'making' || state.status === 'idle' ? <span className="text-[13px] text-gray-300" role="status">{MAKING}</span> : null}
          {state.status === 'off' ? <span className="text-[13px] text-gray-300" role="status" data-testid="remote-pair-off">{REMOTE_OFF}</span> : null}
          {state.status === 'error' ? <span className="text-[13px] text-amber-300" role="alert" data-testid="remote-pair-error">{PAIR_FAILED}</span> : null}
          {state.status === 'ok' ? (
            <>
              <span className={`text-center font-mono text-[40px] font-extrabold tracking-[.12em] ${expired ? 'text-gray-500' : 'text-white'}`} aria-label={`Code ${spokenCode(state.code)}`} data-testid="remote-pair-code">{groupCode(state.code)}</span>
              {qr && !expired ? <img src={qr} alt={`QR code that opens ${REMOTE_PATH} with this code`} width={168} height={168} className="mx-auto rounded-[8px] bg-white p-1 dark:bg-white" data-testid="remote-pair-qr" /> : null}
              <span className="text-[12.5px] text-gray-300">Open {typeof window !== 'undefined' ? window.location.host : ''}{REMOTE_PATH} on your phone and enter this code</span>
              {expired
                ? <span className="text-[12.5px] font-bold text-amber-300" role="status" data-testid="remote-pair-expired">{EXPIRED}</span>
                : <span className="font-mono text-[12px] text-gray-400" data-testid="remote-pair-expires">{expiresLine(left)}</span>}
              <span className="sr-only" aria-live="polite">{spokenMinute(left) || ''}</span>
            </>
          ) : null}
          <div className="flex justify-end gap-2">
            {state.status !== 'off' && state.status !== 'making' ? (
              <button type="button" className={expired || state.status === 'error' ? PRIMARY : GHOST} onClick={make} data-testid="remote-pair-new">{state.status === 'error' ? 'Try again' : NEW_CODE}</button>
            ) : null}
            <button type="button" className={GHOST} onClick={() => setOpen(false)} data-testid="remote-pair-close">Close</button>
          </div>
        </div>
      ) : null}
    </span>
  );
}
