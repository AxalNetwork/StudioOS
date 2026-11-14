import { useCallback, useEffect, useState } from 'react';
import Lightbox from '../../ui/Lightbox';
import { actionGhost, actionPrimary } from '../../ui';
import { googleWorkspace } from '../../lib/api/googleWorkspace';
import { FROM, workspaceRefusal } from '../../lib/googleWorkspaceWords';
import FromGoogle from './FromGoogle';
import MapColumnsDialog from './MapColumnsDialog';

/**
 * D1095 (#2960), Google Workspace part 6 — From Google on Grow's two modules,
 * from `GET /api/cycles/grow/google/:slug` (`routes/cycle_grow.ts`):
 *   - Revenue and traction: the shared section (`FromGoogle.jsx`) with the
 *     figures a metrics Sheet landed in `project_metrics` as `google_sheets`,
 *     and GW4's Map columns. The Sheet offers only New users, CAC, LTV,
 *     Headcount and NRR (%): never a figure Stripe or Mercury writes, never
 *     Active users (#2402 decision 11).
 *   - Durable company-building: the Calendar events the founder tagged
 *     `#board` or `#filing`, each a proposal with Accept (it becomes an
 *     obligation) and Dismiss.
 *
 * Every change opens an in-page dialog that says what it changes. A part that
 * failed reads "Unreadable" with Try again for this part only; the module's
 * records stay drawn. Sync and decisions are the member's own Google
 * connection's; a reader sees the figures and the proposals, and no control.
 */

export const SLUG = Object.freeze({ revenue: 'revenue-and-traction', durable: 'durable-company-building' });
/** The fields a metrics Sheet may fill, the Worker's `SHEET_METRIC_FIELDS`, and the date each row is for. */
export const SHEET_FIELDS = Object.freeze([
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'new_users', label: 'New users', type: 'number' },
  { key: 'cac', label: 'CAC', type: 'number' },
  { key: 'ltv', label: 'LTV', type: 'number' },
  { key: 'headcount', label: 'Headcount', type: 'number' },
  { key: 'nrr_pct', label: 'NRR (%)', type: 'number' },
]);
export const COLUMNS = Object.freeze(SHEET_FIELDS.map((f) => ({ key: f.key, label: f.label })));

const letter = (i) => (i >= 0 && i < 26 ? String.fromCharCode(65 + i) : null);
/** The dialog's column → field, as the Worker keeps it: each field a column letter (A to Z). */
export function encodeMapping(mapping, header) {
  const out = {};
  header.forEach((col, i) => {
    const field = mapping?.[col];
    const at = letter(i);
    if (field && at) out[field] = at; // “Don’t use” is the empty string
  });
  return out;
}
/** The Worker's field → letter, back into the dialog's column → field. */
export function decodeMapping(saved, header) {
  const out = {};
  for (const f of SHEET_FIELDS) {
    const at = saved?.[f.key];
    const i = typeof at === 'string' && /^[A-Z]$/.test(at) ? at.charCodeAt(0) - 65 : -1;
    if (i >= 0 && i < header.length) out[header[i]] = f.key;
  }
  return out;
}

/** The rows the shared section draws: one per day the Sheet landed. A blank cell stays blank, never 0. */
export function rowsOf(facts) {
  return (Array.isArray(facts) ? facts : []).map((f) => ({
    id: f.id,
    label: f.snapshot_date,
    cells: Object.fromEntries(SHEET_FIELDS.map((c) => [c.key, c.key === 'date' ? f.snapshot_date : f[c.key] ?? null])),
  }));
}

const GROW_WORDS = Object.freeze({
  invalid_mapping: 'That mapping cannot be read. Map a Date column and at least one figure.',
  mapping_column_twice: 'Two fields read the same column. Choose one.',
  mapping_column_not_allowed: 'A Sheet never writes a figure Stripe or Mercury records, nor Active users.',
  mapping_needs_a_figure: 'Map at least one figure besides the Date.',
  not_found: 'That proposal is no longer on this venture.',
  decided: 'That proposal was already decided.',
});
/** A refusal in words: Grow's own codes, then Google Workspace's. */
export function growRefusal(e) {
  const code = e?.code || e?.data?.error;
  return GROW_WORDS[code] || (e?.status === 409 ? GROW_WORDS.decided : workspaceRefusal(e));
}

