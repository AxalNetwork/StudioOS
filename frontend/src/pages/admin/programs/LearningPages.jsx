import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, PhoneRows, usePhoneWidth } from '../../../ui';
import { programsApi } from '../../../lib/api/programs';
import {
  BlockFailed, Card, ChartCard, DIALOG_BODY, DialogButtons, EYE, INPUT, LINK, Pill, Skeleton, SUB, TD, TH, Tile,
} from './parts';
import { useLearnersFor } from './useProgramReads';
import {
  FINISHED_LINE, LEARNER_FOOT, completionRows, enrolledLine, enrolmentsFrom, finishedTotal, learnerRows, refusalSentence,
  shortDay,
} from './programPagesModel';
import {
  ASSIGNED_TO_YOU, ENROLMENTS_NOTE, LEARNING_ADMIN_LINE, NOT_RECORDED, enrolmentWord, learnersFrom, learningFigures,
  learningStatusWord, parseStamp,
} from './programsModel';

/**
 * D953 (#2371), completed by D962 (#2795) on part 1's reads (D954 §6–§8) —
 * Learning (PG12, PG12d): Overview's tiles, Completion by program and
 * Enrolments per week, the programs table with each program's assigned
 * admins, and People, where a learner opens their record as a dialog, by
 * name and never by email. Done and Finished are OD9's rule as D962 sets it.
 * A plain Admin's programs are the ones assigned to them.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (stamp) => {
  const ms = parseStamp(stamp);
  if (ms === null) return NOT_RECORDED;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const nf = (n) => Number(n).toLocaleString('en-US');

export function LearningOverview({ reads, superAdmin }) {
  const f = learningFigures(reads.learning);
  const published = f.state === 'ready' ? f.rows.filter((p) => p?.status === 'published') : [];
  const learnerReads = useLearnersFor(published.map((p) => p.uid), reads.tick, f.state === 'ready');
  const completion = completionRows(published, learnerReads);
  const finished = f.state === 'ready' ? finishedTotal(completion) : { state: f.state };
  const weekly = enrolmentsFrom(reads.weekly);
  const scope = superAdmin ? null : ASSIGNED_TO_YOU;
  const cover = f.state === 'ready' && f.capped ? 'Within the first 500 programs by name.' : null;
  const failed = { state: f.state, reason: 'The learning programs could not be read. That is not the same as none.' };
  const tiles = [
    f.state === 'ready' ? { key: 'published', label: 'Published programs', state: 'ready', value: nf(f.published), sub: scope, cover } : { key: 'published', label: 'Published programs', ...failed },
    f.state === 'ready' ? { key: 'enrolments', label: 'Active learners', state: 'ready', value: nf(f.enrolments), sub: `In published programs. ${ENROLMENTS_NOTE}`, cover } : { key: 'enrolments', label: 'Active learners', ...failed },
    finished.state === 'ready'
      ? { key: 'finished', label: 'Finished', state: 'ready', value: f.enrolments ? `${Math.round((100 * finished.count) / f.enrolments)}%` : nf(0), sub: `${nf(finished.count)} of ${nf(f.enrolments)} · ${FINISHED_LINE}` }
      : { key: 'finished', label: 'Finished', state: finished.state, reason: 'A program’s learners could not be read, so no total is drawn.' },
    weekly.state === 'ready'
      ? { key: 'enrolled', label: 'Enrolled this period', state: 'ready', value: nf(weekly.total), sub: enrolledLine(weekly.weeks) }
      : { key: 'enrolled', label: 'Enrolled this period', state: weekly.state, reason: 'The enrolments could not be read. That is not the same as none.' },
  ];
  const ready = completion.filter((r) => r.state === 'ready');
  const bars = ready.map((r) => ({ key: r.uid, label: r.region ? `${r.name} · ${r.region}` : r.name, ...(r.percent === null ? { value: 0, dash: true, text: 'No learners yet' } : { value: r.percent, text: `${nf(r.finished)} of ${nf(r.learners)} finished` }) }));
  const completionCard = f.state !== 'ready'
    ? { state: f.state, what: 'The learning programs' }
    : {
      state: 'ready', chart: bars.length ? { type: 'hbar', rows: bars, axis: '% finished', max: 100 } : null,
      alt: bars.length ? `Learners finished per program: ${bars.map((b) => b.text).join(', ')}.` : 'No program is published.',
      notes: completion.filter((r) => r.state === 'unreadable').map((r) => `${r.name}: its learners could not be read.`),
      window: 'Every learner enrolled now. Done is OD9’s rule: a course or item completed, an exercise accepted, an exam passed.',
    };
  return (
    <div className="flex flex-col gap-4" data-testid="programs-learning-overview">
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => <Tile key={t.key} t={t} onRetry={reads.reload} />)}
      </div>
      {superAdmin ? null : <p className={`m-0 ${SUB}`} data-testid="programs-learning-admin-line">{LEARNING_ADMIN_LINE}</p>}
      <div className="grid gap-3.5 lg:grid-cols-2">
        <ChartCard title="Completion by program" testId="programs-learning-completion" onRetry={reads.reload} b={completionCard}>
          {f.state === 'ready' && !bars.length && !completion.some((r) => r.state === 'loading') ? <p className={`m-0 ${SUB}`}>No program is published.</p> : null}
        </ChartCard>
        <ChartCard title="Enrolments per week" testId="programs-learning-weekly" onRetry={reads.reload}
          b={weekly.state === 'ready' ? { state: 'ready', chart: weekly.chart, alt: weekly.alt, window: enrolledLine(weekly.weeks) } : { state: weekly.state, what: 'The enrolments' }} />
      </div>
      <Card title="Programs" meta={scope} testId="programs-learning-table">
        {f.state === 'loading' ? <Skeleton lines={3} /> : null}
        {f.state === 'unreadable' ? <BlockFailed what="The learning programs" onRetry={reads.reload} testId="programs-learning-table-unreadable" /> : null}
        {f.state === 'ready' && !f.rows.length ? (
          <p className={`m-0 ${SUB}`} data-testid="programs-learning-none">{superAdmin ? 'No program has been written yet.' : 'No program is assigned to you yet.'}</p>
        ) : null}
        {f.state === 'ready' && f.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[12.5px] text-axal-ink dark:text-gray-100">
              <thead>
                <tr className="border-b border-axal-hairline dark:border-gray-700">
                  {['Program and region', 'Status', 'Enrolment', 'Contents', 'Active enrolments', 'Assigned admins'].map((h) => <th key={h} className={TH}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {f.rows.map((p) => (
                  <tr key={p.uid} className="border-b border-axal-hairline last:border-0 dark:border-gray-800" data-testid={`programs-learning-row-${p.uid}`}>
                    <td className={TD}><span className="font-bold">{p.name}</span>{p.region ? <span className={`block ${SUB}`}>{p.region}</span> : null}</td>
                    <td className={TD}>{learningStatusWord(p.status)}</td>
                    <td className={TD}>{enrolmentWord(p.enrolment)}</td>
                    <td className={`${TD} font-mono`}>{nf(p.contents)}</td>
                    <td className={`${TD} font-mono`}>{nf(p.learners)}</td>
                    <td className={`${TD} font-mono`} data-testid={`programs-learning-row-${p.uid}-admins`}>{Number.isFinite(Number(p.admins)) && p.admins !== null && p.admins !== undefined ? nf(p.admins) : NOT_RECORDED}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {superAdmin
          ? <Link to="/learning/studio/programs" className={`${LINK} self-start`}>Open the program studio</Link>
          : <Link to="/learning/programs" className={`${LINK} self-start`}>Open your programs</Link>}
      </Card>
    </div>
  );
}

/** PG12d: one learner's record, read only, by name. */
function LearnerDialog({ programUid, learner, onClose }) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  useEffect(() => {
    let live = true;
    programsApi.learner(programUid, learner.uid).then(
      (data) => { if (live) setRead({ status: 'ready', data }); },
      (error) => { if (live) setRead({ status: 'error', error }); },
    );
    return () => { live = false; };
  }, [programUid, learner.uid]);
  const p = read.data?.program;
  const l = read.data?.learner;
  const rows = read.status === 'ready' ? learnerRows(read.data.contents, l) : [];
  const title = l?.name || learner.name || 'Name not recorded';
  const sub = read.status === 'ready'
    ? [p ? [p.name, p.region].filter(Boolean).join(' · ') : null, `last activity ${shortDay(l?.last_activity_at) || NOT_RECORDED.toLowerCase()}`].filter(Boolean).join(' · ')
    : null;
  return (
    <Lightbox label={title} title={title} sub={sub} onClose={onClose} testId="programs-learner-dialog"
      footer={<DialogButtons onClose={onClose} back="Close" testId="programs-learner" />}>
      <div className={DIALOG_BODY}>
        {read.status === 'loading' ? <Skeleton lines={4} /> : null}
        {read.status === 'error' ? <p role="alert" className="m-0 text-[13px] font-semibold text-red-700 dark:text-red-300" data-testid="programs-learner-refused">{refusalSentence(read.error, 'This learner’s record could not be read. That is not the same as none.')}</p> : null}
        {read.status === 'ready' && !rows.length ? <p className={`m-0 ${SUB}`}>This program holds no content yet.</p> : null}
        {rows.length ? (
          <ul className="m-0 flex list-none flex-col p-0" data-testid="programs-learner-rows">
            {rows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-700" data-testid={`programs-learner-row-${r.key}`}>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className={EYE}>{r.kind}</span>
                  <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{r.title}</span>
                  {r.extra ? <span className={SUB}>{r.extra}</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  <Pill tone={r.done ? 'green' : 'muted'}>{r.word}</Pill>
                  <span className="font-mono text-[12px] font-semibold text-axal-muted dark:text-gray-400">{r.date}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className={`m-0 ${SUB}`} data-testid="programs-learner-foot">{LEARNER_FOOT}</p>
      </div>
    </Lightbox>
  );
}

/** People: one program, picked from the list; a learner opens their record. */
export function LearningPeople({ reads, programUid, onPick }) {
  const phone = usePhoneWidth();
  const [open, setOpen] = useState(null);
  const f = learningFigures(reads.learning);
  const l = learnersFrom(reads.learners);
  return (
    <Card title="Learners" testId="programs-learning-people">
      {f.state === 'loading' ? <Skeleton lines={1} /> : null}
      {f.state === 'unreadable' ? <BlockFailed what="The learning programs" onRetry={reads.reload} testId="programs-learning-people-unreadable" /> : null}
      {f.state === 'ready' && !f.rows.length ? <p className={`m-0 ${SUB}`}>No program to pick yet.</p> : null}
      {f.state === 'ready' && f.rows.length ? (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">Program</span>
          <select className={INPUT} value={programUid || ''} onChange={(e) => onPick(e.target.value || null)} data-testid="programs-learning-pick">
            <option value="">Choose a program…</option>
            {f.rows.map((p) => <option key={p.uid} value={p.uid}>{p.region ? `${p.name} · ${p.region}` : p.name}</option>)}
          </select>
        </label>
      ) : null}
      {f.state === 'ready' && !programUid && f.rows.length ? <p className={`m-0 ${SUB}`}>Pick a program to read its learners.</p> : null}
      {programUid ? (
        <div className="flex flex-col gap-2" data-testid="programs-learning-learners">
          {l.state === 'loading' ? <Skeleton lines={2} /> : null}
          {l.state === 'unreadable' ? <BlockFailed what="This program’s learners" onRetry={reads.reload} testId="programs-learning-learners-unreadable" /> : null}
          {l.state === 'refused' ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-amber-800 dark:text-amber-300" data-testid="programs-learning-learners-refused">{l.text}</p> : null}
          {l.state === 'ready' && !l.learners.length ? <p className={`m-0 ${SUB}`}>No one is enrolled in this program now.</p> : null}
          {l.state === 'ready' && l.learners.length ? <p className="m-0 font-mono text-[12px] font-semibold text-axal-muted dark:text-gray-400" data-testid="programs-learning-learners-count">{`${nf(l.learners.length)} enrolled now`}</p> : null}
          {l.state === 'ready' && l.learners.length && phone ? (
            <PhoneRows groups={[{ label: null, rows: l.learners.map((x) => ({ key: x.uid, title: x.name || 'Name not recorded', description: `Enrolled ${day(x.enrolled_at)}`, onClick: () => setOpen(x), testid: `programs-learning-learner-${x.uid}` })) }]} />
          ) : null}
          {l.state === 'ready' && l.learners.length && !phone ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {l.learners.map((x) => (
                <li key={x.uid} className="border-t border-axal-hairline first:border-t-0 dark:border-gray-700" data-testid={`programs-learning-learner-${x.uid}`}>
                  <button type="button" onClick={() => setOpen(x)} className="flex min-h-[40px] w-full flex-wrap items-baseline justify-between gap-2 py-2 text-left hover:bg-axal-ground dark:hover:bg-gray-800" data-testid={`programs-learning-learner-${x.uid}-open`}>
                    <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{x.name || 'Name not recorded'}</span>
                    <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{`Enrolled ${day(x.enrolled_at)}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {open && programUid ? <LearnerDialog programUid={programUid} learner={open} onClose={() => setOpen(null)} /> : null}
    </Card>
  );
}
