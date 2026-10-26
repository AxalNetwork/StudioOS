import { Unreadable } from '../../../ui';
import { LoadingRows } from '../../account/AccountCenter';
import { Banner } from '../../account/ConnectorSheet';
import { NO_FUND } from './fundAdminModel';
import { Section } from './parts';

/**
 * What every per-fund tab shares (decision 8): the frame on one administered
 * fund (`?fund=`, chosen in the header's fund filter, D1160) and the read
 * states (`Failed`, `Busy`, `Alert`, `LABEL`).
 *
 * D1163 (#3070) moved Capital calls to `CallsTab.jsx` and Distributions to
 * `DistributionsTab.jsx`, each drawn in place; D1165 moved Management fees
 * and Reports to `FeesReportsTabs.jsx`, re-exported below.
 */
export function Failed({ read, what, claim }) {
  return <div className="px-4 py-3 sm:px-5"><Unreadable what={what} claim={claim} onRetry={read.reload} /></div>;
}

export function Busy() { return <div className="px-4 py-3 sm:px-5"><LoadingRows lines={3} /></div>; }

export function Alert({ text }) {
  return text ? <p role="alert" className="px-4 pb-2.5 text-[12px] text-red-700 sm:px-5 dark:text-red-300">{text}</p> : null;
}

export const LABEL = 'text-[11.5px] font-semibold text-zinc-700 dark:text-gray-200';

/**
 * The fund chooser, and the states that leave a per-fund tab with no fund.
 * The tab's Section carries the chooser in its heading, as the canvas's
 * segmented control sits beside a tab's title.
 */
// D1160 (FND2): the fund is chosen in the header's fund filter, kept across tabs as `?fund=`.
export function FundFrame({ title, sub, testId, fund, overview, aside = null, children }) {
  let body = children;
  if (overview.status === 'loading' || overview.status === 'idle') body = <LoadingRows lines={3} />;
  else if (overview.status === 'unreadable' || overview.data?.funds?.state !== 'ok') {
    body = <div data-testid="funds-unreadable"><Unreadable what="The administered funds" claim="This is not a claim that there is none." onRetry={overview.reload} /></div>;
  } else if (!fund) body = <Banner tone="neutral" data-testid="no-administered-fund">{NO_FUND}</Banner>;
  return <Section title={fund ? `${title} · ${fund.name}` : title} sub={sub} testId={testId} aside={fund ? aside : null}>{body}</Section>;
}

// D1165: these tabs have their own layout module; existing imports keep working.
export { FeesTab, ReportsTab } from './FeesReportsTabs';
