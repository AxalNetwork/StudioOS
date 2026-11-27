/**
 * D1242 (#3255, part 6 of #2423) — Deal flow's Studio lens at /deals for an
 * admin or an Operating Partner (DLS11, DLS11b, DLS12), replacing the retired
 * `DealsPage`. The same list as an investor's, on the ROUND's status:
 *   - the board's columns are In intake, Screened, Raising and Funded; Not
 *     raising is a filter (`?round=not_raising`), and intake's alone
 *     (`&by=intake`) is what the notice's "Review them" opens;
 *   - the table adds Lead partner, Investors (invited · interested ·
 *     committed) and Source;
 *   - each row's ⋯ holds Advance, Pass…, Invite investors (an admin, on the
 *     deal page) and Edit terms, only where the Worker lets this caller move
 *     the round. Every change opens an in-page dialog that says what it
 *     changes; a refusal stays in the dialog in the Worker's own words;
 *   - an Operating Partner reads every round and moves only those they lead.
 * Below it, as on the retired page: the Stage SLA, the stage funnel and Why
 * we passed.
 *
 * D5916 (#5916, Deals v2 board DE12, canvas section DX12) redraws it: the
 * stage strip (In intake, Screened, Raising, Funded, Not raising, each a link
 * that filters), the Needs attention strip (No owner, Stale, Terms missing,
 * counted from the one read; Investor waiting and Closing blocked have no
 * field and are not drawn), the Table by default with the canvas's columns,
 * and Advance on the row with More (Pass, Invite investors, Edit terms) only
 * where `can_move` lets this caller move the round. On a phone the table is
 * drawn as cards, so nothing is wider than the screen.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../../lib/api';
import { dealFlowApi } from '../../../lib/api/dealFlow';
import { reportError } from '../../../lib/log';
import { safeReadJSON, safeWriteJSON } from '../../../lib/storage';
import { DEFAULT_SLA, SLA_BAND_CLASS, slaBand } from '../../../lib/dealFlow';
import { Lightbox, Unreadable, Unrecorded, actionGhost, actionPrimary, usePhoneWidth } from '../../../ui';
import { TITLE } from './dealFlowModel';
// D4635 (#4635): the Scorecard column reads the supported scoring batch, with its own states.
import { ventureScoresApi } from '../../../lib/api/ventureScores.js';
import { ScorecardCell } from './FlowCells';
import { scoresOf } from './flowModel';
import {
  ATTENTION, COMMITTED_NOT_READ, CRUMB, LENS_COLUMNS, PARTNER_FOOT, PARTNER_NOTE, PASS_CLOSES, ROUND_WORD, STAGE_STRIP, STUDIO_LINE, TABLE_COLUMNS,
  attentionChip, attentionCounts, attentionOf, columnSummary, committedLine, intakeNotice, investorsLine, lensRows, nextStatus, notRaisingLine,
  splitActions, stageCounts, studioRow, studioViewHref, studioViewOf,
} from './studioLensModel';
import { DealTermsEditor, DraftDealModal, PassAnalyticsPanel, PassModal, SlaPicker, StageFunnelPanel } from './StudioParts';
import Sheet from '../../../ui/Sheet.jsx';

const box = 'flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const chip = 'w-fit rounded-full border border-axal-hairline px-2 py-0.5 text-[11.5px] dark:border-gray-700';
const flag = 'w-fit rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11.5px] font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200';
const seg = (on) => `inline-flex min-h-[44px] items-center rounded-md px-3 text-[13px] font-semibold md:min-h-[30px] ${on ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`;
const LABEL = Object.fromEntries(ATTENTION.map((a) => [a.key, a.label]));

const money = (n, currency) => {
  if (n == null) return <Unrecorded reason="No ask is recorded on this round." />;
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(n); } catch { return String(n); }
};
const asksLine = (sum) => {
  const parts = sum.asks.map((a) => `${money(a.total, a.currency)} in asks`);
  if (sum.none) parts.push(`${sum.none} with none recorded`);
  return parts.length ? parts.join(' · ') : 'No round';
};

function Investors({ row }) {
  const line = investorsLine(row.investors);
  return line == null ? <Unrecorded reason="The invitations and commitments could not be counted." /> : <span className="text-[12px] leading-snug">{line}</span>;
}

/** Committed (DX12): the read counts who committed, never the amount, so the amount says Not recorded. */
function Committed({ row }) {
  const line = committedLine(row);
  return (
    <span className="flex flex-col items-end text-[12px] leading-snug">
      {line != null && <span>{line}</span>}
      <Unrecorded reason={COMMITTED_NOT_READ} />
    </span>
  );
}

