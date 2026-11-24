/** #5026: L31/L32 HQ package offers, explicit read-only consequence review, then a separately confirmed decision. */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { packageOffersApi } from '../../../lib/api/packageOffers';
import { licencePackagesApi } from '../../../lib/api/licencePackages';
import { useAuth } from '../../../hooks/useAuthSync';
import { AdminPageHeader } from '../../../ui';
import { TERMS, TERM_ORDER, termWord } from '../grants/grantsModel';
import { indexWord } from './packageCompareModel';
import Sheet from '../../../ui/Sheet';
import AdminBoardFrame from '../AdminBoardFrame';
import { money, priceText, reviewedPrice, canAccept, operation, validReason, offerFailure, loadPending, savePending } from './packageOfferModel';

const CARD = 'min-w-0 space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100';
const BTN = 'min-h-[44px] cursor-pointer rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 disabled:cursor-default disabled:opacity-50 dark:border-gray-700';
const INPUT = 'min-h-[44px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-950';
function Terms({ terms = {} }) { return <dl className="grid grid-cols-1 gap-1 sm:grid-cols-2">{TERM_ORDER.filter(k => k !== 'currency' && Object.hasOwn(terms, k)).map(k => <React.Fragment key={k}><dt>{TERMS[k].label}</dt><dd>{termWord(k, terms[k], terms)}</dd></React.Fragment>)}</dl>; }
function browserStorage() { try { return window.sessionStorage; } catch { return null; } }
const DEFAULT_API = { ...packageOffersApi, pricing: licencePackagesApi.pricing };
export function LicencePackageOffers(props) { return <Offers key={`${props.actorId}:${props.licenceUid}`} {...props} />; }
function Offers({ licenceUid, actorId, api = DEFAULT_API, storage = browserStorage() }) {
  const storageKey = `studioos:package-offer:${actorId}:${licenceUid}`;
  const [items, setItems] = useState(null), [pricing, setPricing] = useState(null), [pricingError, setPricingError] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [round, setRound] = useState(0);
  const [sheet, setSheet] = useState(null), [review, setReview] = useState(null), [step, setStep] = useState('review');
  const [price, setPrice] = useState(''), [override, setOverride] = useState(''), [reason, setReason] = useState('');
  const [dates, setDates] = useState({ starts_on: '', ends_on: '', expires_on: '' }), [history, setHistory] = useState(null);
  const [pending, setPending] = useState(() => loadPending(storage, storageKey));
  const alive = useRef(true), locked = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let live = true;
    api.list(licenceUid).then(r => { if (live) setItems(r.items || []); }).catch(() => { if (live) setError('Unreadable: package offers could not be read. Existing programs are not known to be absent.'); });
    api.pricing(licenceUid).then(r => { if (live) { setPricing(r); setPricingError(false); } }).catch(() => { if (live) { setPricing(null); setPricingError(true); } });
    return () => { live = false; };
  }, [api, licenceUid, round]);
  const keep = value => { setPending(value); savePending(storage, storageKey, value); };
  async function readAction(fn) {
    if (locked.current || pending) return;
    locked.current = true; setBusy(true); setError('');
    try { await fn(); } catch (e) { if (alive.current) setError(e?.status < 500 ? offerFailure(e) : 'Unreadable: the review or history could not be read. No decision was submitted.'); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function send(op) {
    if (!op || locked.current) return;
    locked.current = true; setBusy(true); setError(''); keep(op);
    try {
      await (op.action === 'create' ? api.create(licenceUid, op.body) : api[op.action](licenceUid, op.offer, op.body));
      savePending(storage, storageKey, null);
      if (!alive.current) return;
      setPending(null); setSheet(null); setReview(null); setNotice('Decision recorded. Read the current offer and branch delivery status separately; granted does not mean in force.'); setRound(n => n + 1);
    } catch (e) {
      if (!alive.current) return;
      setError(offerFailure(e));
      if (e?.status >= 400 && e.status < 500) { keep(null); setReview(null); setStep('review'); }
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  const begin = (offer, action) => { setSheet({ offer, action }); setStep('review'); setReview(null); setHistory(null); setPrice(priceText(offer.recommended_annual_fee_cents, offer.currency)); setOverride(''); setReason(''); setError(''); };
  const priceInput = sheet?.offer ? reviewedPrice(sheet.offer, price, override) : null;
  const readReview = () => readAction(async () => {
    const result = await api.review(licenceUid, sheet.offer.uid, priceInput);
    if (alive.current) { setReview(result); setStep('review'); }
  });
  const changePrice = (setter, value) => { setter(value); setReview(null); setStep('review'); };
  const blocked = busy || !!pending;
  const offer = sheet?.offer;
  return <div className="min-w-0 space-y-4" data-testid="licence-package-offers">
    <section className={CARD}><h2 className="text-base font-bold">Axal VC package offers</h2><p>Immutable versions and prices for this licence. Accepting is an HQ decision; nothing is sent or signed here.</p>
      <button type="button" className={BTN} disabled={busy} onClick={() => { setError(''); setRound(n => n + 1); }}>Read offers again</button>
      {notice && <div role="status"><p>{notice}</p><Link className={BTN} to={`/admin/licences?licence=${encodeURIComponent(licenceUid)}&tab=deploy`}>Check branch delivery</Link></div>}{error && <p role="alert">{error}</p>}
      {pending && <div role="alert"><p>An operation is awaiting confirmation. Its exact inputs and key are retained for this account and licence. Read before retrying; do not start another operation.</p><button type="button" className={BTN} disabled={busy} onClick={() => send(pending)}>Retry the same operation</button></div>}
      {items === null ? <p role="status">Reading recorded offers…</p> : <>
        {!items.some(o => o.state === 'accepted') && <p>No accepted Axal VC package recorded in this offer history. Programs may still be standalone grants; no package does not mean no programs.</p>}
        {items.length === 100 && <p>Showing the latest 100 offers. Older terms may exist; this is not a complete current-package inventory.</p>}
        <div className="grid min-w-0 gap-3 md:grid-cols-2">{items.map(o => <article className={CARD} key={o.uid}><h3 className="font-bold">{o.package_name} · v{o.package_version}</h3><p>{o.state} · Revision {o.revision}</p><p>{money(o.state === 'accepted' ? o.accepted_annual_fee_cents : o.recommended_annual_fee_cents, o.currency)} / year</p><p>Term {o.starts_on} to {o.ends_on} · Offer expiry {o.expires_on || 'Not recorded'}</p><p>Programs: {(o.programs || []).map(p => p.program_key).join(', ') || 'Not recorded'}</p><p>Country snapshot: {o.country_pricing_snapshot_uid || 'Not recorded'} · Model {o.recommendation?.pricing_model_version ?? 'Not recorded'}</p><p>Price override: {o.override_reason ? `Recorded · ${o.override_reason}` : 'None recorded'}</p><div className="flex flex-wrap gap-2">
          {o.state === 'offered' && <button type="button" className={BTN} disabled={blocked} onClick={() => begin(o, 'accept')}>Review {o.package_name} offer</button>}
          {(o.state === 'draft' ? ['offer', 'supersede'] : o.state === 'offered' ? ['decline', 'expire', 'supersede'] : []).map(action => <button type="button" className={BTN} key={action} disabled={blocked} onClick={() => begin(o, action)}>{action[0].toUpperCase() + action.slice(1)} {o.package_name}</button>)}
          <button type="button" className={BTN} disabled={blocked} onClick={() => readAction(async () => { const r = await api.history(licenceUid, o.uid); if (alive.current) { begin(o, 'history'); setHistory(r.items || []); } })}>History for {o.package_name}</button>
        </div>{o.state === 'accepted' && <p>Accepted price and composition are frozen. Upgrades, downgrade, renewal, proration and billing changes require their separate lifecycle policy.</p>}</article>)}</div>
      </>}
    </section>
    <section className={CARD}><h2 className="text-base font-bold">Recommended offers for this licence</h2>{pricingError ? <p role="alert">Recommendations unavailable. Record country pricing or read again; no price is assumed.</p> : !pricing ? <p>Reading recommendations…</p> : <><p>Snapshot {pricing.snapshot?.created_at || 'Not recorded'} · Model {pricing.model_version ?? 'Not recorded'}</p><div className="grid gap-3 md:grid-cols-2">{(pricing.packages || []).map(p => <article className={CARD} key={p.package_uid}><h3 className="font-bold">{p.name} · v{p.package_version}</h3><p>{money(p.recommended_annual_fee_cents, p.currency)} / year</p><p>Programs: {(p.programs || []).map(item => item.program_key.replaceAll('_', ' ')).join(', ') || 'Not recorded'}</p><p>Standalone: {money(p.standalone_sum_cents, p.currency)} · Bundle saving: {money(p.bundle_saving_cents, p.currency)}</p>{p.bundle_value_warning && <p role="status">Bundle price exceeds the recorded standalone sum. Review the warning before offering.</p>}<button type="button" className={BTN} disabled={blocked || p.status !== 'active' || p.recommended_annual_fee_cents == null} onClick={() => { setSheet({ action: 'create', package: p }); setReason(''); setDates({ starts_on: '', ends_on: '', expires_on: '' }); setError(''); }}>Prepare {p.name} offer</button></article>)}</div></>}
    </section>
    {sheet && <Sheet label="Package offer review" title={sheet.action === 'create' ? `Prepare ${sheet.package.name} offer` : `${offer.package_name} · v${offer.package_version}`} width={720} focusKey={step} onClose={() => !busy && setSheet(null)} footer={<div className="flex flex-wrap justify-end gap-2"><button type="button" className={BTN} disabled={busy} onClick={() => setSheet(null)}>Cancel</button>
      {sheet.action === 'create' ? <button type="button" className={BTN} disabled={blocked || !validReason(reason) || !dates.starts_on || !dates.ends_on || dates.ends_on < dates.starts_on} onClick={() => send({ action: 'create', body: { package_key: sheet.package.package_key, package_version: sheet.package.package_version, starts_on: dates.starts_on, ends_on: dates.ends_on, ...(dates.expires_on ? { expires_on: dates.expires_on } : {}), reason: reason.trim(), idempotency_key: crypto.randomUUID() } })}>Create draft offer</button> : sheet.action === 'history' ? null : sheet.action !== 'accept' ? <button type="button" className={BTN} disabled={blocked || !validReason(reason)} onClick={() => send(operation(sheet.action, offer, null, null, reason))}>Confirm {sheet.action}</button> : step === 'review' ? <>
        <button type="button" className={BTN} disabled={blocked || !priceInput} onClick={readReview}>Read consequences</button><button type="button" className={BTN} disabled={blocked || !canAccept(review)} onClick={() => setStep('accept')}>Continue to acceptance</button>
      </> : <><button type="button" className={BTN} disabled={blocked} onClick={() => setStep('review')}>Back to review</button><button type="button" className={BTN} disabled={blocked || !canAccept(review) || !validReason(reason)} onClick={() => send(operation('accept', review.offer, review, priceInput, reason))}>Accept offer</button></>}
    </div>}>
      <div className="space-y-4 p-5 text-sm">
      {sheet.action === 'history' ? <><h3 className="font-bold">Recorded decisions · first 200 events</h3>{!history?.length && <p>No decision events returned.</p>}{history?.map(e => <article className={CARD} key={e.uid || e.id}><p>{e.created_at} · {e.action}</p><p>Recorded by account {e.actor_user_id ?? 'Not recorded'}</p><p>{e.reason}</p></article>)}</> : sheet.action === 'create' ? <><p>A draft freezes this published version, program composition and server recommendation. It grants nothing. Recent HQ authentication and a reason are required.</p>{['starts_on', 'ends_on', 'expires_on'].map((key, i) => <label className="block" key={key}>{['Start date', 'End date', 'Offer expiry (optional)'][i]}<input className={INPUT} type="date" value={dates[key]} onChange={e => setDates(d => ({ ...d, [key]: e.target.value }))} /></label>)}</> : <>
        <h3 className="font-bold">1 · Exactly what is offered</h3><p>{offer.package_name} · frozen version {offer.package_version} · {offer.currency}</p><p>Recommended {money(offer.recommended_annual_fee_cents, offer.currency)} / year · {offer.starts_on} to {offer.ends_on}</p><p>Country index: {indexWord(offer.recommendation?.country_index_ppm)} · Model {offer.recommendation?.pricing_model_version ?? 'Not recorded'} · Snapshot {offer.country_pricing_snapshot_uid || 'Not recorded'}</p>
        {(offer.programs || []).map(p => <section key={p.program_key}><h4 className="font-semibold">{p.program_key.replaceAll('_', ' ')}</h4><Terms terms={p.terms} /></section>)}
        {sheet.action === 'accept' ? <>
          <label className="block">Accepted annual price ({offer.currency})<input className={INPUT} disabled={blocked || step === 'accept'} inputMode="decimal" value={price} onChange={e => changePrice(setPrice, e.target.value)} /></label>
          <label className="block">Price override reason (required when different)<textarea className={INPUT} disabled={blocked || step === 'accept'} maxLength={500} value={override} onChange={e => changePrice(setOverride, e.target.value)} /></label>
          {review && <><h3 className="font-bold">2 · Conflicts with existing grants</h3>{review.conflicts.length ? review.conflicts.map((c, i) => <p role="alert" key={i}>{c.program_key} · {c.message}</p>) : <p>No conflicts in this review. A concurrent change requires review again.</p>}
            <h3 className="font-bold">3 · Agreements that must be prepared</h3><p>Strategy: {review.legal?.strategy || 'Not recorded'} · Legal gate: {review.legal?.legal_gate || 'Not recorded'} · Policy version {review.legal?.policy_version ?? 'Not recorded'}</p><p>No agreement is sent, signed or made in force by this screen.</p>
            <h3 className="font-bold">4 · Effect on branch and program grants</h3>{review.grants.map(g => <section key={g.program_key}><h4 className="font-semibold">{g.program_key.replaceAll('_', ' ')}: {g.action === 'retained' ? 'Existing grant retained' : 'New grant proposed'}</h4><Terms terms={g.terms} /></section>)}<p>{review.branch_sync}</p><p>{review.accepted_program_allocation}</p><p>Reviewed accepted price: {money(review.price?.accepted_annual_fee_cents, offer.currency)}</p>
          </>}
        </> : <p>This records “{sheet.action}” for only this unaccepted offer at revision {offer.revision}. It does not terminate, reprice, invoice or replace an accepted package or its grants.</p>}
      </>}
      {sheet.action !== 'history' && <label className="block">Reason (10–500 characters)<textarea className={INPUT} disabled={blocked} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label>}
      {error && <p role="alert">{error}</p>}{pending && <p role="alert">Outcome is awaiting confirmation; use “Retry the same operation” on the underlying page after closing this sheet.</p>}
      </div>
    </Sheet>}
  </div>;
}
export default function LicencePackageOffersPage() {
  const { uid } = useParams(); const auth = useAuth();
  return <AdminBoardFrame workspace="Licences" note="Review one licence’s immutable package offer and record an explicit HQ decision."><AdminPageHeader title="Axal VC package" line="HQ offer review and decision history" pills={[{ label: 'HQ only', tone: 'hq' }]} /><Link className={BTN} to={`/admin/licences?licence=${encodeURIComponent(uid)}&tab=terms`}>Back to licence terms</Link><LicencePackageOffers licenceUid={uid} actorId={auth?.user?.id} /></AdminBoardFrame>;
}
