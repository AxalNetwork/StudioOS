import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useActiveCompany } from '../../contexts/ActiveCompanyContext';
import { Lightbox, actionPrimary, actionGhost, actionDanger } from '../../ui';
import { CARD, SUB, H3 } from '../../pages/deal/DealFrame';
import {
  REFERENCE_CONSENT_CONFIRM, REFERENCE_DELETE_CONFIRM, REFERENCE_PILLS,
  REFERENCE_STATUS, REFERENCE_SUMMARY, STATES, SUMMARY_MIN_NOTES, whenLine,
} from './dealRoomCopy';
import { Loading, Empty, Unreadable, NotRecorded } from './DealRoomKit';

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
 *
 * D6182 (#6182) — the card on `/deals/:dealId/diligence` follows the deal
 * page's rules: Delete and Record consent each open the shared Lightbox,
 * which says what changes, and a refusal stays inside it. The card draws on
 * the deal page's CARD/SUB/H3 and axal tokens, with the canvas's pills
 * (Consent given or Consent asked, Notes kept). D6735 scopes investor reads
 * to the verified firm and the investor's own checks.
 */
export default function DealReferencesTab({ dealId }) {
  const firmId = useActiveCompany().company?.id ?? '';
  // A firm switch discards the old rows and any open reference dialog.
  return <FirmReferences key={`${dealId}:${firmId}`} dealId={dealId} />;
}

function FirmReferences({ dealId }) {
  const [state, setState] = useState({ loading: true, error: false, rows: null });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const rows = await api.listReferences(dealId);
      setState({ loading: false, error: false, rows: Array.isArray(rows) ? rows : [] });
    } catch (error) {
      if (error?.code === 'no_visible_references') {
        setState({ loading: false, error: false, rows: [] });
      } else {
        setState({ loading: false, error: true, rows: null });
      }
    }
  }, [dealId]);
  useEffect(() => { load(); }, [load]);
  return <ReferencesView dealId={dealId} state={state} onRetry={load} onChanged={load} />;
}