/** A Sheets sync's counts as one sentence: counts only, never a cell. */
export function sheetsSentence(s) {
  if (!s) return '';
  if (s.error) return growRefusal({ code: s.error });
  if (!s.files) return 'No metrics Sheet is chosen for this venture yet.';
  let out = s.written ? `${s.written} ${s.written === 1 ? 'day' : 'days'} of figures read from Google Sheets.` : 'Nothing new in your metrics Sheet.';
  const skipped = (s.skipped || []).length;
  if (skipped) out += ` ${skipped} ${skipped === 1 ? 'row was' : 'rows were'} skipped: not a date or not a number.`;
  if ((s.problems || []).length) out += ` ${s.problems.length} ${s.problems.length === 1 ? 'Sheet' : 'Sheets'} could not be read.`;
  if (s.partial) out += ' Only the first 500 rows were read.';
  return out;
}
/** A Calendar sync's counts as one sentence. */
export function calendarSentence(c) {
  if (!c) return '';
  if (c.error) return growRefusal({ code: c.error });
  const parts = [];
  if (c.proposed) parts.push(`${c.proposed} new ${c.proposed === 1 ? 'event' : 'events'} to review`);
  if (c.updated) parts.push(`${c.updated} updated`);
  if (c.withdrawn) parts.push(`${c.withdrawn} no longer tagged and withdrawn`);
  let out = parts.length ? `${parts.join(', ')}.` : 'No new tagged event in your Google Calendar.';
  if (c.partial) out += ' Google’s read limit was reached: Sync again to carry on.';
  return out;
}

export const KIND_WORDS = Object.freeze({ board_meeting: 'Board meeting', filing_deadline: 'Filing deadline' });
export const OBLIGATION_WORDS = Object.freeze({ board_meeting: 'a governance obligation', filing_deadline: 'a compliance obligation' });

const CARD = 'flex min-w-0 flex-col gap-3 rounded-axal-sm border border-axal-hairline bg-white p-4 text-[13px] text-axal-ink dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const ALERT = 'm-0 text-[12.5px] text-red-700 dark:text-red-300';
const BTN = `${actionGhost} min-h-[36px] max-sm:min-h-[44px]`;

/** One read of a Grow module's From Google, with its own state. */
export function useGrowGoogle(projectId, slug, api = googleWorkspace) {
  const [state, setState] = useState({ status: projectId ? 'loading' : 'none' });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!projectId) { setState({ status: 'none' }); return undefined; }
    let alive = true;
    setState((s) => (s.read ? { ...s, status: 'loading' } : { status: 'loading' }));
    Promise.resolve().then(() => api.growRead(projectId, slug))
      .then((read) => { if (alive) setState({ status: 'ready', read }); })
      .catch((e) => { if (alive) setState({ status: e?.status === 403 || e?.status === 404 ? 'refused' : 'error' }); });
    return () => { alive = false; };
  }, [projectId, slug, tick, api]);
  return { state, reload };
}

