import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '../../lib/api';
import {
  REFERENCE_STATUS, REFERENCE_SUMMARY, STATES, SUMMARY_MIN_NOTES, whenLine,
} from './dealRoomCopy';
import { Loading, Empty, Unreadable, NotRecorded, StatusPill, BTN, INPUT } from './DealRoomKit';

/**
 * D630 (#1388) — canvas `sp-references`: the deal room's References tab, for
 * an admin and an investor who may open the deal (D609 scopes every route to
 * `userMayReadDeal`; a founder and a partner are refused).
 *
 * Each check: name, email, role, relationship, scheduled time, consent (given
 * or not, and when), status and notes. Schedule, edit and delete.
 *
 * D6183 (#6183): NOTES, AND EADWYN'S SUMMARY OF THEM. The owner chose
 * notes-to-summary only, so there is no recording and no transcript, and no
 * row for either. "Summarise notes" appears once a check has enough notes;
 * the summary says when the notes changed after it. The never-mounted
 * `ReferenceChecksPanel.jsx`, which drew upload and transcribe, is deleted.
 */
export default function DealReferencesTab({ dealId }) {
  const [state, setState] = useState({ loading: true, error: false, rows: null });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const rows = await api.listReferences(dealId);
      setState({ loading: false, error: false, rows: Array.isArray(rows) ? rows : [] });
    } catch {
      setState({ loading: false, error: true, rows: null });
    }
  }, [dealId]);
  useEffect(() => { load(); }, [load]);
  return <ReferencesView dealId={dealId} state={state} onRetry={load} onChanged={load} />;
}

const TONE = { scheduled: 'violet', recorded: 'amber', transcribed: 'amber', summarized: 'ok', cancelled: 'grey' };