function Days({ row, sla }) {
  const band = slaBand(row.daysInStage, sla);
  return <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] ${SLA_BAND_CLASS[band]}`}>{row.daysInStage == null ? 'Not recorded' : `${row.daysInStage}d`}</span>;
}

function Flags({ row, sla, testId }) {
  const keys = attentionOf(row, sla);
  if (!keys.length) return null;
  return <span className="flex flex-wrap gap-1" data-testid={testId}>{keys.map((k) => <span key={k} className={flag}>{LABEL[k]}</span>)}</span>;
}

/** A row's actions (DX12): Advance on the row, then More, a disclosure (not an ARIA menu); Escape closes it. */
function RowActions({ row, role, onPick }) {
  const [open, setOpen] = useState(false);
  const { primary, more } = splitActions(row, role);
  if (!primary && !more.length) return null;
  return (
    <div className="relative flex items-center justify-end gap-1" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
      {primary && (
        <button type="button" onClick={() => { setOpen(false); onPick('advance', row); }} data-testid={`studio-row-advance-${row.id}`}
          className="min-h-[44px] rounded-lg border border-axal-hairline px-2.5 text-[12.5px] font-semibold hover:bg-gray-50 md:min-h-[30px] dark:border-gray-700 dark:hover:bg-gray-800">{primary.label}</button>
      )}
      {more.length > 0 && (
        <button type="button" aria-expanded={open} aria-label={`More for ${row.name}: ${more.map((m) => m.label.replace('…', '')).join(', ')}`} onClick={() => setOpen((o) => !o)}
          className="min-h-[44px] min-w-[44px] rounded-lg px-2 text-[16px] font-bold text-axal-muted hover:bg-gray-50 md:min-h-[30px] md:min-w-[30px] dark:hover:bg-gray-800" data-testid={`studio-menu-${row.id}`}>⋯</button>
      )}
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 flex w-[200px] flex-col rounded-lg border border-axal-hairline bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900" data-testid={`studio-menu-${row.id}-list`}>
          {more.map((it) => (it.href
            ? <Link key={it.key} to={it.href} className="rounded-md px-2.5 py-2 text-[13px] font-semibold hover:bg-gray-50 dark:hover:bg-gray-800" data-testid={`studio-menu-${row.id}-${it.key}`}>{it.label}</Link>
            : <button key={it.key} type="button" onClick={() => { setOpen(false); onPick(it.key, row); }} className="rounded-md px-2.5 py-2 text-left text-[13px] font-semibold hover:bg-gray-50 dark:hover:bg-gray-800" data-testid={`studio-menu-${row.id}-${it.key}`}>{it.label}</button>))}
        </div>
      )}
    </div>
  );
}

function Card({ row, role, sla, onPick, scores }) {
  return (
    <li className="flex flex-col gap-1.5 rounded-xl border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900" data-testid={`studio-card-${row.id}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link to={`/deals/${row.id}`} className="block text-[14px] font-bold leading-snug underline-offset-2 hover:underline">{row.name}</Link>
          {row.sector && <span className="block text-[11.5px] text-axal-muted">{row.sector}</span>}
        </div>
        <span className={chip}>{row.round}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {row.source ? <span className={chip}>{row.source}</span> : <span className="text-[11.5px] text-axal-muted">Source not recorded</span>}
        {row.youLead && <span className={`${chip} border-violet-300 text-violet-700 dark:text-violet-300`} data-testid={`studio-you-lead-${row.id}`}>You lead this</span>}
      </div>
      {scores && <ScorecardCell scores={scores} testId={`studio-card-scorecard-${row.id}`} />}
      <span className="text-[12px]">{money(row.ask, row.currency)}</span>
      <Investors row={row} />
      <div className="flex items-center justify-between gap-2 text-[11.5px]">
        <Days row={row} sla={sla} />
        <span className="text-axal-muted">{row.youLead ? 'You' : row.lead || 'No owner'}</span>
      </div>
      <Flags row={row} sla={sla} testId={`studio-card-attention-${row.id}`} />
      <RowActions row={row} role={role} onPick={onPick} />
    </li>
  );
}