/** Revenue and traction (GW3, GW4, GW7): the metrics Sheet's figures, its mapping, Sync and Delete. */
export function RevenueFromGoogleView({ projectId, state, reload, api = googleWorkspace }) {
  const [file, setFile] = useState(null);
  const [mapping, setMapping] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    let alive = true;
    if (!projectId || state?.status !== 'ready') return undefined;
    Promise.resolve().then(() => api.files(projectId))
      .then((d) => { if (alive) setFile((d?.items || []).find((f) => f.module === 'revenue_traction') || null); })
      .catch(() => { if (alive) setFile(null); });
    return () => { alive = false; };
  }, [projectId, state?.status, api]);
  if (!state || state.status === 'none' || state.status === 'refused') return null;
  if (state.status === 'error') {
    return (
      <section aria-label={FROM.title} className={CARD} data-testid="grow-from-google" data-state="unreadable">
        <h3 className="m-0 text-[14px] font-extrabold">{FROM.title}</h3>
        <p className={ALERT}>Unreadable: the figures from Google Sheets could not be read. That is not the same as having none. <button type="button" className="underline" onClick={reload} data-testid="grow-from-google-retry">Try again</button></p>
      </section>
    );
  }
  const read = state.read;
  const rows = state.status === 'loading' && !read ? null : rowsOf(read?.facts);
  const mine = (read?.files || []).find((f) => f.mine);
  return (
    <div className="flex flex-col gap-2" data-testid="grow-from-google" data-module={SLUG.revenue}>
      <FromGoogle project={projectId} module="revenue_traction" columns={COLUMNS} rows={rows} deleted={Number(read?.kept_deleted) || 0}
        onSync={mine ? async () => { const r = await api.growSync(projectId, 'sheets'); setNote(sheetsSentence(r?.sheets)); reload(); } : null}
        onDeleteRow={async (row) => { await api.growDeleteFact(projectId, row.id); reload(); }} />
      {mine && file ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="grow-map">
          <span className={MUTED}>{mine.mapped ? 'The Sheet is mapped: Sync reads its mapped columns only.' : 'Map the Sheet’s columns before the first Sync. Only New users, CAC, LTV, Headcount and NRR (%) can be filled from a Sheet.'}</span>
          <button type="button" className={BTN} onClick={() => setMapping(true)} data-testid="grow-map-open">{mine.mapped ? 'Change the mapping' : 'Map columns'}</button>
        </div>
      ) : null}
      {note ? <p role="status" className={MUTED} data-testid="grow-sync-note">{note}</p> : null}
      {mapping && file ? (
        <MapColumnsDialog file={file} fields={SHEET_FIELDS} encode={encodeMapping} decode={decodeMapping}
          onClose={() => setMapping(false)} onSaved={() => { setMapping(false); reload(); }} />
      ) : null}
    </div>
  );
}
export function RevenueFromGoogle({ projectId, api = googleWorkspace }) {
  const { state, reload } = useGrowGoogle(projectId, SLUG.revenue, api);
  return <RevenueFromGoogleView projectId={projectId} state={state} reload={reload} api={api} />;
}

