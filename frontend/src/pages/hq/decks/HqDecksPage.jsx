import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card } from '../../../ui';
import AdminPageHeader, { HeaderTab } from '../../../ui/AdminPageHeader';
import { deckReportsApi } from '../../../lib/api/deckReports';
import { adminFeatureFlagsApi } from '../../../lib/api/adminFeatureFlags';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { useAuth } from '../../../hooks/useAuthSync';
import {
  BETA_COLUMNS, MODELS_LINK, NORM_COLUMNS, NORM_RULE, NOT_RECORDED, NOTE_MAX, OUTCOMES, PROPOSAL_LINE, REASONS, STAGES, SUBTITLE,
  defaultOnKeys, filterReports, flagLabel, flagRows, notYet, offGridOverrides, reportRow, resolveArmed, templateGrid, viewFor,
} from './hqDecksModel';

/**
 * D4155 (#4155) — HQ › Decks (HD1–HD6), a Platform tab after Promo codes at
 * `/admin/platform/decks`, HQ only (`hqOnly`).
 *
 * THREE READS AND ONE WRITE ARE LIVE, each on a route main already mounts:
 *   Reports            GET  /api/admin/deck-reports?status=   (requireHqAdmin, D1540)
 *                      POST /api/admin/deck-reports/:uid/resolve  { outcome, note }
 *   Feature flags      GET  /api/admin/feature-flags          (requireAdmin, D1509)
 *   Default templates  GET  /api/decks/admin/recommend-overrides  (any admin, D905)
 * Every other control waits for its build task (K1–K5, #4188–#4192): it is
 * drawn disabled with the reason, so nothing claims an audited change the
 * Worker does not yet record. When a task lands its builder flips
 * `BUILD[key].live` in the model and wires the control.
 */

const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const H2 = 'text-[14px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100';
const TH = 'sticky top-0 bg-white px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-axal-muted dark:bg-gray-900 dark:text-gray-400';
const TD = 'px-2 py-2 align-top text-[13px] text-axal-ink dark:text-gray-100';
const BTN = 'rounded-lg border border-axal-hairline px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200';
const PRIMARY = 'rounded-lg bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-60';
const INPUT = 'w-full rounded-md border border-axal-hairline bg-white px-2 py-1.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const SELECT = 'rounded-md border border-axal-hairline bg-white px-2 py-1 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

const isNR = (v) => v === NOT_RECORDED;
const Cell = ({ v }) => (isNR(v) ? <span className="italic text-gray-500 dark:text-gray-400">{v}</span> : <>{v}</>);
const day = (iso) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : NOT_RECORDED;
};

