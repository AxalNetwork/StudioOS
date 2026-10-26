import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dataRoomApi } from '../../../lib/api/dataRoom';
import { Unreadable } from '../../../ui';
import { HOME_PATH, TABS, tabHref, tabSearch } from './dataRoomModel';
import { MATCH_NOTE, PROPOSALS_WAIT, READINESS_PATH, READINESS_WAIT, areasOf, summaryLine } from './checklistModel';

/**
 * D1108 (#2988) — Checklist (DR12): the twelve diligence items in their six
 * areas, each with its state, the files that answer it, their gates and how
 * many investors with access can open each, from D1105's read. A missing item
 * links to Files (Match to checklist) and Upload; an item no investor can open
 * links to Files, where the gate is changed. Those writes stay where they are,
 * each behind its own dialog: this tab changes nothing.
 *
 * DR14, Eadwyn's proposals, and the readiness figure say what they wait for
 * (`checklistModel.js`): nothing is offered to accept.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const LINK = 'inline-flex min-h-[30px] items-center rounded-[9px] border border-axal-hairline bg-white px-2.5 text-[12px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const CHIP = 'inline-flex rounded-full border border-axal-hairline px-2 py-0.5 text-[10.5px] font-bold text-axal-muted dark:border-gray-700 dark:text-gray-400';
const PILL = {
  pos: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  warn: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  missing: 'border-dashed border-axal-muted bg-white text-axal-muted dark:border-gray-500 dark:bg-gray-900 dark:text-gray-400',
};
const EADWYN = 'flex h-6 w-6 flex-none items-center justify-center rounded-full bg-axal-lavender text-[11px] font-extrabold text-axal-violet-deep dark:bg-violet-900/40 dark:text-[#a78bfa]';

function Item({ item, search }) {
  const files = tabHref(TABS.find((t) => t.id === 'files'), search);
  const upload = `${HOME_PATH}/new${tabSearch(search)}`;
  return (
    <li className="flex flex-col gap-1.5 border-t border-axal-hairline py-2.5 first:border-t-0 dark:border-gray-800" data-testid="dataroom-checklist-item" data-state={item.state}>
      <span className={`text-[13.5px] font-bold ${INK}`}>{item.label}</span>
      <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-bold ${PILL[item.pill.tone]}`}>{item.pill.mark ? `${item.pill.mark} ` : ''}{item.pill.label}</span>
      {item.sub ? <span className={`text-[12px] ${MUTED}`} data-testid="dataroom-checklist-reason">{item.sub}</span> : null}
      {item.files.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {item.files.map((f) => (
            <li key={f.uid} className="flex flex-wrap items-center gap-1.5 text-[12.5px]" data-testid="dataroom-checklist-file">
              <span className={`font-semibold ${INK}`}>{f.name}</span>
              {f.chips.map((c) => <span key={c} className={CHIP}>{c}</span>)}
              <span className={`text-[11.5px] ${MUTED}`}>· {f.opens}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {item.next.length ? (
        <span className="flex flex-wrap gap-1.5">
          {item.next.includes('match') ? <Link className={LINK} to={files} data-testid="dataroom-checklist-match">Match a file</Link> : null}
          {item.next.includes('upload') ? <Link className={LINK} to={upload} data-testid="dataroom-checklist-upload">Upload</Link> : null}
          {item.next.includes('gate') ? <Link className={LINK} to={files} data-testid="dataroom-checklist-gate">Change the gate in Files</Link> : null}
        </span>
      ) : null}
    </li>
  );
}

export default function DataRoomChecklist({ projectUid, search = '' }) {
  const [state, setState] = useState({ status: 'loading', read: null });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!projectUid) return undefined;
    let alive = true;
    setState({ status: 'loading', read: null });
    dataRoomApi.checklist(projectUid)
      .then((read) => { if (alive) setState({ status: 'ready', read }); })
      .catch(() => { if (alive) setState({ status: 'error', read: null }); });
    return () => { alive = false; };
  }, [projectUid, reload]);

  let items;
  if (state.status === 'loading') items = <div className="h-40 w-full animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid="dataroom-checklist-loading" />;
  else if (state.status === 'error') {
    items = (
      <div data-testid="dataroom-checklist-unreadable">
        <Unreadable what="The checklist" claim="This is not a claim that no item is answered." onRetry={() => setReload((n) => n + 1)} />
      </div>
    );
  } else {
    items = (
      <div className="flex flex-col gap-3">
        <p className={`m-0 text-[12.5px] font-semibold ${INK}`} data-testid="dataroom-checklist-summary">{summaryLine(state.read)}</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {areasOf(state.read).map((a) => (
            <section key={a.area} className={`${CARD} px-4 py-3`} data-testid="dataroom-checklist-area">
              <div className="flex items-baseline justify-between gap-2 pb-1">
                <span className="flex flex-col"><span className={EYEBROW}>{a.area}</span><h2 className={`m-0 text-[15px] font-extrabold ${INK}`}>{a.area}</h2></span>
                <span className={`font-mono text-[12px] font-bold ${INK}`}>{a.meta}</span>
              </div>
              <ul className="m-0 list-none p-0">{a.items.map((i) => <Item key={i.key} item={i} search={search} />)}</ul>
            </section>
          ))}
        </div>
        <p className={`m-0 text-[11.5px] ${MUTED}`}>{MATCH_NOTE}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]" data-testid="dataroom-checklist">
      <div className="min-w-0">{items}</div>
      <div className="flex flex-col gap-3">
        <section className={`${CARD} px-4 py-3`} data-testid="dataroom-proposals">
          <div className="flex items-center gap-2 pb-2">
            <span className={EADWYN} aria-hidden="true">E</span>
            <h2 className={`m-0 text-[15px] font-extrabold ${INK}`}>Eadwyn proposals</h2>
          </div>
          <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="dataroom-proposals-wait">{PROPOSALS_WAIT}</p>
        </section>
        <section className={`${CARD} px-4 py-3`} data-testid="dataroom-readiness">
          <h2 className={`m-0 pb-1 text-[15px] font-extrabold ${INK}`}>In Fundraising readiness</h2>
          <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="dataroom-readiness-wait">{READINESS_WAIT}</p>
          <Link className={`${LINK} mt-2`} to={`${READINESS_PATH}${tabSearch(search)}`} data-testid="dataroom-readiness-open">Open Fundraising readiness</Link>
        </section>
      </div>
    </div>
  );
}