// The canvas's pill tones, on the axal tokens, each with its dark pair.
const PILL = {
  done: 'border-axal-positive/40 bg-axal-positive/10 text-axal-positive dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  wait: 'border-axal-amber/40 bg-axal-amber/10 text-axal-amber-deep dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300',
  off: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
  now: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-700 dark:bg-violet-950 dark:text-violet-300',
};
const Pill = ({ tone = 'off', testid, children }) => (
  <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-axal-pill border px-2 py-0.5 text-[11px] font-bold ${PILL[tone] || PILL.off}`} data-testid={testid}>{children}</span>
);
const TONE = { scheduled: 'now', recorded: 'wait', transcribed: 'wait', summarized: 'done', cancelled: 'off' };
// 44 px to touch at phone width; the deal page's 34 px from md up.
const TAP = 'min-h-[44px] gap-1.5 md:min-h-[34px]';
const LABEL = 'block text-[12px] font-semibold text-axal-muted dark:text-gray-400';
const FIELD = 'mt-1 min-h-[44px] w-full rounded-axal-sm border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink focus:border-axal-violet focus:outline-none md:min-h-0 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

/** The pills the canvas draws under a check: consent given or asked, and notes kept. */
export function referencePills(r) {
  const pills = [r.consent_given
    ? { key: 'consent', tone: 'done', glyph: '✓', text: REFERENCE_PILLS.consentGiven }
    : { key: 'consent', tone: 'wait', glyph: '◷', text: REFERENCE_PILLS.consentAsked }];
  if (r.notes && String(r.notes).trim()) pills.push({ key: 'notes', tone: 'off', glyph: '▤', text: REFERENCE_PILLS.notesKept });
  return pills;
}

export function ReferencesView({ dealId, state, onRetry, onChanged, initialConfirm = null }) {
  const [editing, setEditing] = useState(null); // null | 'new' | a row
  // D6182: Delete and Record consent each ask first, in the shared Lightbox.
  const [confirm, setConfirm] = useState(initialConfirm); // null | { kind: 'delete' | 'consent', row }

  const [rowError, setRowError] = useState('');
  const [summarising, setSummarising] = useState(null);
  const summarise = async (r) => {
    setRowError(''); setSummarising(r.id);
    try { await api.summarizeReference(r.id); await onChanged?.(); }
    catch (e) { setRowError(e?.message || REFERENCE_SUMMARY.failed); }
    finally { setSummarising(null); }
  };

  const cta = <button type="button" onClick={() => setEditing('new')} className={`${actionPrimary} ${TAP}`} data-testid="dr-reference-cta"><Plus size={14} aria-hidden="true" /> Schedule a reference</button>;
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
      <ul className="m-0 flex list-none flex-col p-0" data-testid="dr-references">
        {state.rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 border-t border-axal-hairline py-2.5 dark:border-gray-700" data-testid="dr-reference-row">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{r.reference_name}</span>
                  <Pill tone={TONE[r.status] || 'off'} testid="dr-reference-status">{REFERENCE_STATUS[r.status] || r.status}</Pill>
                </div>
                <div className="text-[12px] leading-[1.5] text-axal-muted dark:text-gray-400">
                  {[r.reference_email, r.reference_role, r.relationship].filter(Boolean).join(' · ') || 'No email, role or relationship recorded'}
                </div>
                {r.notes && <p className="m-0 text-[13px] text-axal-ink dark:text-gray-200">{r.notes}</p>}
                <div className="flex flex-wrap gap-1.5" data-testid="dr-reference-pills">
                  {referencePills(r).map((p) => <Pill key={p.key} tone={p.tone} testid={`dr-reference-pill-${p.key}`}><span aria-hidden="true">{p.glyph}</span> {p.text}</Pill>)}
                </div>
              </div>
              <dl className="m-0 grid shrink-0 grid-cols-2 gap-x-4 gap-y-1 text-[12px] md:text-right">
                <dt className="text-axal-muted dark:text-gray-400">Scheduled</dt>
                <dd className="m-0 text-axal-ink dark:text-gray-100">{whenLine(r.scheduled_at) || <NotRecorded reason={STATES.references.nrScheduled} />}</dd>
                <dt className="text-axal-muted dark:text-gray-400">Consent</dt>
                <dd className="m-0 text-axal-ink dark:text-gray-100" data-testid="dr-reference-consent">
                  {r.consent_given
                    ? `Given ${whenLine(r.consent_given_at) || ''}`.trim()
                    : <NotRecorded reason={STATES.references.nrConsent} />}
                </dd>
                <dt className="text-axal-muted dark:text-gray-400">Summary</dt>
                <dd className="m-0 text-axal-ink dark:text-gray-100" data-testid="dr-reference-summary-state">
                  {r.summary
                    ? (r.summary_stale ? REFERENCE_SUMMARY.stale : `Written ${whenLine(r.summarized_at) || ''}`.trim())
                    : <NotRecorded reason={canSummarise(r) ? REFERENCE_SUMMARY.none : REFERENCE_SUMMARY.needNotes} />}
                </dd>
              </dl>
            </div>
            {r.summary && <ReferenceSummary summary={r.summary} />}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setEditing(r)} className={`${actionGhost} ${TAP}`} data-testid="dr-reference-edit"><Pencil size={13} aria-hidden="true" /> Edit</button>
              {canSummarise(r) && (!r.summary || r.summary_stale) && (
                <button type="button" onClick={() => summarise(r)} disabled={summarising === r.id} className={`${actionGhost} ${TAP}`} data-testid="dr-reference-summarise">
                  {summarising === r.id ? REFERENCE_SUMMARY.busy : r.summary ? REFERENCE_SUMMARY.again : REFERENCE_SUMMARY.run}
                </button>
              )}
              {!r.consent_given && <button type="button" onClick={() => setConfirm({ kind: 'consent', row: r })} className={`${actionGhost} ${TAP}`} data-testid="dr-reference-consent-open">Record consent</button>}
              <button type="button" onClick={() => setConfirm({ kind: 'delete', row: r })} className={`${actionDanger} ${TAP}`} data-testid="dr-reference-delete-open"><Trash2 size={13} aria-hidden="true" /> Delete</button>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  const hasRows = Boolean(state.rows && state.rows.length);
  return (
    <section className={`${CARD} flex flex-col gap-2.5 p-4`} data-testid="dr-references-card">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className={H3}>Reference calls</h3>
        {hasRows && !editing && cta}
      </div>
      <p className={`m-0 ${SUB}`}>{REFERENCE_SUMMARY.lead}</p>
      {form}
      {rowError && <p className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300" role="alert" data-testid="dr-reference-summary-error">{rowError}</p>}
      {body}
      {confirm && (
        <ReferenceConfirm kind={confirm.kind} row={confirm.row}
          onClose={async (changed) => { setConfirm(null); if (changed) await onChanged?.(); }} />
      )}
    </section>
  );
}

/**
 * D6182 — the dialog before a Delete or a Record consent. It says what
 * changes; the write is made only from its confirm button, and a refusal
 * stays inside it with the dialog open, so the press can be retried.
 */
export function ReferenceConfirm({ kind, row, onClose }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const w = kind === 'delete' ? REFERENCE_DELETE_CONFIRM : kind === 'consent' ? REFERENCE_CONSENT_CONFIRM : null;
  if (!w || !row) return null;
  const name = row.reference_name || 'this reference';
  const title = w.title(name);
  const go = async () => {
    setBusy(true); setErr('');
    try {
      if (kind === 'delete') await api.deleteReference(row.id);
      else await api.captureReferenceConsent(row.id, { consent_given: true });
      setBusy(false);
      await onClose(true);
    } catch (e) {
      setErr(e?.message || w.refused);
      setBusy(false);
    }
  };
  return (
    <Lightbox label={title} title={title} sub={w.body(name)} onClose={() => { if (!busy) onClose(false); }} testId={`dr-reference-${kind}-dialog`}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={`${actionGhost} ${TAP}`} disabled={busy} onClick={() => onClose(false)} data-testid={`dr-reference-${kind}-back`}>{w.back}</button>
          <button type="button" className={`${kind === 'delete' ? actionDanger : actionPrimary} ${TAP}`} disabled={busy} onClick={go} data-testid={`dr-reference-${kind}-confirm`}>
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} {w.act}
          </button>
        </div>
      )}>
      {err && <p role="alert" className="mx-5 my-4 text-[12.5px] text-axal-destructive dark:text-red-300" data-testid={`dr-reference-${kind}-refusal`}>{err}</p>}
    </Lightbox>
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
    <div className="mt-2 rounded-axal-lg border border-axal-lavender-edge bg-axal-lavender/40 p-2 text-sm dark:border-violet-900 dark:bg-violet-950/20" data-testid="dr-reference-summary">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-axal-violet-deep dark:text-violet-300">{REFERENCE_SUMMARY.from}</div>
      <p className="mt-1 text-axal-ink dark:text-gray-200">{summary.summary}</p>
      {strengths.length > 0 && <><div className="mt-1 text-xs font-semibold text-axal-muted dark:text-gray-400">Strengths</div><ul className="list-disc pl-5 text-xs text-axal-ink dark:text-gray-300">{strengths.map((s, i) => <li key={`s${i}`}>{s}</li>)}</ul></>}
      {concerns.length > 0 && <><div className="mt-1 text-xs font-semibold text-axal-muted dark:text-gray-400">Concerns</div><ul className="list-disc pl-5 text-xs text-axal-amber-deep dark:text-amber-300">{concerns.map((s, i) => <li key={`c${i}`}>{s}</li>)}</ul></>}
    </div>
  );
}

/**
 * A manual edit can schedule or cancel a reference. The summary action sets
 * Summarised. A row can also keep its existing status, including legacy
 * Recorded and Transcribed values.
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
    <form onSubmit={submit} className="rounded-axal-lg border border-axal-lavender-edge bg-axal-lavender/40 p-4 dark:border-violet-900 dark:bg-violet-950/20" data-testid="dr-reference-form">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">{row ? `Edit ${row.reference_name}` : 'Schedule a reference'}</h4>
        <button type="button" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-axal-sm text-axal-muted hover:text-axal-ink md:h-8 md:w-8 dark:text-gray-400 dark:hover:text-gray-100" aria-label="Close"><X size={16} aria-hidden="true" /></button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {!row && (
          <label className={LABEL}>Name<input value={f.reference_name} onChange={set('reference_name')} className={FIELD} /></label>
        )}
        <label className={LABEL}>Email<input type="email" value={f.reference_email} onChange={set('reference_email')} className={FIELD} /></label>
        <label className={LABEL}>Role<input value={f.reference_role} onChange={set('reference_role')} className={FIELD} /></label>
        <label className={LABEL}>Relationship<input value={f.relationship} onChange={set('relationship')} className={FIELD} /></label>
        <label className={LABEL}>Scheduled<input type="datetime-local" value={f.scheduled_at} onChange={set('scheduled_at')} className={FIELD} /></label>
        {row && (
          <label className={LABEL}>Status
            <select value={f.status} onChange={set('status')} className={FIELD}>
              {editableStatuses(row.status).map((k) => <option key={k} value={k}>{REFERENCE_STATUS[k]}</option>)}
            </select>
          </label>
        )}
        <label className={`${LABEL} md:col-span-2`}>Notes<textarea rows={2} value={f.notes} onChange={set('notes')} className={FIELD} /></label>
      </div>
      {err && <p className="mt-2 text-[12.5px] text-axal-destructive dark:text-red-300" role="alert">{err}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={`${actionGhost} ${TAP}`}>Cancel</button>
        <button type="submit" disabled={saving} className={`${actionPrimary} ${TAP}`}>
          {saving && <Loader2 size={14} className="animate-spin" />} {row ? 'Save changes' : 'Schedule'}
        </button>
      </div>
    </form>
  );
}
