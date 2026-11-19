import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CARD, EYE, H2, LINK, MONO, SUB } from './labParts';
import { LAB_PATH, labParticipation } from './labModel';

/**
 * D5893 (#5893) — the shell's Participation section (PG03), drawn from the
 * Lab's own records: D946's participants read (everyone it lists, and how
 * each stands this week) and the cohort calendar (each cohort's founders).
 * Each part answers alone; one that fails says so with Try again, and a
 * count a read did not carry is "Not recorded" with its reason, never 0.
 */

function Failed({ reason, onRetry, testId }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <span className="text-[13px] font-bold text-axal-destructive dark:text-red-400">Unreadable</span>
      <span className={SUB}>{reason}</span>
      <button type="button" onClick={onRetry} className="self-start text-[12.5px] font-bold text-axal-destructive underline dark:text-red-400">Try again</button>
    </div>
  );
}

const Reading = ({ testId }) => <span className="font-mono text-[13px] text-axal-muted dark:text-gray-400" data-testid={testId}>Reading…</span>;

export default function LabParticipation({ reads, reload }) {
  const { founders, cohorts } = useMemo(() => labParticipation(reads.people, reads.timeline), [reads.people, reads.timeline]);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2" data-testid="lab-participation">
      <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="lab-participation-founders-h" data-testid="lab-participation-founders">
        <h2 id="lab-participation-founders-h" className={H2}>Founders taking part</h2>
        {founders.state === 'loading' ? <Reading testId="lab-participation-founders-loading" /> : null}
        {founders.state === 'unreadable' ? <Failed reason={founders.reason} onRetry={reload} testId="lab-participation-founders-unreadable" /> : null}
        {founders.state === 'ready' ? (
          <>
            <span className={`${MONO} text-[26px] font-medium`} data-testid="lab-participation-everyone">{founders.value}</span>
            <span className={SUB}>Everyone the participants list holds. This week, by the Lab’s clock:</span>
            <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] text-axal-ink dark:text-gray-100">
              {founders.rows.map((r) => (
                <React.Fragment key={r.key}>
                  <dt className={EYE}>{r.label}</dt>
                  <dd className={`m-0 ${MONO}`} data-testid={`lab-participation-${r.key}`}>{r.value ?? 'Not recorded'}</dd>
                </React.Fragment>
              ))}
            </dl>
            {founders.notRead ? <p className={`m-0 ${SUB}`} data-testid="lab-participation-not-read">{founders.notRead}</p> : null}
            {founders.partial ? <p className={`m-0 ${SUB}`} data-testid="lab-participation-partial">{founders.partial}</p> : null}
            <Link to={`${LAB_PATH}/participants`} className={`${LINK} self-start`}>Open Participants</Link>
          </>
        ) : null}
      </section>
      <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="lab-participation-cohorts-h" data-testid="lab-participation-cohorts">
        <h2 id="lab-participation-cohorts-h" className={H2}>Founders by cohort</h2>
        {cohorts.state === 'loading' ? <Reading testId="lab-participation-cohorts-loading" /> : null}
        {cohorts.state === 'unreadable' ? <Failed reason={cohorts.reason} onRetry={reload} testId="lab-participation-cohorts-unreadable" /> : null}
        {cohorts.state === 'ready' && !cohorts.rows.length ? <p className={`m-0 ${SUB}`}>The calendar holds no cohort yet.</p> : null}
        {cohorts.state === 'ready' && cohorts.rows.length ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {cohorts.rows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-3 text-[13px] text-axal-ink dark:text-gray-100" data-testid={`lab-participation-cohort-${r.key}`}>
                <Link to={`${LAB_PATH}/cohorts/${r.key}`} className={LINK}>{r.label}</Link>
                {r.value !== null ? <span className={MONO}>{r.value}</span> : <span className={SUB}>{r.unrecorded}</span>}
              </li>
            ))}
          </ul>
        ) : null}
        <span className={SUB}>The twelve newest cohorts on the calendar.</span>
      </section>
    </div>
  );
}
