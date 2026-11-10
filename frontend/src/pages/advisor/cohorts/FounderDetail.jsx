import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sheet } from '../../../ui';
import { cohortFounderApi } from '../../../lib/api/advisorCohortFounder.js';
import { Unrecorded } from '../expertise/kit';
import { FromTheLab } from './kit';
import { StatusBadge, useCohortWorkspace } from './CohortWorkspace';
import { createRequestGate, guardedRead } from './cohortModel';
import {
  DETAIL_SECTIONS, LIVE_STATES, NOT_VISIBLE, activityRows, evidenceRows, fetchFounderDetail,
  guidanceRows, milestoneRows, overviewOf, sessionRows,
} from './founderDetailModel';

/**
 * Cohorts › Founders › one founder (D4813 board C4, package 4 of #4813).
 *
 * A SHEET, NOT A PAGE. `ui/Sheet` is the repository's one detail panel: a
 * dialog named by its title, focus moved in on open, Tab kept inside, Escape,
 * the × and the scrim close it, and focus returns to the "Open founder"
 * control that opened it. Below 640px it is full screen. It is mounted by
 * Founders while `?detail=<userId>` names a founder, so a link opens it and
 * switching cohort (which clears `detail`) closes it.
 *
 * WHAT IS SHOWN IS WHAT THE WORKER RETURNS. The read refuses a founder who is
 * not in the cohort or who stopped sharing with this advisor (the same 404),
 * and the sheet says only that this founder is not visible. Six labelled
 * sections, each with its own heading:
 *
 *   · Overview — the week now, in words, and whether they are held.
 *   · Milestones — each week's LIVE status (the Lab's row now) and the Lab's
 *     RECORDED decision (when and why, any grace) as two separate fields; a
 *     deadline snapshot is not stored and reads Not recorded.
 *   · Evidence — the done/required count per week. The Lab stores counts, not
 *     the submitted items, and the section says so.
 *   · Guidance — your published guidance to the cohort and this founder's
 *     questions to you, with any recorded action.
 *   · Sessions — your sessions with this founder.
 *   · Activity — what the founder did that something recorded.
 */

const H3 = 'text-[12px] font-extrabold uppercase tracking-[.08em] text-axal-faint';

function useFounderDetail(cycleId, userId) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const gate = useRef(createRequestGate()).current;
  const load = useCallback(() => {
    if (cycleId == null || userId == null) { gate.invalidate(); return undefined; }
    return guardedRead({
      gate,
      fetch: () => fetchFounderDetail(cohortFounderApi.detail, cycleId, userId),
      onState: (s) => setState({ ...s, for: `${cycleId}:${userId}` }),
      fallbackError: 'This founder’s detail could not be read.',
    });
  }, [cycleId, userId, gate]);
  useEffect(() => { load(); return () => gate.invalidate(); }, [load, gate]);
  // Until the read for THIS cohort and founder answers, it is loading.
  if (state.for !== `${cycleId}:${userId}`) return { loading: true, error: '', data: null, reload: load };
  return { ...state, reload: load };
}

