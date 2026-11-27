import React, { useCallback, useEffect, useState } from 'react';
import { PhoneRows, usePhoneWidth } from '../../../ui';
import { programsApi } from '../../../lib/api/programs';
import { reportError } from '../../../lib/log';
import { BlockFailed, Card, LINK, Skeleton, SUB } from './parts';
import { ACTIVITY_EMPTY, ACTIVITY_PAGE, activityFrom, activityText, shortDay } from './programPagesModel';
import { NOT_RECORDED } from './programsModel';

/**
 * D962 (#2795) — a program's Activity: part 1's activity read (D954 §10),
 * newest first, 50 a page, with "Show older" on its cursor. Each tab draws
 * what that read serves for its program and nothing more: what it does not
 * list yet is a visible line (`gap`), and what the Worker names as not
 * audited yet is its own line (`not_audited`), never an empty list. No person
 * is named, because the read serves none.
 */

/** One activity read, and the pages "Show older" adds to it. */
export function useActivity(program, { enabled = true, limit = ACTIVITY_PAGE } = {}) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null, at: null });
  const [older, setOlder] = useState({ rows: [], next: undefined, busy: false, failed: false });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    setState((s) => (s.status === 'ready' ? s : { status: 'loading', data: null, error: null, at: null }));
    setOlder({ rows: [], next: undefined, busy: false, failed: false });
    programsApi.activity(program, { limit }).then(
      (data) => { if (live) setState({ status: 'ready', data, error: null, at: Date.now() }); },
      (error) => { reportError(`admin-programs:activity:${program}`, error); if (live) setState({ status: 'error', data: null, error, at: null }); },
    );
    return () => { live = false; };
  }, [program, enabled, limit, tick]);
  const more = async (cursor) => {
    setOlder((o) => ({ ...o, busy: true, failed: false }));
    try {
      const data = await programsApi.activity(program, { limit, before: cursor });
      setOlder((o) => ({ rows: [...o.rows, ...(Array.isArray(data?.rows) ? data.rows : [])], next: data?.next_before || null, busy: false, failed: false }));
    } catch (e) {
      reportError(`admin-programs:activity-older:${program}`, e);
      setOlder((o) => ({ ...o, busy: false, failed: true }));
    }
  };
  return { read: state, older, more, reload };
}

function Rows({ rows, cycles, phone, testId }) {
  if (phone) {
    return (
      <PhoneRows groups={[{ label: null, rows: rows.map((r, i) => ({ key: `${r.at}-${i}`, title: activityText(r, cycles), value: shortDay(r.at) || NOT_RECORDED, testid: `${testId}-row-${i}` })) }]} />
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {rows.map((r, i) => (
        <li key={`${r.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-axal-hairline py-2.5 first:border-t-0 dark:border-gray-700" data-testid={`${testId}-row-${i}`}>
          <span className="text-[13px] leading-snug text-axal-ink dark:text-gray-100">{activityText(r, cycles)}</span>
          <span className="font-mono text-[12px] font-semibold text-axal-muted dark:text-gray-400">{shortDay(r.at) || NOT_RECORDED}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The lines every Activity block carries: what the read does not list yet
 * (`gap`, the page's), what the Worker says is not audited yet, and, on
 * Learning for an Admin, that only their programs' rows are read.
 */
export function ActivityLines({ a, gap, testId }) {
  return (
    <>
      {gap ? <p className={`m-0 ${SUB}`} data-testid={`${testId}-gap`}>{gap}</p> : null}
      {a.state === 'ready' && a.notAudited ? <p className={`m-0 ${SUB}`} data-testid={`${testId}-not-audited`}>{a.notAudited}</p> : null}
      {a.state === 'ready' && a.assignedOnly ? <p className={`m-0 ${SUB}`} data-testid={`${testId}-assigned`}>Only the programs assigned to you are listed.</p> : null}
    </>
  );
}

/** The Activity tab: every row the read serves for this program, newest first. */
export default function ActivityTab({ program, cycles = [], gap = null, testId = 'programs-activity' }) {
  const phone = usePhoneWidth();
  const { read, older, more, reload } = useActivity(program);
  const a = activityFrom(read);
  const rows = a.state === 'ready' ? [...a.rows, ...older.rows] : [];
  const next = older.next === undefined ? (a.state === 'ready' ? a.next : null) : older.next;
  return (
    <Card title="Activity" meta={a.state === 'ready' ? `${rows.length.toLocaleString('en-US')} shown, newest first` : null} testId={testId}>
      <ActivityLines a={a} gap={gap} testId={testId} />
      {a.state === 'loading' ? <Skeleton lines={3} /> : null}
      {a.state === 'unreadable' ? <BlockFailed what="This program’s activity" onRetry={reload} testId={`${testId}-unreadable`} /> : null}
      {a.state === 'ready' && !rows.length ? <p className={`m-0 ${SUB}`} data-testid={`${testId}-empty`}>{ACTIVITY_EMPTY}</p> : null}
      {rows.length ? <Rows rows={rows} cycles={cycles} phone={phone} testId={testId} /> : null}
      {next ? (
        <button type="button" className={`${LINK} self-start`} disabled={older.busy} onClick={() => more(next)} data-testid={`${testId}-older`}>
          {older.busy ? 'Reading…' : 'Show older'}
        </button>
      ) : null}
      {older.failed ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid={`${testId}-older-failed`}>The older rows could not be read. The rows above still stand.</p> : null}
    </Card>
  );
}

/** Mentor's Recent activity (item 5): the five newest rows, with See all to the Activity tab. */
export function RecentActivity({ read, cycles = [], gap = null, onRetry, seeAll, testId = 'programs-recent' }) {
  const a = activityFrom(read);
  return (
    <Card title="Recent activity" meta={seeAll} testId={testId}>
      <ActivityLines a={a} gap={gap} testId={testId} />
      {a.state === 'loading' ? <Skeleton lines={3} /> : null}
      {a.state === 'unreadable' ? <BlockFailed what="This program’s activity" onRetry={onRetry} testId={`${testId}-unreadable`} /> : null}
      {a.state === 'ready' && !a.rows.length ? <p className={`m-0 ${SUB}`} data-testid={`${testId}-empty`}>{ACTIVITY_EMPTY}</p> : null}
      {a.state === 'ready' && a.rows.length ? <Rows rows={a.rows} cycles={cycles} phone={false} testId={testId} /> : null}
    </Card>
  );
}
