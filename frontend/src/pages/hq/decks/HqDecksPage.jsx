import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card, Lightbox } from '../../../ui';
import AdminPageHeader, { HeaderTab } from '../../../ui/AdminPageHeader';
import { deckReportsApi } from '../../../lib/api/deckReports';
import { adminFeatureFlagsApi } from '../../../lib/api/adminFeatureFlags';
import { adminDeckBetaApi } from '../../../lib/api/adminDeckBeta';
import { hqDeckStageNormsApi } from '../../../lib/api/hqDeckStageNorms';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { isSuperAdminUser } from '../../../lib/shellRole';
import AiModelsTab from './AiModelsTab';
import DeckGridTab from './DeckGridTab';
import { useAuth } from '../../../hooks/useAuthSync';
import {
  BETA_ADD_LINE, BETA_COLUMNS, BETA_REMOVE_LINE, BUILD, MODELS_LINK, NORM_ADD_LINE, NORM_COLUMNS, NORM_RETIRE_LINE, NORM_RULE, NORM_SOURCE_HELP, NORM_STAGE_OF, NOTE_MAX, NOT_RECORDED, OUTCOMES, PROJECT_NORMS_NOTE, PROPOSAL_LINE, REASONS, STAGES, SUBTITLE,
  addArmed, betaChoices, cohortRow, defaultOnKeys, filterReports, flagLabel, flagRows, normBody, normDraftArmed, normRetireArmed, normRow, notYet, offGridOverrides, reasonOk, reportRow, resolveArmed, templateChangeArmed, templateGrid, templatePreview, templateResetArmed, viewFor,
} from './hqDecksModel';

