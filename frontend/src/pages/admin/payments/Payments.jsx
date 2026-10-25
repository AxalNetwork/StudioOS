import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { paymentsApi } from '../../../lib/api/payments';
import { reportError } from '../../../lib/log';
import { AdminPageHeader, HeaderTab, useMovedNotice } from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import { PaymentsPanel } from '../consoles/PaymentsConsole';
import {
  CATALOG_FAILED_SUB, CATALOG_FAILED_TITLE, CHECKS_UNREAD, DIALOGS_WAIT, FILTERS_EMPTY, MOVED_NOTICES, NOT_CONNECTED, NOT_CONNECTED_SUB,
  NO_PRODUCTS, NO_PRODUCTS_SUB, PAGE_LINE, PAY_PATH, PAY_TITLE, PER_PAGE, PLATFORM_PATH, RAIL_NOTE, SORTS, STATUS_FILTERS, STRIPE_UNREAD, SURFACE_KEYS,
  allowanceCell, catalogueCounts, filterCount, filterProducts, flaggedProducts, keysMatch, kindGroupWord, kindWord, modeWord, needsYou,
  needsYouAll, notConnected, pageOf, priceText, productIdOf, showsOnRows, sortProducts, stampText, surfaceWord, tableGroups, tabOf, yearlyLine,
} from './payModel';
import { AMBER, BIG, CARD, DANGER, EYE, FIELD, GHOST, H2, LINK, MONO, PILL, SUB, Reading, Unread, usePayPhone } from './payUi';
import ProductLightbox from './ProductLightbox';
import StripeConnection, { keysLine } from './StripeConnection';
import ChangeLog from './ChangeLog';

/**
 * D1008 (#2386) — Payments at /admin/platform/payments, the Super Admin's
 * page for HQ's price list and the Stripe connection, built to the owner's
 * canvas (PAY1–PAY13) under the shared admin page header (D936). It replaces
 * the Admin Console's "Payments" tab: `/admin?tab=payments` forwards here with
 * the moved notice, before the console mounts.
 *
 * THE INTEGRATION, NOT THE WHOLE CANVAS (D1008 §3). Catalogue and Stripe
 * connection draw what four existing reads carry, each truthfully, and each
 * read answers alone. The catalogue checks, "shows on", AI allowance, members
 * per plan, the product lightbox, the dialogs, the step-up and the change log
 * wait for D1008's parts. Until the dialogs land, today's editor opens on
 * request at the foot of Catalogue, so nothing HQ can do today is lost.
 *
 * D1014 (#2833, part 6): Stripe connection is complete (`StripeConnection.jsx`:
 * deliveries per hour, the part-5 buttons), the Change log tab is drawn
 * (`ChangeLog.jsx`), and the page has its dark colours (PAY13) and its phone
 * form (PAY12): the catalogue stacks into cards and a product opens as a
 * sheet, the chart is a table, and every dialog is a bottom sheet.
 *
 * D1012 (#2831, part 4): Catalogue is complete. Needs you comes from part 2's
 * checks (D1010), each with one action; the table carries every column (AI
 * allowance, Shows on, the "Needs you" marker), Filters, Sort and a pager,
 * with archived products in their own group; a product opens as PAY2's
 * lightbox at `/admin/platform/payments/products/[id]` (`ProductLightbox.jsx`);
 * and PAY8 (not connected, no products), PAY9 (reading) and PAY10 (a failed
 * block) are drawn. PAY11, a studio admin's closed card, is `hqOnly`'s notice
 * with Payments' words (`pages/hq/hqNoticeModel.js`).
 */

const idle = { status: 'loading', data: null };
const READS = {
  catalogue: ['catalog', 'config', 'summary', 'webhook'],
  stripe: ['config', 'summary', 'webhook', 'deliveries'],
  // The change log reads itself (its filters drive it); the catalogue names its products.
  log: ['catalog'],
};

