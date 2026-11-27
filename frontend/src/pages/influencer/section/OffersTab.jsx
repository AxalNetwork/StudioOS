import React, { useState } from 'react';
import { Pill, Sheet } from '../../../ui';
import { OFFER_PLANS, offerRequestArmed, offerRequestMessage, offerView } from './influencerSectionModel';
import { BODY, BlockUnreadable, Eyebrow, FIELD, INK, Loading, MUTED, Panel, SECONDARY } from './InfluencerParts';

/**
 * D4289 P7 (#4296), IN3 and IN3b — Offers at `/influencer/offers`: each
 * discount HQ linked to the handle, with its plans, who it is for, uses,
 * discount given (per currency), the remaining budget, the end date and its
 * status (Active, Paused by HQ, Ended, Budget used up, or Unreadable when the
 * Promos code behind it cannot be read). "Ask HQ for an offer" sends the
 * influencer's own words; HQ sets the discount, the budget and the end date.
 */
export default function OffersTab({ offers, accent, reads, onRetry }) {
  const [asking, setAsking] = useState(false);
  const [sent, setSent] = useState(false);
  if (!offers || offers.status === 'loading') return <Loading />;
  if (offers.status === 'error') return <BlockUnreadable what="Your offers" onRetry={onRetry} />;
  const list = Array.isArray(offers.data?.offers) ? offers.data.offers.map(offerView) : [];
  const ask = (
    <button type="button" className={SECONDARY} onClick={() => setAsking(true)} data-testid="offers-ask">
      {list.some((o) => o.status.key === 'budget_used') ? 'Ask HQ for more budget' : 'Ask HQ for an offer'}
    </button>
  );
  return (
    <div className="flex flex-col gap-4" data-testid="influencer-offers">
      <Panel title="Offers you can extend" sub="Discounts on Axal memberships, set by HQ. They apply automatically through your handle." right={ask}>
        {sent && <p className="mb-2 text-xs text-emerald-700 dark:text-emerald-300" role="status" data-testid="offers-sent">Sent. HQ replies within 5 business days; an approved offer appears here.</p>}
        {!list.length && (
          <div data-testid="offers-none">
            <span className={`block text-sm font-semibold ${INK}`}>No offer yet</span>
            <span className={`block text-sm ${MUTED}`}>You can ask HQ for a discount to extend through your handle.</span>
          </div>
        )}
      </Panel>
      {list.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((o) => <OfferCard key={o.uid} o={o} accent={accent} />)}
        </div>
      )}
      {asking && <AskSheet accent={accent} reads={reads} onClose={() => setAsking(false)} onSent={() => { setAsking(false); setSent(true); }} />}
    </div>
  );
}

function OfferCard({ o, accent }) {
  return (
    <Panel testId={`offer-${o.uid}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {o.plans.map((p) => <span key={p} className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${accent.chip}`}>{p}</span>)}
        <span className="ml-auto"><Pill tone={o.status.tone}>{o.status.label}</Pill></span>
      </div>
      <span className={`mt-2 block text-base font-semibold ${INK}`}>{o.discount}</span>
      <span className={`block text-xs ${MUTED}`}>{o.whoFor}</span>
      {o.code && <span className={`mt-1 block font-mono text-xs ${BODY}`}>Code {o.code}</span>}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div><Eyebrow>Uses</Eyebrow><span className={`font-mono text-sm font-semibold ${INK}`}>{o.uses}</span></div>
        <div><Eyebrow>Discount given</Eyebrow><span className={`font-mono text-sm font-semibold ${INK}`} data-testid="offer-given">{o.given}</span></div>
        <div><Eyebrow>Ends</Eyebrow><span className={`font-mono text-sm font-semibold ${INK}`}>{o.ends}</span></div>
      </div>
      <div className="mt-3">
        <div className={`flex justify-between text-xs ${MUTED}`}><span>Remaining budget</span><span className={`font-mono font-semibold ${INK}`}>{o.remaining}</span></div>
        {o.remainingPct !== null && (
          <progress className="mt-1 h-1.5 w-full" max={100} value={o.remainingPct} aria-label={`${o.remainingPct}% of the budget left`} />
        )}
      </div>
      {o.unrecordedUses > 0 && <p className={`mt-2 text-[11px] ${MUTED}`}>{o.unrecordedUses} earlier use{o.unrecordedUses === 1 ? '' : 's'} carry no recorded discount and are left out of the figure.</p>}
      <p className={`mt-2 text-[11px] ${MUTED}`}>Applied automatically through your handle. You earn a commission; the disclosure shows with the offer.</p>
    </Panel>
  );
}

function AskSheet({ accent, reads, onClose, onSent }) {
  const [draft, setDraft] = useState({ plans: [], idea: '', when: '' });
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);
  const toggle = (p) => setDraft((d) => ({ ...d, plans: d.plans.includes(p) ? d.plans.filter((x) => x !== p) : [...d.plans, p] }));
  const send = async () => {
    setBusy(true); setSaid(null);
    try { await reads.requestOffer(offerRequestMessage(draft)); onSent(); } catch (e) { setSaid(e?.message || 'The request could not be sent. Nothing was sent; try again.'); } finally { setBusy(false); }
  };
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" className={SECONDARY} onClick={onClose}>Cancel</button>
      <button type="button" className={`inline-flex min-h-[36px] items-center rounded-lg px-3 text-xs font-semibold disabled:opacity-50 ${accent.button}`} disabled={!offerRequestArmed(draft) || busy} onClick={send} data-testid="offers-send">Send request</button>
    </div>
  );
  return (
    <Sheet title="Ask HQ for an offer" sub="HQ replies within 5 business days" onClose={onClose} footer={footer} width={480} testId="offers-ask-sheet">
      <div className="flex flex-col gap-3">
        <fieldset>
          <legend className={`text-xs font-semibold ${MUTED}`}>Plans</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {OFFER_PLANS.map((p) => (
              <button key={p} type="button" aria-pressed={draft.plans.includes(p)} onClick={() => toggle(p)}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${draft.plans.includes(p) ? accent.chip : 'border-[#e2dfe8] text-[#3f3a47] dark:border-gray-600 dark:text-gray-300'}`}>{p}</button>
            ))}
          </div>
        </fieldset>
        <label className={`text-xs font-semibold ${MUTED}`}>What you have in mind
          <textarea className={FIELD} rows={4} maxLength={1800} value={draft.idea} onChange={(e) => setDraft({ ...draft, idea: e.target.value })} />
        </label>
        <label className={`text-xs font-semibold ${MUTED}`}>When you’ll publish
          <input className={FIELD} value={draft.when} onChange={(e) => setDraft({ ...draft, when: e.target.value })} />
        </label>
        <p className={`text-xs ${MUTED}`}>HQ sets the discount, the budget and the end date. The offer appears here once it is approved.</p>
        {said && <p className="text-xs text-red-700 dark:text-red-300" role="alert">{said}</p>}
      </div>
    </Sheet>
  );
}
