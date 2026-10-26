/**
 * D1244 (#2385) — Due diligence's tabs as addresses (DDL1, DDL3): the list's
 * Cases · My reviews · Templates, and the case's nine tabs. Mounted by
 * `AdminDueDiligencePage.jsx` and `AdminDueDiligenceCasePage.jsx` under both
 * `/admin/due-diligence` and `/due-diligence`. A tab no read carries yet says
 * "Not read here yet" with its reason (`ddModel.WAITS`), never a zero.
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CASE_TABS, NOT_YET, ON_OVERVIEW, WAITS } from './ddModel';

const tabCls = (on) => `whitespace-nowrap border-b-2 px-1 pb-2 text-[13.5px] font-semibold ${on ? 'border-violet-600 text-gray-900 dark:border-violet-400 dark:text-gray-100' : 'border-transparent text-axal-muted hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'}`;
const box = 'flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';

export function DdWait({ id }) {
  return (
    <div className="flex flex-col gap-1" data-testid={`dd-wait-${id}`}>
      <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">{WAITS[id]}</p>
    </div>
  );
}

/** DDL1's tabs. Each is a link; the open one is underlined in violet. */
export function DdListTabs({ active }) {
  const { pathname } = useLocation();
  const base = pathname.startsWith('/admin') ? '/admin/due-diligence' : '/due-diligence';
  return (
    <nav aria-label="Due diligence" className="mb-5 flex gap-5 overflow-x-auto border-b border-axal-hairline dark:border-gray-800" data-testid="dd-list-tabs">
      <Link to={base} aria-current={active === 'cases' ? 'page' : undefined} className={tabCls(active === 'cases')} data-testid="dd-tab-cases">Cases</Link>
      <Link to={`${base}/my-reviews`} aria-current={active === 'my-reviews' ? 'page' : undefined} className={tabCls(active === 'my-reviews')} data-testid="dd-tab-my-reviews">My reviews</Link>
      <Link to={`${base}/templates`} aria-current={active === 'templates' ? 'page' : undefined} className={tabCls(active === 'templates')} data-testid="dd-tab-templates">Templates</Link>
    </nav>
  );
}

/** My reviews (DDL12) waits for part 8 (#3267). D1250 draws Templates (`DdTemplates.jsx`). */
export function DdListTabBody({ tab }) {
  return (
    <section className={box} data-testid={`dd-list-${tab}`}>
      <DdWait id={tab} />
    </section>
  );
}

/** DDL3's tabs, each its own address. The bare case address, which emails and notices carry, opens Overview too. */
export function DdCaseTabs({ uid, active }) {
  const { pathname } = useLocation();
  const base = pathname.startsWith('/admin') ? '/admin/due-diligence' : '/due-diligence';
  return (
    <nav aria-label="Case" className="mb-5 flex gap-5 overflow-x-auto border-b border-axal-hairline dark:border-gray-800" data-testid="dd-case-tabs">
      {CASE_TABS.map((t) => (
        <Link
          key={t.key}
          to={`${base}/${uid}/${t.key}`}
          aria-current={active === t.key ? 'page' : undefined}
          className={tabCls(active === t.key)}
          data-testid={`dd-case-tab-${t.key}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** A case tab other than Overview: where today's blocks are drawn, then what waits. */
export function DdCaseTabBody({ uid, tab }) {
  const { pathname } = useLocation();
  const base = pathname.startsWith('/admin') ? '/admin/due-diligence' : '/due-diligence';
  return (
    <section className={box} data-testid={`dd-case-${tab}`}>
      <p className="m-0 text-sm">
        {ON_OVERVIEW[tab]}{' '}
        <Link to={`${base}/${uid}`} className="font-semibold text-violet-700 underline dark:text-violet-300">Open Overview</Link>
      </p>
      {WAITS[tab] && <DdWait id={tab} />}
      {tab === 'sign-off' && <DdWait id="decision" />}
    </section>
  );
}