/**
 * D4155 (#4155) — HQ › Decks (HD1–HD6), a Platform tab after Promo codes at
 * `/admin/platform/decks`, HQ only (`hqOnly`).
 *
 * THE LIVE READS AND WRITES, each on a mounted route:
 *   Reports            GET  /api/admin/deck-reports?status=   (requireHqAdmin, D1540)
 *                      POST /api/admin/deck-reports/:uid/resolve  { outcome, note }
 *   Feature flags      GET  /api/admin/feature-flags          (requireAdmin, D1509)
 *   Beta cohort        GET/POST /api/admin/deck-beta, GET /people, DELETE /:uid (requireHqAdmin, K3 #4190)
 *   Default templates  GET  /api/decks/admin/recommend-overrides  (any admin, D905)
 *                      PUT / DELETE the same, { reason }        (Super Admin, K4 #4191)
 *   Stage norms        GET/POST /api/admin/deck-stage-norms, PUT /:uid, POST /:uid/retire,
 *                      GET /projects/:id (requireHqAdmin, K5 #4192)
 *   AI models          GET/PUT /api/admin/ai/element-models (a Super Admin on HQ, D4251 #4251)
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
function ReadFailed({ what, claim, onRetry, testId }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] text-red-700 dark:text-red-300" data-testid={testId}>
      <span><strong>Could not be read.</strong> {what} did not load. {claim}</span>
      <button type="button" className={BTN} onClick={onRetry}>Try again</button>
    </div>
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
      {!BUILD.K1.live && (isNR(row.founder) || isNR(row.before)) && <p className={`${MUTED} mt-2`} data-testid="deck-report-k1">{notYet('K1')}</p>}
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
  else if (reply === null) body = <ReadFailed what="The reports" claim="That is not the same as no reports." onRetry={retry} testId="deck-reports-unreadable" />;
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
  if (reply === null) return <Card><ReadFailed what="The feature flags" claim="That is not the same as every feature being off." onRetry={retry} testId="deck-flags-unreadable" /></Card>;
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

/** HD3: "Add people", found by name, the features to give them, and the reason. */
function AddPeople({ keys, onDone, onClose }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState([]);
  const [picked, setPicked] = useState([]);
  const [features, setFeatures] = useState([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    if (query.trim().length < 2) { setFound([]); return undefined; }
    adminDeckBetaApi.people(query.trim()).then((r) => { if (live) setFound(Array.isArray(r?.people) ? r.people : []); },
      (e) => { reportError('hq-decks:beta-search', e); if (live) setFound([]); });
    return () => { live = false; };
  }, [query]);
  const toggle = (list, set, v) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const armed = addArmed({ people: picked, features, reason });
  const add = async () => {
    if (!armed) return;
    setBusy(true); setError(null);
    try { await adminDeckBetaApi.add(picked.map((p) => p.uid), features, reason.trim()); onDone(); }
    catch (e) { setError(e?.message || 'They could not be added. Nothing was changed.'); reportError('hq-decks:beta-add', e); }
    finally { setBusy(false); }
  };
  return (
    <Lightbox label="Add people" title="Add people" width={560} onClose={() => !busy && onClose()} testId="deck-beta-add"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={PRIMARY} onClick={add} disabled={busy || !armed} data-testid="deck-beta-add-confirm">{busy ? 'Adding…' : `Add ${picked.length || ''}`.trim()}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        <p className={MUTED}>{BETA_ADD_LINE}</p>
        <input className={INPUT} placeholder="Find people by name" aria-label="Find people by name" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="deck-beta-search" />
        <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="deck-beta-found">
          {found.map((p) => (
            <li key={p.uid}>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={picked.some((x) => x.uid === p.uid)} onChange={() => setPicked((l) => (l.some((x) => x.uid === p.uid) ? l.filter((x) => x.uid !== p.uid) : [...l, p]))} data-testid={`deck-beta-pick-${p.uid}`} />
                <span className="font-semibold">{p.name}</span>
                <span className={MUTED}>{[p.company, p.role].filter(Boolean).join(' · ')}</span>
              </label>
            </li>
          ))}
        </ul>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-[13px] font-semibold">Features</legend>
          {betaChoices(keys).map((k) => (
            <label key={k.key} className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={features.includes(k.key)} onChange={() => toggle(features, setFeatures, k.key)} data-testid={`deck-beta-feature-${k.key}`} />
              {k.label}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="font-semibold">Reason <span className={MUTED}>(kept in the admin audit)</span></span>
          <textarea className={INPUT} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="deck-beta-reason" />
        </label>
        {error ? <p role="alert" className="text-[12.5px] text-red-700 dark:text-red-300">{error}</p> : null}
      </div>
    </Lightbox>
  );
}

/** HD3b: "Remove…", with the reason; what they made stays. */
function RemovePerson({ row, onDone, onClose }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const remove = async () => {
    if (!reasonOk(reason)) return;
    setBusy(true); setError(null);
    try { await adminDeckBetaApi.remove(row.uid, reason.trim()); onDone(); }
    catch (e) { setError(e?.message || 'They could not be removed. Nothing was changed.'); reportError('hq-decks:beta-remove', e); }
    finally { setBusy(false); }
  };
  return (
    <Lightbox label={`Remove ${row.name}`} title={`Remove ${row.name} from the beta`} width={480} onClose={() => !busy && onClose()} testId="deck-beta-remove"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={PRIMARY} onClick={remove} disabled={busy || !reasonOk(reason)} data-testid="deck-beta-remove-confirm">{busy ? 'Removing…' : 'Remove'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        <p className={MUTED}>{BETA_REMOVE_LINE}</p>
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="font-semibold">Reason <span className={MUTED}>(kept in the admin audit)</span></span>
          <textarea className={INPUT} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="deck-beta-remove-reason" />
        </label>
        {error ? <p role="alert" className="text-[12.5px] text-red-700 dark:text-red-300">{error}</p> : null}
      </div>
    </Lightbox>
  );
}

function Beta() {
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState(null);
  const [reply, retry] = useRead(() => adminDeckBetaApi.list({ q }), [q]);
  const close = () => setSheet(null);
  const done = () => { setSheet(null); retry(); };
  const keys = reply?.keys || [];
  return (
    <Card data-testid="hq-decks-beta">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className={`${INPUT} max-w-[280px]`} placeholder="Name or company" aria-label="Filter by name or company" value={q} onChange={(e) => setQ(e.target.value)} data-testid="deck-beta-filter" />
        <button type="button" className={PRIMARY} onClick={() => setSheet({ kind: 'add' })} disabled={reply === undefined || reply === null} data-testid="deck-beta-add-open">Add people</button>
      </div>
      {reply === undefined ? <Reading testId="deck-beta-reading" /> : null}
      {reply === null ? <ReadFailed what="The beta cohort" claim="That is not the same as nobody being in it." onRetry={retry} testId="deck-beta-unreadable" /> : null}
      {reply ? (
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full" data-testid="deck-beta-table">
            <thead><tr>{[...BETA_COLUMNS, ''].map((c) => <th key={c || 'act'} className={TH}>{c || <span className="sr-only">Remove</span>}</th>)}</tr></thead>
            <tbody>
              {(reply.people || []).map((p) => {
                const r = cohortRow(p, keys);
                return (
                  <tr key={r.uid} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`deck-beta-row-${r.uid}`}>
                    <td className={TD}><span className="font-semibold">{r.name}</span>{r.company && <><br /><span className={MUTED}>{r.company}</span></>}</td>
                    <td className={TD}>{r.features.join(', ')}</td>
                    <td className={TD}><Cell v={r.by} /> · {r.at ? day(r.at) : <Cell v={NOT_RECORDED} />}</td>
                    <td className={TD}><button type="button" className={BTN} onClick={() => setSheet({ kind: 'remove', row: r })} data-testid={`deck-beta-remove-${r.uid}`}>Remove…</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!(reply.people || []).length ? <p className={`${MUTED} mt-2`} data-testid="deck-beta-empty">{q ? 'Nobody in the cohort matches.' : 'Nobody is in the beta cohort yet.'}</p> : null}
        </div>
      ) : null}
      <p className={`${MUTED} mt-2`}>People are found by name. Emails are never shown.</p>
      {sheet?.kind === 'add' && <AddPeople keys={keys} onDone={done} onClose={close} />}
      {sheet?.kind === 'remove' && <RemovePerson key={sheet.row.uid} row={sheet.row} onDone={done} onClose={close} />}
    </Card>
  );
}

// ── HD4 · Default templates ─────────────────────────────────────────────────

/**
 * HD4b: one cell's change sheet, the Super Admin's only. Pick a template, see
 * what it holds, give a reason; or give a reason and reset the cell to the
 * engine's own pick. Each write is one admin audit row with before and after.
 */
function TemplateSheet({ sector, cell, methods, onDone, onClose }) {
  const [methodId, setMethodId] = useState(cell.methodId || '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const preview = templatePreview(methods, methodId);
  const stageLabel = STAGES.find((s) => s.id === cell.stage)?.label ?? cell.stage;
  const run = async (write, failed) => {
    setBusy(true); setError('');
    try { await write(); onDone(); } catch (e) { setError(e?.message || failed); } finally { setBusy(false); }
  };
  const save = () => run(() => api.deckSetRecommendOverride({ sector, stage: cell.stage, method_id: methodId, reason: reason.trim() }), 'The template could not be changed.');
  const reset = () => run(() => api.deckResetRecommendOverride({ sector, stage: cell.stage, reason: reason.trim() }), 'The template could not be reset.');
  return (
    <Card data-testid="deck-template-sheet">
      <p className={H2}>Default template · {sector} · {stageLabel}</p>
      <p className={MUTED}>Now: {cell.template}{cell.changed ? ' (changed)' : ' (default)'}</p>
      <label className="mt-3 block text-[12px] font-semibold text-axal-ink dark:text-gray-200">
        Template
        <select className={`${SELECT} mt-1 block`} value={methodId} onChange={(e) => setMethodId(e.target.value)} data-testid="deck-template-select">
          <option value="">Choose a template</option>
          {methods.map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
        </select>
      </label>
      {methodId && (
        <div className="mt-2 rounded-md border border-axal-hairline p-2 dark:border-gray-800" data-testid="deck-template-preview">
          <p className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{preview.name}</p>
          {preview.bestFor && <p className={MUTED}>Best for {preview.bestFor}</p>}
          {preview.slides.length > 0
            ? <ol className="mt-1 list-decimal pl-5 text-[12.5px] text-axal-ink dark:text-gray-200">{preview.slides.map((t, i) => <li key={`${i}-${t}`}>{t}</li>)}</ol>
            : <p className={MUTED}>This template’s slides could not be read.</p>}
        </div>
      )}
      <label className="mt-3 block text-[12px] font-semibold text-axal-ink dark:text-gray-200">
        Reason · required, ten characters or more
        <textarea className={`${INPUT} mt-1`} rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this sector and stage should start here" data-testid="deck-template-reason" />
      </label>
      <p className={MUTED}>Founders can still pick any template. The change is recorded in the admin audit log with your reason.</p>
      {error && <p role="alert" className="text-[12.5px] text-red-700 dark:text-red-300">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={PRIMARY} disabled={busy || !templateChangeArmed({ methodId, current: cell.methodId, reason })} onClick={save} data-testid="deck-template-save">{busy ? 'Saving…' : 'Save'}</button>
        {cell.changed && <button type="button" className={BTN} disabled={busy || !templateResetArmed({ reason })} onClick={reset} data-testid="deck-template-reset">Reset to default</button>}
        <button type="button" className={BTN} disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </Card>
  );
}

function Templates({ superAdmin }) {
  const [reply, retry] = useRead(() => Promise.all([api.deckRecommendOverrides(), api.deckMethods().catch(() => null)]), []);
  const [open, setOpen] = useState(null);
  if (reply === undefined) return <Card><Reading testId="deck-templates-reading" /></Card>;
  if (reply === null) return <Card><ReadFailed what="The default templates" claim="That is not the same as no defaults." onRetry={retry} testId="deck-templates-unreadable" /></Card>;
  const [overrides, methodsReply] = reply;
  const methods = Array.isArray(methodsReply?.methods) ? methodsReply.methods : Array.isArray(methodsReply?.items) ? methodsReply.items : [];
  const grid = templateGrid(overrides, methods);
  const off = offGridOverrides(overrides);
  const openCell = open ? grid.find((r) => r.sector === open.sector)?.cells.find((c) => c.stage === open.stage) : null;
  return (
    <div className="space-y-4">
      <Card data-testid="hq-decks-templates">
        <p className={`${MUTED} mb-1`}>Each sector and stage starts founders on one template. Founders can still pick any template.</p>
        {!superAdmin && <p className={`${MUTED} mb-3`} data-testid="deck-templates-why">Only the Super Admin changes a default template.</p>}
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
                      <span className={MUTED}>{c.changed ? <>Changed by <Cell v={c.by} />{c.at ? ` · ${day(c.at)}` : ''}</> : 'Default'}</span>
                      {superAdmin && (
                        <div className="mt-1 flex gap-1.5">
                          <button type="button" className={BTN} onClick={() => setOpen({ sector: row.sector, stage: c.stage })} data-testid={`deck-template-change-${row.sector}-${c.stage}`}>
                            {c.changed ? 'Change or reset' : 'Change'}
                          </button>
                        </div>
                      )}
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
      {superAdmin && openCell && (
        <TemplateSheet key={`${open.sector}|${open.stage}`} sector={open.sector} cell={openCell} methods={methods}
          onClose={() => setOpen(null)} onDone={() => { setOpen(null); retry(); }} />
      )}
    </div>
  );
}

// ── HD5 · Stage norms ───────────────────────────────────────────────────────

/** HD5b: add a norm, or edit one; every field but the unit and the review day is required, and so is a reason. */
function NormForm({ stage, norm, onDone, onClose }) {
  const stageLabel = STAGES.find((s) => s.id === stage)?.label ?? stage;
  const [f, setF] = useState(() => ({
    metric: norm?.metric ?? '', low: norm?.range?.low ?? '', high: norm?.range?.high ?? '', unit: norm?.range?.unit ?? '', source: norm?.source ?? '', reason: '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const armed = normDraftArmed(f);
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const body = normBody({ stage, ...f });
      if (norm) await hqDeckStageNormsApi.edit(norm.uid, body); else await hqDeckStageNormsApi.add(body);
      onDone();
    } catch (e) {
      setError(e?.message || 'The norm could not be saved.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card data-testid="deck-norm-form">
      <p className={H2}>{norm ? `Edit “${norm.metric}”` : `Add a ${stageLabel} norm`}</p>
      <p className={MUTED}>{NORM_ADD_LINE}</p>
      <label className="mt-3 block text-[12px] font-semibold text-axal-ink dark:text-gray-200">
        Metric
        <input className={`${INPUT} mt-1`} value={f.metric} onChange={set('metric')} placeholder="Net revenue retention" data-testid="deck-norm-metric" />
      </label>
      <fieldset className="mt-3">
        <legend className="text-[12px] font-semibold text-axal-ink dark:text-gray-200">Typical range · a low, a high or both</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          <input className={`${INPUT} w-24`} inputMode="decimal" value={f.low} onChange={set('low')} aria-label="Low" placeholder="100" data-testid="deck-norm-low" />
          <input className={`${INPUT} w-24`} inputMode="decimal" value={f.high} onChange={set('high')} aria-label="High" placeholder="120" data-testid="deck-norm-high" />
          <input className={`${INPUT} w-28`} value={f.unit} onChange={set('unit')} aria-label="Unit" placeholder="%" data-testid="deck-norm-unit" />
        </div>
      </fieldset>
      <label className="mt-3 block text-[12px] font-semibold text-axal-ink dark:text-gray-200">
        Source
        <input className={`${INPUT} mt-1`} value={f.source} onChange={set('source')} placeholder="Public seed benchmarks report · 2026" data-testid="deck-norm-source" />
      </label>
      <p className={MUTED}>{NORM_SOURCE_HELP}</p>
      <label className="mt-3 block text-[12px] font-semibold text-axal-ink dark:text-gray-200">
        {norm ? 'Why change it?' : 'Why add it?'} · required, ten characters or more
        <textarea className={`${INPUT} mt-1`} rows={2} maxLength={500} value={f.reason} onChange={set('reason')} data-testid="deck-norm-reason" />
      </label>
      {error && <p role="alert" className="text-[12.5px] text-red-700 dark:text-red-300">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={BTN} disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className={PRIMARY} disabled={busy || !armed} onClick={submit} data-testid="deck-norm-save">{busy ? 'Saving…' : norm ? 'Save' : 'Add norm'}</button>
      </div>
    </Card>
  );
}

/** HD5b: retire a norm with a reason. */
function RetireNorm({ norm, onDone, onClose }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true); setError('');
    try { await hqDeckStageNormsApi.retire(norm.uid, { reason: reason.trim() }); onDone(); } catch (e) { setError(e?.message || 'The norm could not be retired.'); } finally { setBusy(false); }
  };
  return (
    <Card data-testid="deck-norm-retire">
      <p className={H2}>Retire “{norm.metric}”?</p>
      <p className={MUTED}>{NORM_RETIRE_LINE}</p>
      <label className="mt-3 block text-[12px] font-semibold text-axal-ink dark:text-gray-200">
        Why retire it? · required, ten characters or more
        <textarea className={`${INPUT} mt-1`} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="deck-norm-retire-reason" />
      </label>
      {error && <p role="alert" className="text-[12.5px] text-red-700 dark:text-red-300">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={BTN} disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className="rounded-lg bg-red-700 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60" disabled={busy || !normRetireArmed({ reason })} onClick={submit} data-testid="deck-norm-retire-button">Retire</button>
      </div>
    </Card>
  );
}

/** HD5's side panel: one venture's own norms, read-only, the setters by name. */
function ProjectNorms() {
  const [id, setId] = useState('');
  const [reply, setReply] = useState(null);
  const [error, setError] = useState('');
  const open = async () => {
    setError(''); setReply(undefined);
    try { setReply(await hqDeckStageNormsApi.projectNorms(id.trim())); } catch (e) { setReply(null); setError(e?.message || 'That venture’s norms could not be read.'); }
  };
  return (
    <Card data-testid="deck-project-norms">
      <p className={H2}>A venture’s own norms</p>
      <p className={MUTED}>{PROJECT_NORMS_NOTE}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input className={`${INPUT} w-32`} inputMode="numeric" value={id} onChange={(e) => setId(e.target.value)} aria-label="Venture id" placeholder="Venture id" data-testid="deck-project-norms-id" />
        <button type="button" className={BTN} disabled={!/^\d+$/.test(id.trim())} onClick={open}>Open · read only</button>
      </div>
      {reply === undefined && <Reading testId="deck-project-norms-reading" />}
      {error && <p role="alert" className="mt-2 text-[12.5px] text-red-700 dark:text-red-300">{error}</p>}
      {reply && (
        <div className="mt-3">
          <p className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{reply.project?.name ?? NOT_RECORDED}</p>
          {reply.norms?.length ? (
            <table className="mt-1 w-full">
              <thead><tr>{['Metric', 'Their target', 'Source', 'Set by'].map((c) => <th key={c} className={TH}>{c}</th>)}</tr></thead>
              <tbody>
                {reply.norms.map((n) => (
                  <tr key={n.uid} className="border-t border-axal-hairline dark:border-gray-800">
                    <td className={TD}>{n.metric}</td><td className={TD}>{n.value}</td><td className={TD}>{n.source}</td>
                    <td className={TD}><Cell v={n.set_by?.name ?? NOT_RECORDED} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className={MUTED}>This venture has recorded no norms of its own.</p>}
          {reply.last_changed && <p className={`${MUTED} mt-2`}>Last changed by <Cell v={reply.last_changed.by?.name ?? NOT_RECORDED} /> on {day(reply.last_changed.at)}.</p>}
        </div>
      )}
    </Card>
  );
}

function Norms() {
  const [stage, setStage] = useState('seed');
  const [sheet, setSheet] = useState(null);
  const [reply, retry] = useRead(() => hqDeckStageNormsApi.list({ stage: NORM_STAGE_OF[stage] }), [stage]);
  const close = () => setSheet(null);
  const done = () => { setSheet(null); retry(); };
  const stageLabel = STAGES.find((s) => s.id === stage)?.label ?? stage;
  const norms = Array.isArray(reply?.norms) ? reply.norms : [];
  return (
    <div className="space-y-4">
      <Card data-testid="hq-decks-norms">
        <div className="flex flex-wrap items-center gap-2">
          {STAGES.map((s) => (
            <button key={s.id} type="button" aria-pressed={s.id === stage} onClick={() => setStage(s.id)} data-testid={`deck-norms-stage-${s.id}`}
              className={`rounded-full border px-2 py-0.5 text-[12px] ${s.id === stage ? 'border-axal-violet text-axal-violet-deep dark:text-violet-300' : 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400'}`}>{s.label}</button>
          ))}
          <button type="button" className={PRIMARY} onClick={() => setSheet({ kind: 'add' })} data-testid="deck-norm-add">Add norm</button>
        </div>
        <div className="mt-3 overflow-auto">
          {reply === undefined ? <Reading testId="deck-norms-reading" />
            : reply === null ? <ReadFailed what={`The ${stageLabel} norms`} claim="That is not the same as no norms." onRetry={retry} testId="deck-norms-unreadable" />
              : (
                <table className="w-full" aria-label={`${stageLabel} norms`} data-testid="deck-norms-table">
                  <thead><tr>{[...NORM_COLUMNS, ''].map((c) => <th key={c || 'actions'} className={TH}>{c}</th>)}</tr></thead>
                  <tbody>
                    {norms.length === 0 && <tr><td className={`${TD} ${MUTED}`} colSpan={5}>No {stageLabel} norms yet. The critic cites none from HQ for this stage.</td></tr>}
                    {norms.map((n) => {
                      const r = normRow(n);
                      return (
                        <tr key={r.uid} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`deck-norm-${r.uid}`}>
                          <td className={`${TD} ${r.retired ? 'text-axal-muted line-through dark:text-gray-500' : 'font-semibold'}`}>{r.metric}</td>
                          <td className={`${TD} font-mono`}><Cell v={r.range} /></td>
                          <td className={TD}>{r.retired ? <span className={MUTED}>{r.retiredLine}</span> : <Cell v={r.source} />}</td>
                          <td className={TD}>{r.retired ? <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] text-axal-muted dark:border-gray-700 dark:text-gray-400">Retired</span> : <Cell v={r.reviewed} />}</td>
                          <td className={TD}>
                            {!r.retired && (
                              <div className="flex gap-1.5">
                                <button type="button" className={BTN} onClick={() => setSheet({ kind: 'edit', norm: n })} data-testid={`deck-norm-edit-${r.uid}`}>Edit</button>
                                <button type="button" className={BTN} onClick={() => setSheet({ kind: 'retire', norm: n })} data-testid={`deck-norm-retire-${r.uid}`}>Retire</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
        </div>
        <p className={`${MUTED} mt-2`}>{NORM_RULE}</p>
      </Card>
      {sheet?.kind === 'add' && <NormForm key={`add-${stage}`} stage={stage} onDone={done} onClose={close} />}
      {sheet?.kind === 'edit' && <NormForm key={`edit-${sheet.norm.uid}`} stage={stage} norm={sheet.norm} onDone={done} onClose={close} />}
      {sheet?.kind === 'retire' && <RetireNorm key={`retire-${sheet.norm.uid}`} norm={sheet.norm} onDone={done} onClose={close} />}
      <ProjectNorms />
    </div>
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
      <HeaderTab to="/admin/platform/decks/models" end data-testid="hq-decks-tab-ai-models">AI models</HeaderTab>
      <HeaderTab to="/admin/platform/decks/grid" end data-testid="hq-decks-tab-grid">Grid health</HeaderTab>
      <HeaderTab to="/admin/platform/decks/funnel" end data-testid="hq-decks-tab-funnel">Funnel</HeaderTab>
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
      {view === 'models' ? <AiModelsTab /> : null}
      {view === 'grid' || view === 'funnel' ? <DeckGridTab view={view} /> : null}
      <p className={MUTED}>The deck model defaults and locks stay on <Link to={MODELS_LINK.to} className="font-semibold text-axal-violet-deep underline dark:text-violet-300">AI usage</Link>.</p>
    </div>
  );
}
