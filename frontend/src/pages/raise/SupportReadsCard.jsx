import React, { useCallback, useEffect, useState } from 'react';
import { reportError } from '../../lib/log';
import {
  NO_READS, READS_UNREADABLE, SUPPORT_READS_LINE, SUPPORT_READS_TITLE, supportReadRows,
} from './supportReads';

/**
 * D1464 (#4021, RR09): the founder's "Support reads" card on a record an
 * admin opens once per reason. `load(page)` is the record's own read
 * (`dataRoomApi.supportReads`, `capitalRelationshipsApi.supportReads`);
 * `record` picks the empty sentence. Loading, rows, empty, or Unreadable with
 * Try again: an unread list is never drawn as an empty one.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const LINK = `text-[12.5px] font-bold ${INK} underline underline-offset-2`;

export default function SupportReadsCard({ record, load, testId = 'support-reads' }) {
  const [state, setState] = useState({ status: 'loading', rows: [], page: 1, more: false });
  const [reload, setReload] = useState(0);

  const read = useCallback((page, keep) => {
    let alive = true;
    Promise.resolve().then(() => load(page))
      .then((body) => {
        const rows = supportReadRows(body);
        if (!alive) return;
        if (rows == null) { setState({ status: 'error', rows: [], page: 1, more: false }); return; }
        setState({ status: 'ready', rows: [...keep, ...rows], page, more: body.has_more === true });
      })
      .catch((e) => { reportError(`SupportReads:${record}`, e); if (alive) setState({ status: 'error', rows: [], page: 1, more: false }); });
    return () => { alive = false; };
  }, [load, record]);

  useEffect(() => {
    setState({ status: 'loading', rows: [], page: 1, more: false });
    return read(1, []);
  }, [read, reload]);

  let body;
  if (state.status === 'loading') body = <div className="h-12 animate-pulse rounded-lg bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid={`${testId}-loading`} />;
  else if (state.status === 'error') {
    body = (
      <p className={`m-0 flex flex-wrap items-center gap-2 text-[13px] ${INK}`} data-testid={`${testId}-unreadable`}>
        <span className="font-bold">{READS_UNREADABLE}</span>
        <span className={MUTED}>This is not a claim that no admin has read it.</span>
        <button type="button" className={LINK} onClick={() => setReload((n) => n + 1)}>Try again</button>
      </p>
    );
  } else if (!state.rows.length) body = <p className={`m-0 text-[13px] ${MUTED}`} data-testid={`${testId}-empty`}>{NO_READS[record]}</p>;
  else {
    body = (
      <>
        <ul className="m-0 flex list-none flex-col divide-y divide-axal-hairline p-0 dark:divide-gray-800">
          {state.rows.map((r, i) => (
            <li key={r.id ?? i} className="flex flex-col gap-0.5 py-2.5" data-testid={`${testId}-row`}>
              <span className={`text-[13px] font-bold ${INK}`}>{r.who}</span>
              <span className={`text-[13px] ${INK}`}>{r.reason}</span>
              <span className={`text-[12px] ${MUTED}`}>{r.when}</span>
            </li>
          ))}
        </ul>
        {state.more ? <button type="button" className={`w-fit ${LINK}`} onClick={() => read(state.page + 1, state.rows)} data-testid={`${testId}-more`}>Show more</button> : null}
      </>
    );
  }

  return (
    <section className={`${CARD} flex flex-col gap-2 p-4`} aria-label={SUPPORT_READS_TITLE} data-testid={testId}>
      <h3 className={`m-0 text-[14px] font-extrabold ${INK}`}>{SUPPORT_READS_TITLE}</h3>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>{SUPPORT_READS_LINE}</p>
      {body}
    </section>
  );
}
