import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { deckGrantsApi } from '../../../lib/api/deckGrants';
import { reportError } from '../../../lib/log';
import { Lightbox } from '../../../ui';
import {
  DEALS_FAILED, DEFAULT_TICKS, GRANT_BUTTON, GRANT_TICKS, NO_DEAL, NO_GRANT, NO_INVESTOR, NO_VERSION, SECTION_LINE, SECTION_TITLE,
  grantBody, grantRows, grantedLine, investorOptions, liveGrantFor, refusalText, replaceLine, ventureDeals, versionOptions,
  withdrawLine, withdrawnLine,
} from './deckGrantsModel';

/**
 * D6166 (#6166; D1587's founder control, owner answer: plain control now) —
 * "Shared on a deal", on Share & analytics. The founder picks one of the
 * venture's deals and sees its grants: each investor's name and firm, the
 * version, the four ticks, and the granted and withdrawn dates, never an
 * investor's note, score or decision. "Share a version…" opens the dialog
 * (deal, investor from the read's `investors`, saved version, the four ticks);
 * an investor who already has a live grant is told it will be replaced before
 * anything is sent. Withdraw asks first and says what the investor loses.
 * A refusal reads in the Worker's words, and a failed read is never drawn as
 * an empty list. Reads `GET /api/deals` (the founder's own deals) and
 * `deckGrantsApi`; writes only through `deckGrantsApi.grant` and `.withdraw`.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep dark:hover:bg-violet-700`;
const DANGER = `${BTN} bg-axal-destructive text-white hover:opacity-90 dark:hover:opacity-90`;
const DANGER_TEXT = 'inline-flex min-h-[32px] items-center px-2 text-[12px] font-bold text-axal-destructive hover:underline dark:text-red-400 dark:hover:underline';
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const PILL = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-bold';
const PILL_OK = `${PILL} border-emerald-200 bg-emerald-50 text-axal-positive dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300`;
const SELECT = 'min-h-[36px] w-full rounded-[8px] border border-axal-hairline bg-white px-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LABEL = 'flex flex-col gap-1 text-[11.5px] font-bold text-axal-muted dark:text-gray-400';
const ALERT = 'm-0 text-[12.5px] font-semibold text-axal-destructive dark:text-red-400';

function Failed({ text, onRetry, testId }) {
  return (
    <div className="flex flex-col items-start gap-2 px-4 pb-4" data-testid={testId}>
      <span role="alert" className={`text-[13px] font-bold ${INK}`}>{text}</span>
      <button type="button" className={GHOST} onClick={onRetry} data-testid={`${testId}-retry`}><RefreshCw size={14} aria-hidden="true" /> Try again</button>
    </div>
  );
}

export default function DeckGrants({ projectId, versions, readOnly }) {
  const [deals, setDeals] = useState({ status: 'loading' });
  const [dealTick, setDealTick] = useState(0);
  const [dealId, setDealId] = useState(null);
  const [grants, setGrants] = useState({ status: 'idle' });
  const [grantTick, setGrantTick] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [withdraw, setWithdraw] = useState(null);
  const [toast, setToast] = useState(null);
  const dismiss = useRef(null);
  const heading = useRef(null);

  useEffect(() => {
    if (projectId == null) { setDeals({ status: 'ok', list: [] }); return undefined; }
    let live = true;
    setDeals({ status: 'loading' });
    api.listDeals().then(
      (r) => { if (live) setDeals({ status: 'ok', list: ventureDeals(r, projectId) }); },
      (e) => { if (live) setDeals({ status: 'error', message: DEALS_FAILED }); reportError('pitch-studio:deck-grants-deals', e); },
    );
    return () => { live = false; };
  }, [projectId, dealTick]);

  const dealList = deals.status === 'ok' ? deals.list : null;
  useEffect(() => {
    if (!dealList) return;
    if (!dealList.some((d) => d.id === dealId)) setDealId(dealList[0]?.id ?? null);
  }, [dealList, dealId]);

  useEffect(() => {
    if (dealId == null) { setGrants({ status: 'idle' }); return undefined; }
    let live = true;
    setGrants({ status: 'loading', dealId });
    deckGrantsApi.grants(dealId).then(
      (r) => { if (live) setGrants({ status: 'ok', dealId, rows: grantRows(r?.grants), investors: investorOptions(r?.investors) }); },
      (e) => {
        if (!live) return;
        setGrants({ status: 'error', dealId, message: refusalText(e, 'The deck grants could not be read. Try again.') });
        reportError('pitch-studio:deck-grants', e);
      },
    );
    return () => { live = false; };
  }, [dealId, grantTick]);

  useEffect(() => { if (toast) dismiss.current?.focus?.(); }, [toast]);

  const versionList = useMemo(() => versionOptions(versions), [versions]);
  const reload = useCallback(() => setGrantTick((n) => n + 1), []);
  const canGrant = !readOnly && dealId != null && versionList.length > 0;

  let body;
  if (deals.status === 'loading') {
    body = <p className={`${MUTED} px-4 pb-4`} data-testid="deck-grants-loading">Reading your deals…</p>;
  } else if (deals.status === 'error') {
    body = <Failed text={deals.message} onRetry={() => setDealTick((n) => n + 1)} testId="deck-grants-deals-error" />;
  } else if (!deals.list.length) {
    body = <p className={`${MUTED} px-4 pb-4`} data-testid="deck-grants-no-deal">{NO_DEAL}</p>;
  } else {
    let list;
    if (grants.status === 'error') {
      list = <Failed text={grants.message} onRetry={reload} testId="deck-grants-error" />;
    } else if (grants.status !== 'ok') {
      list = <p className={`${MUTED} px-4 pb-4`} data-testid="deck-grants-reading">Reading the grants on this deal…</p>;
    } else if (!grants.rows.length) {
      list = <p className={`${MUTED} px-4 pb-4`} data-testid="deck-grants-empty">{NO_GRANT}</p>;
    } else {
      list = (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px]" data-testid="deck-grants-table">
            <thead>
              <tr className="bg-axal-ground font-mono text-[9.5px] font-semibold uppercase tracking-[.07em] text-axal-muted dark:bg-gray-800 dark:text-gray-400">
                <th className="px-4 py-2 font-semibold">Investor</th>
                <th className="px-4 py-2 font-semibold">Firm</th>
                <th className="px-4 py-2 font-semibold">Version</th>
                <th className="px-4 py-2 font-semibold">Includes</th>
                <th className="px-4 py-2 font-semibold">Granted</th>
                <th className="px-4 py-2 font-semibold">Withdrawn</th>
                <th className="px-4 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {grants.rows.map((g) => (
                <tr key={g.uid} className="border-t border-axal-hairline dark:border-gray-700" data-testid={`deck-grant-${g.uid}`}>
                  <td className={`px-4 py-2.5 font-semibold ${INK}`}>{g.name}</td>
                  <td className="px-4 py-2.5 text-axal-muted dark:text-gray-400">{g.firm}</td>
                  <td className={`px-4 py-2.5 font-mono ${INK}`}>{g.version}</td>
                  <td className="px-4 py-2.5 text-[11.5px] text-axal-muted dark:text-gray-400">{g.ticks}</td>
                  <td className="px-4 py-2.5 font-mono text-axal-muted dark:text-gray-400">{g.granted}</td>
                  <td className="px-4 py-2.5 font-mono text-axal-muted dark:text-gray-400" data-testid={`deck-grant-withdrawn-${g.uid}`}>
                    {g.live ? <span className={PILL_OK}>Live</span> : g.withdrawn}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {!readOnly && g.live ? (
                      <button type="button" className={DANGER_TEXT} onClick={() => setWithdraw({ row: g, busy: false, error: null })} data-testid={`deck-grant-withdraw-${g.uid}`}>Withdraw</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    body = (
      <>
        <div className="px-4 pb-3">
          <label className={`${LABEL} max-w-[420px]`}>Deal
            <select className={SELECT} value={dealId ?? ''} onChange={(e) => setDealId(Number(e.target.value))} data-testid="deck-grants-deal">
              {deals.list.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </label>
        </div>
        {list}
      </>
    );
  }

  const openDialog = () => {
    setToast(null);
    setDialog({ investorId: null, deckId: versionList[0]?.id ?? null, ticks: { ...DEFAULT_TICKS }, busy: false, error: null });
  };

  const sendGrant = async () => {
    if (!dialog || dialog.busy || dealId == null) return;
    const investor = grants.investors?.find((i) => i.id === dialog.investorId);
    const version = versionList.find((v) => v.id === dialog.deckId);
    if (!investor || !version) return;
    const replaced = Boolean(liveGrantFor(grants.rows, investor.id));
    setDialog((d) => ({ ...d, busy: true, error: null }));
    try {
      await deckGrantsApi.grant(dealId, grantBody(dialog));
      setDialog(null);
      setToast(grantedLine(investor.name, version.short, replaced));
      reload();
    } catch (e) {
      reportError('pitch-studio:deck-grant', e);
      setDialog((d) => (d ? { ...d, busy: false, error: refusalText(e, 'The deck could not be shared. Try again.') } : d));
    }
  };

  const confirmWithdraw = async () => {
    if (!withdraw || withdraw.busy || dealId == null) return;
    setWithdraw((w) => ({ ...w, busy: true, error: null }));
    try {
      await deckGrantsApi.withdraw(dealId, withdraw.row.uid);
      setToast(withdrawnLine(withdraw.row));
      setWithdraw(null);
      reload();
    } catch (e) {
      reportError('pitch-studio:deck-grant-withdraw', e);
      setWithdraw((w) => (w ? { ...w, busy: false, error: refusalText(e, 'The grant could not be withdrawn. Try again.') } : w));
    }
  };

  return (
    <section className={`${CARD} overflow-hidden`} data-testid="deck-grants">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <h2 ref={heading} tabIndex={-1} className={`m-0 text-[14px] font-extrabold ${INK}`}>{SECTION_TITLE}</h2>
        {canGrant ? <button type="button" className={GHOST} onClick={openDialog} data-testid="deck-grants-open">{GRANT_BUTTON}</button> : null}
      </div>
      <p className={`${MUTED} m-0 px-4 pb-3 pt-1`}>{SECTION_LINE}</p>
      {!readOnly && deals.status === 'ok' && deals.list.length > 0 && !versionList.length ? (
        <p className={`${MUTED} m-0 px-4 pb-3`} data-testid="deck-grants-no-version">{NO_VERSION}</p>
      ) : null}
      {body}
      <div role="status">
        {toast ? (
          <div className={`flex items-center justify-between gap-3 border-t border-axal-hairline px-4 py-3 text-[12.5px] dark:border-gray-700 ${INK}`} data-testid="deck-grants-toast">
            <span>{toast}</span>
            <button ref={dismiss} type="button" aria-label="Dismiss" className="h-8 w-8 text-[16px] leading-none" onClick={() => { setToast(null); heading.current?.focus?.(); }}>×</button>
          </div>
        ) : null}
      </div>
      {dialog ? (
        <GrantDialog
          dialog={dialog} setDialog={setDialog} deals={deals.list} dealId={dealId} setDealId={setDealId}
          grants={grants} versions={versionList} onSend={sendGrant} onRetry={reload}
        />
      ) : null}
      {withdraw ? (
        <Lightbox
          label="Withdraw this grant"
          title={`Withdraw ${withdraw.row.name}'s grant?`}
          width={480}
          onClose={() => !withdraw.busy && setWithdraw(null)}
          testId="deck-grant-withdraw-dialog"
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={GHOST} onClick={() => setWithdraw(null)} disabled={withdraw.busy}>Cancel</button>
              <button type="button" className={DANGER} onClick={confirmWithdraw} disabled={withdraw.busy} data-testid="deck-grant-withdraw-confirm">{withdraw.busy ? 'Withdrawing…' : 'Withdraw'}</button>
            </div>
          )}
        >
          <p className={`m-0 text-[13px] leading-[1.55] ${INK}`} data-testid="deck-grant-withdraw-line">{withdrawLine(withdraw.row)}</p>
          {withdraw.error ? <p role="alert" className={`${ALERT} mt-2`} data-testid="deck-grant-withdraw-error">{withdraw.error}</p> : null}
        </Lightbox>
      ) : null}
    </section>
  );
}

function GrantDialog({ dialog, setDialog, deals, dealId, setDealId, grants, versions, onSend, onRetry }) {
  const set = (patch) => setDialog((d) => ({ ...d, ...patch, error: null }));
  const ready = grants.status === 'ok' && grants.dealId === dealId;
  const investors = ready ? grants.investors : [];
  const version = versions.find((v) => v.id === dialog.deckId);
  const live = ready ? liveGrantFor(grants.rows, dialog.investorId) : null;
  const canSend = ready && !dialog.busy && dialog.investorId != null && version != null;
  const sendLabel = dialog.busy ? 'Sharing…' : live ? 'Replace and share' : 'Share';

  let investorField;
  if (grants.status === 'error') {
    investorField = (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className={ALERT} data-testid="deck-grant-investors-error">{grants.message}</p>
        <button type="button" className={GHOST} onClick={onRetry}><RefreshCw size={14} aria-hidden="true" /> Try again</button>
      </div>
    );
  } else if (!ready) {
    investorField = <p className={`${MUTED} m-0`} data-testid="deck-grant-investors-reading">Reading the investors on this deal…</p>;
  } else if (!investors.length) {
    investorField = <p className={`${MUTED} m-0`} data-testid="deck-grant-no-investor">{NO_INVESTOR}</p>;
  } else {
    investorField = (
      <label className={LABEL}>Investor
        <select className={SELECT} value={dialog.investorId ?? ''} onChange={(e) => set({ investorId: e.target.value === '' ? null : Number(e.target.value) })} data-testid="deck-grant-investor">
          <option value="">Choose an investor</option>
          {investors.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
      </label>
    );
  }

  return (
    <Lightbox
      label="Share a version on a deal"
      title="Share a version on a deal"
      width={520}
      onClose={() => !dialog.busy && setDialog(null)}
      testId="deck-grant-dialog"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={() => setDialog(null)} disabled={dialog.busy}>Cancel</button>
          <button type="button" className={`${PRIMARY} disabled:opacity-50`} onClick={onSend} disabled={!canSend} data-testid="deck-grant-send">{sendLabel}</button>
        </div>
      )}
    >
      <div className="flex flex-col gap-3">
        <label className={LABEL}>Deal
          <select className={SELECT} value={dealId ?? ''} disabled={dialog.busy} onChange={(e) => { setDealId(Number(e.target.value)); set({ investorId: null }); }} data-testid="deck-grant-deal">
            {deals.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>
        {investorField}
        <label className={LABEL}>Saved version
          <select className={SELECT} value={dialog.deckId ?? ''} disabled={dialog.busy} onChange={(e) => set({ deckId: Number(e.target.value) })} data-testid="deck-grant-version">
            {versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 text-[11.5px] font-bold text-axal-muted dark:text-gray-400">What the investor sees</legend>
          {GRANT_TICKS.map((t) => (
            <label key={t.key} className={`flex min-h-[32px] items-center gap-2 text-[12.5px] ${INK}`}>
              <input
                type="checkbox" checked={dialog.ticks[t.key] === true} disabled={dialog.busy}
                onChange={(e) => set({ ticks: { ...dialog.ticks, [t.key]: e.target.checked } })}
                data-testid={`deck-grant-tick-${t.key}`}
              />
              {t.long}
            </label>
          ))}
        </fieldset>
        {live && version ? (
          <p className={`m-0 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] leading-[1.5] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200`} data-testid="deck-grant-replace">
            {replaceLine(live, version.short)}
          </p>
        ) : null}
        {dialog.error ? <p role="alert" className={ALERT} data-testid="deck-grant-error">{dialog.error}</p> : null}
      </div>
    </Lightbox>
  );
}
