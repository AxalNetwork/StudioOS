import React from 'react';
import { Link } from 'react-router-dom';
import { BlockFailed, Card, INPUT, LINK, Skeleton, SUB, TD, TH, Tile } from './parts';
import {
  ASSIGNED_TO_YOU, ENROLMENTS_NOTE, LEARNING_ADMIN_LINE, enrolmentWord, learnersFrom, learningFigures,
  learningStatusWord, parseStamp,
} from './programsModel';

/**
 * D953 (#2371) — Learning (PG12): Overview's two tiles and programs table
 * from R9, and People from R10. The tiles count enrolments, not people, in
 * published programs only; the table lists every row with its own status
 * and its own count. A plain Admin's programs are the ones assigned to them.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (stamp) => {
  const ms = parseStamp(stamp);
  if (ms === null) return 'Not recorded';
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export function LearningOverview({ reads, superAdmin }) {
  const f = learningFigures(reads.learning);
  const scope = superAdmin ? null : ASSIGNED_TO_YOU;
  const cover = f.state === 'ready' && f.capped ? 'Within the first 500 programs by name.' : null;
  const tiles = f.state === 'ready'
    ? [
      { key: 'published', label: 'Published programs', state: 'ready', value: f.published.toLocaleString('en-US'), sub: scope, cover },
      { key: 'enrolments', label: 'Active enrolments', state: 'ready', value: f.enrolments.toLocaleString('en-US'), sub: `In published programs. ${ENROLMENTS_NOTE}`, cover },
    ]
    : ['published', 'enrolments'].map((key) => ({ key, label: key === 'published' ? 'Published programs' : 'Active enrolments', state: f.state, reason: 'The learning programs could not be read. That is not the same as none.' }));
  return (
    <div className="flex flex-col gap-4" data-testid="programs-learning-overview">
      <div className="grid gap-3.5 sm:grid-cols-2">
        {tiles.map((t) => <Tile key={t.key} t={t} onRetry={reads.reload} />)}
      </div>
      {superAdmin ? null : <p className={`m-0 ${SUB}`} data-testid="programs-learning-admin-line">{LEARNING_ADMIN_LINE}</p>}
      <Card title="Programs" meta={scope} testId="programs-learning-table">
        {f.state === 'loading' ? <Skeleton lines={3} /> : null}
        {f.state === 'unreadable' ? <BlockFailed what="The learning programs" onRetry={reads.reload} testId="programs-learning-table-unreadable" /> : null}
        {f.state === 'ready' && !f.rows.length ? (
          <p className={`m-0 ${SUB}`} data-testid="programs-learning-none">{superAdmin ? 'No program has been written yet.' : 'No program is assigned to you yet.'}</p>
        ) : null}
        {f.state === 'ready' && f.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-[12.5px] text-axal-ink dark:text-gray-100">
              <thead>
                <tr className="border-b border-axal-hairline dark:border-gray-700">
                  {['Program and region', 'Status', 'Enrolment', 'Contents', 'Active enrolments'].map((h) => <th key={h} className={TH}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {f.rows.map((p) => (
                  <tr key={p.uid} className="border-b border-axal-hairline last:border-0 dark:border-gray-800" data-testid={`programs-learning-row-${p.uid}`}>
                    <td className={TD}><span className="font-bold">{p.name}</span>{p.region ? <span className={`block ${SUB}`}>{p.region}</span> : null}</td>
                    <td className={TD}>{learningStatusWord(p.status)}</td>
                    <td className={TD}>{enrolmentWord(p.enrolment)}</td>
                    <td className={`${TD} font-mono`}>{Number(p.contents).toLocaleString('en-US')}</td>
                    <td className={`${TD} font-mono`}>{Number(p.learners).toLocaleString('en-US')}</td>
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

/** People: one program, picked from the list, and its learners by name and enrolment date, never an email. */
export function LearningPeople({ reads, programUid, onPick }) {
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
          {l.state === 'ready' && l.learners.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {l.learners.map((x) => (
                <li key={x.uid} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-700" data-testid={`programs-learning-learner-${x.uid}`}>
                  <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{x.name || 'Name not recorded'}</span>
                  <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{`Enrolled ${day(x.enrolled_at)}`}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
