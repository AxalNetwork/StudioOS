import React, { useCallback, useEffect, useState } from 'react';
import { Card, Pill } from '../../../ui';
import { api } from '../../../lib/api';
import { NothingYet, Unrecorded, ZoneBody, ZoneHeading, Field, inputClass, buttonClass } from '../expertise/kit';
import { BatchPicker, NoBatch, StatedLimit, cohortLabel } from './kit';

/**
 * Cohorts · Guidance — what was said to the batch, and who acted on it.
 *
 * THE CARD THIS REPLACES WAS RIGHT, which made it the exception among the three
 * zones in this pass. It said "nothing records a piece of guidance addressed to
 * a batch, and nothing records a founder acting on one" — checked against
 * production before migration 212 was written, and true. The other two cards
 * were describing gaps that had already closed.
 *
 * WHAT SHIPS IS THE ADVISOR'S HALF. Migration 212's schema holds both models:
 * `asked_by_user_id` NULL is the advisor posting unprompted, non-NULL is a
 * founder's question with `answer` and `answered_at` for the reply. The canvas
 * draws the question queue; a founder cannot ask yet because that needs a
 * founder-side page belonging to no current pass. So the queue's counts are
 * computed and shown, and will simply start moving when that page lands — the
 * schema does not have to be reopened for it.
 *
 * TWO NUMBERS ARE DELIBERATELY ABSENT, and they are the reason this zone is
 * worth reading carefully:
 *
 *   · `median_response_hours` is null until something has been answered. A
 *     median over an empty set is undefined and "0h" would read as an instant
 *     reply to every question.
 *   · There is no "overdue". The canvas draws one against "your 24h
 *     commitment"; nothing stores a commitment and no advisor has been asked
 *     for one. `oldest_open_hours` is the fact underneath it, and the page says
 *     the commitment is not recorded rather than inventing the threshold.
 */
