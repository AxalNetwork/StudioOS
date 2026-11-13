import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { adminPaymentsApi } from '../../../lib/api/adminPayments';
import { paymentsApi } from '../../../lib/api/payments';
import { reportError } from '../../../lib/log';
import {
  ALLOWANCES_PATH, CATALOG_FAILED, CHANGES_UNREAD, KEEP_PRICE, MEMBERS_UNREAD, PRODUCT_MISSING, PROMOS_UNREAD,
  actionWord, allowanceOf, amountText, codesWord, dayText, groupOf, intervalWord, kindGroupWord, membersLine, membersOn,
  priceRows, productChecks, promosFor, showsOnRows, technicalLines, whoText,
} from './payModel';
import { AMBER, EYE, GHOST, LINK, MONO, PILL, PRIMARY, SUB, WRITE_HOLDER_NOTE, PayDialog, Reading, Technical, Unread, usePayPhone } from './payUi';

/**
 * D1012 (#2831) — PAY2: one product, as a centred lightbox over Catalogue, at
 * its own address (`/admin/platform/payments/products/[id]`), and as a full
 * page on a phone (PAY12b, D1129). Where members see it, its prices with the AI
 * allowance and the yearly saving, the members on the plan, the promo codes
 * that apply, its checks, its recent changes, and Technical details.
 *
 * It reads only when open, and each read answers alone: members (plans only),
 * promo codes and the change log. The catalogue it draws from is the page's.
 *
 * D1013 (#2832, part 5): its buttons open the price dialogs (`onAct`, at the
 * page's level): Add a price, Edit details and Archive, and Change and Archive
 * on each live price. Only the Super Admin is drawn them (`canWrite`).
 */

const idle = { status: 'loading', data: null };

/** One read for the open product; `skip` leaves it unread (members, for a product that is not a plan). */
function useRead(load, skip, sig) {
  const [state, setState] = useState(skip ? { status: 'skip', data: null } : idle);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (skip) { setState({ status: 'skip', data: null }); return undefined; }
    let live = true;
    setState(idle);
    load().then(
      (data) => { if (live) setState({ status: 'ready', data }); },
      (e) => { reportError(`payments:product:${sig}`, e); if (live) setState({ status: 'error', data: null }); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, skip, tick]);
  const retry = useCallback(() => setTick((t) => t + 1), []);
  return [state, retry];
}

function Section({ title, children, testId }) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-axal-hairline pt-3 dark:border-gray-700" data-testid={testId}>
      <h3 className={`m-0 ${EYE}`}>{title}</h3>
      {children}
    </section>
  );
}