export function ReferencesView({ dealId, state, onRetry, onChanged }) {
  const [editing, setEditing] = useState(null); // null | 'new' | a row
  const [rowError, setRowError] = useState('');

  const remove = async (r) => {
    setRowError('');
    try { await api.deleteReference(r.id); await onChanged?.(); }
    catch (e) { setRowError(e?.message || 'The reference was not deleted. Try again.'); }
  };
  const [summarising, setSummarising] = useState(null);
  const summarise = async (r) => {
    setRowError(''); setSummarising(r.id);
    try { await api.summarizeReference(r.id); await onChanged?.(); }
    catch (e) { setRowError(e?.message || REFERENCE_SUMMARY.failed); }
    finally { setSummarising(null); }
  };
  const consent = async (r) => {
    setRowError('');
    try { await api.captureReferenceConsent(r.id, { consent_given: true }); await onChanged?.(); }
    catch (e) { setRowError(e?.message || 'Consent was not recorded. Try again.'); }
  };

  const cta = <button type="button" onClick={() => setEditing('new')} className={BTN.primary} data-testid="dr-reference-cta"><Plus size={14} /> Schedule a reference</button>;
  const form = editing && (
    <ReferenceForm
      dealId={dealId}
      row={editing === 'new' ? null : editing}
      onClose={() => setEditing(null)}
      onSaved={async () => { setEditing(null); await onChanged?.(); }}
    />
  );

  let body;
  if (state.loading && !state.rows) body = <Loading what="references" />;
  else if (state.error) body = <Unreadable onRetry={onRetry}>{STATES.references.unread}</Unreadable>;
  else if (!state.rows.length) body = <Empty action={editing ? null : cta}>{STATES.references.empty}</Empty>;
  else {
    body = (
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900" data-testid="dr-references">
        {state.rows.map((r) => (
          <li key={r.id} className="p-3" data-testid="dr-reference-row">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{r.reference_name}</span>
                  <StatusPill tone={TONE[r.status] || 'grey'} testid="dr-reference-status">{REFERENCE_STATUS[r.status] || r.status}</StatusPill>
                </div>
                <div className="text-xs text-gray-500">
                  {[r.reference_email, r.reference_role, r.relationship].filter(Boolean).join(' · ') || 'No email, role or relationship recorded'}
                </div>
                {r.notes && <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{r.notes}</p>}
              </div>
              <dl className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-1 text-xs md:text-right">
                <dt className="text-gray-500">Scheduled</dt>
                <dd>{whenLine(r.scheduled_at) || <NotRecorded reason={STATES.references.nrScheduled} />}</dd>
                <dt className="text-gray-500">Consent</dt>
                <dd data-testid="dr-reference-consent">
                  {r.consent_given
                    ? `Given ${whenLine(r.consent_given_at) || ''}`.trim()
                    : <NotRecorded reason={STATES.references.nrConsent} />}
                </dd>
                <dt className="text-gray-500">Summary</dt>
                <dd data-testid="dr-reference-summary-state">
                  {r.summary
                    ? (r.summary_stale ? REFERENCE_SUMMARY.stale : `Written ${whenLine(r.summarized_at) || ''}`.trim())
                    : <NotRecorded reason={canSummarise(r) ? REFERENCE_SUMMARY.none : REFERENCE_SUMMARY.needNotes} />}
                </dd>
              </dl>
            </div>
            {r.summary && <ReferenceSummary summary={r.summary} />}
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => setEditing(r)} className={BTN.ghost}><Pencil size={13} /> Edit</button>
              {canSummarise(r) && (!r.summary || r.summary_stale) && (
                <button type="button" onClick={() => summarise(r)} disabled={summarising === r.id} className={BTN.ghost} data-testid="dr-reference-summarise">
                  {summarising === r.id ? REFERENCE_SUMMARY.busy : r.summary ? REFERENCE_SUMMARY.again : REFERENCE_SUMMARY.run}
                </button>
              )}
              {!r.consent_given && <button type="button" onClick={() => consent(r)} className={BTN.ghost}>Record consent</button>}
              <button type="button" onClick={() => remove(r)} className={BTN.danger}><Trash2 size={13} /> Delete</button>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  const hasRows = Boolean(state.rows && state.rows.length);
  return (
    <div>
      <p className="mb-3 text-xs text-gray-500">{REFERENCE_SUMMARY.lead}</p>
      {hasRows && !editing && <div className="mb-3 flex justify-end">{cta}</div>}
      {form}
      {rowError && <p className="mb-2 text-sm text-red-700 dark:text-red-300" role="alert">{rowError}</p>}
      {body}
    </div>
  );
}

/** A check whose notes are long enough to summarise (the Worker refuses shorter ones). */
export function canSummarise(r) {
  return String(r?.notes ?? '').trim().length >= SUMMARY_MIN_NOTES;
}

function ReferenceSummary({ summary }) {
  const list = (items) => (Array.isArray(items) ? items.filter((x) => typeof x === 'string' && x) : []);
  const strengths = list(summary.strengths);
  const concerns = list(summary.concerns);
  return (
    <div className="mt-2 rounded-lg border border-violet-100 bg-violet-50/40 p-2 text-sm dark:border-violet-900 dark:bg-violet-950/20" data-testid="dr-reference-summary">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">{REFERENCE_SUMMARY.from}</div>
      <p className="mt-1 text-gray-800 dark:text-gray-200">{summary.summary}</p>
      {strengths.length > 0 && <><div className="mt-1 text-xs font-semibold text-gray-600 dark:text-gray-400">Strengths</div><ul className="list-disc pl-5 text-xs text-gray-700 dark:text-gray-300">{strengths.map((s, i) => <li key={`s${i}`}>{s}</li>)}</ul></>}
      {concerns.length > 0 && <><div className="mt-1 text-xs font-semibold text-gray-600 dark:text-gray-400">Concerns</div><ul className="list-disc pl-5 text-xs text-amber-800 dark:text-amber-300">{concerns.map((s, i) => <li key={`c${i}`}>{s}</li>)}</ul></>}
    </div>
  );
}

/**
 * The statuses an edit may set. Recorded, Transcribed and Summarised follow a
 * recording, and no recording can be made yet, so setting one by hand would
 * claim an artefact that does not exist. A row already in one keeps it.
 */
export function editableStatuses(current) {
  const keys = ['scheduled', 'cancelled'];
  return current && !keys.includes(current) && REFERENCE_STATUS[current] ? [current, ...keys] : keys;
}

export function ReferenceForm({ dealId, row, onClose, onSaved }) {
  const [f, setF] = useState({
    reference_name: row?.reference_name || '',
    reference_email: row?.reference_email || '',
    reference_role: row?.reference_role || '',
    relationship: row?.relationship || '',
    scheduled_at: row?.scheduled_at ? String(row.scheduled_at).slice(0, 16) : '',
    notes: row?.notes || '',
    status: row?.status || 'scheduled',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!row && !f.reference_name.trim()) { setErr('Name the person giving the reference.'); return; }
    setSaving(true); setErr('');
    const common = {
      reference_email: f.reference_email.trim() || null,
      reference_role: f.reference_role.trim() || null,
      relationship: f.relationship.trim() || null,
      scheduled_at: f.scheduled_at || null,
      notes: f.notes.trim() || null,
    };
    try {
      if (row) await api.updateReference(row.id, { ...common, status: f.status });
      else await api.createReference({ deal_id: dealId, reference_name: f.reference_name.trim(), ...common });
      await onSaved?.();
    } catch (e2) {
      setErr(e2?.message || 'The reference was not saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mb-4 rounded-xl border border-violet-200 bg-violet-50/40 p-4 dark:border-violet-900 dark:bg-violet-950/20" data-testid="dr-reference-form">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{row ? `Edit ${row.reference_name}` : 'Schedule a reference'}</h3>
        <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700" aria-label="Close"><X size={16} /></button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {!row && (
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Name<input value={f.reference_name} onChange={set('reference_name')} className={`${INPUT} mt-1`} /></label>
        )}
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Email<input type="email" value={f.reference_email} onChange={set('reference_email')} className={`${INPUT} mt-1`} /></label>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Role<input value={f.reference_role} onChange={set('reference_role')} className={`${INPUT} mt-1`} /></label>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Relationship<input value={f.relationship} onChange={set('relationship')} className={`${INPUT} mt-1`} /></label>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Scheduled<input type="datetime-local" value={f.scheduled_at} onChange={set('scheduled_at')} className={`${INPUT} mt-1`} /></label>
        {row && (
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Status
            <select value={f.status} onChange={set('status')} className={`${INPUT} mt-1`}>
              {editableStatuses(row.status).map((k) => <option key={k} value={k}>{REFERENCE_STATUS[k]}</option>)}
            </select>
          </label>
        )}
        <label className="block text-xs font-medium text-gray-600 md:col-span-2 dark:text-gray-400">Notes<textarea rows={2} value={f.notes} onChange={set('notes')} className={`${INPUT} mt-1`} /></label>
      </div>
      {err && <p className="mt-2 text-sm text-red-700 dark:text-red-300" role="alert">{err}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BTN.ghost}>Cancel</button>
        <button type="submit" disabled={saving} className={BTN.primary}>
          {saving && <Loader2 size={14} className="animate-spin" />} {row ? 'Save changes' : 'Schedule'}
        </button>
      </div>
    </form>
  );
}