/** DLS11's board, kept as DX12's Board: the round's four columns, each with its count and asks. */
export function StudioBoard({ rows, role, sla, onPick }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="studio-board">
      {LENS_COLUMNS.map((status) => {
        const col = rows.filter((r) => r.status === status);
        const sum = columnSummary(col);
        return (
          <section key={status} aria-label={`${ROUND_WORD[status]}, ${sum.count} rounds`} className="flex min-w-0 flex-col gap-2 rounded-xl bg-gray-50 p-2 dark:bg-gray-950" data-testid={`studio-col-${status}`}>
            <div className="px-1">
              <div className="flex items-center justify-between"><h2 className="m-0 text-[13.5px] font-bold">{ROUND_WORD[status]}</h2><span className="font-mono text-[12px] font-semibold">{sum.count}</span></div>
              <span className="text-[11px] text-axal-muted">{asksLine(sum)}</span>
            </div>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {col.map((r) => <Card key={r.id} row={r} role={role} sla={sla} onPick={onPick} />)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * DX12's table: Company, Round status, Scorecard, Lead, Investors, Ask,
 * Committed, Source, Days, Attention, then the row's actions. Not raising
 * adds who set it. On a phone the same rows are cards.
 */
export function StudioTable({ rows, role, notRaising, onPick, sla = DEFAULT_SLA, isAdmin = false, phone = false, scoresFor = () => ({ state: 'loading' }) }) {
  if (!rows.length) {
    return <section className={box} data-testid="studio-empty"><p className="m-0 text-sm">{notRaising ? 'No round is Not raising here.' : 'No round matches this view.'}</p></section>;
  }
  const foot = isAdmin ? <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="studio-partner-foot">{PARTNER_FOOT}</p> : null;
  if (phone) {
    return (
      <section className="flex flex-col gap-2" data-testid="studio-table">
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map((r) => <Card key={r.id} row={r} role={role} sla={sla} onPick={onPick} scores={scoresFor(r.id)} />)}
        </ul>
        {foot}
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-2 overflow-hidden rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" data-testid="studio-table">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-left text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase text-gray-500 dark:text-gray-400">
              {TABLE_COLUMNS.map((c) => <th key={c} className={`px-2 py-2 ${c === 'Ask' || c === 'Committed' ? 'text-right' : ''}`}>{c}</th>)}
              {notRaising && <th className="px-2">Set by</th>}
              <th className="px-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 align-top dark:border-gray-800" data-testid={`studio-row-${r.id}`}>
                <td className="px-2 py-2">
                  <Link to={`/deals/${r.id}`} className="font-semibold underline">{r.name}</Link>
                  {r.youLead && <span className={`${chip} ml-1.5 border-violet-300 text-violet-700 dark:text-violet-300`}>You lead this</span>}
                  {r.sector && <span className="block text-[12px] text-axal-muted">{r.sector}</span>}
                </td>
                <td className="px-2 py-2"><span className={chip}>{r.round}</span></td>
                <td className="w-[110px] px-2 py-2"><ScorecardCell scores={scoresFor(r.id)} testId={`studio-scorecard-${r.id}`} /></td>
                <td className="px-2 py-2">{r.youLead ? 'You' : r.lead || <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11.5px] font-semibold dark:bg-gray-800">No owner</span>}</td>
                <td className="px-2 py-2"><Investors row={r} /></td>
                <td className="px-2 py-2 text-right">{money(r.ask, r.currency)}</td>
                <td className="px-2 py-2 text-right" data-testid={`studio-committed-${r.id}`}><Committed row={r} /></td>
                <td className="px-2 py-2">{r.source || <Unrecorded reason="No source is recorded on this round." />}</td>
                <td className="px-2 py-2"><Days row={r} sla={sla} /></td>
                <td className="px-2 py-2"><Flags row={r} sla={sla} testId={`studio-attention-${r.id}`} /></td>
                {notRaising && <td className="px-2 py-2 text-[12px]" data-testid={`studio-set-by-${r.id}`}>{notRaisingLine(r)}</td>}
                <td className="px-2 py-2 text-right"><RowActions row={r} role={role} onPick={onPick} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {foot && <div className="px-3 pb-3">{foot}</div>}
    </section>
  );
}

/** DX12's stage strip: every round the read returned, by status; each tile filters to its status. */
function StageStrip({ counts, view }) {
  return (
    <nav aria-label="Rounds by status" className="grid grid-cols-3 gap-2 sm:grid-cols-5" data-testid="studio-stages">
      {STAGE_STRIP.map((s) => {
        const notRaising = s === 'rejected';
        const on = notRaising ? view.notRaising : view.stage === s;
        const to = on ? studioViewHref({ view: view.view }) : studioViewHref(notRaising ? { notRaising: true } : { view: view.view, stage: s });
        return (
          <Link key={s} to={to} aria-current={on ? 'true' : undefined} data-testid={`studio-stage-${s}`}
            className={`flex min-h-[44px] flex-col rounded-xl border px-3 py-2 ${on ? 'border-violet-400 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/40' : 'border-axal-hairline bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800'}`}>
            <small className="text-[11.5px] text-axal-muted dark:text-gray-400">{ROUND_WORD[s]}</small>
            <b className="font-mono text-[20px] leading-tight">{counts[s]}</b>
          </Link>
        );
      })}
    </nav>
  );
}

/** DX12's Needs attention strip. A zero is a count the read backs, so it shows, but filters nothing. */
function AttentionStrip({ counts, view }) {
  return (
    <section aria-label="Needs attention" className="flex flex-wrap items-center gap-2 rounded-xl border border-axal-hairline bg-white px-4 py-2.5 dark:border-gray-800 dark:bg-gray-900" data-testid="studio-attention">
      <b className="text-[13px]">Needs attention</b>
      {ATTENTION.map((a) => {
        const n = counts[a.key];
        const on = view.attention === a.key;
        const words = attentionChip(a.key, n);
        if (!n && !on) return <span key={a.key} title={a.rule} className="inline-flex min-h-[44px] items-center rounded-full border border-axal-hairline px-3 text-[12.5px] text-axal-muted md:min-h-[30px] dark:border-gray-700 dark:text-gray-500" data-testid={`studio-attention-${a.key}`}>{words}</span>;
        return (
          <Link key={a.key} to={studioViewHref({ view: view.view, stage: view.stage, attention: on ? null : a.key })} title={a.rule} aria-current={on ? 'true' : undefined} data-testid={`studio-attention-${a.key}`}
            className={`inline-flex min-h-[44px] items-center rounded-full border px-3 text-[12.5px] font-semibold md:min-h-[30px] ${on ? 'border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-300' : 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 dark:text-amber-200'}`}>{words}</Link>
        );
      })}
    </section>
  );
}

/** While the rounds are read: the two strips and the rows in their own shape. */
function LensSkeleton() {
  const bar = 'animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800';
  return (
    <div className="flex flex-col gap-3" aria-busy="true" data-testid="studio-loading">
      <span className="sr-only">Reading the rounds…</span>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{STAGE_STRIP.map((s) => <div key={s} className={`${bar} h-[58px]`} />)}</div>
      <div className={`${bar} h-[48px]`} />
      <div className={`${bar} h-[220px]`} />
    </div>
  );
}

/** Advance (DLS11): says where the round goes before anything moves. */
function AdvanceDialog({ row, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const to = ROUND_WORD[nextStatus(row.status)];
  const go = async () => {
    setBusy(true); setRefusal(null);
    try { await api.advanceDeal(row.id, row.status); onDone(`${row.name} moved to ${to}.`); } catch (e) { reportError('StudioLens:advance', e); setRefusal(e?.message || 'The round did not move. Nothing changed.'); setBusy(false); }
  };
  return (
    <Lightbox phone="sheet" label={`Move ${row.name} to ${to}?`} title={`Move ${row.name} to ${to}?`} onClose={() => { if (!busy) onClose(); }} testId="studio-advance"
      footer={(
        <div className="flex flex-col gap-2">
          <div className="flex justify-end gap-2">
            <button type="button" className={actionGhost} onClick={onClose} disabled={busy}>Back</button>
            <button type="button" className={actionPrimary} onClick={go} disabled={busy} data-testid="studio-advance-go">{busy ? 'Moving…' : 'Move'}</button>
          </div>
          {refusal && <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="studio-advance-refusal">{refusal}</p>}
        </div>
      )}>
      <p className="m-0 px-5 py-4 text-[13px] leading-normal">{`${row.name} moves from ${row.round} to ${to} for every investor, and the founder is told.`}</p>
    </Lightbox>
  );
}

function TermsDialog({ row, onClose, onDone }) {
  return (
    <Sheet phone="sheet" label={`Edit the terms of ${row.name}`} title={`Edit the terms of ${row.name}`} onClose={onClose} testId="studio-terms">
      <div className="px-5 py-4">
        <DealTermsEditor deal={{ id: row.id, ...row.terms, source: row.source }} onDone={() => onDone(`The terms of ${row.name} were saved.`)} onCancel={onClose} />
      </div>
    </Sheet>
  );
}

function useRead(fn, deps) {
  const [state, setState] = useState({ kind: 'loading', data: null });
  const load = useCallback(async () => {
    setState((s) => (s.kind === 'ok' ? s : { kind: 'loading', data: null }));
    try { setState({ kind: 'ok', data: await fn() }); } catch (e) { reportError('StudioLens:read', e); setState({ kind: 'unreadable', data: null }); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return [state, load];
}

/** /deals for an admin or an Operating Partner. `view` comes from the address (`studioViewOf`); the Table is the default (DX12). */
export default function StudioLens({ role, view: given = {} }) {
  const view = { view: 'table', notRaising: false, intakeOnly: false, stage: null, attention: null, ...given };
  const isAdmin = role === 'admin';
  const phone = usePhoneWidth();
  const [lens, reloadLens] = useRead(() => dealFlowApi.studio(), []);
  const [stage, reloadStage] = useRead(() => api.dealStageAnalytics(), []);
  const [passReason, setPassReason] = useState(null);
  const [passes, reloadPasses] = useRead(() => api.dealPassAnalytics(passReason || undefined), [passReason]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [done, setDone] = useState(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [sla, setSla] = useState(() => safeReadJSON('dealFlowSla', DEFAULT_SLA) || DEFAULT_SLA);
  const chooseSla = (key) => { setSla(key); safeWriteJSON('dealFlowSla', key); };

  useEffect(() => { document.title = `${TITLE} — axal`; }, []);

  const all = lens.kind === 'ok' && Array.isArray(lens.data?.rows) ? lens.data.rows.map(studioRow) : null;
  const rows = all ? lensRows(all, { notRaising: view.notRaising, intakeOnly: view.intakeOnly, stage: view.stage, attention: view.attention, sla, q }) : null;
  const lensIds = all ? all.map((r) => Number(r.id)).filter((n) => Number.isInteger(n) && n > 0) : [];
  const [batch] = useRead(() => (lensIds.length ? ventureScoresApi.batch(lensIds) : Promise.resolve({ items: [] })), [lensIds.join(',')]);
  const scoresFor = (id) => scoresOf(batch.kind === 'ok' ? batch.data : batch.kind === 'unreadable' ? 'failed' : null, id);
  const notice = lens.kind === 'ok' ? intakeNotice(lens.data?.intake_not_raising) : null;
  const finished = (line) => { setOpen(null); setDone(line); reloadLens(); reloadStage(); reloadPasses(); };
  const pick = (key, row) => { setDone(null); setOpen({ key, row }); };
  const board = !view.notRaising && view.view === 'board';

  let body;
  if (lens.kind === 'loading') body = <LensSkeleton />;
  else if (lens.kind === 'unreadable' || !all) body = <section className={box} data-testid="studio-failed"><Unreadable what="The rounds" claim="That is not the same as having none." onRetry={reloadLens} /></section>;
  else {
    body = (
      <>
        <StageStrip counts={stageCounts(all)} view={view} />
        {!view.notRaising && <AttentionStrip counts={attentionCounts(all, sla)} view={view} />}
        {board
          ? <StudioBoard rows={rows} role={role} sla={sla} onPick={pick} />
          : <StudioTable rows={rows} role={role} notRaising={view.notRaising} onPick={pick} sla={sla} isAdmin={isAdmin} phone={phone} scoresFor={scoresFor} />}
      </>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="studio-lens">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[.07em] text-axal-muted"><span className="text-violet-700 dark:text-violet-300">{CRUMB}</span> › {TITLE}</div>
          <h1 className="m-0 mt-2 text-[24px] font-extrabold tracking-[-.02em]">{TITLE}</h1>
          <p className="m-0 mt-1.5 max-w-[760px] text-[13px] text-axal-muted dark:text-gray-400">{STUDIO_LINE}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="View" className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800" data-testid="studio-view">
            <Link to={studioViewHref({ view: 'board', stage: view.stage, attention: view.attention })} aria-current={board ? 'page' : undefined} className={seg(board)} data-testid="studio-view-board">Board</Link>
            <Link to={studioViewHref({ view: 'table', stage: view.stage, attention: view.attention, notRaising: view.notRaising, intakeOnly: view.intakeOnly })} aria-current={!board ? 'page' : undefined} className={seg(!board)} data-testid="studio-view-table">Table</Link>
          </nav>
          {isAdmin && <button type="button" className={actionPrimary} onClick={() => setDraftOpen(true)} data-testid="studio-draft">Draft a deal</button>}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3" data-testid="studio-toolbar">
        <label className="flex min-w-[220px] flex-1 flex-col">
          <span className="sr-only">Search companies, sectors, partners</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies, sectors, partners" className="h-11 rounded-lg border border-axal-hairline bg-white px-3 text-[13px] md:h-9 dark:border-gray-700 dark:bg-gray-900" data-testid="studio-search" />
        </label>
        {(view.stage || view.attention || view.notRaising) && <Link to={studioViewHref({ view: view.view })} className="inline-flex min-h-[44px] items-center text-[13px] font-semibold underline md:min-h-0" data-testid="studio-clear">Every open round</Link>}
      </div>

      {notice && (
        <p className="m-0 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="studio-intake-notice">
          {notice}
          <Link to={studioViewHref({ notRaising: true, intakeOnly: true })} className="font-semibold underline" data-testid="studio-intake-review">Review them</Link>
        </p>
      )}
      {!isAdmin && <p className="m-0 rounded-lg border border-axal-hairline bg-gray-50 px-3.5 py-2.5 text-[13px] dark:border-gray-700 dark:bg-gray-800" data-testid="studio-partner-note">{PARTNER_NOTE}</p>}
      {done && <p role="status" className="m-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] font-semibold dark:border-emerald-900 dark:bg-emerald-950/40" data-testid="studio-done">{done}</p>}

      {body}

      <SlaPicker sla={sla} chooseSla={chooseSla} />
      {stage.kind === 'unreadable'
        ? <section className={box}><Unreadable what="The stage funnel" claim="That is not the same as no moves." onRetry={reloadStage} /></section>
        : <StageFunnelPanel stageAnalytics={stage.kind === 'ok' ? stage.data : null} />}
      {passes.kind === 'unreadable'
        ? <section className={box}><Unreadable what="Why we passed" claim="That is not the same as no passes." onRetry={reloadPasses} /></section>
        : passes.kind === 'ok' && <PassAnalyticsPanel stats={passes.data} active={passReason} onQuery={(r) => setPassReason((cur) => (cur === r ? null : r))} />}

      {open?.key === 'advance' && <AdvanceDialog row={open.row} onClose={() => setOpen(null)} onDone={finished} />}
      {open?.key === 'pass' && (
        <PassModal deal={{ id: open.row.id, project_name: open.row.name, status: open.row.round, days_in_stage: open.row.daysInStage }} closes={PASS_CLOSES}
          onClose={() => setOpen(null)}
          onConfirm={async ({ reason, note }) => { await api.passDeal(open.row.id, { reason, note }); finished(`${open.row.name} is Not raising. The round is closed for every investor, and the founder is told.`); }} />
      )}
      {open?.key === 'terms' && <TermsDialog row={open.row} onClose={() => setOpen(null)} onDone={finished} />}
      {draftOpen && <DraftDealModal onClose={() => setDraftOpen(false)} onCreated={() => { setDraftOpen(false); finished('The deal was drafted.'); }} />}
    </div>
  );
}

/** The /deals route for an admin or an Operating Partner: the view is the address's. */
export function StudioLensRoute({ role }) {
  const { search } = useLocation();
  return <StudioLens role={role} view={studioViewOf(search)} />;
}