export default function GuidanceZone() {
  const [assignments, setAssignments] = useState({ loading: true, error: '', items: [] });
  const [cycleId, setCycleId] = useState(null);
  const [data, setData] = useState({ loading: false, error: '', payload: null });
  const [draft, setDraft] = useState('');
  const [week, setWeek] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const loadAssignments = useCallback(async () => {
    setAssignments((c) => ({ ...c, loading: true, error: '' }));
    try {
      const res = await api.listMyAdvisorCohorts();
      const items = Array.isArray(res?.items) ? res.items : [];
      setAssignments({ loading: false, error: '', items });
      setCycleId(items[0]?.cohort_cycle_id ?? null);
    } catch (e) {
      setAssignments({ loading: false, error: e?.message || 'Your cohort assignments could not be read.', items: [] });
    }
  }, []);
  useEffect(() => { loadAssignments(); }, [loadAssignments]);

  const load = useCallback(async () => {
    if (cycleId == null) return;
    setData((c) => ({ ...c, loading: true, error: '' }));
    try {
      setData({ loading: false, error: '', payload: await api.listMyAdvisorCohortGuidance(cycleId) });
    } catch (e) {
      setData({ loading: false, error: e?.message || 'This batch’s guidance could not be read.', payload: null });
    }
  }, [cycleId]);
  useEffect(() => { load(); }, [load]);

  const post = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true); setNote('');
    try {
      const n = Number(week);
      await api.postMyAdvisorCohortGuidance(cycleId, {
        body,
        // Left off entirely when unstated: guidance about the whole programme
        // has no week, and stamping one would file it under a week nobody chose.
        ...(Number.isInteger(n) && n >= 1 && n <= 52 ? { week_number: n } : {}),
      });
      setDraft(''); setWeek(''); setNote('Posted.');
      await load();
    } catch (e) {
      setNote(e?.message || 'That could not be posted. Nothing was saved.');
    } finally { setBusy(false); }
  };

  const retire = async (uid) => {
    setBusy(true); setNote('');
    try {
      await api.updateMyAdvisorGuidance(uid, { retired: true });
      await load();
    } catch (e) {
      setNote(e?.message || 'That could not be retired.');
    } finally { setBusy(false); }
  };

  const payload = data.payload;
  const counts = payload?.counts || null;
  const items = payload?.items || [];
  const live = items.filter((g) => !g.retired_at);

  return (
    <div className="space-y-4">
      <ZoneHeading
        title="Guidance"
        blurb="What you have said to this batch, and which founders acted on it."
      />

      {assignments.items.length > 1 && (
        <BatchPicker items={assignments.items} value={cycleId} onChange={setCycleId} />
      )}

      {/* Nested like ThisWeekZone: the outer body owns "can I see any batch at
          all", the inner owns "did this batch's guidance read". Both state
          `loading` explicitly, which `_zoneGuards` requires. */}
      <ZoneBody
        loading={assignments.loading}
        error={assignments.error}
        onRetry={loadAssignments}
        isEmpty={assignments.items.length === 0}
        empty={<NoBatch />}
      >
      <ZoneBody
        loading={data.loading}
        error={data.error}
        onRetry={load}
        isEmpty={!data.loading && !data.error && live.length === 0}
        empty={(
          <NothingYet
            title="Nothing said to this batch yet"
            body={`Guidance you post to ${cohortLabel(assignments.items.find((a) => a.cohort_cycle_id === cycleId)?.cohort)} appears here with the founders who acted on it. Nothing is inferred — an empty list means you have not posted, not that nobody read.`}
          />
        )}
      >
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {[
            { label: 'Posted', value: counts ? counts.broadcast : null, note: 'guidance you wrote to the batch' },
            { label: 'Open questions', value: counts ? counts.open : null, note: 'asked by a founder, not yet answered' },
            { label: 'Answered', value: counts ? counts.answered : null, note: 'archive, this batch' },
            {
              label: 'Median response',
              // Null, not zero. See the docblock.
              value: counts && counts.medianResponseHours != null ? `${counts.medianResponseHours}h` : null,
              note: 'across answered questions',
            },
          ].map((t) => (
            <Card key={t.label} className="px-3 py-2.5">
              <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">{t.label}</div>
              {t.value === null || t.value === undefined
                ? <div className="mt-1.5"><Unrecorded /></div>
                : <div className="mt-1 text-base font-extrabold tabular-nums tracking-tight">{t.value}</div>}
              <div className="mt-1 text-[10px] leading-snug text-axal-ink-3">{t.note}</div>
            </Card>
          ))}
        </div>

        <StatedLimit title="No “overdue” count, on purpose">
          <p>
            The design shows overdue questions against a 24-hour commitment. Nothing in
            the product stores a commitment and you have never been asked for one, so a
            threshold here would be invented and then held against you.
          </p>
          <p>
            {payload?.oldest_open_hours != null
              ? `The longest-waiting open question has been open ${payload.oldest_open_hours} hours. That is a fact; whether it is late is not something this page can say.`
              : 'Nothing is waiting. When a question is open, this states how long it has actually waited.'}
          </p>
        </StatedLimit>

        <Card className="p-4">
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
            Post guidance to this batch
          </div>
          <div className="mt-2.5 space-y-2.5">
            <Field label="What the batch should know">
              <textarea
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className={inputClass}
                placeholder="One thing every founder in this batch should do or know."
              />
            </Field>
            <Field label="Week it applies to" hint="Leave blank if it applies to the whole programme.">
              <input
                type="number" min="1" max="52" value={week}
                onChange={(e) => setWeek(e.target.value)}
                className={inputClass}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" disabled={busy || !draft.trim()} onClick={post} className={buttonClass}>
                Post to the batch
              </button>
              {note && <span className="text-[12px] text-axal-ink-2">{note}</span>}
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="text-sm font-extrabold tracking-tight">This batch</span>
            <span className="text-[11px] text-axal-ink-3">Newest first</span>
          </div>
          <ul className="divide-y divide-axal-border-soft">
            {live.map((gd) => (
              <li key={gd.uid} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={gd.kind === 'question' ? (gd.answer ? 'ok' : 'warn') : 'neutral'}>
                    {gd.kind === 'question' ? (gd.answer ? 'Answered' : 'Open question') : 'Posted'}
                  </Pill>
                  {gd.week_number != null && (
                    <span className="text-[11px] text-axal-ink-3">Week {gd.week_number}</span>
                  )}
                  <span className="text-[11px] text-axal-ink-3">{String(gd.posted_at || '').slice(0, 10)}</span>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed">{gd.body}</p>
                {gd.answer && (
                  <p className="mt-1.5 border-l-2 border-axal-border-soft pl-2.5 text-[12.5px] leading-relaxed text-axal-ink-2">
                    {gd.answer}
                  </p>
                )}
                <div className="mt-1.5 text-[11px] text-axal-ink-3">
                  {/* WHO acted, not how many. A count answers the wrong
                      question for an advisor with twelve founders. */}
                  {gd.acted_by.length
                    ? `Acted on by ${gd.acted_by.map((a) => a.name || `user ${a.user_id}`).join(', ')}`
                    : 'Nobody has recorded acting on this yet'}
                </div>
                <button
                  type="button" disabled={busy} onClick={() => retire(gd.uid)}
                  className="mt-2 text-[11px] text-axal-ink-3 underline hover:text-axal-ink-2"
                >
                  Retire
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </ZoneBody>
      </ZoneBody>
    </div>
  );
}
