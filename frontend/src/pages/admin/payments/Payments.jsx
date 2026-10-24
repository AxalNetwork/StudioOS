import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { AdminPageHeader, HeaderTab, useMovedNotice } from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import { PaymentsPanel } from '../consoles/PaymentsConsole';
import {
  CATALOG_FAILED, MOVED_NOTICES, NOT_YET, PAGE_LINE, PAY_TITLE, PLATFORM_PATH, RAIL_NOTE, STRIPE_UNREAD, WEBHOOK_UNREAD,
  catalogueCounts, catalogueGroups, keysMatch, kindWord, modeWord, needsYou, priceText, searchProducts, stampText, tabOf,
} from './payModel';

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
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const DANGER = `${BTN} self-start border border-axal-destructive-edge bg-white text-axal-destructive dark:border-red-900 dark:bg-gray-900 dark:text-red-400`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const TAG = 'self-start rounded-full border border-dashed border-axal-muted px-2 py-0.5 text-[11px] font-semibold text-axal-muted dark:text-gray-400';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';
const PILL = 'inline-flex items-center rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100';
const AMBER = 'rounded-[10px] border border-amber-300 bg-axal-amber/30 px-3.5 py-2.5 text-[12.5px] text-axal-amber-deep dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200';
const LINK = 'font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';

const idle = { status: 'loading', data: null };
const READS = {
  catalogue: ['catalog', 'config', 'summary', 'webhook'],
  stripe: ['config', 'summary', 'webhook'],
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
    };
    for (const k of want) settle(k, work[k]());
    return () => { live = false; };
  }, [sig, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { reads, asOf, reload };
}

function Skeleton() {
  return <span className="block h-2.5 w-[70%] rounded-full bg-axal-hairline dark:bg-gray-700" />;
}

function Reading() {
  return <><span className="font-mono text-[13px] text-axal-muted">Reading…</span><Skeleton /></>;
}

function Unread({ text, onRetry, testId }) {
  return (
    <div role="alert" className="flex flex-col gap-2 text-[12.5px] text-axal-destructive dark:text-red-300" data-testid={testId}>
      <span>{text}</span>
      <button type="button" className={DANGER} onClick={onRetry}>Try again</button>
    </div>
  );
}

function Tile({ id, label, children }) {
  return <div className={`${CARD} flex flex-col gap-1.5 px-4 py-3.5`} data-testid={`pay-tile-${id}`}><span className={EYE}>{label}</span>{children}</div>;
}

const big = `${MONO} text-[22px] font-medium text-axal-ink dark:text-gray-100`;