function WhereSeen({ product }) {
  const rows = showsOnRows(product);
  return (
    <Section title="Where members see it" testId="pay-product-where">
      {rows === null && <span className={SUB}>Not recorded: the catalogue read did not say where it shows.</span>}
      {rows && rows.length === 0 && <span className={SUB}>{product.active ? 'Members do not see it anywhere.' : 'Members do not see it anywhere: it is archived.'}</span>}
      {rows && rows.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {rows.map((r, i) => (
            <li key={`${r.key}-${i}`} className="text-[12.5px] text-axal-ink dark:text-gray-100">
              {r.path ? <a href={r.path} target="_blank" rel="noopener noreferrer" className={LINK}>↗ {r.label}</a> : <span>{r.label}</span>}
              {r.detail && <span className={SUB}> · {r.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Prices({ product, onAct, canWrite }) {
  const phone = usePayPhone();
  const rows = priceRows(product);
  const pct = product.plan?.yearly_saving_percent;
  // Changing a price is drawn on a live, non-pack product, for the Super Admin.
  const live = canWrite && product.active && groupOf(product) !== 'packs';
  const SMALL = `${GHOST} min-h-[28px] px-2 text-[11.5px]`;
  return (
    <Section title="Prices" testId="pay-product-prices">
      {groupOf(product) === 'packs' && <Link to={ALLOWANCES_PATH} className={LINK}>Managed on AI allowances →</Link>}
      {rows.length === 0 && <span className={SUB}>No price.</span>}
      {phone && rows.length > 0 && <div className="flex flex-col gap-2" data-testid="pay-phone-prices">
        {rows.map((x) => <article key={x.id} className="rounded-lg border border-axal-hairline p-3 dark:border-gray-700" data-testid="pay-price-row">
          <div className="font-semibold text-axal-ink dark:text-gray-100">{intervalWord(x)} · {amountText(x)}</div>
          <div className={SUB}>AI allowance a month: {allowanceOf(x).text || allowanceOf(x).reason || 'Not recorded'}</div>
          <div className={SUB}>{x.active ? 'Active' : 'Archived'}{x.nickname ? ` · ${x.nickname}` : ''}</div>
          <Technical>{x.id}</Technical>
          {live && x.active && <div className="mt-2 flex gap-2">
            <button type="button" className={GHOST} onClick={() => onAct({ type: 'changePrice', product, price: x })} data-testid={`pay-act-change-${x.id}`}>Change</button>
            <button type="button" className={GHOST} onClick={() => onAct({ type: 'archivePrice', product, price: x })} data-testid={`pay-act-archive-${x.id}`}>Archive</button>
          </div>}
        </article>)}
      </div>}
      {!phone && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[12.5px]">
            <thead>
              <tr className={EYE}>
                <th scope="col" className="py-1 pr-3 font-bold">Interval</th>
                <th scope="col" className="py-1 pr-3 font-bold">Amount</th>
                <th scope="col" className="py-1 pr-3 font-bold">AI allowance a month</th>
                <th scope="col" className="py-1 pr-3 font-bold">Nickname</th>
                <th scope="col" className="py-1 font-bold">Status</th>
                {live && <th scope="col" className="py-1 pl-3 font-bold"><span className="sr-only">Change</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const a = allowanceOf(x);
                return (
                  <tr key={x.id} className={`border-t border-axal-hairline dark:border-gray-700 ${x.active ? '' : 'opacity-60'}`} data-testid="pay-price-row">
                    <td className="py-1.5 pr-3 text-axal-ink dark:text-gray-100">{intervalWord(x)}</td>
                    <td className={`py-1.5 pr-3 ${MONO} text-axal-ink dark:text-gray-100`}>{amountText(x)}</td>
                    <td className={`py-1.5 pr-3 ${MONO}`}>{a.text ? <span className="text-axal-ink dark:text-gray-100">{a.text}</span> : <span className={SUB} title={a.reason}>—</span>}</td>
                    <td className={`py-1.5 pr-3 ${SUB}`}>{x.nickname || 'None'}</td>
                    <td className={`py-1.5 ${SUB}`}>{x.active ? 'Active' : 'Archived'}</td>
                    {live && (
                      <td className="py-1.5 pl-3">
                        {x.active && (
                          <span className="flex gap-1.5">
                            <button type="button" className={SMALL} onClick={() => onAct({ type: 'changePrice', product, price: x })} data-testid={`pay-act-change-${x.id}`}>Change</button>
                            <button type="button" className={SMALL} onClick={() => onAct({ type: 'archivePrice', product, price: x })} data-testid={`pay-act-archive-${x.id}`}>Archive</button>
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {typeof pct === 'number' && pct > 0 && <span className={SUB} data-testid="pay-product-saving">Yearly saves {pct}%, computed from the two prices.</span>}
      {!phone && rows.some((x) => !allowanceOf(x).text) && product.plan && <span className={SUB}>A dash is a price that gives no AI allowance; hover it for why.</span>}
    </Section>
  );
}

function Members({ product, read, retry }) {
  if (!product.plan) return null;
  const m = read.status === 'ready' ? membersOn(product, read.data) : null;
  return (
    <Section title="Members on this plan" testId="pay-product-members">
      {read.status === 'loading' && <Reading />}
      {read.status === 'error' && <Unread text={MEMBERS_UNREAD} onRetry={retry} testId="pay-product-members-unread" />}
      {m && (
        <>
          <span className={`${MONO} text-[13px] font-bold text-axal-ink dark:text-gray-100`} data-testid="pay-product-members-line">{membersLine(m)}</span>
          {m.other > 0 && <span className={SUB}>{m.other.toLocaleString('en-US')} more trialing, past due, unpaid or incomplete.</span>}
          {m.withoutPrice > 0 && <span className={SUB} data-testid="pay-product-members-unpriced">{m.withoutPrice.toLocaleString('en-US')} on this plan’s family were recorded before prices were stored, so they are not counted under a price.</span>}
        </>
      )}
      <span className={SUB}>{KEEP_PRICE}</span>
    </Section>
  );
}

function Promos({ product, read, retry }) {
  const n = read.status === 'ready' ? promosFor(product.id, read.data?.promos) : null;
  return (
    <Section title="Promo codes that apply" testId="pay-product-promos">
      {read.status === 'loading' && <Reading />}
      {read.status === 'error' && <Unread text={PROMOS_UNREAD} onRetry={retry} testId="pay-product-promos-unread" />}
      {n && (
        <div className="flex flex-wrap items-center gap-3">
          <span className={`${MONO} text-[13px] font-bold text-axal-ink dark:text-gray-100`} data-testid="pay-product-promos-count">{codesWord(n.apply)}</span>
          <Link to="/admin/platform/promo-codes" className={GHOST}>Open Promo codes</Link>
        </div>
      )}
      {n?.unreadable > 0 && <span className={SUB}>{codesWord(n.unreadable)} could not be matched: their product list could not be read.</span>}
    </Section>
  );
}

function Checks({ catalog, product }) {
  const checks = productChecks(catalog, product.id);
  return (
    <Section title="Checks" testId="pay-product-checks">
      {checks === null && <span className={SUB}>Not recorded: the catalogue read carried no checks.</span>}
      {checks && checks.length === 0 && <span className="text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-400">✓ No issues.</span>}
      {checks && checks.map((c, i) => <div key={`${c.code}-${i}`} className={AMBER} data-testid="pay-product-check">! {c.message}</div>)}
    </Section>
  );
}

function Changes({ product, read, retry }) {
  const rows = read.status === 'ready' ? read.data?.entries || [] : [];
  return (
    <Section title="Recent changes" testId="pay-product-changes">
      {read.status === 'loading' && <Reading />}
      {read.status === 'error' && <Unread text={CHANGES_UNREAD} onRetry={retry} testId="pay-product-changes-unread" />}
      {read.status === 'ready' && rows.length === 0 && <span className={SUB}>No change to this product is recorded.</span>}
      {rows.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {rows.map((e, i) => <li key={e.id ?? i} className="text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="pay-product-change">{dayText(e.at)} · {whoText(e.who)} · {actionWord(e.action)}</li>)}
        </ul>
      )}
      <Link to={`/admin/platform/payments/log?product=${encodeURIComponent(product.id)}`} className={`${GHOST} self-start`}>Open the change log</Link>
    </Section>
  );
}

function Body({ product, catalog, onAct, canWrite }) {
  const phone = usePayPhone();
  const id = product.id;
  const [members, retryMembers] = useRead(() => adminPaymentsApi.members(), !product.plan, `members:${id}`);
  const [promos, retryPromos] = useRead(() => api.adminListPromos(), false, `promos:${id}`);
  const [changes, retryChanges] = useRead(() => paymentsApi.changeLog({ product: id, limit: 3 }), false, `changes:${id}`);
  const pack = groupOf(product) === 'packs';
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className={PILL}>{kindGroupWord(product)}{product.plan?.label ? ` · ${product.plan.label}` : ''}</span>
        <span className={PILL}>{product.active ? '✓ Active' : '– Archived'}</span>
      </div>
      {!phone && !pack && product.active && canWrite && (
        <div className="flex flex-wrap items-center gap-2" data-testid="pay-product-actions">
          <button type="button" className={PRIMARY} onClick={() => onAct({ type: 'addPrice', product })} data-testid="pay-act-add-price">Add a price</button>
          <button type="button" className={GHOST} onClick={() => onAct({ type: 'edit', product })} data-testid="pay-act-edit">Edit details</button>
          <button type="button" className={GHOST} onClick={() => onAct({ type: 'archiveProduct', product })} data-testid="pay-act-archive">Archive product</button>
        </div>
      )}
      {!pack && product.active && !canWrite && <span className={SUB} data-testid="pay-product-holder">{WRITE_HOLDER_NOTE}</span>}
      {!pack && !product.active && <span className={SUB}>An archived product cannot be changed here; make a new product instead.</span>}
      <WhereSeen product={product} />
      <Prices product={product} onAct={onAct} canWrite={canWrite} />
      <Members product={product} read={members} retry={retryMembers} />
      <Promos product={product} read={promos} retry={retryPromos} />
      <Checks catalog={catalog} product={product} />
      <Changes product={product} read={changes} retry={retryChanges} />
      <Technical testId="pay-product-tech">
        {technicalLines(product).map(([k, v]) => <span key={`${k}-${v}`} className="block">{k}: {v}</span>)}
      </Technical>
    </>
  );
}

/** PAY12b is a page with a Back door and persistent actions, not a clipped desktop table. */
function ProductFrame({ product, title, sub, onClose, onAct, canWrite, children }) {
  const phone = usePayPhone();
  const [choosing, setChoosing] = useState(false);
  if (!phone) return <PayDialog sheet label={title} title={title} sub={sub} onClose={onClose} testId="pay-product">{children}</PayDialog>;
  const writable = canWrite && product?.active && groupOf(product) !== 'packs';
  const prices = product ? priceRows(product).filter((p) => p.active) : [];
  return <section className="min-w-0 bg-white text-axal-ink dark:bg-gray-950 dark:text-gray-100" data-testid="pay-product-page">
    <header className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className={LINK} onClick={onClose} data-testid="pay-product-back">‹ Catalogue</button>
        {writable && <details className="relative" data-testid="pay-phone-product-more">
          <summary className={`${GHOST} cursor-pointer`}>More</summary>
          <div className="absolute right-0 z-10 flex min-w-[180px] flex-col gap-2 rounded-lg border border-axal-hairline bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-950">
            <button type="button" className={GHOST} onClick={() => onAct({ type: 'edit', product })} data-testid="pay-phone-edit">Edit details</button>
            <button type="button" className={GHOST} onClick={() => onAct({ type: 'archiveProduct', product })} data-testid="pay-phone-archive">Archive product</button>
          </div>
        </details>}
      </div>
      <h1 className="m-0 text-[22px] font-extrabold">{title}</h1>
    </header>
    <div className="flex flex-col gap-3 px-4 pb-6">{children}</div>
    {choosing && <section className="px-4 pb-4" data-testid="pay-phone-price-picker">
      <h2 className={EYE}>Which price do you want to change?</h2>
      {prices.map((p) => <button key={p.id} type="button" className={`${GHOST} mb-2 w-full`} onClick={() => onAct({ type: 'changePrice', product, price: p })} data-testid={`pay-phone-choose-${p.id}`}>{intervalWord(p)} · {amountText(p)}</button>)}
      <button type="button" className={GHOST} onClick={() => setChoosing(false)}>Cancel</button>
    </section>}
    {writable && <footer className="sticky bottom-20 flex gap-2 border-t border-axal-hairline bg-white p-3 dark:border-gray-700 dark:bg-gray-950" data-testid="pay-phone-product-actions">
      <button type="button" className={`${PRIMARY} flex-1`} onClick={() => onAct({ type: 'addPrice', product })} data-testid="pay-phone-add-price">Add a price</button>
      <button type="button" className={`${GHOST} flex-1`} disabled={!prices.length} onClick={() => setChoosing(true)} data-testid="pay-phone-change-price">Change a price</button>
    </footer>}
  </section>;
}

/** The lightbox for the product the address names, over whatever the catalogue read is doing. */
export default function ProductLightbox({ id, catalogRead, onClose, onRetry, onAct = () => {}, canWrite = false }) {
  const products = catalogRead?.status === 'ready' ? catalogRead.data?.products || [] : [];
  const product = products.find((p) => p.id === id) || null;
  if (catalogRead?.status === 'ready' && product) {
    return (
      <ProductFrame product={product} title={product.name} sub="Product" onClose={onClose} onAct={onAct} canWrite={canWrite}>
        <Body product={product} catalog={catalogRead.data} onAct={onAct} canWrite={canWrite} />
      </ProductFrame>
    );
  }
  return (
    <ProductFrame title="Product" onClose={onClose}>
      {(!catalogRead || catalogRead.status === 'loading') && <Reading />}
      {catalogRead?.status === 'error' && <Unread text={CATALOG_FAILED} onRetry={onRetry} testId="pay-product-unread" />}
      {catalogRead?.status === 'ready' && <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="pay-product-missing">{PRODUCT_MISSING}</p>}
      <Technical testId="pay-product-tech">{id}</Technical>
    </ProductFrame>
  );
}
