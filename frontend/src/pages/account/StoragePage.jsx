import { Link } from 'react-router-dom';
import { usageApi } from '../../lib/api/usage';
import { PhoneBar } from '../../ui';
import { PanelCard, useAccountRead } from './AccountCenter';
import { StorageCard } from './AccountUsage';
import { DOES_NOT_COUNT, NOT_YET, STORAGE_PAGE, WAITS } from './storagePageModel';

/**
 * D1166 (#2449) — `/account/usage/storage`, Usage's fourth page, from the
 * canvas "Account · Usage · Storage" (STG1–STG20).
 *
 * ONE READ, D642's `GET /api/usage/storage`, drawn by today's place card. The
 * allowance, the kinds, the companies and the largest files have no read yet,
 * so each says "Not read here yet" with its reason: never a bar, a zero or a
 * figure the Worker did not send. The rest is D1166's slot tasks.
 */
export default function StoragePage({ role }) {
  const storage = useAccountRead(() => usageApi.storage());
  return <div className="flex min-w-0 flex-col gap-4" data-testid="usage-storage-page">
    <div className="-mx-[22px] lg:hidden"><PhoneBar back={{ label: 'Usage', to: '/account/usage' }} title={STORAGE_PAGE.title} sub={STORAGE_PAGE.sub} /></div>
    <Link to="/account/usage" className="hidden lg:block text-xs font-semibold text-axal-violet dark:text-violet-300">← Usage overview</Link>
    <header className="hidden lg:block"><h2 className="text-xl font-extrabold tracking-axal-heading">{STORAGE_PAGE.title}</h2><p className="mt-1 text-[13px] text-axal-muted dark:text-gray-400">{STORAGE_PAGE.sub}</p></header>
    <WaitCard id="allowance" title="Your storage" />
    <div className="grid min-w-0 gap-3 md:grid-cols-2">
      <WaitCard id="kinds" title="By kind" />
      <WaitCard id="companies" title="By company" />
    </div>
    <StorageCard storage={storage} role={role} title="By place" />
    <WaitCard id="largest" title="Largest files" />
    <PanelCard title="What counts" data-testid="storage-what-counts">
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-axal-muted dark:text-gray-400">Counts</p><Wait id="counts" /></div>
        <div><p className="text-xs font-semibold uppercase tracking-wide text-axal-muted dark:text-gray-400">Does not count</p>
          <ul className="mt-2 flex flex-col gap-1 text-[13px]" data-testid="storage-does-not-count">{DOES_NOT_COUNT.map((r) => <li key={r}>{r}</li>)}</ul></div>
      </div>
    </PanelCard>
  </div>;
}

function Wait({ id }) {
  return <div className="mt-2 flex flex-col gap-2" data-testid={`storage-wait-${id}`}>
    <span className="w-fit rounded-axal-pill border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
    <p className="m-0 text-[13px] text-axal-muted dark:text-gray-400">{WAITS[id]}</p>
  </div>;
}

function WaitCard({ id, title }) {
  return <PanelCard title={title} data-testid={`storage-card-${id}`}><Wait id={id} /></PanelCard>;
}
