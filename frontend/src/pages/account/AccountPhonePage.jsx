import { PhoneBar, PhoneRows, Skeleton, Unreadable } from '../../ui';
import { ACCOUNT_PHONE_PAGES } from './accountPhone';

// The shell pads the page (`p-4 md:p-6`, App.jsx); the phone view takes that
// back so the bar spans the width, and its body takes AMP's 22px gutter. A
// full-bleed route (`/perks`) has no padding to take back.
export const PHONE_PAGE = '-m-4 md:-m-6 lg:m-0 min-h-screen bg-white dark:bg-gray-950';
const BLEED_PAGE = 'min-h-screen bg-white dark:bg-gray-950';

/**
 * A section whose read has not answered: the skeleton while it loads, else
 * Unreadable with its claim, so only that section says it failed
 * (`pages/account/README.md`). Its title still draws.
 */
export function phonePending(status, what, claim, reload) {
  return status === 'loading'
    ? <div data-testid="account-loading" className="py-1"><Skeleton.Text lines={2} /></div>
    : <Unreadable what={what} claim={claim} onRetry={reload} />;
}

/**
 * D700 (#1662) — one of A4m–A10m: the board's bar from `ACCOUNT_PHONE_PAGES`,
 * its sections as `PhoneRows`, then `children`, what the page keeps below
 * (decision 9). The bar names itself to Eadwyn with its title (decision 12);
 * `PhoneBar` draws the button only while a founder rail is mounted.
 */
export function AccountPhonePage({ pageKey, groups, testid, bleed = false, header = null, children = null }) {
  const page = ACCOUNT_PHONE_PAGES[pageKey];
  const bar = <PhoneBar back={{ label: 'Back' }} title={page.title} sub={page.sub} eadwynLabel={page.title} />;
  return (
    <div className={bleed ? BLEED_PAGE : PHONE_PAGE} data-testid={testid} data-phone="true">
      {header ? header(bar) : bar}
      <div className="pt-[18px]">
        <PhoneRows groups={groups} />
      </div>
      {children && <div className="flex flex-col gap-4 px-[22px] pb-[18px]">{children}</div>}
    </div>
  );
}