function Section({ id, label, children, base }) {
  return (
    <section id={`${base}-${id}`} aria-labelledby={`${base}-${id}-h`} className="border-t border-axal-hairline px-5 py-4 first:border-t-0 dark:border-gray-800" data-section={id}>
      <h3 id={`${base}-${id}-h`} className={H3}>{label}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Failed({ children }) {
  return <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">{children}</p>;
}

/** The six sections, from the read's payload. Exported so a test renders it. */
export function FounderDetailBody({ data, label, guidanceHref, now = Date.now(), base = 'fd' }) {
  const ov = overviewOf(data, now);
  const weeks = milestoneRows(data.milestones, now);
  const evidence = evidenceRows(data.milestones);
  const guidance = guidanceRows(data.guidance);
  const sessions = sessionRows(data.sessions, now);
  const activity = activityRows(data.activity);
  const jump = (id) => {
    try { document.getElementById(`${base}-${id}`)?.scrollIntoView({ block: 'start' }); } catch { /* no DOM */ }
  };
  const sec = Object.fromEntries(DETAIL_SECTIONS);

  return (
    <div data-testid="founder-detail-body">
      <nav aria-label="Founder sections" className="sticky top-0 z-[1] flex gap-1.5 overflow-x-auto border-b border-axal-hairline bg-white px-5 py-2 dark:border-gray-800 dark:bg-gray-950">
        {DETAIL_SECTIONS.map(([id, l]) => (
          <button key={id} type="button" onClick={() => jump(id)}
            className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-axal-hairline px-3 text-[11.5px] font-semibold text-axal-muted hover:border-emerald-400 dark:border-gray-700 dark:text-gray-300 lg:min-h-[32px]">
            {l}
          </button>
        ))}
      </nav>

      <Section id="overview" label={sec.overview} base={base}>
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[12.5px]">
          <dt className="text-axal-faint">Cohort</dt><dd>{label}</dd>
          <dt className="text-axal-faint">Email</dt><dd>{data.founder?.email || <Unrecorded />}</dd>
          <dt className="text-axal-faint">This week</dt>
          <dd>
            {ov.current
              ? <span className="inline-flex flex-wrap items-center gap-1.5"><span className="font-bold">{ov.current.title}</span><StatusBadge state={ov.current.live.state}>{ov.current.live.label}</StatusBadge><span className="text-axal-muted">{ov.current.live.deliverables}</span></span>
              : <Unrecorded>Week not recorded</Unrecorded>}
          </dd>
          {ov.held && (<><dt className="text-axal-faint">Held</dt><dd className="font-bold">{ov.held}</dd></>)}
          <dt className="text-axal-faint">Questions</dt><dd>{guidance ? `${ov.unanswered} waiting for your answer` : <Unrecorded />}</dd>
          <dt className="text-axal-faint">Sessions</dt><dd>{sessions ? `${ov.upcoming} upcoming with you` : <Unrecorded />}</dd>
        </dl>
      </Section>

      <Section id="milestones" label={sec.milestones} base={base}>
        {weeks == null ? <Failed>{data.milestones?.detail || 'The Lab’s week record could not be read.'}</Failed>
          : weeks.length === 0 ? <p className="text-[12px] text-axal-muted">No week windows or week records for this cohort. This cycle predates week windows; that is not zero progress.</p>
            : (
              <ol className="grid gap-2" data-testid="founder-milestones">
                {weeks.map((w) => (
                  <li key={w.week} className={`rounded-[10px] border p-3 ${w.current ? 'border-emerald-300 dark:border-emerald-800' : 'border-axal-hairline dark:border-gray-800'}`} data-week={w.week}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h4 className="text-[12.5px] font-extrabold">{w.title}{w.current ? ' · this week' : ''}</h4>
                      <span className="text-[11px] text-axal-faint">{w.window}</span>
                    </div>
                    <dl className="mt-2 grid gap-1 text-[12px] sm:grid-cols-[150px,1fr]">
                      <dt className="text-axal-faint">Live status</dt>
                      <dd data-field="live" className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge state={w.live.state}>{w.live.label}</StatusBadge>
                        <span>{w.live.deliverables}</span>
                      </dd>
                      <dt className="text-axal-faint">Lab’s recorded decision</dt>
                      <dd data-field="recorded" className={w.decided ? '' : 'italic text-axal-faint'}>{w.recorded}</dd>
                      <dt className="text-axal-faint">At the deadline</dt>
                      <dd data-field="snapshot" className="italic text-axal-faint">{w.snapshot}</dd>
                    </dl>
                  </li>
                ))}
              </ol>
            )}
        <p className="mt-2 text-[11px] text-axal-faint">
          {`Live status is the Lab’s week row as it reads now. The recorded decision is when and why the Lab decided, kept apart from it. What the row said at the deadline is not stored, so it reads Not recorded. States: ${Object.values(LIVE_STATES).map((s) => s.label).join(', ')}.`}
        </p>
      </Section>

      <Section id="evidence" label={sec.evidence} base={base}>
        {evidence == null ? <Failed>The Lab’s week record could not be read.</Failed> : (
          <>
            {evidence.length === 0 ? <p className="text-[12px] text-axal-muted">No deliverable counts are recorded for this founder yet.</p> : (
              <ul className="grid gap-1 text-[12px]" data-testid="founder-evidence">
                {evidence.map((e) => <li key={e.week}><span className="font-bold">{`Week ${e.week}`}</span>{` · ${e.text}`}</li>)}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-axal-faint" data-testid="evidence-counts-only">
              The Lab stores how many deliverables are in, not the submitted work, so no item, file or link is shown here.
            </p>
          </>
        )}
      </Section>

      <Section id="guidance" label={sec.guidance} base={base}>
        {guidance == null ? <Failed>{data.guidance?.detail || 'Your guidance could not be read.'}</Failed>
          : guidance.length === 0 ? <p className="text-[12px] text-axal-muted">You have published no guidance to this cohort, and this founder has asked you nothing.</p> : (
            <ul className="grid gap-2">
              {guidance.map((g) => (
                <li key={g.uid} className="rounded-[10px] border border-axal-hairline p-3 text-[12px] dark:border-gray-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-extrabold">{g.title}</h4>
                    {g.unanswered ? <StatusBadge state="needs_response" /> : g.retired ? <StatusBadge state="retired" /> : g.kind === 'question' ? <StatusBadge state="answered" /> : <StatusBadge state="published" />}
                  </div>
                  <p className="mt-1 whitespace-pre-line text-axal-muted">{g.body}</p>
                  {g.answer && <p className="mt-1"><span className="font-bold">Your answer: </span>{g.answer}</p>}
                  <p className="mt-1 text-[11px] text-axal-faint">{[g.week, g.when, g.acted || (g.kind === 'broadcast' ? 'No action recorded' : null)].filter(Boolean).join(' · ')}</p>
                </li>
              ))}
            </ul>
          )}
        {data.guidance?.truncated && <p className="mt-1 text-[11px] text-axal-faint">The newest 200 are shown; there are more.</p>}
        <p className="mt-2 text-[11px] text-axal-faint">Acknowledgements are not recorded yet: an action shows only where one was recorded.</p>
      </Section>

      <Section id="sessions" label={sec.sessions} base={base}>
        {sessions == null ? <Failed>{data.sessions?.detail || 'Your sessions could not be read.'}</Failed>
          : data.sessions?.profile === false ? <p className="text-[12px] text-axal-muted">You have no advisor profile yet, so no session with you is recorded.</p>
            : sessions.length === 0 ? <p className="text-[12px] text-axal-muted">No session with this founder is recorded.</p> : (
              <ul className="grid gap-1 text-[12px]">
                {sessions.map((s) => (
                  <li key={s.uid} className="flex flex-wrap gap-x-2"><span className="font-bold">{s.when}</span><span>{s.topic}</span><span className="text-axal-faint">{`· ${s.status}`}</span></li>
                ))}
              </ul>
            )}
        <p className="mt-2 text-[11px] text-axal-faint">Only your own sessions with this founder. Notes and prices are not shown here.</p>
      </Section>

      <Section id="activity" label={sec.activity} base={base}>
        {activity.length === 0 ? <p className="text-[12px] text-axal-muted">No recorded action yet.</p> : (
          <ul className="grid gap-1 text-[12px]">
            {activity.map((a) => <li key={a.key}><span className="font-bold">{a.label}</span><span className="text-axal-faint">{` · ${a.when}`}</span></li>)}
          </ul>
        )}
        {data.activity?.complete === false && <p role="status" className="mt-1 text-[11px] text-amber-800 dark:text-amber-200">Partial: a read behind this list failed, so some actions may be missing.</p>}
        <p className="mt-2 text-[11px] text-axal-faint">Recorded actions only: questions to you, actions on your guidance and sessions booked with you. Submissions and Lab decisions are under Milestones, not here.</p>
      </Section>

      <div className="px-5 pb-4">
        <FromTheLab>read-only — milestone decisions belong to the Spin-Out Lab; this founder shares their progress with you</FromTheLab>
        {guidanceHref && (
          <Link to={guidanceHref} className="mt-2 inline-flex min-h-[44px] items-center text-[12px] font-bold text-emerald-800 underline dark:text-emerald-300 lg:min-h-0">Write guidance</Link>
        )}
      </div>
    </div>
  );
}

/** The refusal: a boundary, stated once, with nothing about the founder. */
export function FounderNotVisible() {
  return <p className="px-5 py-4 text-[12.5px] text-axal-muted" data-testid="founder-not-visible">{NOT_VISIBLE}</p>;
}

export default function FounderDetail({ userId, onClose, name }) {
  const ws = useCohortWorkspace();
  const base = useId().replace(/:/g, '');
  const detail = useFounderDetail(ws.cycleId, userId);
  const data = detail.data;
  const title = data?.not_visible ? 'Founder not visible' : (data?.founder?.name || name || 'Founder');

  return (
    <Sheet
      title={title}
      eyebrow={`Founder · ${ws.label || 'this cohort'}`}
      onClose={onClose}
      width={640}
      testId="founder-detail"
      focusKey={data ? 'loaded' : 'loading'}
    >
      {detail.loading ? (
        <p role="status" className="px-5 py-4 text-[12px] text-axal-muted">{`Loading this founder for ${ws.label || 'your cohort'}…`}</p>
      ) : detail.error ? (
        <div className="px-5 py-4">
          <Failed>{detail.error}</Failed>
          <button type="button" onClick={detail.reload} className="mt-2 min-h-[44px] text-[12px] font-bold underline lg:min-h-0">Retry</button>
        </div>
      ) : data?.not_visible ? (
        <FounderNotVisible />
      ) : data ? (
        <FounderDetailBody data={data} label={ws.label || 'this cohort'} guidanceHref={ws.href('/cohorts/guidance')} base={base} />
      ) : null}
    </Sheet>
  );
}
