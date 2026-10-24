import React, { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import {
  ACCEPT_AND_OPEN, NDA_GATE_TITLE, NDA_UNREADABLE, SIGN_IN_TO_ACCEPT, closedCard, figureChips, frozenLine,
} from './shareModel';

/**
 * D902 (#2681) — the parts of the investor's viewer (PD20, PD22) that a link's
 * NDA and its closed state need. The share read decides: a link that asks for
 * the NDA sends no card until it is accepted on this link, and a closed link
 * sends the venture's name and nothing from the deck.
 */

const CARD = 'mx-auto mt-12 flex max-w-xl flex-col gap-3 rounded-[14px] border border-gray-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900';
const MUTED = 'text-[13px] leading-[1.5] text-gray-600 dark:text-slate-400';
const BTN = 'inline-flex min-h-[38px] items-center justify-center rounded-lg px-4 text-sm font-semibold';

/** PD22: "This link is no longer open." and who to ask. Nothing from the deck is shown. */
export function ClosedLink({ error }) {
  const card = closedCard(error);
  return (
    <div className={CARD} data-testid="share-closed">
      <h1 className="m-0 text-lg font-semibold text-gray-900 dark:text-slate-100">{card.title}</h1>
      <p className={`m-0 ${MUTED}`}>{card.line}</p>
    </div>
  );
}

/**
 * PD20 A: the NDA's text, a name field and Accept and open. Accepting needs a
 * signed-in account (the owner has not answered otherwise); without one, the
 * gate offers Sign in and comes back to this link.
 */
export function NdaGate({ token, gate, onAccepted }) {
  const [nda, setNda] = useState({ status: 'loading', text: null });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);

  useEffect(() => {
    let alive = true;
    api.deckShareNdaText(token)
      .then((r) => { if (alive) setNda({ status: 'ok', text: String(r?.text || '') }); })
      .catch((e) => { reportError('NdaGate:text', e); if (alive) setNda({ status: 'error', text: null }); });
    return () => { alive = false; };
  }, [token]);

  const accept = async () => {
    if (!name.trim() || busy || nda.status !== 'ok') return;
    setBusy(true); setFailed(null);
    try {
      await api.deckShareNda(token, { signed_by: name.trim() });
      onAccepted?.();
    } catch (e) {
      reportError('NdaGate:accept', e);
      setFailed(e?.data?.error || e?.data?.detail || e?.message || 'The NDA could not be recorded. Try again.');
    } finally { setBusy(false); }
  };

  const here = typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '';
  return (
    <div className={CARD} data-testid="share-nda-gate">
      <span className="font-mono text-[10.5px] uppercase tracking-[.07em] text-gray-500 dark:text-slate-400">
        {gate?.project_name || 'This venture'} · {frozenLine({ version: gate?.frozen?.version, created_at: gate?.frozen?.as_of })}
      </span>
      <h1 className="m-0 text-lg font-semibold text-gray-900 dark:text-slate-100">{NDA_GATE_TITLE}</h1>
      {nda.status === 'loading' ? <p className={`m-0 ${MUTED}`}>Reading the NDA…</p> : null}
      {nda.status === 'error' ? <p role="alert" className={`m-0 ${MUTED}`} data-testid="share-nda-unreadable">{NDA_UNREADABLE}</p> : null}
      {nda.status === 'ok' ? (
        <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-[12.5px] leading-[1.55] text-gray-800 dark:bg-slate-800 dark:text-slate-200" data-testid="share-nda-text">{nda.text}</div>
      ) : null}
      {gate?.signed_in ? (
        <>
          <label className="flex flex-col gap-1 text-[12.5px] text-gray-700 dark:text-slate-300">
            Your full name
            <input className="min-h-[36px] rounded-lg border border-gray-300 px-2.5 dark:border-slate-600 dark:bg-slate-900" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} data-testid="share-nda-name" />
          </label>
          <button type="button" className={`${BTN} bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50`} onClick={accept} disabled={busy || !name.trim() || nda.status !== 'ok'} data-testid="share-nda-accept">
            {busy ? 'Recording…' : ACCEPT_AND_OPEN}
          </button>
        </>
      ) : (
        <a className={`${BTN} bg-violet-600 text-white hover:bg-violet-700`} href={`/login?next=${encodeURIComponent(here)}`} data-testid="share-nda-sign-in">{SIGN_IN_TO_ACCEPT}</a>
      )}
      <p className={`m-0 text-[12px] ${MUTED}`}>Nothing from the deck opens until the NDA is accepted. Accepting is recorded with the venture.</p>
      {failed ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-600 dark:text-red-400" data-testid="share-nda-failed">{failed}</p> : null}
    </div>
  );
}

/** PD20 B: each figure on the shared version with a small source chip under it. */
export function FigureSources({ slides }) {
  const rows = figureChips(slides);
  if (!rows.length) return null;
  return (
    <section className="deck-print-cta mx-auto my-6 flex max-w-4xl flex-col gap-2 px-4" data-testid="share-figure-sources" aria-label="Figures and their sources">
      <span className="font-mono text-[10.5px] uppercase tracking-[.07em] text-gray-500 dark:text-slate-400">Figures and their sources</span>
      <div className="flex flex-wrap gap-2">
        {rows.map((r, i) => (
          <div key={`${r.card}-${i}`} className="flex flex-col rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
            <span className="text-[12.5px] font-semibold text-gray-900 dark:text-slate-100">{r.label} · {r.value}</span>
            <span className="mt-1 self-start rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[10px] text-gray-600 dark:bg-slate-800 dark:text-slate-400">Card {r.card} · {r.chip}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
