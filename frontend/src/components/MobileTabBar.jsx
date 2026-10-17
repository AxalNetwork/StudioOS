import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { mobilePlan, rowActive } from '../lib/mobileTabs';
import './mobileTabBar.css';

/**
 * The phone's tab bar: four tabs and More, below 1024px (D425, D699; Cycle
 * Overview canvas CO:219, and M5's safe-area and 44pt rules).
 *
 * WHAT IT IS AND IS NOT. The founder's tabs are the four cycles, Validate,
 * Build, Raise and Grow. Studio is the band's glyph (`ui/phone/PhoneHeader.jsx`),
 * so on `/studio` nothing here is lit (CO:218). It is navigation only: the
 * pages and their zone pills are unchanged.
 *
 * WHERE THE ROWS COME FROM. `lib/mobileTabs.js` builds the tabs and More from
 * the founder sidebar's own rows (label, route, `match`), with the canvas's
 * icons, plus Messages, the one door a phone otherwise lacks. A tab lights for
 * exactly the pages its sidebar row lights for.
 *
 * MORE IS A PAGE, `/more` (D699, superseding D425's "More opens a bottom
 * sheet, never a screen"). The canvas links it (CO:219) and draws it
 * (CO:244-247), so More is a link: current on `/more`, and marked active when
 * the page is one of its rows.
 *
 * SAFE AREAS. The page tag asks for `viewport-fit=cover` (index.html), so the
 * bar pads itself by `env(safe-area-inset-bottom)` to clear the home
 * indicator, and while the bar is up the page's own content is padded by the
 * bar's height (`mobileTabBar.css`), so nothing sits under it.
 *
 * FOUNDER FIRST. `mobilePlan` returns null for the other licences until their
 * allocations are built, and the bar then renders nothing.
 *
 * MOUNTED BY THE SHELL, NOT HERE. App.jsx mounts it beside the drawer.
 */

export default function MobileTabBar({ role }) {
  const { pathname } = useLocation();
  const plan = mobilePlan(role);
  const drawn = plan !== null;

  // The page's own content is padded by the bar's height only while a bar is
  // actually drawn: the attribute is what `mobileTabBar.css` keys off, and it
  // leaves with the last bar, as the rail's collapse attribute does.
  useEffect(() => {
    if (!drawn || typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    root.setAttribute('data-mobile-tabbar', 'on');
    return () => root.removeAttribute('data-mobile-tabbar');
  }, [drawn]);

  if (!plan) return null;
  const onMore = rowActive({ to: '/more' }, pathname);
  const moreActive = onMore || plan.more.some((row) => rowActive(row, pathname));

  return (
    <nav
      aria-label="Primary"
      className="mtb fixed inset-x-0 bottom-0 z-30 flex border-t border-[#ececf1] bg-[rgba(255,255,255,.96)] lg:hidden dark:border-gray-800 dark:bg-gray-950"
      data-testid="mobile-tab-bar"
    >
      {plan.tabs.map((row) => (
        <TabLink key={row.to} row={row} active={rowActive(row, pathname)} />
      ))}
      <Link
        to="/more"
        aria-current={onMore ? 'page' : undefined}
        className={`${TAB} ${moreActive ? TAB_ON : TAB_OFF}`}
        data-active={moreActive ? 'true' : 'false'}
        data-testid="link-mobile-tab-more"
      >
        <MoreHorizontal size={20} aria-hidden="true" />
        <span>More</span>
      </Link>
    </nav>
  );
}

// 56px tall and a fifth of the width: the whole column is the target, well
// over the canvas's 44pt floor. The 9.5px/700 labels and the two colours are
// the canvas's (CO:219).
const TAB = 'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-[3px] px-1 text-[9.5px] font-bold '
  + 'transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 '
  + 'focus-visible:outline-axal-violet';
const TAB_ON = 'text-[#6d28d9] dark:text-violet-300';
const TAB_OFF = 'text-[#9a95a6] dark:text-gray-400';

function TabLink({ row, active }) {
  const Icon = row.icon;
  return (
    <Link
      to={row.to}
      aria-current={active ? 'page' : undefined}
      className={`${TAB} ${active ? TAB_ON : TAB_OFF}`}
      data-testid={`link-mobile-tab-${row.to.slice(1).replace(/\//g, '-')}`}
    >
      {Icon && <Icon size={20} aria-hidden="true" />}
      <span className="max-w-full truncate">{row.label}</span>
    </Link>
  );
}