function keysLine(k) {
  if (k.state === 'match') return 'Keys match';
  if (k.state === 'differ') return `Keys differ: the publishable key is ${modeWord(k.key)}`;
  if (k.state === 'nokey') return 'No publishable key set';
  if (k.state === 'unknownkey') return 'The publishable key is in no known mode';
  if (k.state === 'noaccount') return 'No secret key at deploy';
  return 'The key\'s mode was not checked';
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
        {config?.status === 'ready' && <><span className={big}>{modeWord(config.data?.mode)}</span><span className={SUB}>{keysLine(k)}</span></>}
      </Tile>
      <Tile id="products" label="Active products">
        {catalog?.status === 'loading' && <Reading />}
        {catalog?.status === 'error' && <span className={SUB}>Could not be read.</span>}
        {counts && <><span className={big}>{counts.active.toLocaleString('en-US')} <span className="text-[13px] text-axal-muted">of {counts.all.toLocaleString('en-US')}</span></span><span className={SUB}>{counts.activePrices.toLocaleString('en-US')} active prices</span></>}
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
          ? <><span className={big}>{Number(hook.deliveries).toLocaleString('en-US')}</span><span className={SUB}>{Number(hook.not_2xx).toLocaleString('en-US')} not accepted</span></>
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

function Catalogue({ reads, reload }) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const [editor, setEditor] = useState(false);
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

function Stripe({ reads, reload }) {
  const { config, summary, webhook } = reads;
  const k = keysMatch(config?.data, summary?.data);
  const mirror = summary?.data?.catalog;
  const hook = summary?.data?.webhook;
  return (
    <div className="grid grid-cols-12 gap-3.5">
      <section className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 lg:col-span-6`} data-testid="pay-account">
        <h2 className={H2}>Account</h2>
        {config?.status === 'loading' && <Reading />}
        {config?.status === 'error' && <Unread text={STRIPE_UNREAD} onRetry={reload} testId="pay-account-unread" />}
        {config?.status === 'ready' && (
          <>
            <span className={big}>{modeWord(config.data?.mode)}</span>
            <span className={SUB}>{config.data?.mode === 'unconfigured' ? 'Stripe is not connected on this platform yet. HQ adds the account\'s keys at deploy.' : 'Payments go to HQ\'s Stripe account. The mode is read from the secret key, which this page never shows.'}</span>
          </>
        )}
      </section>
      <section className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 lg:col-span-6`} data-testid="pay-key">
        <h2 className={H2}>Publishable key</h2>
        {config?.status === 'loading' && <Reading />}
        {config?.status === 'error' && <Unread text={STRIPE_UNREAD} onRetry={reload} testId="pay-key-unread" />}
        {config?.status === 'ready' && (
          <>
            <span className={`${MONO} text-[14px] text-axal-ink dark:text-gray-100`}>{config.data?.configured ? config.data?.publishable_key : 'Not set'}</span>
            <span className={k.state === 'differ' ? AMBER : SUB} data-testid="pay-key-match">{k.state === 'differ' ? `The publishable key is ${modeWord(k.key)}, the account is ${modeWord(k.account)}. Checkout and token packs will fail until they match.` : keysLine(k)}</span>
          </>
        )}
      </section>

      <section className={`${CARD} col-span-12 flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="pay-h-webhook" data-testid="pay-webhook">
        <h2 id="pay-h-webhook" className={H2}>Webhook</h2>
        {webhook?.status === 'loading' && <Reading />}
        {webhook?.status === 'error' && <Unread text={WEBHOOK_UNREAD} onRetry={reload} testId="pay-webhook-unread" />}
        {webhook?.status === 'ready' && (
          <>
            <span className={`${MONO} text-[12.5px] text-axal-ink dark:text-gray-100`}>{webhook.data?.our_url}</span>
            {(webhook.data?.endpoints || []).length === 0 && <span className={AMBER}>Stripe has no webhook endpoint yet.</span>}
            {(webhook.data?.endpoints || []).map((e) => (
              <div key={e.id} className={`rounded-[10px] border border-axal-hairline px-3.5 py-3 dark:border-gray-700 ${e.is_ours ? '' : 'opacity-70'}`} data-testid={`pay-endpoint-${e.is_ours ? 'ours' : 'other'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`${MONO} text-[12px] text-axal-ink dark:text-gray-100`}>{e.url}</span>
                  <span className={PILL}>{e.status === 'enabled' ? 'Enabled' : e.status === 'disabled' ? 'Disabled' : 'Not recorded'}</span>
                  {e.is_ours ? <span className={PILL}>This platform&apos;s endpoint</span> : <span className={SUB}>Not used by this platform.</span>}
                </div>
                {e.is_ours && (
                  <>
                    <ul className="m-0 mt-2 grid list-none grid-cols-1 gap-1 p-0 sm:grid-cols-2">
                      {(webhook.data?.required_events || []).map((ev) => {
                        const miss = (e.missing_events || []).includes(ev);
                        return <li key={ev} className={`text-[12px] ${miss ? 'text-axal-amber-deep dark:text-amber-200' : 'text-axal-ink dark:text-gray-100'}`}><span aria-hidden="true">{miss ? '✕' : '✓'}</span> <span className={MONO}>{ev}</span>{miss ? ' — missing' : ''}</li>;
                      })}
                    </ul>
                    {(e.missing_events || []).length > 0 && <span className={`mt-1 block ${SUB}`}>{e.missing_events.length} missing. Add them from the editor on Catalogue until D1008 part 6.</span>}
                  </>
                )}
              </div>
            ))}
          </>
        )}
      </section>

      <section className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 lg:col-span-6`} data-testid="pay-deliveries">
        <h2 className={H2}>Deliveries, last 24 hours</h2>
        {summary?.status === 'loading' && <Reading />}
        {summary?.status === 'error' && <span className={SUB}>Could not be read.</span>}
        {summary?.status === 'ready' && (hook?.available ? (
          <>
            <span className={SUB}>{Number(hook.deliveries).toLocaleString('en-US')} deliveries · {Number(hook.not_2xx).toLocaleString('en-US')} not accepted</span>
            <span className={SUB}>{hook.last ? `Last: ${stampText(hook.last.at) || hook.last.at} · ${hook.last.status_code ?? 'no status'} · ${hook.last.latency_ms ?? '—'} ms` : 'No delivery logged yet.'}</span>
            <span className={TAG}>Per hour: {NOT_YET}</span>
            <span className={SUB}>Read from the request log: the time this platform took, not Stripe&apos;s round trip.</span>
          </>
        ) : <span className={SUB}>Not recorded: {hook?.reason}</span>)}
      </section>
      <section className={`${CARD} col-span-12 flex flex-col gap-2 px-[18px] py-4 lg:col-span-6`} data-testid="pay-mirror">
        <h2 className={H2}>Catalogue mirror</h2>
        {summary?.status === 'loading' && <Reading />}
        {summary?.status === 'error' && <span className={SUB}>Could not be read.</span>}
        {summary?.status === 'ready' && (mirror?.available ? (
          <>
            <span className={`${MONO} text-[12.5px] text-axal-ink dark:text-gray-100`}>{mirror.products.active} active of {mirror.products.all} products · {mirror.prices.active} active of {mirror.prices.all} prices</span>
            <span className={SUB}>Last written {stampText(mirror.last_written_at) || 'never'}.</span>
            <span className={SUB}>{mirror.sync_basis}</span>
          </>
        ) : <span className={SUB}>Not recorded: {mirror?.reason}</span>)}
      </section>
    </div>
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
    </>
  );
  const actions = (
    <>
      <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="pay-asof">
        {asOf ? `Updated ${new Date(asOf).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}` : 'Reading…'}
      </span>
      <button type="button" aria-label="Refresh" onClick={reload} className="grid h-9 w-9 place-items-center rounded-[9px] border border-axal-hairline text-axal-muted dark:border-gray-700"><RefreshCw size={16} aria-hidden="true" /></button>
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
      {tab === 'stripe' && <Stripe reads={reads} reload={reload} />}
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