function DecideDialog({ projectId, proposal, verb, api, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const kind = KIND_WORDS[proposal.kind] || 'Event';
  const title = verb === 'accept' ? `Add “${proposal.title}” as an obligation?` : `Dismiss “${proposal.title}”?`;
  const says = verb === 'accept'
    ? `${kind} on ${proposal.date} becomes ${OBLIGATION_WORDS[proposal.kind] || 'an obligation'} in Durable company-building, due that day. The event in your Google Calendar is not changed.`
    : `${kind} on ${proposal.date} is not proposed again. Your Google Calendar is not changed.`;
  const go = async () => {
    setBusy(true); setRefusal('');
    try { await (verb === 'accept' ? api.growAccept(projectId, proposal.id) : api.growDismiss(projectId, proposal.id)); onDone(); }
    catch (e) { setRefusal(growRefusal(e)); setBusy(false); }
  };
  return (
    <Lightbox label={title} title={title} onClose={() => { if (!busy) onClose(); }} width={480} phone="sheet" testId="grow-calendar-decide"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={actionGhost} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={actionPrimary} onClick={go} disabled={busy} data-testid="grow-calendar-decide-confirm">{busy ? 'Saving…' : verb === 'accept' ? 'Add the obligation' : 'Dismiss'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-2 text-[13px]">
        <p className="m-0" data-testid="grow-calendar-decide-says">{says}</p>
        {refusal ? <p role="alert" className={ALERT}>{refusal}</p> : null}
      </div>
    </Lightbox>
  );
}

/** Durable company-building: the tagged Calendar events, each Accept or Dismiss, and Sync. */
export function DurableFromGoogleView({ projectId, state, reload, canDecide = true, api = googleWorkspace }) {
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  if (!state || state.status === 'none' || state.status === 'refused') return null;
  const head = (
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="m-0 flex items-center gap-2 text-[14px] font-extrabold">
          <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-md bg-axal-ground text-[12px] font-black dark:bg-gray-800">G</span>From Google Calendar
        </h3>
        <p className={MUTED} data-testid="grow-calendar-how">Tag an event <code>#board</code> or <code>#filing</code> in its title, and it is proposed here. Nothing is added until you accept it.</p>
      </div>
      {canDecide && state.status !== 'error' ? (
        <button type="button" className={BTN} disabled={busy} data-testid="grow-calendar-sync"
          onClick={async () => {
            setBusy(true); setNote('');
            try { const r = await api.growSync(projectId, 'calendar'); setNote(calendarSentence(r?.calendar)); reload(); }
            catch (e) { setNote(growRefusal(e)); }
            finally { setBusy(false); }
          }}>{busy ? 'Syncing…' : FROM.sync}</button>
      ) : null}
    </header>
  );
  if (state.status === 'error') {
    return (
      <section aria-label="From Google Calendar" className={CARD} data-testid="grow-calendar" data-state="unreadable">
        {head}
        <p className={ALERT}>Unreadable: the Calendar proposals could not be read. That is not the same as having none. <button type="button" className="underline" onClick={reload} data-testid="grow-calendar-retry">Try again</button></p>
      </section>
    );
  }
  const read = state.read;
  const proposals = read?.proposals || [];
  const decided = read?.decided || { accepted: 0, dismissed: 0 };
  return (
    <section aria-label="From Google Calendar" className={CARD} data-testid="grow-calendar" data-state={state.status === 'loading' && !read ? 'loading' : 'ready'}>
      {head}
      {state.status === 'loading' && !read ? <p className={MUTED}>{FROM.loading}</p> : null}
      {read && !proposals.length ? <p className={MUTED} data-testid="grow-calendar-none">No tagged event is waiting for review.</p> : null}
      {proposals.length ? (
        <ul className="m-0 flex list-none flex-col divide-y divide-axal-hairline p-0 dark:divide-gray-800">
          {proposals.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between" data-testid="grow-calendar-proposal">
              <span className="min-w-0">
                <span className="mr-2 rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-bold dark:border-gray-700">{KIND_WORDS[p.kind] || 'Event'}</span>
                <span className="font-semibold">{p.title}</span>
                <span className="ml-2 text-axal-muted dark:text-gray-400">{p.date}</span>
              </span>
              {canDecide ? (
                <span className="flex gap-2">
                  <button type="button" className={actionPrimary} onClick={() => setDialog({ verb: 'accept', p })} data-testid="grow-calendar-accept">Accept</button>
                  <button type="button" className={actionGhost} onClick={() => setDialog({ verb: 'dismiss', p })} data-testid="grow-calendar-dismiss">Dismiss</button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {decided.accepted || decided.dismissed ? <p className={MUTED} data-testid="grow-calendar-decided">{decided.accepted} accepted and {decided.dismissed} dismissed before.</p> : null}
      {note ? <p role="status" className={MUTED} data-testid="grow-calendar-note">{note}</p> : null}
      {dialog ? <DecideDialog projectId={projectId} proposal={dialog.p} verb={dialog.verb} api={api} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} /> : null}
    </section>
  );
}
export function DurableFromGoogle({ projectId, canDecide = true, api = googleWorkspace }) {
  const { state, reload } = useGrowGoogle(projectId, SLUG.durable, api);
  return <DurableFromGoogleView projectId={projectId} state={state} reload={reload} canDecide={canDecide} api={api} />;
}
