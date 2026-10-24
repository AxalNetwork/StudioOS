import React, { useCallback, useRef } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Info } from 'lucide-react';

/**
 * D936 (#2375) — the one header every admin page shares, built to the owner's
 * "Admin page header" canvas (SHL1–SHL9, design/incoming/Admin page header.dc.html).
 * It replaces the Admin Console's title and section dropdown: each tool is a
 * page at its own address, and this is what sits above its content.
 *
 * Top to bottom, as SHL1 draws it:
 *   1. the breadcrumb, "Section › Page", the section a link to its overview
 *      (none on a section's own overview); on a phone, a back link "‹ Section";
 *   2. the title row: the h1, its pills, and on the right the page's actions
 *      (at most one primary button, D936 §2);
 *   3. one muted line saying what the page is for, and an optional facts strip;
 *   4. the scope chip, on the Admin shell only;
 *   5. the moved notice, only after an old address forwarded here;
 *   6. the tab bar, only when the page has tabs: `HeaderTab`s, passed as `tabs`.
 *
 * THE HEADER RENDERS AT ONCE. Its title, line and tabs come from the page,
 * never from a read, so a slow or failed read never blanks it (SHL4, SHL6).
 * A tab's count says one of four things and never 0 for a missing value:
 *   { kind: 'num', value }      a number that was read;
 *   { kind: 'dash', tip }       not recorded or not read, with the reason;
 *   { kind: 'dot' }             something waits on you (amber, "waiting" for
 *                               screen readers, since colour is never alone);
 *   { kind: 'load' }            still reading: a short grey bar.
 */

export const HELD_SCOPE_LABEL = 'HQ-held accounts · axal.vc';
export const HELD_SCOPE_TITLE = 'No subsidiary is deployed yet, so these are the accounts HQ holds directly.';

const PILL_TONES = {
  live: 'border-emerald-200 bg-emerald-50 text-axal-positive dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400',
  held: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
  hq: 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100',
};

/**
 * One tab: a link to its own address (D936: no `?tab=`), its label, then its
 * count. A page writes each tab with a literal `to`, so the reachability walk
 * (admin_route_reachability) finds every door. The open tab is underlined
 * violet and carries aria-current="page" (NavLink sets it); `end` is on by
 * default, so a page's Overview is open only at its own address.
 */
export function HeaderTab({ to, end = true, count = null, children, 'data-testid': testId }) {
  return (
    <NavLink
      to={to}
      end={end}
      data-testid={testId}
      className={({ isActive }) => `inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-0.5 text-[13px] sm:min-h-[40px] ${isActive ? 'border-axal-violet font-bold text-axal-ink dark:text-gray-100' : 'border-transparent text-axal-muted hover:text-axal-ink dark:text-gray-400'}`}
    >
      {children}
      <TabCount count={count} />
    </NavLink>
  );
}

function TabCount({ count }) {
  if (!count) return null;
  if (count.kind === 'num') {
    return <span className="font-mono text-[12px] tabular-nums">{count.value}</span>;
  }
  if (count.kind === 'dash') {
    return <span title={count.tip} className="cursor-help font-mono text-[12px]" aria-label={count.tip}>—</span>;
  }
  if (count.kind === 'dot') {
    return (
      <span className="inline-flex items-center">
        <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full border border-axal-amber-deep bg-axal-amber" />
        <span className="sr-only">waiting</span>
      </span>
    );
  }
  if (count.kind === 'load') {
    return <span aria-label="Reading" className="inline-block h-2 w-5 rounded bg-axal-hairline dark:bg-gray-700" />;
  }
  return null;
}

/**
 * The moved notice (SHL3): which sentence to show for `?moved=<key>`, and how
 * to dismiss it. Dismiss drops `moved` from the address, keeping every other
 * query and the hash, so a reload does not show it again.
 */
export function useMovedNotice(notices) {
  const loc = useLocation();
  const navigate = useNavigate();
  const key = new URLSearchParams(loc.search).get('moved');
  const text = key && Object.hasOwn(notices, key) ? notices[key] : null;
  const dismiss = useCallback(() => {
    const next = new URLSearchParams(loc.search);
    next.delete('moved');
    const q = next.toString();
    navigate({ pathname: loc.pathname, search: q ? `?${q}` : '', hash: loc.hash }, { replace: true });
  }, [loc.search, loc.pathname, loc.hash, navigate]);
  return { text, dismiss };
}

export default function AdminPageHeader({
  crumb = null,
  title,
  pills = [],
  actions = null,
  line,
  facts = null,
  scope = false,
  notice = null,
  tabs = null,
  'data-testid': testId = 'admin-page-header',
}) {
  const titleRef = useRef(null);
  const onDismiss = () => {
    notice?.onDismiss?.();
    // SHL3: Dismiss returns focus to the title, never to the top of the page.
    titleRef.current?.focus();
  };
  return (
    <header className="flex flex-col gap-2.5" data-testid={testId}>
      {crumb && (
        <>
          <nav aria-label="Breadcrumb" className="hidden items-center gap-1.5 font-mono text-[11px] uppercase tracking-[.07em] text-axal-muted dark:text-gray-400 sm:flex" data-testid="admin-page-crumb">
            <Link to={crumb.to} className="text-axal-muted hover:text-axal-violet dark:text-gray-400">{crumb.label}</Link>
            {crumb.current ? <><span aria-hidden="true">›</span><span>{crumb.current}</span></> : null}
          </nav>
          <Link to={crumb.to} className="inline-flex min-h-[44px] items-center text-[13px] font-bold text-axal-violet sm:hidden" data-testid="admin-page-back">
            ‹ {crumb.label}
          </Link>
        </>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-[9px]">
          <h1 ref={titleRef} tabIndex={-1} className="m-0 text-[20px] font-extrabold leading-tight tracking-[-.02em] text-axal-ink outline-none dark:text-gray-100 sm:text-[24px]">{title}</h1>
          {pills.map((p) => (
            <span key={p.label} title={p.title} className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold ${PILL_TONES[p.tone] || PILL_TONES.hq}`}>{p.label}</span>
          ))}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {line ? <p className="m-0 max-w-[72ch] text-[13px] leading-normal text-axal-muted dark:text-gray-400">{line}</p> : null}
      {facts ? <p className="m-0 font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="admin-page-facts">{facts}</p> : null}
      {scope ? (
        <div>
          <span tabIndex={0} title={HELD_SCOPE_TITLE} className="inline-flex cursor-help rounded-full border border-axal-hairline bg-white px-3 py-1 font-mono text-[11.5px] font-medium text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="admin-page-scope">{HELD_SCOPE_LABEL}</span>
        </div>
      ) : null}
      {notice?.text ? (
        <div role="status" aria-live="polite" className="flex items-center gap-2.5 rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3 py-1.5 text-[13px] text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100" data-testid="admin-page-moved">
          <Info size={15} aria-hidden="true" className="shrink-0 text-axal-violet-deep dark:text-violet-300" />
          <span className="min-w-0 flex-1 leading-[1.45]">{notice.text}</span>
          <button type="button" onClick={onDismiss} className="inline-flex min-h-[40px] shrink-0 items-center rounded-[9px] px-2.5 text-[13px] font-bold text-axal-violet-deep dark:text-violet-300">Dismiss</button>
        </div>
      ) : null}
      {tabs ? (
        <nav aria-label={title} className="-mb-px flex gap-5 overflow-x-auto border-b border-axal-hairline dark:border-gray-700" data-testid="admin-page-tabs">
          {tabs}
        </nav>
      ) : null}
    </header>
  );
}
