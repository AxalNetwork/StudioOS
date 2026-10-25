import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { paymentsApi } from '../../../lib/api/payments';
import { reportError } from '../../../lib/log';
import { AdminPageHeader, HeaderTab, useMovedNotice } from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import { PaymentsPanel } from '../consoles/PaymentsConsole';
import {
  CATALOG_FAILED, MOVED_NOTICES, NOT_YET, PAGE_LINE, PAY_TITLE, PLATFORM_PATH, RAIL_NOTE, STRIPE_UNREAD,
  catalogueCounts, catalogueGroups, keysMatch, kindWord, modeWord, needsYou, priceText, searchProducts, stampText, tabOf,
} from './payModel';
import { AMBER, BIG, CARD, EYE, GHOST, H2, LINK, MONO, PILL, SUB, PayDialog, Reading, Technical, Unread, usePayPhone } from './payUi';
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

function Needs({ reads }) {
  const settled = ['config', 'summary', 'webhook'].every((k) => reads[k]?.status && reads[k].status !== 'loading');
  if (!settled) return null;
  const items = needsYou({ config: reads.config?.data, summary: reads.summary?.data, webhook: reads.webhook?.status === 'ready' ? reads.webhook.data : null });
  return (
    <section className="flex flex-col gap-2" aria-label="Needs you" data-testid="pay-needs">
      {items.map((it) => (
        <div key={it.id} className={`${AMBER} flex flex-wrap items-center justify-between gap-2`} data-testid={`pay-need-${it.id}`}>
          <span>{it.text}</span>
          <Link to="/admin/platform/payments/stripe" className={LINK}>Open Stripe connection</Link>
        </div>
      ))}
      <span className={SUB} data-testid="pay-checks-wait">Two products making one /pricing card, a plan with no yearly price and the other catalogue checks are {NOT_YET.toLowerCase()}: D1008 part 2.</span>
    </section>
  );
}

