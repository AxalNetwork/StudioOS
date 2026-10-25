import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { usePhoneWidth } from '../../../ui';
import { GrantBadge, MovedNotice, StatusPill, SUB, Unread } from './parts';
import { NOT_RECORDED, PAGES, crumbText, movedNotice, programByKey, withoutMoved } from './programsModel';

const CRUMB = 'font-mono text-[11px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const CRUMB_LINK = 'text-axal-muted hover:text-axal-violet dark:text-gray-400 dark:hover:text-violet-300';

/**
 * D953 (#2371) — the frame every program page draws inside its routed file's
 * `AdminBoardFrame`: the crumb "Programs › [Program]" ("‹ Programs" on a
 * phone) back to the catalogue, the header (the title at 24 px, the status
 * pill and grant badge as on the card, the program's line, and the facts
 * strip where the canvas draws one), the moved notice where a redirect lands,
 * then the tab strip and the tab. There is no ⋯ menu: Pause waits for
 * OD-PAUSE, and the CSV for S-CSV.
 */
export default function ProgramFrame({ program, superAdmin = false, actions = null, tabs = null, children }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const phone = usePhoneWidth();
  const page = PAGES[program];
  const card = programByKey(program);
  const moved = movedNotice(loc.pathname, loc.search);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pb-24 pt-6 sm:px-6 lg:pb-10" data-testid={`programs-page-${program}`}>
      <nav aria-label="Breadcrumb" className={CRUMB} data-testid="programs-crumb">
        {phone
          ? <Link to="/admin/programs" className={CRUMB_LINK}>{crumbText(program, true)}</Link>
          : <><Link to="/admin/programs" className={CRUMB_LINK}>Programs</Link>{` › ${page.title}`}</>}
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3" data-testid="programs-header">
        <div className="flex min-w-0 flex-col gap-[7px]">
          <h1 className="m-0 text-[24px] font-extrabold leading-tight tracking-[-.02em] text-axal-ink dark:text-gray-100">{page.title}</h1>
          <div className="flex flex-wrap gap-1.5">
            <StatusPill status={card.status} testId="programs-header-status" />
            <GrantBadge grant={superAdmin ? card.hqGrant : card.grant} testId="programs-header-grant" />
          </div>
          {page.line
            ? <p className="m-0 text-[13.5px] leading-normal text-axal-muted dark:text-gray-400" data-testid="programs-header-line">{page.line}</p>
            : <Unread word={NOT_RECORDED} reason={page.lineReason} testId="programs-header-line" />}
          {page.whoReason ? <span className={SUB} data-testid="programs-header-who">{`Who: ${NOT_RECORDED}. ${page.whoReason}`}</span> : null}
        </div>
        {actions}
      </header>

      {page.facts ? (
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] border border-axal-hairline bg-white px-3 py-2 text-[12.5px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="programs-facts">
          {page.facts.map((f, i) => <span key={f}>{i ? `· ${f}` : f}</span>)}
        </p>
      ) : null}

      <MovedNotice text={moved} onDismiss={() => navigate({ pathname: loc.pathname, search: withoutMoved(loc.search), hash: loc.hash }, { replace: true })} />

      {tabs}
      {children}
    </div>
  );
}
