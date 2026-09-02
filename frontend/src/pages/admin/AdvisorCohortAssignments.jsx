import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { Card, Pill } from '../../ui';

/**
 * Admin — which advisor may read which Lab cohort's founders.
 *
 * WHAT THIS GRANTS, said plainly because it is the whole point: an assignment
 * lets one advisor read the NAMES AND EMAIL ADDRESSES of the founders in one
 * Lab cohort. It changes nothing in the Lab. It is the only way an advisor
 * gets that access, and ending it is the only way they lose it.
 *
 * WHY IT IS ITS OWN PAGE rather than a tab on the Spin-Out Lab console, which
 * is where an admin would naturally look. That console is a Lab-owned file
 * under a standing do-not-touch instruction, and the split matches how the
 * backend was already built: these endpoints live at
 * `/api/advisors/admin/cohort-assignments`, not under `/api/admin/cohort/*`.
 * The assignment is advisor-domain; the cohort it points at is the Lab's.
 *
 * IT SHOWS ENDED ROWS. Migration 206 soft-deletes precisely so the record of
 * who could see a batch, and when, survives the access itself. A list that hid
 * them could not answer the question the record exists for.
 *
 * IT SHOWS THE TARGET'S CURRENT ROLE. A still-active row beside a role that is
 * no longer advisor is a grant the worker now refuses at read time — the
 * access is already gone, but the row is not, and only a person can decide to
 * end it.
 */

const inputClass = 'rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] '
  + 'focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 '
  + 'dark:border-gray-700 dark:bg-gray-900';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const cycleLabel = (c) => `${MONTHS[Number(c.month) - 1] || `Month ${c.month}`} ${c.year}`;