/** PAY12a: the catalogue on a phone, one card per product in its group; a tap opens the product as a sheet. */
function PhoneCatalogue({ groups, onOpen }) {
  return (
    <div className="flex flex-col gap-3" data-testid="pay-phone-catalogue">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label} data-testid={`pay-group-${g.key}`}>
          <h3 className={`m-0 mb-1.5 ${EYE}`}>{g.label} · {g.rows.length}</h3>
          {g.rows.length === 0 && <span className={SUB}>None.</span>}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {g.rows.map((p) => {
              const prices = (p.prices || []).filter((x) => x.active);
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => onOpen(p)} data-testid="pay-row"
                    className={`flex w-full flex-col items-start gap-1 rounded-[10px] border border-axal-hairline bg-white px-3.5 py-3 text-left dark:border-gray-700 dark:bg-gray-900 ${p.active ? '' : 'opacity-60'}`}>
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="font-bold text-axal-ink dark:text-gray-100">{p.name}</span>
                      <span className={PILL}>{kindWord(p.kind)}</span>
                    </span>
                    <span className={`${MONO} text-[12px] text-axal-ink dark:text-gray-100`}>
                      {g.key === 'packs' ? 'Managed on AI allowances' : prices.length ? prices.map(priceText).join(' · ') : 'No active price'}
                    </span>
                    <span className={SUB}>{p.active ? 'Active' : 'Archived'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** PAY12b: one product, read only, as a sheet. Changing it is part 4's lightbox; today's editor sits on this page. */
function ProductSheet({ product: p, labels, onClose }) {
  const prices = p.prices || [];
  return (
    <PayDialog title={p.name} sub={`${kindWord(p.kind)} · ${p.active ? 'Active' : 'Archived'}`} onClose={onClose} testId="pay-product">
      <div className="flex flex-col gap-1">
        <span className={EYE}>Prices</span>
        {p.kind === 'token_pack' ? <Link to="/admin/platform/allowances" className={LINK}>Managed on AI allowances →</Link>
          : prices.length ? prices.map((x) => (
            <span key={x.id} className={`${MONO} text-[13px] ${x.active ? 'text-axal-ink dark:text-gray-100' : 'text-axal-muted line-through dark:text-gray-500'}`}>{priceText(x)}{x.active ? '' : ' · archived'}</span>
          )) : <span className={SUB}>No price</span>}
      </div>
      <div className="flex flex-col gap-1">
        <span className={EYE}>For</span>
        {(p.categories || []).length ? <span className="flex flex-wrap gap-1">{p.categories.map((c) => <span key={c} className={PILL}>{labels[c] || c}</span>)}</span> : <span className={SUB}>Not set</span>}
      </div>
      <span className={SUB}>Changing a product opens with D1008 part 4. Until then, use the editor at the foot of Catalogue.</span>
      <Technical testId="pay-product-tech">{[p.id, ...prices.map((x) => x.id)].join(' · ')}</Technical>
    </PayDialog>
  );
}

function Catalogue({ reads, reload }) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const [editor, setEditor] = useState(false);
  const [open, setOpen] = useState(null);
  const phone = usePayPhone();
  const catalog = reads.catalog;
  const products = catalog?.status === 'ready' ? catalog.data?.products || [] : [];
  const labels = Object.fromEntries((catalog?.data?.audience_categories || []).map((a) => [a.value, a.label]));
  const counts = useMemo(() => catalogueCounts(products), [products]);
  const groups = useMemo(() => catalogueGroups(searchProducts(products, q)).filter((g) => group === 'all' || g.key === group), [products, q, group]);
  const shown = groups.reduce((t, g) => t + g.rows.length, 0);

  return (
    <>
      <Needs reads={reads} />
      <Tiles reads={reads} reload={reload} />
      <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="pay-h-catalogue" data-testid="pay-catalogue">
        <h2 id="pay-h-catalogue" className={H2}>Catalogue</h2>
        {catalog?.status === 'loading' && <Reading />}
        {catalog?.status === 'error' && <Unread text={CATALOG_FAILED} onRetry={reload} testId="pay-catalogue-failed" />}
        {catalog?.status === 'ready' && counts.all === 0 && (
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="pay-catalogue-empty">No products yet. Make the first one, or sync products you made in the Stripe dashboard.</p>
        )}
        {catalog?.status === 'ready' && counts.all > 0 && (
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
              <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`} data-testid="pay-count">{shown ? `1–${shown} of ${shown}` : '0 of 0'}</span>
            </div>
            {q.trim().length === 1 && <span className={SUB}>Type at least two characters.</span>}
            {phone ? <PhoneCatalogue groups={groups} onOpen={setOpen} /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left text-[12.5px]">
                <thead>
                  <tr className={EYE}>
                    <th scope="col" className="py-1.5 pr-3 font-bold">Product</th>
                    <th scope="col" className="py-1.5 pr-3 font-bold">Kind</th>
                    <th scope="col" className="py-1.5 pr-3 font-bold">Prices</th>
                    <th scope="col" className="py-1.5 pr-3 font-bold">For</th>
                    <th scope="col" className="py-1.5 font-bold">Status</th>
                  </tr>
                </thead>
                {groups.map((g) => (
                  <tbody key={g.key} data-testid={`pay-group-${g.key}`}>
                    <tr><th scope="rowgroup" colSpan={5} className={`${EYE} border-t border-axal-hairline pb-1 pt-3 dark:border-gray-700`}>{g.label} · {g.rows.length}</th></tr>
                    {g.rows.length === 0 && <tr><td colSpan={5} className={`py-2 ${SUB}`}>None.</td></tr>}
                    {g.rows.map((p) => (
                      <tr key={p.id} className={`border-t border-axal-hairline align-top dark:border-gray-700 ${p.active ? '' : 'opacity-60'}`} data-testid="pay-row">
                        <td className="py-2 pr-3">
                          <span className="block font-bold text-axal-ink dark:text-gray-100">{p.name}</span>
                          <span className={`block ${MONO} ${SUB}`}>{p.id}</span>
                        </td>
                        <td className="py-2 pr-3"><span className={PILL}>{kindWord(p.kind)}</span></td>
                        <td className="py-2 pr-3 text-axal-ink dark:text-gray-100">
                          {g.key === 'packs'
                            ? <Link to="/admin/platform/allowances" className={LINK}>Managed on AI allowances →</Link>
                            : ((p.prices || []).filter((x) => x.active).map((x) => <span key={x.id} className={`block ${MONO}`}>{priceText(x)}</span>))}
                          {g.key !== 'packs' && !(p.prices || []).some((x) => x.active) && <span className={SUB}>No active price</span>}
                        </td>
                        <td className="py-2 pr-3">
                          <span className="flex flex-wrap gap-1">{(p.categories || []).map((c) => <span key={c} className={PILL}>{labels[c] || c}</span>)}</span>
                          {!(p.categories || []).length && <span className={SUB}>Not set</span>}
                        </td>
                        <td className="py-2"><span className={SUB}>{p.active ? 'Active' : 'Archived'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
            )}
            {open && <ProductSheet product={open} labels={labels} onClose={() => setOpen(null)} />}
            <span className={SUB}>Where each product shows, its AI allowance and the members on it arrive with D1008 part 2.</span>
          </>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="pay-h-editor" data-testid="pay-editor">
        <h2 id="pay-h-editor" className={H2}>Make a change</h2>
        <span className={SUB}>Today&apos;s editor (products, prices, the publishable key and the webhook), until D1008 parts 4 to 6 draw the dialogs and the step-up.</span>
        {editor ? <PaymentsPanel /> : <button type="button" className={`${GHOST} self-start`} onClick={() => setEditor(true)} data-testid="pay-editor-open">Open the editor</button>}
      </section>
      <p className={`m-0 ${SUB}`}>Money received, refunds and disputes are on <Link to="/admin/revenue" className={LINK}>Revenue</Link>. Promo codes have their own page.</p>
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
