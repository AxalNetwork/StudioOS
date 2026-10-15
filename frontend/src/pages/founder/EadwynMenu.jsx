/**
 * D701 (#1663) — the Eadwyn menu, board S5m of `Studio Mobile Page.dc.html`
 * (SMP:68-72, :169-183): the drawer the bar's "Open the Eadwyn menu" opens.
 *
 * TWO GROUPS. Eadwyn's four rows (Open a ticket, Conversations, Tasks, My
 * tickets) and Your profile's five. Only links that work are drawn (decision
 * 9): You, Your venture, What others see and Visibility wait behind
 * `PROFILE_ROWS_LIVE` until #1664 adds their routes. Today `/profile`
 * redirects to `/account` and the other three reach NotFound.
 *
 * `project_id` STAYS (decision 3). The four Eadwyn rows, and the three profile
 * rows that read a venture once they are live, add the current page's
 * `project_id` through `withProjectId`, so a founder with several ventures
 * keeps the one they are on. You and Archetype card read no venture.
 *
 * `active` names a row by its route here (`/studio?tab=tasks`), never by an
 * href carrying `project_id`. The current row is violet with
 * `aria-current="page"`.
 *
 * A MODAL DIALOG, labelled "Eadwyn menu", at `z-50` with D699's PhoneSheet:
 * over the tab bar (`z-30`), under #1660's Eadwyn panel (`z-60`) and the
 * Lightbox (`z-[80]`). Escape joins D686's stack through `useEscapeClose`; the
 * focus trap and scroll lock are `ui/lightboxFocus.js`'s. Escape, the scrim
 * and × close it, and so does following a row. Each row is a link, so a long
 * press copies it. Exported, so #1664's profile pages open the same drawer.
 */
import React, { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Briefcase, Eye, ListChecks, Lock, MessageCircle, ScrollText, Sparkles, Ticket, User } from 'lucide-react';
import { useEscapeClose } from '../../components/useEscapeClose.js';
import { inertOutside, lockScroll, tabbable, tabTarget } from '../../ui/lightboxFocus.js';
import { withProjectId } from './studioPhoneModel';

/** #1664 sets this in the PR that adds `/profile`, `/profile/venture`, `/profile/preview` and `/profile/visibility`. */
export const PROFILE_ROWS_LIVE = false;

/**
 * The drawer's rows and their routes (SMP:170-181). `venture` rows carry the
 * page's `project_id`; `profile` rows wait for `PROFILE_ROWS_LIVE`.
 */
export const EADWYN_MENU = [
  {
    label: 'Eadwyn',
    rows: [
      { title: 'Open a ticket', route: '/studio/tickets/new', icon: Ticket, venture: true },
      { title: 'Conversations', route: '/studio', icon: MessageCircle, venture: true },
      { title: 'Tasks', route: '/studio?tab=tasks', icon: ListChecks, venture: true },
      { title: 'My tickets', route: '/studio?tab=tickets', icon: ScrollText, venture: true },
    ],
  },
  {
    label: 'Your profile',
    rows: [
      { title: 'You', route: '/profile', icon: User, profile: true },
      { title: 'Your venture', route: '/profile/venture', icon: Briefcase, profile: true, venture: true },
      { title: 'Archetype card', route: '/studio/archetype', icon: Sparkles },
      { title: 'What others see', route: '/profile/preview', icon: Eye, profile: true, venture: true },
      { title: 'Visibility', route: '/profile/visibility', icon: Lock, profile: true, venture: true },
    ],
  },
];

/** The groups drawn: the profile rows only while they are live. */
export function menuGroups(profileRowsLive = PROFILE_ROWS_LIVE) {
  return EADWYN_MENU.map((g) => ({ ...g, rows: g.rows.filter((r) => profileRowsLive || !r.profile) }));
}

/** A row's href: its route, with the page's `project_id` when the row reads a venture. */
export const menuHref = (row, search) => (row.venture ? withProjectId(row.route, search) : row.route);

export function EadwynMenu({ open, onClose, active = null, opener = null, profileRowsLive = PROFILE_ROWS_LIVE }) {
  const { search } = useLocation();
  const layer = useRef(null);
  const box = useRef(null);
  useEscapeClose(onClose, { active: open });
  useEffect(() => {
    if (!open || !box.current) return undefined;
    const releaseInert = inertOutside(layer.current);
    const releaseScroll = lockScroll(document.body);
    (tabbable(box.current)[0] || box.current)?.focus?.();
    return () => { releaseInert(); releaseScroll(); opener?.current?.focus?.(); };
  }, [open, opener]);
  if (!open) return null;

  function onKeyDown(event) {
    if (event.key !== 'Tab') return;
    const targets = tabbable(box.current, document.activeElement);
    const next = tabTarget(targets, document.activeElement, event.shiftKey);
    if (next !== null) { event.preventDefault(); (targets[next] || box.current)?.focus(); }
  }

  return (
    <div ref={layer} className="fixed inset-0 z-50 lg:hidden" role="presentation" data-testid="eadwyn-menu">
      <div className="absolute inset-0 bg-[rgba(24,24,27,.42)]" onClick={onClose} aria-hidden="true" data-testid="eadwyn-menu-scrim" />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label="Eadwyn menu"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="absolute bottom-0 right-0 top-0 flex w-[286px] max-w-[86%] flex-col overflow-auto bg-white pb-[env(safe-area-inset-bottom)] shadow-[-12px_0_40px_rgba(24,24,27,.18)] dark:bg-gray-950"
      >
        <div className="flex items-center justify-between gap-2.5 border-b border-[#ececf1] py-3 pl-[18px] pr-3 dark:border-gray-800">
          <span className="flex items-center gap-2">
            <img src="/eadwyn-ai.png" alt="" width="24" height="24" className="h-6 w-6 object-contain [image-rendering:pixelated]" />
            <span className="text-[15px] font-extrabold text-gray-900 dark:text-gray-100">Eadwyn AI</span>
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center text-[22px] text-[#6b6577] dark:text-gray-400">×</button>
        </div>
        {menuGroups(profileRowsLive).map((g) => (
          <div key={g.label} className="px-2.5 pb-1 pt-3.5">
            <div className="px-2.5 pb-1.5 text-[10px] font-extrabold uppercase tracking-[.12em] text-[#7d7889] dark:text-gray-400">{g.label}</div>
            {g.rows.map((r) => {
              const on = r.route === active;
              const Icon = r.icon;
              return (
                <Link
                  key={r.route}
                  to={menuHref(r, search)}
                  onClick={onClose}
                  aria-current={on ? 'page' : undefined}
                  className={`flex min-h-[48px] items-center gap-3 rounded-[10px] px-2.5 text-[14.5px] ${on
                    ? 'bg-[#f6f2ff] font-bold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300'
                    : 'font-semibold text-gray-900 dark:text-gray-100'}`}
                >
                  <Icon size={18} className="shrink-0" aria-hidden="true" />
                  <span className="flex-1">{r.title}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default EadwynMenu;