export default function AdvisorCohortAssignments() {
  const [rows, setRows] = useState({ loading: true, error: '', items: [] });
  const [advisors, setAdvisors] = useState({ loading: true, error: '', items: [] });
  const [cycles, setCycles] = useState({ loading: true, error: '', items: [] });
  const [draft, setDraft] = useState({ advisor_user_id: '', cohort_cycle_id: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [showEnded, setShowEnded] = useState(false);

  const load = useCallback(async () => {
    setRows((c) => ({ ...c, loading: true, error: '' }));
    try {
      const res = await api.adminAdvisorCohortAssignments();
      setRows({ loading: false, error: '', items: Array.isArray(res?.items) ? res.items : [] });
    } catch (e) {
      setRows({ loading: false, error: e?.message || 'Assignments could not be read.', items: [] });
    }
  }, []);

  useEffect(() => {
    load();
    // The picker offers exactly what the worker will accept — the eligibility
    // rule lives there, not here, so the two cannot disagree.
    api.adminAssignableAdvisors()
      .then((r) => setAdvisors({ loading: false, error: '', items: r?.items || [] }))
      .catch((e) => setAdvisors({ loading: false, error: e?.message || 'Advisors could not be read.', items: [] }));
    // The Lab's own cycle list, read-only. No Lab file is edited to get it.
    api.adminCohortTimeline()
      .then((r) => setCycles({ loading: false, error: '', items: r?.cycles || r?.items || [] }))
      .catch((e) => setCycles({ loading: false, error: e?.message || 'Cohort cycles could not be read.', items: [] }));
  }, [load]);

  const byId = useMemo(
    () => new Map((cycles.items || []).map((c) => [Number(c.id), c])),
    [cycles.items],
  );

  const assign = async (e) => {
    e.preventDefault();
    setNote(null);
    if (!draft.advisor_user_id || !draft.cohort_cycle_id) {
      setNote({ ok: false, text: 'Pick an advisor and a cohort.' });
      return;
    }
    setBusy(true);
    try {
      await api.adminAssignAdvisorCohort({
        advisor_user_id: Number(draft.advisor_user_id),
        cohort_cycle_id: Number(draft.cohort_cycle_id),
        note: draft.note.trim() || null,
      });
      setDraft({ advisor_user_id: '', cohort_cycle_id: '', note: '' });
      setNote({ ok: true, text: 'Assigned. The advisor can now read that cohort’s founders.' });
      await load();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That could not be assigned. Nothing was changed.' });
    } finally {
      setBusy(false);
    }
  };

  const end = async (row) => {
    setNote(null);
    try {
      await api.adminEndAdvisorCohortAssignment(row.id);
      setNote({ ok: true, text: `Access ended for ${row.advisor_name || `user #${row.advisor_user_id}`}.` });
      await load();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That could not be ended.' });
    }
  };

  const visible = (rows.items || []).filter((r) => showEnded || r.is_active);

  return (
    <div className="space-y-4">
      <div className="max-w-3xl">
        <h1 className="text-lg font-extrabold tracking-tight">Advisor cohort access</h1>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-axal-ink-2">
          An assignment lets one advisor read the names and email addresses of the founders in one
          Spin-Out Lab cohort. It changes nothing in the Lab, and it is the only way an advisor
          gets that access.
        </p>
      </div>

      <Card padding="lg">
        <h2 className="text-sm font-extrabold tracking-tight">Assign an advisor</h2>
        <form onSubmit={assign} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Advisor</span>
            <select className={`${inputClass} mt-1 w-full`} value={draft.advisor_user_id}
              onChange={(e) => setDraft({ ...draft, advisor_user_id: e.target.value })}>
              <option value="">Choose…</option>
              {advisors.items.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.email || `User #${a.id}`}{a.has_advisor_profile ? '' : ' — no profile yet'}
                </option>
              ))}
            </select>
            {advisors.error && <span className="mt-1 block text-[11px] text-red-700 dark:text-red-300">{advisors.error}</span>}
          </label>
          <label className="block">
            <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Cohort</span>
            <select className={`${inputClass} mt-1 w-full`} value={draft.cohort_cycle_id}
              onChange={(e) => setDraft({ ...draft, cohort_cycle_id: e.target.value })}>
              <option value="">Choose…</option>
              {cycles.items.map((c) => (
                <option key={c.id} value={c.id}>{cycleLabel(c)}{c.status ? ` · ${c.status}` : ''}</option>
              ))}
            </select>
            {cycles.error && <span className="mt-1 block text-[11px] text-red-700 dark:text-red-300">{cycles.error}</span>}
          </label>
          <label className="block">
            <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Note</span>
            <input className={`${inputClass} mt-1 w-full`} value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              placeholder="Why, for the record" />
          </label>
          <div className="sm:col-span-3">
            <button type="submit" disabled={busy}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
              {busy ? 'Assigning…' : 'Assign'}
            </button>
            {note && (
              <p className={`mt-2 text-[12px] font-semibold ${note.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                {note.text}
              </p>
            )}
          </div>
        </form>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-extrabold tracking-tight">
          Who has access{visible.length ? ` — ${visible.length}` : ''}
        </h2>
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} />
          Include ended
        </label>
      </div>

      {rows.loading ? (
        <p className="text-[12.5px] text-axal-ink-3">Loading…</p>
      ) : rows.error ? (
        <Card variant="dashed" padding="lg">
          <p className="text-[12.5px] leading-relaxed text-axal-ink-2">
            {rows.error} Nothing is listed rather than an empty list, because an empty list here
            would say nobody has access — which is not something this page can currently know.
          </p>
        </Card>
      ) : visible.length === 0 ? (
        <Card variant="dashed" padding="lg">
          <p className="text-[12.5px] leading-relaxed text-axal-ink-2">
            {showEnded
              ? 'No advisor has ever been assigned a cohort.'
              : 'No advisor currently has access to a cohort’s founders.'}
          </p>
        </Card>
      ) : (
        <Card padding="none" className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-axal-hairline text-left dark:border-gray-700">
                {['Advisor', 'Cohort', 'Assigned', 'State', ''].map((h) => (
                  <th key={h} className="px-4 py-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const cycle = byId.get(Number(r.cohort_cycle_id));
                const stale = r.is_active && r.advisor_role && r.advisor_role.toLowerCase() !== 'advisor';
                return (
                  <tr key={r.id} className="border-b border-axal-hairline/60 last:border-0 dark:border-gray-800">
                    <td className="px-4 py-2.5">
                      <div className="font-semibold">{r.advisor_name || `User #${r.advisor_user_id}`}</div>
                      <div className="text-[11px] text-axal-ink-3">{r.advisor_email || '—'}</div>
                    </td>
                    <td className="px-4 py-2.5">{cycle ? cycleLabel(cycle) : `Cycle #${r.cohort_cycle_id}`}</td>
                    <td className="px-4 py-2.5 text-axal-ink-3">{String(r.assigned_at || '').slice(0, 10)}</td>
                    <td className="px-4 py-2.5">
                      {r.is_active ? <Pill tone="ok">Active</Pill> : <Pill tone="neutral">Ended</Pill>}
                      {/* The row outlives the access. The worker refuses this
                          person at read time already; only a human can decide
                          to tidy the record. */}
                      {stale && (
                        <div className="mt-1 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                          No longer an advisor ({r.advisor_role}) — access is already refused, but
                          the row is still open.
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {r.is_active && (
                        <button type="button" onClick={() => end(r)}
                          className="rounded-lg border border-axal-hairline px-3 py-1.5 text-[12px] font-semibold hover:bg-axal-ground dark:border-gray-700 dark:hover:bg-gray-800">
                          End access
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <p className="text-[11px] leading-relaxed text-axal-ink-3">
        Ending access keeps the row. A record that vanished could not answer who could see a
        cohort’s founders, and when — which is the question it exists for.
      </p>
    </div>
  );
}