/** The tab's reads. Each settles alone, so a slow or failed read holds back only its blocks. */
function usePayReads(tab) {
  const keys = READS[tab] || READS.catalogue;
  const [reads, setReads] = useState({});
  const [asOf, setAsOf] = useState(null);
  const [tick, setTick] = useState(0);
  const sig = keys.join(',');
  useEffect(() => {
    let live = true;
    const want = sig ? sig.split(',') : [];
    setReads(Object.fromEntries(want.map((k) => [k, idle])));
    const settle = (key, work) => work.then(
      (data) => { if (live) { setReads((r) => ({ ...r, [key]: { status: 'ready', data } })); setAsOf(Date.now()); } },
      (e) => { reportError(`payments:${key}`, e); if (live) setReads((r) => ({ ...r, [key]: { status: 'error', data: null } })); },
    );
    const work = {
      catalog: () => api.adminCatalogList(),
      config: () => api.adminStripeGetConfig(),
      summary: () => api.hqPlatform().then((d) => d?.payments_catalog ?? null),
      webhook: () => api.adminStripeListWebhooks(),
      deliveries: () => paymentsApi.webhookDeliveries(),
    };
    for (const k of want) settle(k, work[k]());
    return () => { live = false; };
  }, [sig, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { reads, asOf, reload };
}

function Tile({ id, label, children }) {
  return <div className={`${CARD} flex flex-col gap-1.5 px-4 py-3.5`} data-testid={`pay-tile-${id}`}><span className={EYE}>{label}</span>{children}</div>;
}

function Tiles({ reads, reload }) {
  const { catalog, config, summary } = reads;
  const counts = catalog?.status === 'ready' ? catalogueCounts(catalog.data?.products) : null;
  const k = keysMatch(config?.data, summary?.data);
  const mirror = summary?.data?.catalog;
  const hook = summary?.data?.webhook;
  return (
    <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="pay-tiles">
      <Tile id="stripe" label="Stripe">
        {config?.status === 'loading' && <Reading />}
        {config?.status === 'error' && <Unread text={STRIPE_UNREAD} onRetry={reload} testId="pay-stripe-unread" />}
        {config?.status === 'ready' && <><span className={BIG}>{modeWord(config.data?.mode)}</span><span className={SUB}>{keysLine(k)}</span></>}
      </Tile>
      <Tile id="products" label="Active products">
        {catalog?.status === 'loading' && <Reading />}
        {catalog?.status === 'error' && <span className={SUB}>Could not be read.</span>}
        {counts && <><span className={BIG}>{counts.active.toLocaleString('en-US')} <span className="text-[13px] text-axal-muted">of {counts.all.toLocaleString('en-US')}</span></span><span className={SUB}>{counts.activePrices.toLocaleString('en-US')} active prices</span></>}
      </Tile>
      <Tile id="sync" label="Last sync">
        {summary?.status === 'loading' && <Reading />}
        {summary?.status === 'error' && <span className={SUB}>Could not be read.</span>}
        {summary?.status === 'ready' && (mirror?.available
          ? <><span className={`${MONO} text-[14px] text-axal-ink dark:text-gray-100`}>{stampText(mirror.last_written_at) || 'Never written'}</span><span className={SUB}>Nothing syncs on a schedule.</span></>
          : <span className={SUB}>Not recorded: {mirror?.reason || 'the mirror was not in the summary.'}</span>)}
      </Tile>
      <Tile id="webhook" label="Webhook, last 24 hours">
        {summary?.status === 'loading' && <Reading />}
        {summary?.status === 'error' && <span className={SUB}>Could not be read.</span>}
        {summary?.status === 'ready' && (hook?.available
          ? <><span className={BIG}>{Number(hook.deliveries).toLocaleString('en-US')}</span><span className={SUB}>{Number(hook.not_2xx).toLocaleString('en-US')} not accepted</span></>
          : <span className={SUB}>Not recorded: {hook?.reason || 'the request log was not in the summary.'}</span>)}
      </Tile>
    </div>
  );
}

/** Needs you (PAY1): part 2's checks and the webhook's state, each with one action (D1012). */
function Needs({ reads }) {
  const settled = ['config', 'summary', 'webhook', 'catalog'].every((k) => reads[k]?.status && reads[k].status !== 'loading');
  if (!settled) return null;
  const items = needsYouAll({
    config: reads.config?.data,
    summary: reads.summary?.data,
    webhook: reads.webhook?.status === 'ready' ? reads.webhook.data : null,
    catalog: reads.catalog?.status === 'ready' ? reads.catalog.data : null,
  });
  return (
    <section className="flex flex-col gap-2" aria-labelledby="pay-h-needs" data-testid="pay-needs">
      {items.length > 0 && <h2 id="pay-h-needs" className={H2}>Needs you · <span className={MONO}>{items.length}</span></h2>}
      {items.map((it) => (
        <div key={it.id} className={`${AMBER} flex flex-wrap items-center justify-between gap-2`} data-testid={`pay-need-${it.code || it.id}`}>
          <span>{it.text}</span>
          <Link to={it.href} className={LINK}>{it.action}</Link>
        </div>
      ))}
      {reads.catalog?.status === 'error' && <span className={SUB} data-testid="pay-checks-unread">{CHECKS_UNREAD}</span>}
    </section>
  );
}

/** PAY12a: the catalogue on a phone, one card per product in its group; a tap opens the product as a sheet. */
function PhoneCatalogue({ groups, flagged }) {
  return (
    <div className="flex flex-col gap-3" data-testid="pay-phone-catalogue">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label} data-testid={`pay-group-${g.key}`}>
          <h3 className={`m-0 mb-1.5 ${EYE}`}>{g.label} · {g.count}</h3>
          {g.rows.length === 0 && <span className={SUB}>None.</span>}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {g.rows.map((p) => {
              const prices = (p.prices || []).filter((x) => x.active);
              return (
                <li key={p.id}>
                  <Link to={`/admin/platform/payments/products/${encodeURIComponent(p.id)}`} data-testid="pay-row"
                    className={`flex w-full flex-col items-start gap-1 rounded-[10px] border border-axal-hairline bg-white px-3.5 py-3 text-left dark:border-gray-700 dark:bg-gray-900 ${p.active ? '' : 'opacity-60'}`}>
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="font-bold text-axal-ink dark:text-gray-100">{p.name}</span>
                      <span className={PILL}>{kindGroupWord(p)}</span>
                    </span>
                    <span className={`${MONO} text-[12px] text-axal-ink dark:text-gray-100`}>
                      {g.key === 'packs' ? 'Managed on AI allowances' : prices.length ? prices.map(priceText).join(' · ') : 'No active price'}
                    </span>
                    <span className={SUB}>{p.active ? 'Active' : 'Archived'}{flagged.has(p.id) ? ' · ● Needs you' : ''}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** PAY8a, PAY8b and PAY10b: one centred card in place of the catalogue. */
function StateCard({ mark, title, sub, children, testId, alert }) {
  return (
    <section className={`${CARD} flex flex-col items-center gap-2 px-6 py-10 text-center`} role={alert ? 'alert' : undefined} data-testid={testId}>
      <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-full border border-axal-hairline text-[16px] text-axal-muted dark:border-gray-700 dark:text-gray-400">{mark}</span>
      <p className="m-0 text-[14px] font-bold text-axal-ink dark:text-gray-100">{title}</p>
      <p className={`m-0 max-w-[460px] ${SUB}`}>{sub}</p>
      {children}
    </section>
  );
}

/** PAY9: the table's headers at once, and eight skeleton rows while the catalogue reads. */
function SkeletonRows() {
  return (
    <tbody data-testid="pay-skeleton">
      {Array.from({ length: 8 }, (_, i) => (
        <tr key={i} className="border-t border-axal-hairline dark:border-gray-700" data-testid="pay-skeleton-row">
          {Array.from({ length: 7 }, (_, j) => <td key={j} className="py-3 pr-3"><span className="block h-2.5 w-[70%] rounded-full bg-axal-hairline dark:bg-gray-700" /></td>)}
        </tr>
      ))}
    </tbody>
  );
}

const COLUMNS = ['Product', 'Kind', 'Prices', 'AI allowance', 'Shows on', 'For', 'Status'];

function Head() {
  return (
    <thead>
      <tr className={EYE}>{COLUMNS.map((c) => <th key={c} scope="col" className="py-1.5 pr-3 font-bold">{c}</th>)}</tr>
    </thead>
  );
}

function Row({ p, labels, flagged }) {
  const pack = kindGroupWord(p) === 'Token pack';
  const prices = (p.prices || []).filter((x) => x.active || !p.active);
  const yearly = yearlyLine(p);
  const allowance = allowanceCell(p);
  const shows = showsOnRows(p);
  return (
    <tr className={`border-t border-axal-hairline align-top dark:border-gray-700 ${p.active && !pack ? '' : 'opacity-60'}`} data-testid="pay-row">
      <td className="py-2 pr-3">
        <Link to={`/admin/platform/payments/products/${encodeURIComponent(p.id)}`} className="block font-bold text-axal-ink hover:text-axal-violet dark:text-gray-100 dark:hover:text-violet-300" data-testid="pay-row-open">{p.name}</Link>
        <span className={`block ${MONO} ${SUB}`}>{kindWord(p.kind)} · {p.id}</span>
      </td>
      <td className="py-2 pr-3"><span className={PILL}>{kindGroupWord(p)}</span></td>
      <td className="py-2 pr-3 text-axal-ink dark:text-gray-100" data-testid="pay-row-prices">
        {yearly?.tone === 'good' && <span className={`block ${MONO} text-[11.5px] font-bold text-emerald-700 dark:text-emerald-400`}>{yearly.text}</span>}
        {prices.map((x) => <span key={x.id} className={`block ${MONO}`}>{priceText(x)}</span>)}
        {!prices.length && <span className={SUB}>No active price</span>}
        {yearly?.tone === 'muted' && <span className={`block ${SUB}`}>{yearly.text}</span>}
      </td>
      <td className="py-2 pr-3" data-testid="pay-row-allowance">
        {allowance.main
          ? <><span className={`block ${MONO} text-axal-ink dark:text-gray-100`}>{allowance.main}</span>{allowance.sub && <span className={`block ${MONO} ${SUB}`}>{allowance.sub}</span>}</>
          : <span className={SUB} title={allowance.reason}>—</span>}
      </td>
      <td className="py-2 pr-3" data-testid="pay-row-shows">
        {shows === null && <span className={SUB}>Not recorded</span>}
        {shows && shows.length === 0 && <span className={SUB} title="It reaches no member.">—</span>}
        {shows && shows.map((s, i) => <span key={`${s.key}-${i}`} className="block text-axal-ink dark:text-gray-100" title={s.detail || undefined}>{s.label}</span>)}
      </td>
      <td className="py-2 pr-3">
        <span className="flex flex-wrap gap-1">{(p.categories || []).map((c) => <span key={c} className={PILL}>{labels[c] || c}</span>)}</span>
        {!(p.categories || []).length && <span className={SUB}>{pack ? 'Every member' : 'Not set'}</span>}
      </td>
      <td className="py-2" data-testid="pay-row-status">
        <span className={PILL}>{p.active ? '✓ Active' : '– Archived'}</span>
        {!p.active && <span className={`block ${SUB}`}>Date not recorded</span>}
        {flagged.has(p.id) && <span className="block text-[11.5px] font-bold text-axal-amber-deep dark:text-amber-300" data-testid="pay-row-needs">● Needs you</span>}
      </td>
    </tr>
  );
}

/** PAY1's "Filters ▾": an in-page panel, never a browser pop-up. */
function FiltersPanel({ filters, setFilters }) {
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700" data-testid="pay-filters-panel">
      <label className="flex flex-col gap-1">
        <span className={EYE}>Status</span>
        <select value={filters.status} onChange={(e) => set('status', e.target.value)} className={FIELD} data-testid="pay-filter-status">
          {STATUS_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={EYE}>Shows on</span>
        <select value={filters.surface} onChange={(e) => set('surface', e.target.value)} className={FIELD} data-testid="pay-filter-surface">
          <option value="">Anywhere</option>
          {SURFACE_KEYS.map((k) => <option key={k} value={k}>{surfaceWord(k)}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-[12.5px] text-axal-ink dark:text-gray-100">
        <input type="checkbox" checked={filters.needs} onChange={(e) => set('needs', e.target.checked)} data-testid="pay-filter-needs" />
        Needs you only
      </label>
      {filterCount(filters) > 0 && <button type="button" className={GHOST} onClick={() => setFilters(FILTERS_EMPTY)}>Clear filters</button>}
    </div>
  );
}

function Catalogue({ reads, reload }) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const [filters, setFilters] = useState(FILTERS_EMPTY);
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PER_PAGE[0]);
  const [editor, setEditor] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();
  const openId = productIdOf(loc.pathname);
  const phone = usePayPhone();
  const catalog = reads.catalog;
  const data = catalog?.status === 'ready' ? catalog.data : null;
  const products = data?.products || [];
  const labels = Object.fromEntries((data?.audience_categories || []).map((a) => [a.value, a.label]));
  const counts = useMemo(() => catalogueCounts(products), [products]);
  const flagged = useMemo(() => flaggedProducts(data), [data]);
  const view = useMemo(() => {
    const rows = sortProducts(filterProducts(products, { group, q, filters, flagged }), sort, flagged);
    return pageOf(tableGroups(rows), page, perPage);
  }, [products, group, q, filters, flagged, sort, page, perPage]);
  useEffect(() => { setPage(1); }, [group, q, filters, sort, perPage]);
  const lightbox = openId && <ProductLightbox id={openId} catalogRead={catalog} onClose={() => navigate(PAY_PATH)} onRetry={reload} />;

  // PAY8a: no account, no tiles, no table, and nothing that looks like a count.
  if (notConnected(reads.config?.status === 'ready' ? reads.config.data : null, data)) {
    return (
      <>
        <StateCard mark="○" title={NOT_CONNECTED} sub={NOT_CONNECTED_SUB} testId="pay-not-connected" />
        {lightbox}
      </>
    );
  }

  return (
    <>
      <Needs reads={reads} />
      <Tiles reads={reads} reload={reload} />
      {catalog?.status === 'error' && (
        <StateCard mark="!" title={CATALOG_FAILED_TITLE} sub={CATALOG_FAILED_SUB} testId="pay-catalogue-failed" alert>
          <button type="button" className={DANGER} onClick={reload}>Try again</button>
        </StateCard>
      )}
      {data && counts.all === 0 && (
        <StateCard mark="+" title={NO_PRODUCTS} sub={NO_PRODUCTS_SUB} testId="pay-catalogue-empty">
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className={GHOST} disabled title={DIALOGS_WAIT}>New product</button>
            <button type="button" className={GHOST} disabled title={DIALOGS_WAIT}>Sync from Stripe</button>
          </div>
          <span className={SUB}>{DIALOGS_WAIT}</span>
        </StateCard>
      )}
      {(catalog?.status === 'loading' || (data && counts.all > 0)) && (
        <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="pay-h-catalogue" data-testid="pay-catalogue">
          <h2 id="pay-h-catalogue" className={H2}>Catalogue</h2>
          {catalog?.status === 'loading' && <Reading />}
          {data && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex-1">
                  <span className="sr-only">Search name or product ID</span>
                  <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or product ID"
                    className="h-9 w-full max-w-[320px] rounded-[7px] border border-axal-hairline px-3 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="pay-search" />
                </label>
                <div className="flex flex-wrap gap-[7px]" role="radiogroup" aria-label="Kind" data-testid="pay-kind-chips">
                  {[['all', 'All', counts.all], ['plans', 'Plans', counts.byGroup.plans], ['oneTime', 'One-time', counts.byGroup.oneTime], ['packs', 'Token packs', counts.byGroup.packs]].map(([key, label, n]) => (
                    <button key={key} type="button" role="radio" aria-checked={group === key} onClick={() => setGroup(key)}
                      className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold ${group === key ? 'border-axal-lavender-edge bg-axal-lavender text-axal-ink dark:border-violet-700 dark:bg-violet-900/40 dark:text-gray-100' : 'border-axal-hairline text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-100'}`}>
                      {label} <span className={MONO}>{n}</span>
                    </button>
                  ))}
                </div>
                <button type="button" aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)} className={GHOST} data-testid="pay-filters">
                  Filters{filterCount(filters) ? ` · ${filterCount(filters)}` : ''} ▾
                </button>
                <label className="flex items-center gap-1.5 text-[12px] text-axal-muted dark:text-gray-400">
                  Sort
                  <select value={sort} onChange={(e) => setSort(e.target.value)} className={FIELD} data-testid="pay-sort">
                    {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              </div>
              {showFilters && <FiltersPanel filters={filters} setFilters={setFilters} />}
              {q.trim().length === 1 && <span className={SUB}>Type at least two characters.</span>}
            </>
          )}
          {phone && data ? <PhoneCatalogue groups={view.groups.filter((g) => g.count)} flagged={flagged} /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left text-[12.5px]">
                <Head />
                {catalog?.status === 'loading' && <SkeletonRows />}
                {data && view.groups.filter((g) => g.count).map((g) => (
                  <tbody key={g.key} data-testid={`pay-group-${g.key}`}>
                    <tr>
                      <th scope="rowgroup" colSpan={COLUMNS.length} className={`${EYE} border-t border-axal-hairline pb-1 pt-3 dark:border-gray-700`}>
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span>{g.label} · {g.count}{g.readOnly ? ' · read only' : ''}</span>
                          {g.key === 'packs' && <Link to="/admin/platform/allowances" className={`${LINK} normal-case tracking-normal`}>Managed on AI allowances →</Link>}
                        </span>
                      </th>
                    </tr>
                    {g.rows.map((p) => <Row key={p.id} p={p} labels={labels} flagged={flagged} />)}
                  </tbody>
                ))}
              </table>
            </div>
          )}
          {data && view.total === 0 && <span className={SUB} data-testid="pay-none-match">No product matches the search and filters.</span>}
          {data && (
            <div className="flex flex-wrap items-center justify-between gap-3" data-testid="pay-pager">
              <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`} data-testid="pay-count">{view.range}</span>
              <span className="flex items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400">
                <label className="flex items-center gap-1.5">
                  Rows per page
                  <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))} className={FIELD} data-testid="pay-per-page">
                    {PER_PAGE.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <button type="button" aria-label="Previous page" className={GHOST} disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}>‹</button>
                <span className={MONO}>{view.page} of {view.pages}</span>
                <button type="button" aria-label="Next page" className={GHOST} disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)} data-testid="pay-next">›</button>
              </span>
            </div>
          )}
        </section>
      )}
      {lightbox}

      <section className="flex flex-col gap-2" aria-labelledby="pay-h-editor" data-testid="pay-editor">
        <h2 id="pay-h-editor" className={H2}>Make a change</h2>
        <span className={SUB}>Today&apos;s editor (products, prices, the publishable key and the webhook), until D1008 part 5 draws the dialogs and the step-up.</span>
        {editor ? <PaymentsPanel /> : <button type="button" className={`${GHOST} self-start`} onClick={() => setEditor(true)} data-testid="pay-editor-open">Open the editor</button>}
      </section>
      <p className={`m-0 ${SUB}`}>Money received, refunds and disputes are on <Link to="/admin/revenue" className={LINK}>Revenue →</Link>. Promo codes have their own page: <Link to="/admin/platform/promo-codes" className={LINK}>Promo codes →</Link></p>
    </>
  );
}

function PaymentsPage() {
  const loc = useLocation();
  const tab = tabOf(loc.pathname) || 'catalogue';
  const { reads, asOf, reload } = usePayReads(tab);
  const notice = useMovedNotice(MOVED_NOTICES);
  const catalogCount = reads.catalog?.status === 'ready' ? { kind: 'num', value: catalogueCounts(reads.catalog.data?.products).all.toLocaleString('en-US') }
    : reads.catalog?.status === 'error' ? { kind: 'dash', tip: 'The catalogue could not be read.' }
      : reads.catalog ? { kind: 'load' } : null;
  const settled = ['config', 'summary', 'webhook'].every((k) => reads[k]?.status === 'ready' || reads[k]?.status === 'error');
  const stripeDot = settled && needsYou({ config: reads.config?.data, summary: reads.summary?.data, webhook: reads.webhook?.status === 'ready' ? reads.webhook.data : null }).length ? { kind: 'dot' } : null;
  // Literal doors, one per tab (D936), so the reachability walk finds each.
  const tabs = (
    <>
      <HeaderTab to="/admin/platform/payments" count={catalogCount} data-testid="pay-tab-catalogue">Catalogue</HeaderTab>
      <HeaderTab to="/admin/platform/payments/stripe" count={stripeDot} data-testid="pay-tab-stripe">Stripe connection</HeaderTab>
      <HeaderTab to="/admin/platform/payments/log" data-testid="pay-tab-log">Change log</HeaderTab>
    </>
  );
  const actions = (
    <>
      <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="pay-asof">
        {asOf ? `Updated ${new Date(asOf).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}` : 'Reading…'}
      </span>
      <button type="button" aria-label="Refresh" onClick={reload} className="grid h-9 w-9 place-items-center rounded-[9px] border border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400"><RefreshCw size={16} aria-hidden="true" /></button>
    </>
  );
  return (
    <div className="flex flex-col gap-5 pb-24 lg:pb-10" data-testid="payments">
      <AdminPageHeader
        crumb={{ label: 'Platform', to: PLATFORM_PATH, current: PAY_TITLE }}
        title={PAY_TITLE}
        pills={[{ label: 'HQ only', tone: 'hq' }]}
        actions={actions}
        line={PAGE_LINE}
        notice={{ text: notice.text, onDismiss: notice.dismiss }}
        tabs={tabs}
        data-testid="pay-header"
      />
      {tab === 'catalogue' && <Catalogue reads={reads} reload={reload} />}
      {tab === 'stripe' && <StripeConnection reads={reads} reload={reload} />}
      {tab === 'log' && <ChangeLog reads={reads} />}
    </div>
  );
}

/** The page inside its rail frame (D774); the board is H29, Payments catalogue. */
export default function Payments() {
  return (
    <AdminBoardFrame workspace="Payments catalogue" note={RAIL_NOTE} data-testid="hq-board-payments">
      <PaymentsPage />
    </AdminBoardFrame>
  );
}
