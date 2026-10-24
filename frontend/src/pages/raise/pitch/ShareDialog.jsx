import React, { useEffect, useState } from 'react';
import { cyclesWrite } from '../../../lib/api/cycles';
import { reportError } from '../../../lib/log';
import { Lightbox } from '../../../ui';
import {
  DEFAULT_SHARE, EXPIRIES, INCLUDE_ROWS, NDA_SWITCH, NEVER_SHARED, NO_LIMIT, SHARE_CTA, SHARE_TITLE, SHOWN_ONCE, TYPED,
  frozenLine, shareBody, shareFailure, shareProblem, shareUrl, whatShareDoes,
} from './shareModel';

/**
 * D902 (#2681) — the share dialog (PD18), from Share in the editor and from
 * "New link" on Share & analytics. It writes through the one link writer,
 * `POST /api/cycles/raise/deck-links`, and says what it writes before it
 * writes it. The link is shown once, with Copy.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep disabled:opacity-60`;
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const EYE = 'font-mono text-[10px] font-semibold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const FIELD = 'min-h-[34px] rounded-[8px] border border-axal-hairline bg-white px-2 text-[12.5px] dark:border-gray-700 dark:bg-gray-900';

function Toggle({ label, on, onChange, testId }) {
  return (
    <label className={`flex items-center justify-between gap-3 text-[12.5px] ${INK}`}>
      <span>{label}</span>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
    </label>
  );
}

export default function ShareDialog({ projectId, deck, onClose, onCreated }) {
  const [state, setState] = useState({ ...DEFAULT_SHARE, include: { ...DEFAULT_SHARE.include } });
  const [prospects, setProspects] = useState({ status: 'loading', rows: [] });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);
  const [made, setMade] = useState(null);
  const [copied, setCopied] = useState(false);
  const set = (patch) => setState((s) => ({ ...s, ...patch }));

  useEffect(() => {
    let alive = true;
    cyclesWrite.formOptions('raise', projectId, 'pitch-deck')
      .then((r) => {
        if (!alive) return;
        const rows = Array.isArray(r?.prospects) ? r.prospects : [];
        setProspects({ status: 'ok', rows });
        setState((s) => (s.investor ? s : { ...s, investor: rows[0]?.value ?? TYPED }));
      })
      .catch((e) => {
        reportError('ShareDialog:prospects', e);
        if (!alive) return;
        setProspects({ status: 'error', rows: [] });
        setState((s) => (s.investor ? s : { ...s, investor: TYPED }));
      });
    return () => { alive = false; };
  }, [projectId]);

  const problem = shareProblem(state, deck);
  const investorName = state.investor === TYPED ? String(state.label || '').trim() : prospects.rows.find((p) => String(p.value) === String(state.investor))?.label;
  const url = shareUrl(made);

  const create = async () => {
    if (problem || busy) return;
    setBusy(true); setFailed(null);
    try {
      const r = await cyclesWrite.raise.deckLink(projectId, shareBody(state, deck));
      setMade(r);
      onCreated?.(r);
    } catch (e) {
      reportError('ShareDialog:create', e);
      setFailed(shareFailure(e));
    } finally { setBusy(false); }
  };

  const copy = async () => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <Lightbox
      label="Share"
      title={SHARE_TITLE}
      width={560}
      onClose={() => !busy && onClose()}
      testId="pitch-share-dialog"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>{made ? 'Done' : 'Cancel'}</button>
          {!made ? (
            <button type="button" className={PRIMARY} onClick={create} disabled={busy || Boolean(problem)} data-testid="pitch-share-create">
              {busy ? 'Creating…' : SHARE_CTA}
            </button>
          ) : null}
        </div>
      )}
    >
      {made ? (
        <div className="flex flex-col gap-3" data-testid="pitch-share-made">
          {url ? (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-[8px] bg-axal-ground px-2.5 py-2 font-mono text-[12px] dark:bg-gray-800" data-testid="pitch-share-url">{url}</code>
              <button type="button" className={GHOST} onClick={copy} data-testid="pitch-share-copy">{copied ? 'Copied' : 'Copy'}</button>
            </div>
          ) : <p className={`m-0 ${MUTED}`}>The link was made, but its address was not returned. Withdraw it from Share &amp; analytics and make another.</p>}
          <p className={`m-0 ${MUTED}`}>{SHOWN_ONCE}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <span className={EYE}>Investor</span>
            <select className={FIELD} value={state.investor} onChange={(e) => set({ investor: e.target.value })} data-testid="pitch-share-investor">
              {prospects.rows.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              <option value={TYPED}>or type a name</option>
            </select>
            {state.investor === TYPED ? (
              <input className={FIELD} value={state.label} onChange={(e) => set({ label: e.target.value })} placeholder="The investor's name" maxLength={200} data-testid="pitch-share-label" />
            ) : null}
            {prospects.status === 'error' ? <span className={MUTED}>Your prospects could not be read. Type a name instead.</span> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={EYE}>Expires</span>
            <div className="grid grid-cols-4 gap-1 rounded-[9px] bg-axal-ground p-1 dark:bg-gray-800" role="radiogroup" aria-label="Expires">
              {EXPIRIES.map((x) => {
                const on = x.id === state.expires;
                return (
                  <button key={String(x.id)} type="button" role="radio" aria-checked={on} onClick={() => set({ expires: x.id })}
                    className={`rounded-[7px] px-2 py-1.5 text-[12px] font-bold ${on ? 'bg-white text-axal-violet shadow-sm dark:bg-gray-900' : 'text-axal-muted dark:text-gray-400'}`}
                    data-testid={`pitch-share-expires-${x.id ?? 'never'}`}>{x.label}</button>
                );
              })}
            </div>
          </div>
          <label className={`flex items-center justify-between gap-3 text-[12.5px] ${INK}`}>
            <span>View limit</span>
            <input className={`${FIELD} w-28 text-right font-mono`} inputMode="numeric" value={state.viewLimit} placeholder={NO_LIMIT}
              onChange={(e) => set({ viewLimit: e.target.value })} data-testid="pitch-share-limit" />
          </label>
          <div className="flex flex-col gap-2">
            <Toggle label="Download" on={state.allowDownload} onChange={(v) => set({ allowDownload: v })} testId="pitch-share-download" />
            <Toggle label="Forwarding" on={state.allowForwarding} onChange={(v) => set({ allowForwarding: v })} testId="pitch-share-forwarding" />
            <Toggle label={NDA_SWITCH} on={state.ndaRequired} onChange={(v) => set({ ndaRequired: v })} testId="pitch-share-nda" />
          </div>
          <div className="flex flex-col gap-2">
            <span className={EYE}>What is included</span>
            {INCLUDE_ROWS.map((row) => (
              <Toggle key={row.key} label={row.label} on={Boolean(state.include[row.key])}
                onChange={(v) => set({ include: { ...state.include, [row.key]: v } })} testId={`pitch-share-include-${row.key}`} />
            ))}
            <div className={`flex items-center justify-between gap-3 text-[12.5px] ${INK}`}>
              <span>Data</span>
              <span className="font-mono text-[11.5px] text-axal-violet dark:text-violet-300" data-testid="pitch-share-frozen">{frozenLine(deck)}</span>
            </div>
            <span className={MUTED}>{NEVER_SHARED}</span>
          </div>
          <p className={`m-0 ${MUTED}`} data-testid="pitch-share-what">{problem || whatShareDoes(state, deck, investorName)}</p>
          {failed ? (
            <div role="alert" className="rounded-[10px] bg-red-50 px-3 py-2.5 text-[12.5px] font-semibold text-axal-destructive dark:bg-red-950/40 dark:text-red-300" data-testid="pitch-share-failed">{failed}</div>
          ) : null}
        </div>
      )}
    </Lightbox>
  );
}