/** One read's three states: `undefined` reading, `null` unreadable, else the reply. */
function useRead(load, deps) {
  const [value, setValue] = useState(undefined);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setValue(undefined);
    load().then((v) => { if (live) setValue(v); }, (e) => { reportError('hq-decks:read', e); if (live) setValue(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return [value, useCallback(() => setTick((t) => t + 1), [])];
}

const Reading = ({ testId }) => <p className={MUTED} role="status" data-testid={testId}>Reading…</p>;

/** HD6b: a failed read is never an empty list. */
function Unreadable({ what, claim, onRetry, testId }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] text-red-700 dark:text-red-300" data-testid={testId}>
      <span><strong>Could not be read.</strong> {what} did not load. {claim}</span>
      <button type="button" className={BTN} onClick={onRetry}>Try again</button>
    </div>
  );
}

/** A board that waits on its build task, with its columns drawn and its controls off. */
function Waiting({ task, columns, testId, children }) {
  return (
    <Card data-testid={testId}>
      <p className={`${MUTED} mb-3`} data-testid={`${testId}-not-yet`}>{notYet(task)}</p>
      {columns && (
        <table className="w-full"><thead><tr>{columns.map((c) => <th key={c} className={TH}>{c}</th>)}</tr></thead></table>
      )}
      {children}
    </Card>
  );
}

// ── HD1 · Reports ───────────────────────────────────────────────────────────

function ResolveForm({ row, onDone }) {
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const armed = resolveArmed({ outcome, note });
  const submit = async () => {
    setBusy(true); setError('');
    try {
      await deckReportsApi.resolve(row.uid, { outcome, note: note.trim() });
      onDone();
    } catch (e) {
      setError(e?.message || 'The report could not be resolved.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2" data-testid="deck-report-resolve">
      <fieldset className="flex flex-wrap gap-3 text-[12.5px]">
        <legend className="sr-only">Outcome</legend>
        {OUTCOMES.map((o) => (
          <label key={o.id} className="flex items-center gap-1.5 text-axal-ink dark:text-gray-200">
            <input type="radio" name="outcome" value={o.id} checked={outcome === o.id} onChange={() => setOutcome(o.id)} /> {o.label}
          </label>
        ))}
      </fieldset>
      <label className="block text-[12px] font-semibold text-axal-ink dark:text-gray-200">
        Resolution note · required
        <textarea className={`${INPUT} mt-1`} rows={3} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you find, and what changed?" data-testid="deck-report-note" />
      </label>
      <p className={MUTED}>The founder sees this note on their report.</p>
      {error && <p role="alert" className="text-[12.5px] text-red-700 dark:text-red-300">{error}</p>}
      <button type="button" className={PRIMARY} disabled={!armed || busy} onClick={submit} data-testid="deck-report-resolve-button">{busy ? 'Resolving…' : 'Resolve'}</button>
    </div>
  );
}

function ReportSheet({ row, onResolved }) {
  return (
    <Card data-testid="deck-report-sheet">
      <p className={H2}>Report · <Cell v={row.deck} /></p>
      <p className={MUTED}><Cell v={row.card} /> · reported by <Cell v={row.founder} /></p>
      <dl className="mt-3 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
        <dt className="text-axal-muted dark:text-gray-400">Asked</dt><dd><Cell v={row.asked} /></dd>
        <dt className="text-axal-muted dark:text-gray-400">Model</dt><dd><Cell v={row.model} /></dd>
        <dt className="text-axal-muted dark:text-gray-400">Charged</dt><dd><Cell v={row.charged} /></dd>
        <dt className="text-axal-muted dark:text-gray-400">Before</dt><dd className="whitespace-pre-wrap"><Cell v={row.before} /></dd>
        <dt className="text-axal-muted dark:text-gray-400">After · the proposal</dt><dd className="whitespace-pre-wrap"><Cell v={row.after} /></dd>
        <dt className="text-axal-muted dark:text-gray-400">Founder’s reason</dt><dd>{row.reason}{row.note ? ` · “${row.note}”` : ''}</dd>
      </dl>
      {PROPOSAL_LINE[row.proposal] && <p className={`${MUTED} mt-2`}>{PROPOSAL_LINE[row.proposal]}</p>}
      {(isNR(row.founder) || isNR(row.before)) && <p className={`${MUTED} mt-2`} data-testid="deck-report-k1">{notYet('K1')}</p>}
      <div className="mt-3 border-t border-axal-hairline pt-3 dark:border-gray-800">
        {row.open
          ? <ResolveForm row={row} onDone={onResolved} />
          : <p className={MUTED}>Resolved{row.resolution ? `: “${row.resolution}”` : '.'}</p>}
      </div>
    </Card>
  );
}

function Reports() {
  const [status, setStatus] = useState('open');
  const [filters, setFilters] = useState({ model: '', reason: '', q: '' });
  const [openUid, setOpenUid] = useState(null);
  const [reply, retry] = useRead(() => deckReportsApi.queue(status), [status]);
  const rows = useMemo(() => (Array.isArray(reply?.reports) ? reply.reports.map(reportRow) : []), [reply]);
  const shownRows = filterReports(rows, filters);
  const models = [...new Set(rows.map((r) => r.model).filter((m) => !isNR(m)))];
  const open = rows.find((r) => r.uid === openUid) || null;
  let body;
  if (reply === undefined) body = <Reading testId="deck-reports-reading" />;
  else if (reply === null) body = <Unreadable what="The reports" claim="That is not the same as no reports." onRetry={retry} testId="deck-reports-unreadable" />;
  else if (!shownRows.length) {
    body = (
      <div className="py-6 text-center" data-testid="deck-reports-empty">
        <p className={H2}>{status === 'open' ? 'No open reports.' : 'No reports.'}</p>
        <p className={MUTED}>When a founder marks a result as bad, it appears here with the area before and after.</p>
        {status === 'open' && <button type="button" className={`${BTN} mt-2`} onClick={() => setStatus('resolved')}>Show resolved</button>}
      </div>
    );
  } else {
    body = (
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full" data-testid="deck-reports-table">
          <thead><tr>{['When', 'Deck and slide', 'What was asked', 'Model', 'Founder’s reason', 'Status'].map((c) => <th key={c} className={TH}>{c}</th>)}</tr></thead>
          <tbody>
            {shownRows.map((r) => (
              <tr key={r.uid} className="cursor-pointer border-t border-axal-hairline hover:bg-axal-ground dark:border-gray-800 dark:hover:bg-gray-800" onClick={() => setOpenUid(r.uid)} data-testid={`deck-report-${r.uid}`}>
                <td className={TD}>{day(r.when)}</td>
                <td className={TD}><Cell v={r.deck} /><br /><span className={MUTED}><Cell v={r.card} /> · <Cell v={r.founder} /></span></td>
                <td className={TD}><Cell v={r.asked} /></td>
                <td className={TD}><Cell v={r.model} /></td>
                <td className={TD}>{r.reason}{r.note ? <><br /><span className={MUTED}>“{r.note}”</span></> : null}</td>
                <td className={TD}>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]" data-testid="hq-decks-reports">
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input className={`${INPUT} max-w-xs`} placeholder="Search deck or founder" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} aria-label="Search deck or founder" />
          <select className={SELECT} value={status} onChange={(e) => { setStatus(e.target.value); setOpenUid(null); }} aria-label="Status">
            <option value="open">Status: open</option><option value="resolved">Status: resolved</option><option value="all">Status: all</option>
          </select>
          <select className={SELECT} value={filters.model} onChange={(e) => setFilters((f) => ({ ...f, model: e.target.value }))} aria-label="Model">
            <option value="">Model: any</option>{models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className={SELECT} value={filters.reason} onChange={(e) => setFilters((f) => ({ ...f, reason: e.target.value }))} aria-label="Reason">
            <option value="">Reason: any</option>{Object.values(REASONS).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        {body}
      </Card>
      {open ? <ReportSheet key={open.uid} row={open} onResolved={() => { setOpenUid(null); retry(); }} /> : null}
    </div>
  );
}

// ── HD2 · Feature flags ─────────────────────────────────────────────────────

function Flags() {
  const [reply, retry] = useRead(() => adminFeatureFlagsApi.list(), []);
  if (reply === undefined) return <Card><Reading testId="deck-flags-reading" /></Card>;
  if (reply === null) return <Card><Unreadable what="The feature flags" claim="That is not the same as every feature being off." onRetry={retry} testId="deck-flags-unreadable" /></Card>;
  const rows = flagRows(reply);
  const defaults = defaultOnKeys(reply);
  return (
    <Card data-testid="hq-decks-flags">
      <p className={`${MUTED} mb-3`} data-testid="deck-flags-not-yet">{notYet('K2')}</p>
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full" data-testid="deck-flags-table">
          <thead><tr>{['Feature', 'Scope', 'Last changed', 'On'].map((c) => <th key={c} className={TH}>{c}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-axal-hairline dark:border-gray-800">
                <td className={TD}><span className="font-semibold">{r.name}</span>{r.what && <><br /><span className={MUTED}>{r.what}</span></>}</td>
                <td className={TD}>{r.scope}</td>
                <td className={TD}><Cell v={r.by} /> · {r.at ? day(r.at) : <Cell v={NOT_RECORDED} />}</td>
                <td className={TD}><button type="button" className={BTN} disabled title={notYet('K2')} aria-pressed={r.on}>{r.on ? 'On' : 'Off'}</button></td>
              </tr>
            ))}
            {defaults.map((k) => (
              <tr key={k} className="border-t border-axal-hairline dark:border-gray-800" data-testid="deck-flag-default">
                <td className={TD}><span className="font-semibold">{flagLabel(k).name}</span></td>
                <td className={TD}>Everyone · the default</td>
                <td className={TD}><Cell v={NOT_RECORDED} /></td>
                <td className={TD}><button type="button" className={BTN} disabled title={notYet('K2')} aria-pressed>On</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`${MUTED} mt-3`}>Scope is Everyone, one role, or named people. With no row a feature is on for everyone. A change applies within a minute.</p>
    </Card>
  );
}

// ── HD3 · Beta cohort ───────────────────────────────────────────────────────

function Beta() {
  return (
    <Waiting task="K3" columns={BETA_COLUMNS} testId="hq-decks-beta">
      <div className="mt-3 flex gap-2">
        <button type="button" className={PRIMARY} disabled title={notYet('K3')}>Add people</button>
      </div>
      <p className={`${MUTED} mt-2`}>People are found by name. Emails are never shown.</p>
    </Waiting>
  );
}

// ── HD4 · Default templates ─────────────────────────────────────────────────

function Templates({ superAdmin }) {
  const [reply, retry] = useRead(() => Promise.all([api.deckRecommendOverrides(), api.deckMethods().catch(() => null)]), []);
  if (reply === undefined) return <Card><Reading testId="deck-templates-reading" /></Card>;
  if (reply === null) return <Card><Unreadable what="The default templates" claim="That is not the same as no defaults." onRetry={retry} testId="deck-templates-unreadable" /></Card>;
  const [overrides, methodsReply] = reply;
  const methods = Array.isArray(methodsReply?.methods) ? methodsReply.methods : Array.isArray(methodsReply?.items) ? methodsReply.items : [];
  const grid = templateGrid(overrides, methods);
  const off = offGridOverrides(overrides);
  const why = superAdmin ? notYet('K4') : 'Only the Super Admin changes a default template.';
  return (
    <Card data-testid="hq-decks-templates">
      <p className={`${MUTED} mb-1`}>Each sector and stage starts founders on one template. Founders can still pick any template.</p>
      <p className={`${MUTED} mb-3`} data-testid="deck-templates-why">{why}</p>
      <div className="overflow-auto">
        <table className="w-full" data-testid="deck-templates-grid">
          <thead><tr><th className={TH}>Sector</th>{STAGES.map((s) => <th key={s.id} className={TH}>{s.label}</th>)}</tr></thead>
          <tbody>
            {grid.map((row) => (
              <tr key={row.sector} className="border-t border-axal-hairline dark:border-gray-800">
                <td className={`${TD} font-semibold`}>{row.sector}</td>
                {row.cells.map((c) => (
                  <td key={c.stage} className={TD} data-testid={`deck-template-${row.sector}-${c.stage}`}>
                    <span className="font-semibold">{c.template}</span><br />
                    <span className={MUTED}>{c.changed ? <>Changed by <Cell v={c.by} /></> : 'Default'}</span>
                    <div className="mt-1 flex gap-1.5">
                      <button type="button" className={BTN} disabled title={why}>Change</button>
                      {c.changed && <button type="button" className={BTN} disabled title={why}>Reset to default</button>}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {off.length > 0 && (
        <p className={`${MUTED} mt-3`} data-testid="deck-templates-off-grid">
          Also set, outside this grid: {off.map((o) => `${o.sector} · ${o.stage}`).join(', ')}.
        </p>
      )}
    </Card>
  );
}

// ── HD5 · Stage norms ───────────────────────────────────────────────────────

function Norms() {
  return (
    <Waiting task="K5" columns={NORM_COLUMNS} testId="hq-decks-norms">
      <div className="mt-3 flex flex-wrap gap-2">
        {STAGES.map((s) => <span key={s.id} className="rounded-full border border-axal-hairline px-2 py-0.5 text-[12px] text-axal-muted dark:border-gray-700 dark:text-gray-400">{s.label}</span>)}
        <button type="button" className={PRIMARY} disabled title={notYet('K5')}>Add a norm</button>
      </div>
      <p className={`${MUTED} mt-2`}>{NORM_RULE}</p>
    </Waiting>
  );
}

export default function HqDecksPage() {
  const { pathname } = useLocation();
  const view = viewFor(pathname);
  const superAdmin = isSuperAdminUser(useAuth()?.user);
  const tabs = (
    <>
      <HeaderTab to={MODELS_LINK.to} end data-testid="hq-decks-tab-models">{MODELS_LINK.label}</HeaderTab>
      <HeaderTab to="/admin/platform/decks" end data-testid="hq-decks-tab-reports">Reports</HeaderTab>
      <HeaderTab to="/admin/platform/decks/flags" end data-testid="hq-decks-tab-flags">Feature flags</HeaderTab>
      <HeaderTab to="/admin/platform/decks/beta" end data-testid="hq-decks-tab-beta">Beta cohort</HeaderTab>
      <HeaderTab to="/admin/platform/decks/templates" end data-testid="hq-decks-tab-templates">Default templates</HeaderTab>
      <HeaderTab to="/admin/platform/decks/norms" end data-testid="hq-decks-tab-norms">Stage norms</HeaderTab>
    </>
  );
  return (
    <div className="space-y-4" data-testid="hq-decks-page" data-view={view}>
      <AdminPageHeader title="Decks" pills={[{ label: 'HQ only', tone: 'hq' }]} line={SUBTITLE} tabs={tabs} data-testid="hq-decks-header" />
      {view === 'reports' ? <Reports /> : null}
      {view === 'flags' ? <Flags /> : null}
      {view === 'beta' ? <Beta /> : null}
      {view === 'templates' ? <Templates superAdmin={superAdmin} /> : null}
      {view === 'norms' ? <Norms /> : null}
      <p className={MUTED}>The deck model defaults and locks stay on <Link to={MODELS_LINK.to} className="font-semibold text-axal-violet-deep underline dark:text-violet-300">AI usage</Link>.</p>
    </div>
  );
}
