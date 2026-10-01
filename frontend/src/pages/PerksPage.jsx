import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShoppingBag, Ticket, Coins, Loader2, X, Check, Copy, ExternalLink,
  ClipboardCheck, Send, Star, Quote, ArrowRight, Grid3x3,
} from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';
import { Card, Pill, SectionLabel, Unrecorded, Unreadable, WorkerRail } from '../ui';
import './perksDesk.css';
import ZoneToolbar from '../workspaces/ZoneToolbar';
import ZoneDraft from '../workspaces/ZoneDraft';
import { Eyebrow, Instrument } from '../workspaces/canvasKit';

/**
 * Perks & Products — built from `design/canvases/backlog/Perks & Products.dc.html`
 * (D413). Two audiences, two mounts.
 *
 *   /perks                the founder side: Marketplace and My perks, plus
 *                         the admin Review queue. Unembedded, one WorkerRail.
 *   /offers/perk-deals    the partner side: the `po2` zone (strip, lifecycle,
 *                         Extend, draft) with the canvas's Submit a perk and
 *                         Performance under it. Embedded; the shell has the rail.
 *
 * A partner who opens /perks is sent to /offers/perk-deals (App.jsx): the
 * canvas's partner side is Submit and Performance, and both live there.
 *
 * WHAT THIS PAGE NEVER WRITES ITSELF. Every "why is this missing" sentence is
 * the Worker's — `absent.*` on the response — so the page cannot claim a
 * reminder, an introduction or a sync the product does not perform. Every
 * count, window and day-count is the Worker's too: My perks reads
 * `days_left`, `expiring` and `stats` off /api/perks/mine rather than doing
 * date arithmetic that could disagree with the partner zone's window.
 *
 * TWO HONEST EMPTY STATES, and they say different things on purpose.
 *
 *   * The catalogue is empty because no partner has submitted a perk yet. The
 *     partners in the design canvas are placeholders; listing them would be
 *     inventing commercial relationships that do not exist.
 *   * A zero credit balance is ambiguous, and the ambiguity matters. "Not
 *     enough credits" tells someone they spent theirs. But no credit allowance
 *     has been decided for any plan yet, so nobody has ever had any. The
 *     catalogue response carries `allowance_configured` precisely so this page
 *     can tell those two situations apart and say the true one.
 *
 * Credits here are PERK credits, a separate balance from the introduction
 * credits under Network. They are different units — an intro credit buys one
 * warm introduction — and the copy says so wherever a balance appears, because
 * two unlabelled "credits" in one product is a trap.
 *
 * WHAT THE CANVAS DRAWS THAT THIS DOES NOT, by decision (D413): the ledger's
 * monthly allowance, annual bonus and referral lines (no allowance exists —
 * perks_live.test.mjs pins that none is invented); "Credits refresh on the
 * 8th" (nothing refreshes); a fourth "Instant" redeem method (migration 186's
 * CHECK admits three); platform products priced in money (those are sold
 * through /api/payments and /api/orders, never as a perk); card impressions
 * and the BD console (the Worker says why, on the Performance panel).
 */

// D412 — the reasons routes/perks.ts gives for a listing this caller cannot
// claim. The card used to print "Not enough credits" for every reason that was
// not a tier, which became false the moment claiming became founders-only.
// `tier_required` reads as the canvas's CTA.
const UNCLAIMABLE_LABEL = {
  tier_required: 'Upgrade to claim',
  insufficient_credits: 'Not enough credits',
  founders_only: 'Founders only',
  cap_reached: 'Claim limit reached',
  perk_ended: 'Offer ended',
};

/** A listing's review state, as the shared Pill's tones say it. */
const STATUS_PILL = { live: 'ok', in_review: 'warn', rejected: 'danger', paused: 'neutral', draft: 'neutral' };

/** A count the Worker served. Never defaulted: a missing figure is not a zero. */
const n0 = (n) => Number(n).toLocaleString();
const money = (cents) => (cents === null || cents === undefined
  ? null
  : `$${(Math.round(Number(cents)) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
/** Whole dollars for a stated value — "$2,400 value" — never a float round-trip. */
const dollars = (cents) => `$${Math.round(Number(cents) / 100).toLocaleString()}`;
const day = (iso) => String(iso || '').slice(0, 10);
const tierName = (t) => (t ? String(t).charAt(0).toUpperCase() + String(t).slice(1) : '');
const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2)
  .map((w) => w[0].toUpperCase()).join('');

function priceLabel(p) {
  if (p.kind === 'tier') return p.required_tier ? `Included in ${tierName(p.required_tier)}` : 'Included in your plan';
  if (p.kind === 'money') return money(p.price_cents) || 'Quoted';
  return `${n0(p.credits)} credits`;
}

/** The canvas's line under the price: short by, needs a tier, or what kind of thing it is. */
function costNote(p) {
  if (p.kind === 'credits') return p.reason === 'insufficient_credits' ? `${n0(p.short_by)} short` : '';
  if (p.kind === 'tier') return p.reason === 'tier_required' ? `needs ${tierName(p.required_tier)}` : 'your plan';
  return 'paid engagement';
}

function CopyLine({ label, value, note }) {
  const [done, setDone] = useState(false);
  if (!value) return null;
  return (
    <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 break-all font-mono text-sm text-gray-900 dark:text-gray-100">{value}</code>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 dark:border-gray-700 dark:bg-gray-900"
          onClick={() => {
            navigator.clipboard?.writeText(value).then(() => {
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            }).catch(() => {});
          }}
        >
          {done ? <Check size={12} /> : <Copy size={12} />}{done ? 'Copied' : 'Copy'}
        </button>
      </div>
      {note && <div className="mt-1 text-[11px] text-gray-500">{note}</div>}
    </div>
  );
}

function Logo({ name, size = 36 }) {
  return (
    <div
      aria-hidden="true"
      className="flex flex-none items-center justify-center rounded-[10px] bg-violet-100 font-extrabold text-violet-800 dark:bg-violet-900/40 dark:text-violet-200"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initials(name)}
    </div>
  );
}

/** Stars and an average, or the canvas's "Not yet rated" — no rating is not a zero rating. */
function RatingLine({ rating }) {
  if (!rating || rating.average === null || rating.average === undefined) {
    return <span className="text-[11px] text-gray-500">Not yet rated</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-800 dark:text-gray-200">
      <Star size={11} className="fill-amber-400 text-amber-400" />{rating.average.toFixed(1)}
      <span className="font-normal text-gray-500">({n0(rating.count)})</span>
    </span>
  );
}

/**
 * One marketplace card. Also the partner's live preview, fed a draft — so what
 * a partner is shown is this component, not a drawing of it.
 */
export function PerkCard({ p, onOpen, preview = false }) {
  const cta = p.claimed
    ? 'Claimed'
    : (p.claimable ? (p.kind === 'money' ? 'Request' : 'Claim') : (UNCLAIMABLE_LABEL[p.reason] || 'Not claimable'));
  const live = preview || p.claimed || p.claimable || p.reason === 'tier_required';
  return (
    <Card
      as={onOpen ? 'button' : 'div'}
      type={onOpen ? 'button' : undefined}
      onClick={onOpen}
      data-testid="perk-card"
      className={`flex flex-col ${p.claimed ? 'border-emerald-300 dark:border-emerald-800' : ''} ${live ? '' : 'opacity-90'}`}
    >
      <div className="flex items-start gap-3">
        <Logo name={p.partner_name} />
        <div className="min-w-0">
          <div className="text-[12.5px] font-bold text-gray-900 dark:text-gray-100">{p.partner_name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <Pill tone="info">{p.category}</Pill>
            <RatingLine rating={p.rating} />
          </div>
        </div>
      </div>
      <div className="mt-3 text-[14px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">{p.offer}</div>
      {p.blurb && <p className="mt-1 flex-1 text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">{p.blurb}</p>}
      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <div className="text-[13px] font-bold text-gray-900 dark:text-gray-100">{priceLabel(p)}</div>
          <div className="text-[10.5px] text-gray-500">
            {[costNote(p), p.value_cents != null ? `${dollars(p.value_cents)} value` : ''].filter(Boolean).join(' · ')}
          </div>
        </div>
        <span
          className={`flex-none rounded-[9px] px-3.5 py-1.5 text-[11.5px] font-bold ${
            p.claimed ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
              : p.claimable || preview ? 'bg-violet-600 text-white'
                : p.reason === 'tier_required' ? 'border border-violet-300 text-violet-700 dark:text-violet-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
          }`}
        >
          {cta}
        </span>
      </div>
      {p.reason === 'tier_required' && (
        <div className="mt-2.5 rounded-[9px] bg-violet-50 px-2.5 py-2 text-[10.5px] text-violet-800 dark:bg-violet-900/20 dark:text-violet-200">
          Available on {tierName(p.required_tier)} and above
        </div>
      )}
      {p.cap_reached && (
        <div className="mt-2.5 text-[10.5px] text-gray-500">Every claim this partner offered has been taken; the listing stays up, marked full.</div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Founder: the marketplace                                            *
 * ------------------------------------------------------------------ */

const AFFORD = [
  { k: 'all', label: 'Everything' },
  { k: 'afford', label: 'What I can claim' },
  { k: 'free', label: 'No credits needed' },
];

/** The canvas's three affordability views. `free` is "included in your plan". */
export function passesAfford(p, afford) {
  if (afford === 'afford') return p.claimable && !p.claimed;
  if (afford === 'free') return p.kind === 'tier' && p.reason !== 'tier_required';
  return true;
}

function Marketplace({ data, onOpen }) {
  const [cat, setCat] = useState('All');
  const [afford, setAfford] = useState('all');
  const items = data.items;
  const featured = items.filter((p) => p.featured);
  const rest = items.filter((p) => !p.featured);
  const shown = rest
    .filter((p) => cat === 'All' || p.category === cat)
    .filter((p) => passesAfford(p, afford));
  const categories = data.categories;

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
        <ShoppingBag size={22} className="mx-auto text-gray-400" />
        <p className="mt-3 text-sm font-medium text-gray-900 dark:text-gray-100">No perks are listed yet.</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-gray-600">
          Partners submit offers and each one is reviewed before it appears here. Nothing is
          listed until a real partner has agreed to honour it.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {featured.length > 0 && (
        <section data-testid="perks-featured">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-[15px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Featured this month</div>
              <div className="text-[11.5px] text-gray-600 dark:text-gray-400">
                Picked by Axal’s reviewers. The quote under each is theirs — a partner cannot write or edit it.
              </div>
            </div>
            <div className="text-[11px] text-gray-500">{items.length} listings · {categories.length} categories</div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {featured.map((p) => (
              <div key={p.uid}>
                <PerkCard p={p} onOpen={() => onOpen(p)} />
                {p.editorial_note && (
                  <div className="mt-1.5 flex items-start gap-2 rounded-[10px] bg-violet-50 px-3 py-2 text-[11px] leading-relaxed text-violet-800 dark:bg-violet-900/20 dark:text-violet-200">
                    <Quote size={12} className="mt-0.5 flex-none" />{p.editorial_note}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section data-testid="perks-all">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[15px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">All perks &amp; products</div>
            <div className="text-[11.5px] text-gray-600 dark:text-gray-400">
              {shown.length} of {rest.length}{cat === 'All' ? '' : ` in ${cat}`}
              {afford === 'free' ? ' · included in your plan' : afford === 'afford' ? ' · you can claim now' : ''}
            </div>
          </div>
          <div className="flex gap-1 rounded-[10px] bg-gray-100 p-1 dark:bg-gray-800" role="group" aria-label="Affordability">
            {AFFORD.map((a) => (
              <button
                key={a.k} type="button" onClick={() => setAfford(a.k)} aria-pressed={afford === a.k}
                className={`rounded-[8px] px-3 py-1 text-[11.5px] font-semibold ${afford === a.k ? 'bg-white text-violet-700 shadow-sm dark:bg-gray-900 dark:text-violet-300' : 'text-gray-600 dark:text-gray-400'}`}
              >{a.label}</button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {['All', ...categories].map((k) => (
            <button
              key={k} type="button" onClick={() => setCat(k)} aria-pressed={cat === k}
              className={`rounded-full border px-3 py-1 text-xs ${cat === k ? 'border-violet-300 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-200' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}
            >
              {k}
              {k !== 'All' && <span className="ml-1 text-[9.5px] font-bold opacity-70">{items.filter((p) => p.category === k).length}</span>}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-6 text-center dark:border-gray-700">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Nothing matches that filter</div>
            <div className="mt-1 text-[12px] text-gray-600">
              {afford === 'afford'
                ? `Nothing${cat === 'All' ? '' : ` in ${cat}`} is claimable on this account right now.`
                : 'Try another category, or widen the filter.'}
            </div>
            <button type="button" onClick={() => { setCat('All'); setAfford('all'); }} className="mt-3 text-[12px] font-semibold text-violet-700 underline dark:text-violet-300">
              Clear filters
            </button>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((p) => <PerkCard key={p.uid} p={p} onOpen={() => onOpen(p)} />)}
          </div>
        )}
      </section>
    </div>
  );
}

/** What happens after a claim, by how the partner fulfils it. Product facts, not the partner's copy. */
function nextSteps(d) {
  const steps = [];
  if (d.kind === 'credits') steps.push('The credits come off your balance in the same step, and the ledger under My perks shows the line.');
  if (d.fulfilment === 'code') steps.push(`A code is issued to you on this screen and kept under My perks. Use it with ${d.partner_name}.`);
  if (d.fulfilment === 'link') steps.push(`You get a link to ${d.partner_name}’s own page, kept under My perks with your claim reference.`);
  if (d.fulfilment === 'intro') steps.push(`Your claim is recorded with a reference. You contact ${d.partner_name} with it.`);
  steps.push(`${d.partner_name} marks the claim redeemed once you have used it; after that you can rate it.`);
  return steps;
}

function ClaimModal({ perk, userTier, onClose, onClaimed, onGoMine }) {
  const [detail, setDetail] = useState(null);
  const [detailErr, setDetailErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    setDetailErr('');
    api.perk(perk.uid)
      .then(setDetail)
      .catch((e) => { reportError('perk_detail_failed', e); setDetailErr(e?.message || 'Could not load this perk.'); });
  }, [perk.uid]);
  useEffect(load, [load]);

  async function claim() {
    setBusy(true); setErr('');
    try {
      const r = await api.perkClaim(perk.uid);
      setResult(r);
      onClaimed?.();
    } catch (e) {
      reportError('perk_claim_failed', e);
      setErr(e?.message || 'Could not claim this perk.');
      // The listing changed under the reader: re-read it so the modal shows
      // the state the refusal was about, not the one it opened on.
      if (['cap_reached', 'perk_ended', 'insufficient_credits', 'tier_required'].includes(e?.code)) load();
    } finally { setBusy(false); }
  }

  const d = detail || perk;
  const absent = detail?.absent || {};
  const cost = d.kind === 'credits' ? Number(d.credits) : 0;
  const hasBalance = detail && detail.balance !== undefined && detail.balance !== null;
  const tierBlocked = !d.claimable && d.reason === 'tier_required';
  const label = d.claimable
    ? (d.kind === 'money' ? `Request · ${money(d.price_cents) || 'quoted'}`
      : d.kind === 'tier' ? `Claim · included in ${tierName(d.required_tier)}`
        : `Claim · ${n0(cost)} credits`)
    : (d.reason === 'tier_required' ? `Upgrade to ${tierName(d.required_tier)}` : (UNCLAIMABLE_LABEL[d.reason] || 'Not claimable'));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={d.offer} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        {result ? (
          <div data-testid="perk-claim-done">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
              <Check size={18} /><span className="text-[16px] font-extrabold">{result.already_claimed ? 'Already yours' : 'Claimed'}</span>
            </div>
            <p className="mt-1 text-[12.5px] text-gray-600 dark:text-gray-400">
              {result.already_claimed
                ? 'You had claimed this before, so nothing new was taken. Here is that claim.'
                : `${d.offer}, from ${d.partner_name}. It is saved under My perks.`}
            </p>
            {Number(result.credits_spent) > 0 && (
              <div className="mt-3 flex items-baseline justify-between rounded-md border border-gray-200 p-3 text-sm dark:border-gray-800">
                <span className="text-gray-600">Perk credits deducted · {n0(Number(result.balance) + Number(result.credits_spent))} → {n0(result.balance)}</span>
                <span className="font-bold text-gray-900 dark:text-gray-100">−{n0(result.credits_spent)}</span>
              </div>
            )}
            <CopyLine
              label="Redemption code" value={result.code}
              note={result.expires_at ? `Expires ${day(result.expires_at)}, with the offer.` : 'The offer has no end date, so this code does not expire.'}
            />
            {!result.code && (
              <CopyLine label="Claim reference" value={result.uid} note={`${d.partner_name} marks your claim redeemed by this reference.`} />
            )}
            {result.redeem_url && (
              <a href={result.redeem_url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm text-violet-700 hover:underline dark:text-violet-300">
                Open {d.partner_name}’s page <ExternalLink size={12} />
              </a>
            )}
            {absent.partner_contact && <p className="mt-3 text-[12px] text-amber-800 dark:text-amber-300">{absent.partner_contact}</p>}
            <div className="mt-5 grid gap-2">
              <button type="button" onClick={onGoMine} className="rounded-[11px] bg-violet-600 py-2.5 text-[13px] font-bold text-white hover:bg-violet-700">View in My perks</button>
              <button type="button" onClick={onClose} className="rounded-[11px] py-2 text-[12.5px] font-semibold text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800">Back to marketplace</button>
            </div>
          </div>
        ) : (
          <div data-testid="perk-claim-review">
            <div className="flex items-start gap-3">
              <Logo name={d.partner_name} size={44} />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">{d.offer}</div>
                <div className="text-[11.5px] text-gray-500">{d.partner_name} · {d.category}</div>
              </div>
              <button type="button" onClick={onClose} className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Close"><X size={16} /></button>
            </div>
            {detailErr && <div className="mt-3"><Unreadable what="This perk" claim="What claiming it costs is not shown." onRetry={load} /></div>}
            {(d.detail || d.blurb) && <p className="mt-3 whitespace-pre-wrap text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300">{d.detail || d.blurb}</p>}

            <div className="mt-4 rounded-[12px] border border-gray-200 p-3 dark:border-gray-800">
              <SectionLabel>{d.kind === 'credits' ? 'Credit balance' : d.kind === 'tier' ? 'Plan entitlement' : 'Price'}</SectionLabel>
              {d.kind === 'credits' && (
                hasBalance ? (
                  <>
                    <div className="mt-2 flex items-center gap-3">
                      <div><div className="text-[10px] text-gray-500">Balance now</div><div className="font-mono text-[16px] font-extrabold">{n0(detail.balance)}</div></div>
                      <ArrowRight size={14} className="text-gray-400" />
                      <div><div className="text-[10px] text-gray-500">After claiming</div><div className={`font-mono text-[16px] font-extrabold ${detail.balance - cost < 0 ? 'text-red-700' : ''}`}>{n0(Math.max(0, detail.balance - cost))}</div></div>
                      <div className="ml-auto text-right"><div className="text-[10px] text-gray-500">Cost</div><div className="font-mono text-[16px] font-extrabold">−{n0(cost)}</div></div>
                    </div>
                    {d.reason === 'insufficient_credits' && (
                      <div className="mt-2 rounded-[9px] bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                        You are {n0(d.short_by)} perk credits short. Claim something smaller, or ask Axal about a grant.
                      </div>
                    )}
                  </>
                ) : <div className="mt-2 text-sm text-gray-500"><Loader2 size={13} className="inline animate-spin" /> Reading your balance…</div>
              )}
              {d.kind === 'tier' && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-gray-700 dark:text-gray-300">
                  {userTier && <Pill tone="info">{tierName(userTier)} plan</Pill>}
                  {tierBlocked
                    ? `Needs ${tierName(d.required_tier)}.${userTier ? ` You are on ${tierName(userTier)}.` : ''}`
                    : `Included in ${tierName(d.required_tier)}.`}
                </div>
              )}
              {d.kind === 'money' && (
                <div className="mt-2">
                  <div className="font-mono text-[16px] font-extrabold">{money(d.price_cents) || 'Quoted'}</div>
                  <div className="text-[11px] text-gray-500">Nothing is charged here. The claim records that you asked.</div>
                </div>
              )}
            </div>

            <div className="mt-4">
              <SectionLabel>What happens next</SectionLabel>
              <ol className="mt-2 space-y-1.5">
                {nextSteps(d).map((s, i) => (
                  <li key={s} className="flex gap-2 text-[12px] text-gray-700 dark:text-gray-300">
                    <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full bg-violet-100 text-[9.5px] font-bold text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">{i + 1}</span>{s}
                  </li>
                ))}
              </ol>
              {absent.partner_contact && <p className="mt-2 text-[11.5px] text-amber-800 dark:text-amber-300">{absent.partner_contact}</p>}
            </div>

            {!d.claimable && d.reason === 'founders_only' && d.reason_text && (
              <p className="mt-3 text-sm text-amber-700">{d.reason_text}</p>
            )}
            {!d.claimable && (d.reason === 'cap_reached' || d.reason === 'perk_ended') && (
              <p className="mt-3 text-sm text-amber-700">{UNCLAIMABLE_LABEL[d.reason]}.</p>
            )}
            {err && <p className="mt-3 text-sm text-red-600" role="alert">{err}</p>}

            {tierBlocked ? (
              <Link to="/plans-and-pricing" className="mt-4 block rounded-[11px] border border-violet-300 py-3 text-center text-[13px] font-bold text-violet-700 dark:text-violet-300">{label}</Link>
            ) : (
              <button
                type="button" disabled={busy || !d.claimable || !detail} onClick={claim}
                className="mt-4 w-full rounded-[11px] bg-violet-600 py-3 text-[13px] font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:disabled:bg-gray-800"
              >
                {busy ? <Loader2 size={14} className="mx-auto animate-spin" /> : label}
              </button>
            )}
            <p className="mt-2 text-[10.5px] leading-relaxed text-gray-500">
              {d.ends_at
                ? `The offer ends ${day(d.ends_at)}; a claim made now expires then, whatever the listing says later.`
                : 'This offer has no end date, so a claim of it does not expire.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Founder: my perks + the credit ledger                               *
 * ------------------------------------------------------------------ */

const CLAIM_STATE = {
  issued: ['Active', 'ok'],
  redeemed: ['Redeemed', 'info'],
  expired: ['Expired', 'danger'],
};
const LEDGER_WHY = { grant: 'granted by Axal', spend: 'perk claimed', admin_adjust: 'adjusted by Axal' };

function paidWith(c) {
  if (Number(c.credits_spent) > 0) return `${n0(c.credits_spent)} perk credits`;
  if (c.kind_at_claim === 'tier') return 'included in your plan';
  if (c.kind_at_claim === 'money') return c.claimed_price_cents != null ? `${money(c.claimed_price_cents)}, invoiced by the partner` : 'quoted by the partner';
  return 'no credits';
}

function Stars({ value, onRate, busy }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="group" aria-label="Rate this perk">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={busy} onClick={() => onRate(n)} aria-label={`${n} star${n === 1 ? '' : 's'}`} aria-pressed={value === n}>
          <Star size={15} className={value && n <= value ? 'fill-amber-400 text-amber-400' : 'text-gray-300'} />
        </button>
      ))}
    </span>
  );
}

function ClaimedCard({ c, onRated }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [state, tone] = c.state === 'issued' && c.fulfilment === 'intro'
    ? ['Contact the partner', 'warn']
    : (CLAIM_STATE[c.state] || [c.state, 'neutral']);
  async function rate(n) {
    setBusy(true); setErr('');
    try { await api.perkRate(c.perk_uid, n); onRated(); } catch (e) {
      reportError('perk_rate_failed', e); setErr(e?.message || 'That rating did not save.');
    } finally { setBusy(false); }
  }
  return (
    <Card data-testid="perk-claimed">
      <div className="flex items-start gap-3">
        <Logo name={c.partner_name} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-100">{c.offer}</div>
            <Pill tone={tone}>{state}</Pill>
          </div>
          <div className="mt-0.5 text-[11.5px] text-gray-500">{c.partner_name} · claimed {day(c.created_at)} · {paidWith(c)}</div>
          {c.state === 'issued' && c.fulfilment === 'intro' && (
            <div className="mt-1 text-[11.5px] text-gray-700 dark:text-gray-300">Get in touch with {c.partner_name} and give them your claim reference.</div>
          )}
        </div>
        <div className="flex-none text-right">
          {c.state === 'redeemed' ? (
            <>
              <div className="text-[10px] text-gray-500">Redeemed</div>
              <div className="text-[12.5px] font-bold">{day(c.redeemed_at)}</div>
            </>
          ) : (
            <>
              <div className="text-[10px] text-gray-500">Expires</div>
              <div className={`text-[12.5px] font-bold ${c.expiring ? 'text-amber-700 dark:text-amber-300' : ''}`}>{c.expires_at ? day(c.expires_at) : 'No end date'}</div>
              {c.days_left !== null && c.days_left !== undefined && (
                <div className="text-[10.5px] text-gray-500">{c.days_left > 0 ? `${c.days_left} day${c.days_left === 1 ? '' : 's'} left` : 'expires today'}</div>
              )}
            </>
          )}
        </div>
      </div>
      {c.code
        ? <CopyLine label="Redemption code" value={c.code} />
        : <CopyLine label="Claim reference" value={c.uid} note={`${c.partner_name} marks the claim redeemed by this reference.`} />}
      {c.redeem_url && (
        <a href={c.redeem_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-violet-700 hover:underline dark:text-violet-300">
          Open {c.partner_name}’s page <ExternalLink size={12} />
        </a>
      )}
      {(c.can_rate || c.my_rating) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-gray-600 dark:text-gray-400">
          {c.can_rate ? <>Your rating <Stars value={c.my_rating} onRate={rate} busy={busy} /></> : <>You rated it {c.my_rating} of 5</>}
          {err && <span className="text-red-600">{err}</span>}
        </div>
      )}
    </Card>
  );
}

function MyPerks({ data, onRated }) {
  const items = data.items;
  const ledger = data.ledger;
  // Running balance, newest first: the top row ends at today's balance and
  // each older row ends where the next one started. Read off the rows the
  // Worker returned — the balance is their sum, never a stored number.
  const balances = [];
  let bal = Number(data.balance);
  for (const l of ledger) { balances.push(bal); bal -= Number(l.delta); }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-xl">
          <div className="text-[15px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">My perks</div>
          <div className="mt-0.5 text-[11.5px] leading-relaxed text-gray-600 dark:text-gray-400">
            Everything you have claimed, with its code or reference and when it lapses.
            {data.absent?.expiry_reminder ? ` ${data.absent.expiry_reminder}` : ''}
          </div>
        </div>
        <div className="flex gap-5" data-testid="perks-mine-stats">
          {[
            ['Claimed', n0(data.stats.claimed)],
            ['Perk credits spent', n0(data.stats.credits_spent)],
            [`Expiring in ${data.stats.expiring_within_days}d`, n0(data.stats.expiring)],
          ].map(([k, v]) => (
            <div key={k} className="text-right">
              <div className="font-mono text-[20px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">{v}</div>
              <div className="text-[10.5px] text-gray-500">{k}</div>
            </div>
          ))}
        </div>
      </div>

      {items.length === 0
        ? <p className="text-sm text-gray-600">Nothing claimed yet.</p>
        : <div className="space-y-3">{items.map((c) => <ClaimedCard key={c.uid} c={c} onRated={onRated} />)}</div>}

      <Card padding="none" data-testid="perks-ledger">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <SectionLabel>Perk credit ledger</SectionLabel>
          <div className="font-mono text-[11.5px] text-gray-600">balance {n0(data.balance)}</div>
        </div>
        <p className="px-4 pt-2 text-[11px] text-gray-500">
          Every line is a grant or a spend — the balance is the sum of them, not a number stored separately.
        </p>
        {ledger.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-600">No credits have been granted or spent on this account.</p>
        ) : (
          <div className="px-4 pb-2">
            {ledger.map((l, i) => (
              <div key={i} className="grid grid-cols-[70px_minmax(0,1fr)_70px_70px] items-baseline gap-2 border-b border-gray-100 py-2 text-[12px] last:border-0 dark:border-gray-800">
                <div className="text-gray-500">{day(l.created_at)}</div>
                <div className="min-w-0">
                  <div className="truncate font-semibold text-gray-900 dark:text-gray-100">{l.note || LEDGER_WHY[l.kind] || l.kind}</div>
                  <div className="text-[10.5px] text-gray-500">{LEDGER_WHY[l.kind] || l.kind}</div>
                </div>
                <div className={`text-right font-mono font-bold ${Number(l.delta) < 0 ? 'text-violet-700 dark:text-violet-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                  {Number(l.delta) > 0 ? '+' : '−'}{n0(Math.abs(Number(l.delta)))}
                </div>
                <div className="text-right font-mono text-gray-600">{n0(balances[i])}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Partner: submissions                                                *
 * ------------------------------------------------------------------ */

/**
 * `live` | `expiring` | `expired` for one listing, as the worker computed it.
 *
 * NEVER RECOMPUTED HERE. `routes/perks.ts` owns the thirty-day window and
 * serves `lifecycle` on every row; `routes/research.ts` imports the same helper
 * for the AI gather. A copy of the arithmetic in this file is how the strip and
 * the chips come to disagree about which perks are ending.
 *
 * The fallback is `live` rather than a guess, and it is only reachable against a
 * response that predates the field.
 */
export function perkState(p) {
  const s = String(p?.lifecycle || '');
  return s === 'expiring' || s === 'expired' ? s : 'live';
}

/**
 * Which chip a listing answers to.
 *
 * `Live` IS BOTH THINGS, and this is the correction migration 228 made
 * possible. It used to be `status === 'live'` alone — the REVIEW state, "an
 * admin approved it" — while the artboard's own note for the word is
 * "accepting redemptions". A perk approved in March and ended in June is not
 * accepting anything.
 *
 * A draft with a far-off end date answers to `All` and to nothing else. That is
 * a real fourth state with no word on the artboard, and the two wrong homes for
 * it would each claim something untrue: `Live` claims a review that has not
 * happened, `Expiring` claims an urgency it does not have.
 */
export function matchesPerkChip(p, chip) {
  const state = perkState(p);
  if (chip === 'live') return p.status === 'live' && state === 'live';
  if (chip === 'expiring') return state === 'expiring';
  if (chip === 'expired') return state === 'expired';
  return true;
}

const STATE_LABEL = { live: 'Live', expiring: 'Expiring', expired: 'Expired' };
const STATE_TONE = { live: 'ok', expiring: 'warn', expired: 'danger' };
const REVIEW_NOTE = {
  draft: 'draft — not submitted',
  in_review: 'awaiting review',
  paused: 'paused — hidden from founders',
  rejected: 'rejected',
};

/** The strip tile, in the anatomy the artboards share. */
function PerkTile({ label, value, note }) {
  return (
    <div className="rounded-[10px] border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1.5 font-mono text-[16px] font-extrabold tracking-tight tabular-nums text-gray-900 dark:text-gray-100">{value}</div>
      <div className="mt-1 text-[10px] leading-snug text-gray-600 dark:text-gray-400">{note}</div>
    </div>
  );
}

/**
 * `Extend`, the artboard's second op.
 *
 * IT LISTS ONLY WHAT CAN BE EXTENDED — perks that are ending or have ended.
 * A perk with no end date recorded is not in the set: there is nothing to push,
 * and offering to extend it would be offering to invent a date the firm never
 * chose. A perk months from ending is not in it either, for the same reason the
 * `Expiring` chip does not include it.
 */
function ExtendModal({ rows, busy, onSave, onClose, note }) {
  const [dates, setDates] = useState(() => Object.fromEntries(
    rows.map((p) => [p.uid, String(p.ends_at || '').slice(0, 10)]),
  ));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Extend an offer</h3>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="mt-3 text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400">
            Nothing is ending. Only offers already expiring or expired can be extended —
            a listing with no end date recorded has nothing to push, and one months away
            is not ending yet.
          </p>
        ) : (
          <>
            <p className="mt-2 text-[11.5px] leading-relaxed text-gray-600 dark:text-gray-400">
              Extending the offer does not restore a grant it already revoked. Those are two
              decisions, and only the first one happens here.
            </p>
            <div className="mt-3 space-y-3">
              {rows.map((p) => (
                <div key={p.uid} className="rounded-md border border-gray-200 p-3 dark:border-gray-800">
                  <div className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-100">{p.offer}</div>
                  <div className="mt-0.5 text-[11px] text-gray-500">
                    {STATE_LABEL[perkState(p)]} · ends {String(p.ends_at || '').slice(0, 10)}
                    {p.grant_scope ? ` · grants ${p.grant_scope}` : ''}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="date" className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700"
                      value={dates[p.uid] || ''}
                      onChange={(e) => setDates((d) => ({ ...d, [p.uid]: e.target.value }))}
                    />
                    <button
                      type="button" disabled={busy || !dates[p.uid] || dates[p.uid] === String(p.ends_at || '').slice(0, 10)}
                      onClick={() => onSave(p, dates[p.uid])}
                      className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      Save new end date
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {note && (
          <p className={`mt-3 text-[12px] ${note.ok ? 'text-green-700' : 'text-red-600'}`}>{note.text}</p>
        )}
      </div>
    </div>
  );
}

const INPUT = 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900';
/** The canvas's six categories, plus the Worker's own default for anything else. */
const PERK_CATEGORIES = ['Cloud', 'Legal', 'Banking', 'Recruiting', 'GTM', 'Tools', 'Other'];

function PerkField({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-[11.5px] font-semibold text-gray-700 dark:text-gray-300">{label}</span>
      <span className="mt-1 block">{children}</span>
      {hint && <span className="mt-1 block text-[10.5px] leading-snug text-gray-500">{hint}</span>}
    </label>
  );
}

const pct = (r) => `${Math.round(Number(r) * 100)}%`;

/**
 * The canvas's Performance tab, for ONE of this partner's listings (D413).
 *
 * Every figure is `GET /partner/:uid/stats`; every row is `GET
 * /partner/:uid/claims`. What the canvas draws that the store cannot say —
 * card impressions, which founders claimed, a BD console — is printed as the
 * Worker's own sentence, never as a zero or a fixture.
 */
function ListingPerformance({ rows, onChanged }) {
  const first = rows.find((p) => p.status === 'live') || rows[0];
  const [uid, setUid] = useState(first.uid);
  const [stats, setStats] = useState(null);
  const [claims, setClaims] = useState(null);
  const [readErr, setReadErr] = useState('');
  const [code, setCode] = useState('');
  const [cap, setCap] = useState('');
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const listing = rows.find((p) => p.uid === uid) || first;

  const load = useCallback(() => {
    setReadErr('');
    Promise.all([api.perkStats(uid), api.perkClaimsForListing(uid)])
      .then(([s, c]) => { setStats(s); setClaims(c); })
      .catch((e) => { reportError('perk_performance_failed', e); setReadErr(e?.message || 'Could not read this listing.'); });
  }, [uid]);
  useEffect(() => { setStats(null); setClaims(null); setNote(null); load(); }, [load]);

  async function redeem(body) {
    setBusy(true); setNote(null);
    try {
      await api.perkRedeem(uid, body);
      setNote({ ok: true, text: 'Marked redeemed. The founder can now rate the perk.' });
      setCode('');
      load(); onChanged();
    } catch (e) {
      reportError('perk_redeem_failed', e);
      setNote({ ok: false, text: e?.message || 'That claim was not marked redeemed.' });
      if (e?.code === 'already_redeemed') load();
    } finally { setBusy(false); }
  }

  async function raiseCap(next) {
    setBusy(true); setNote(null);
    try {
      const r = await api.perkUpdate(uid, { claim_cap: next });
      setNote({
        ok: true,
        text: r?.reviewed_again
          ? 'Saved. That was not a raise, so the listing went back to review.'
          : `Cap ${next === null ? 'removed' : `raised to ${next}`}. The listing stays as it was.`,
      });
      setCap('');
      load(); onChanged();
    } catch (e) {
      reportError('perk_cap_failed', e);
      setNote({ ok: false, text: e?.message || 'The cap did not change.' });
    } finally { setBusy(false); }
  }

  const s = stats;
  const funnel = s ? [
    { k: 'Card views', n: null, why: s.absent?.card_views },
    { k: 'Opened the detail', n: s.views, note: 'Detail opens, one per founder per day.' },
    { k: 'Claimed', n: s.claims, note: 'Spent credits, claimed on a plan, or asked for a paid engagement.' },
    { k: 'Redeemed with you', n: s.redeemed, note: 'Claims you marked redeemed. This is the number that matters.' },
  ] : [];
  const top = s ? Math.max(1, ...funnel.filter((f) => f.n !== null).map((f) => Number(f.n))) : 1;

  return (
    <section data-testid="perk-performance" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-xl">
          <div className="text-[15px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Listing performance</div>
          <div className="mt-0.5 text-[11.5px] text-gray-600 dark:text-gray-400">
            Redemption rate is the number to watch — claims are cheap, redemptions are the distribution.
          </div>
        </div>
        <select className={`${INPUT} w-auto max-w-xs`} value={uid} onChange={(e) => setUid(e.target.value)} aria-label="Listing">
          {rows.map((p) => <option key={p.uid} value={p.uid}>{p.offer} · {String(p.status).replace('_', ' ')}</option>)}
        </select>
      </div>

      {readErr && <Unreadable what="This listing’s performance" claim="It is not a sign nobody claimed it." onRetry={load} />}
      {!s && !readErr && <p className="text-sm text-gray-500"><Loader2 size={13} className="inline animate-spin" /> Reading…</p>}

      {s && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="perk-performance-strip">
            <PerkTile label="Claims" value={n0(s.claims)} note={s.claim_cap == null ? 'uncapped' : `of a ${s.claim_cap} cap`} />
            <PerkTile
              label="Redemption rate"
              value={s.redemption_rate === null ? <Unrecorded reason={s.absent?.redemption_rate} /> : pct(s.redemption_rate)}
              note={s.redemption_rate === null ? s.absent?.redemption_rate : `${n0(s.redeemed)} of ${n0(s.claims)} redeemed`}
            />
            <PerkTile label="Founders reached" value={n0(s.founders_reached)} note="one claim per founder — a count, never who" />
            <PerkTile
              label="Cost per founder"
              value={s.cost_per_founder_cents === null ? <Unrecorded reason={s.absent?.cost_per_founder} /> : money(s.cost_per_founder_cents)}
              note={s.cost_per_founder_cents === null ? s.absent?.cost_per_founder : `${dollars(s.value_cents)} value × ${n0(s.redeemed)} redeemed ÷ ${n0(s.claims)} reached`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Card data-testid="perk-funnel">
              <div className="flex items-baseline justify-between">
                <SectionLabel>Claim funnel · {listing.offer}</SectionLabel>
                <RatingLine rating={s.rating} />
              </div>
              <div className="mt-3 space-y-3">
                {funnel.map((f, i) => {
                  const prev = i > 0 ? funnel[i - 1].n : null;
                  const conv = f.n !== null && prev !== null && Number(prev) > 0 ? Math.round((Number(f.n) / Number(prev)) * 100) : null;
                  return (
                    <div key={f.k}>
                      <div className="flex items-baseline justify-between gap-2 text-[12px]">
                        <span className="font-semibold text-gray-800 dark:text-gray-200">{f.k}</span>
                        <span className="flex items-center gap-2">
                          {conv !== null && <Pill tone={conv >= 60 ? 'ok' : conv >= 20 ? 'warn' : 'neutral'}>{conv}% of prior step</Pill>}
                          <span className="font-mono font-extrabold">{f.n === null ? <Unrecorded reason={f.why} /> : n0(f.n)}</span>
                        </span>
                      </div>
                      <div className="mt-1 h-2 rounded-[5px] bg-gray-100 dark:bg-gray-800">
                        {f.n !== null && <div className="h-full rounded-[5px] bg-violet-600" style={{ width: `${(Number(f.n) / top) * 100}%`, opacity: 1 - i * 0.14 }} />}
                      </div>
                      <div className="mt-0.5 text-[10.5px] text-gray-500">{f.n === null ? f.why : f.note}</div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <div className="space-y-4">
              <Card data-testid="perk-cap">
                <div className="flex items-baseline justify-between">
                  <SectionLabel>Claim cap</SectionLabel>
                  <span className="font-mono text-[12px] font-bold">{s.claim_cap == null ? `${n0(s.claims)} claimed · uncapped` : `${n0(s.claims)} of ${s.claim_cap} claimed`}</span>
                </div>
                {s.claim_cap != null && (
                  <div className="mt-2 h-2 rounded-full bg-gray-100 dark:bg-gray-800">
                    <div className={`h-full rounded-full ${s.claims / s.claim_cap > 0.85 ? 'bg-amber-600' : 'bg-violet-600'}`} style={{ width: `${Math.min(100, (s.claims / s.claim_cap) * 100)}%` }} />
                  </div>
                )}
                <p className="mt-2 text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
                  {s.claim_cap == null
                    ? 'No cap is set, so claims are not limited.'
                    : `At ${s.claim_cap} claims stop: the listing stays up, marked full, rather than letting claims run past what you agreed to honour. ${n0(s.remaining)} left.`}
                </p>
                {s.claim_cap != null && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="number" min={s.claim_cap + 1} className={`${INPUT} w-28 font-mono`} placeholder={String(s.claim_cap + 1)}
                      value={cap} onChange={(e) => setCap(e.target.value)} aria-label="New cap" />
                    <button type="button" disabled={busy || !(Number(cap) > s.claim_cap)} onClick={() => raiseCap(Number(cap))}
                      className="rounded-md border border-violet-300 px-3 py-1.5 text-xs font-bold text-violet-700 disabled:opacity-50 dark:text-violet-300">
                      Raise the cap
                    </button>
                  </div>
                )}
                <p className="mt-1.5 text-[10.5px] text-gray-500">Raising the cap keeps a live listing live. Any other edit sends it back to review.</p>
              </Card>

              <Card data-testid="perk-claims">
                <div className="flex items-baseline justify-between">
                  <SectionLabel>Founders reached</SectionLabel>
                  <span className="text-[11px] text-gray-500">{n0(s.founders_reached)} founder{Number(s.founders_reached) === 1 ? '' : 's'}</span>
                </div>
                <p className="mt-1 text-[10.5px] leading-relaxed text-gray-500">
                  <Unrecorded reason={s.absent?.founders_list}>Who they are is not shown</Unrecorded> — {s.absent?.founders_list}
                </p>
                <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) redeem({ code: code.trim() }); }}>
                  <input className={`${INPUT} font-mono`} placeholder="Code a founder gave you" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Redemption code" />
                  <button type="submit" disabled={busy || !code.trim()} className="flex-none rounded-md bg-violet-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Mark redeemed</button>
                </form>
                {note && <p className={`mt-2 text-[12px] ${note.ok ? 'text-emerald-700' : 'text-red-600'}`} role="status">{note.text}</p>}
                <div className="mt-2 max-h-72 overflow-y-auto">
                  {(claims?.items || []).length === 0 ? (
                    <p className="py-2 text-[12px] text-gray-600">No claims on this listing yet.</p>
                  ) : claims.items.map((c) => (
                    <div key={c.uid} className="flex items-center gap-2 border-b border-gray-100 py-2 text-[11.5px] last:border-0 dark:border-gray-800">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-gray-800 dark:text-gray-200">{c.uid}</div>
                        <div className="text-[10.5px] text-gray-500">
                          claimed {String(c.created_at).slice(0, 10)}
                          {c.state === 'redeemed' ? ` · redeemed ${String(c.redeemed_at).slice(0, 10)}` : c.expires_at ? ` · expires ${String(c.expires_at).slice(0, 10)}` : ''}
                        </div>
                      </div>
                      <Pill tone={c.state === 'redeemed' ? 'ok' : c.state === 'issued' ? 'warn' : 'neutral'}>{c.state === 'issued' ? 'Claimed' : c.state === 'redeemed' ? 'Redeemed' : c.state}</Pill>
                      {c.state === 'issued' && (
                        <button type="button" disabled={busy} onClick={() => redeem({ claim_uid: c.uid })} className="flex-none text-[11px] font-bold text-violet-700 underline disabled:opacity-50 dark:text-violet-300">
                          Mark redeemed
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[10.5px] leading-relaxed text-gray-500">
                  <Unrecorded reason={s.absent?.bd_console}>No BD console</Unrecorded> — {s.absent?.bd_console}
                </p>
              </Card>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function PartnerConsole({ zoneActions, zoneFilters, role }) {
  const [items, setItems] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [view, setView] = useState('all');
  const [form, setForm] = useState({
    partner_name: '', offer: '', category: 'Other', blurb: '', detail: '', value: '',
    kind: 'credits', credits: '', required_tier: 'growth', price_cents: '',
    fulfilment: 'code', redeem_url: '', claim_cap: '', duration: '', ends_at: '', grant_scope: '',
  });
  const [absent, setAbsent] = useState({});
  const [submitted, setSubmitted] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [extending, setExtending] = useState(false);
  const [extendNote, setExtendNote] = useState(null);
  const offerRef = React.useRef(null);

  const load = useCallback(() => {
    api.perkSubmissions()
      .then((d) => { setItems(d?.items || []); setAbsent(d?.absent || {}); })
      .catch((e) => { reportError('perk_submissions_failed', e); setLoadErr(e?.message || 'Could not load your listings.'); });
  }, []);
  useEffect(load, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // The canvas's "Listing duration" writes the offer's own end date, which the
  // field below shows and the partner can still change. `Ongoing` is no date.
  const setDuration = (e) => {
    const months = Number(e.target.value);
    const end = new Date();
    if (months) end.setUTCMonth(end.getUTCMonth() + months);
    setForm((f) => ({ ...f, duration: e.target.value, ends_at: months ? end.toISOString().slice(0, 10) : '' }));
  };

  // The canvas's rule for its button: an offer a founder can read, what it is
  // worth, and the detail a founder reads before claiming.
  const ready = form.partner_name.trim() && form.offer.trim().length > 6 && form.value.trim() && form.detail.trim().length > 20;

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    // Entered in dollars, stored in cents. Money is an integer number of cents
    // everywhere in this codebase; a value that is not a number is refused here
    // rather than stored as a zero.
    const valueCents = Math.round(Number(form.value.replace(/[$,\s]/g, '')) * 100);
    if (!Number.isFinite(valueCents) || valueCents < 0) { setErr('The cash value must be an amount in dollars.'); return; }
    setBusy(true); setErr(''); setSubmitted('');
    try {
      const { value, duration, ...rest } = form;
      await api.perkSubmit({
        ...rest,
        value_cents: valueCents,
        credits: form.kind === 'credits' ? Number(form.credits) || 0 : 0,
        // Entered in dollars, stored in cents. Money is an integer number of
        // cents everywhere in this codebase.
        price_cents: form.kind === 'money' ? Math.round((Number(form.price_cents) || 0) * 100) : null,
        claim_cap: form.claim_cap === '' ? null : Number(form.claim_cap),
        // An empty field is an ABSENT date and an ABSENT grant, not an empty
        // string: the worker stores null and the row reads `Not recorded`.
        ends_at: form.ends_at || null,
        grant_scope: form.grant_scope || null,
      });
      setSubmitted(form.offer);
      setForm((f) => ({
        ...f, offer: '', blurb: '', detail: '', value: '', credits: '', price_cents: '',
        duration: '', ends_at: '', grant_scope: '',
      }));
      load();
    } catch (e2) {
      reportError('perk_submit_failed', e2);
      setErr(e2?.message || 'Could not submit.');
    } finally { setBusy(false); }
  }

  const rows = items || [];
  const visible = rows.filter((p) => matchesPerkChip(p, view));

  // ══ THE ARTBOARD'S FOUR TILES, COUNTED OVER THE WHOLE BOOK ═══════════════
  // Never over `visible`: a figure that changes because a chip was clicked is
  // not reporting what its label claims.
  const live = rows.filter((p) => p.status === 'live' && perkState(p) === 'live');
  const expiring = rows.filter((p) => perkState(p) === 'expiring');
  const expired = rows.filter((p) => perkState(p) === 'expired');
  // `Grants revoked` COUNTS WHAT THIS BOOK NAMES, and the distinction is the
  // artboard's own: a perk whose expiry took something back is one that RECORDED
  // what it granted. A perk with no grant recorded contributes nothing — not
  // because it granted nothing, but because nobody said. The instNote says so
  // rather than letting the zero read as an all-clear.
  const revoking = expired.filter((p) => p.grant_scope);
  // D413 — REDEEMERS, now that `redeemed` has a writer. This summed
  // `claim_count` under the word "redeemers" while nothing ever marked a claim
  // redeemed, so every claim was counted as one.
  const revokedRedeemers = revoking.reduce((a, p) => a + Number(p.redeemed_count), 0);
  const nextEnd = expiring
    .map((p) => String(p.ends_at || '').slice(0, 10))
    .filter(Boolean)
    .sort()[0];

  const handlers = {
    // `New perk` opens the form that was already on the page. The op used to
    // read 'perks are added from the form below', which was true and made the
    // header row point at something instead of doing it.
    newPerk: () => {
      offerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      offerRef.current?.focus({ preventScroll: true });
    },
    extend: () => { setExtendNote(null); setExtending(true); },
  };

  async function saveEnd(perk, date) {
    setBusy(true); setExtendNote(null);
    try {
      await api.perkUpdate(perk.uid, { ends_at: date });
      setExtendNote({ ok: true, text: `${perk.offer} now ends ${date}.` });
      load();
    } catch (e) {
      reportError('perk_extend_failed', e);
      setExtendNote({ ok: false, text: e?.message || 'That date did not save.' });
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      {/* `role` is the SHELL's licence rather than the viewer's: this console is
          reached through `PartnerWorkspaceTabs`, so an admin reading it is
          still in the amber shell. The caller supplies it beside the actions it
          already supplies, and this page learns nothing about roles. */}
      {(zoneActions || zoneFilters) && (
        <ZoneToolbar
          role={role}
          filters={zoneFilters ? zoneFilters({ value: view, onChange: setView }) : []}
          actions={zoneActions ? zoneActions(visible, handlers) : []}
        />
      )}

      {/* ══ THE `po2` STRIP ═══════════════════════════════════════════════════
          `Live · Expiring · Expired · Grants revoked`, all four counted from
          rows. The window under `Expiring` is printed rather than assumed: the
          artboard supplies no number, thirty days is chosen in
          `routes/perks.ts`, and a reader who can see the rule can disagree
          with it. */}
      {items && items.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <PerkTile label="Live" value={String(live.length)} note="accepting redemptions" />
          <PerkTile
            label="Expiring"
            value={String(expiring.length)}
            note={nextEnd ? `next ends ${nextEnd}` : 'none ending within 30 days'}
          />
          <PerkTile label="Expired" value={String(expired.length)} note="grants revoked on expiry" />
          <PerkTile
            label="Grants revoked"
            value={String(revokedRedeemers)}
            note={`redeemers affected across ${revoking.length} perk${revoking.length === 1 ? '' : 's'}`}
          />
        </div>
      )}

      {items && items.length > 0 && (
        <Instrument
          testid="perk-lifecycle"
          title="Perk lifecycle"
          meta="Expiry is an event with a consequence, not a filter"
          cols="1.6fr .9fr 1.1fr .9fr 1.9fr"
          head={['Perk', 'State', 'Redeemed / cap', 'Ends', 'What it granted']}
          rows={visible.map((p) => {
            const state = perkState(p);
            // TWO COUNTS, AND THE CAP IS ON ONE OF THEM (D413). The cap limits
            // claims, so the bar is claims against it; `redeemed` is the
            // subset the partner has marked used. This cell printed the claim
            // count as "redeemed" until a claim could be marked redeemed.
            const claimed = Number(p.claim_count);
            const used = Number(p.redeemed_count);
            const cap = p.claim_cap == null ? null : Number(p.claim_cap);
            const ratio = cap ? claimed / cap : 0;
            return {
              key: p.uid,
              cells: [
                { text: p.offer, sub: REVIEW_NOTE[p.status] || undefined },
                { pill: STATE_LABEL[state], pillTone: STATE_TONE[state] },
                // THE BAR IS DRAWN ONLY WHERE THERE IS A DENOMINATOR. An
                // uncapped offer has a redemption count and no ratio, and a bar
                // filled to some fraction of nothing would invent the cap the
                // firm deliberately did not set.
                cap == null
                  ? { text: `${used} redeemed`, sub: `${claimed} claimed · uncapped` }
                  : {
                    text: `${used} redeemed`,
                    sub: `${claimed} of ${cap} claimed`,
                    barPct: Math.round(ratio * 100),
                    barColor: ratio >= 1 ? '#b91c1c' : (ratio >= 0.7 ? '#b45309' : '#047857'),
                  },
                p.ends_at ? { text: String(p.ends_at).slice(0, 10) } : { nr: true },
                p.grant_scope
                  ? { text: p.grant_scope, ...(p.grant_revoked_on ? { rvk: `Revoked ${p.grant_revoked_on}` } : {}) }
                  : { nr: true },
              ],
            };
          })}
          note={'An expired offer states what it took back and on what date rather than fading out — that is the whole reason this table has a lifecycle column instead of a filter. Two things it does not claim. Nothing in this product withdraws a scope automatically: the red mark records that the grant ended with the offer, and sending the notice is a person’s job. And `Grants revoked` counts the grants this book NAMES — a perk with no grant recorded contributes nothing to it, because nobody said what it gave, not because it gave nothing. An offer with no end date recorded reads Live and never appears under Expiring, so a date left blank is a listing that will run until somebody sets one.'}
        />
      )}

      {items && items.length > 0 && (
        <ZoneDraft
          surface="offers/perk-deals"
          label="Draft · expiry consequences"
          accept="Accept draft"
          run="Read the expiries"
          foot="Traces to perk rows and grant scopes."
          empty="For each expiring offer, what its expiry revokes and from whom — so a notice can go out before it happens rather than after."
          nothingToDraft="No offer carries an end date yet, so nothing is expiring."
        />
      )}

      {extending && (
        <ExtendModal
          rows={rows.filter((p) => p.ends_at && perkState(p) !== 'live')}
          busy={busy}
          note={extendNote}
          onSave={saveEnd}
          onClose={() => setExtending(false)}
        />
      )}

      {loadErr && <Unreadable what="Your listings" claim="This is not a sign you have none." onRetry={load} />}

      {rows.length > 0 && <ListingPerformance rows={rows} onChanged={load} />}

      <section data-testid="perk-submit" className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div>
          <div className="text-[15px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Submit a perk</div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600 dark:text-gray-400">
            Every submission is reviewed before founders see it. Editing a live listing sends it
            back for review — the terms founders were shown are the terms that were approved. Raising
            its claim cap is the one edit that does not.
          </p>
        <form onSubmit={submit} className="mt-3 space-y-3">
          <PerkField label="Your company name">
            <input className={INPUT} value={form.partner_name} onChange={set('partner_name')} required />
          </PerkField>
          <PerkField label="The offer, as a founder would read it" hint="Lead with what they get, not your product name.">
            <input ref={offerRef} className={INPUT} placeholder="e.g. 3 months free business banking"
              value={form.offer} onChange={set('offer')} required />
          </PerkField>
          <div className="grid gap-3 sm:grid-cols-2">
            <PerkField label="Cash value" hint="In dollars. Shown on the card; reviewed like the rest of the listing.">
              <input className={`${INPUT} font-mono`} inputMode="decimal" placeholder="e.g. 1650"
                value={form.value} onChange={set('value')} />
            </PerkField>
            <PerkField label="Category">
              <select className={INPUT} value={form.category} onChange={set('category')}>
                {PERK_CATEGORIES.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </PerkField>
          </div>
          <PerkField label="One line founders see on the card">
            <input className={INPUT} maxLength={500} value={form.blurb} onChange={set('blurb')} />
          </PerkField>
          <PerkField label="The detail" hint="What it covers, what it excludes, and any conditions. Founders read this before claiming.">
            <textarea className={INPUT} rows={3} value={form.detail} onChange={set('detail')} />
          </PerkField>
          <div className="grid gap-3 sm:grid-cols-2">
            <PerkField label="What it costs a founder">
              <div className="flex gap-2">
                <select className={INPUT} value={form.kind} onChange={set('kind')}>
                  <option value="credits">Perk credits</option>
                  <option value="tier">Included in a plan</option>
                  <option value="money">Paid engagement</option>
                </select>
                {form.kind === 'credits' && (
                  <input type="number" min="0" className={`${INPUT} w-28`} placeholder="Credits" value={form.credits} onChange={set('credits')} />
                )}
                {form.kind === 'tier' && (
                  <select className={`${INPUT} w-28`} value={form.required_tier} onChange={set('required_tier')}>
                    <option value="growth">Growth</option>
                    <option value="studio">Studio</option>
                  </select>
                )}
                {form.kind === 'money' && (
                  <input type="number" min="0" step="0.01" className={`${INPUT} w-28`} placeholder="Price $" value={form.price_cents} onChange={set('price_cents')} />
                )}
              </div>
            </PerkField>
            <PerkField label="How founders redeem it" hint="Code and Link are self-serve. Introduction means the founder gets in touch with you, carrying a claim reference.">
              <select className={INPUT} value={form.fulfilment} onChange={set('fulfilment')}>
                <option value="code">Code</option>
                <option value="link">Link</option>
                <option value="intro">Introduction</option>
              </select>
            </PerkField>
          </div>
          {form.fulfilment === 'link' && (
            <PerkField label="Where the link goes">
              <input className={INPUT} placeholder="https://…" value={form.redeem_url} onChange={set('redeem_url')} />
            </PerkField>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <PerkField label="Claim cap" hint="Claims stop at the cap rather than overcommitting you. Blank is uncapped.">
              <input type="number" min="1" className={`${INPUT} font-mono`} placeholder="100" value={form.claim_cap} onChange={set('claim_cap')} />
            </PerkField>
            <PerkField label="Listing duration">
              <select className={INPUT} value={form.duration} onChange={setDuration}>
                <option value="">Ongoing</option>
                <option value="3">3 months</option>
                <option value="6">6 months</option>
                <option value="12">12 months</option>
              </select>
            </PerkField>
          </div>
          {/* THE TWO FIELDS MIGRATION 228 ADDED, and both are optional because
              both absences are real. An offer with no end date runs until
              somebody sets one; an offer that grants nothing beyond itself
              revokes nothing when it stops. Left blank they store null and the
              row says `Not recorded` rather than inventing either. The duration
              above fills the date; it stays editable. */}
          <div className="flex flex-wrap gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-gray-500">
              Ends (optional)
              <input type="date" className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
                value={form.ends_at} onChange={set('ends_at')} />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-[11px] text-gray-500">
              What it grants beyond the offer, and for how long (optional)
              <input className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
                placeholder="e.g. Priority queue access, 90 days" maxLength={300}
                value={form.grant_scope} onChange={set('grant_scope')} />
            </label>
          </div>
          <p className="text-[11px] leading-relaxed text-gray-500">
            An end date is the offer’s own. A founder’s claim expires with it, on the date the offer
            carried when they claimed. When the offer ends, whatever it granted ends with it, and the
            lifecycle table above says what and on what day.
          </p>
          {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
          {submitted && <p className="text-sm text-emerald-700" role="status">{submitted} is in review.</p>}
          <button type="submit" disabled={busy || !ready}
            className="inline-flex w-full items-center justify-center gap-1 rounded-[11px] bg-violet-600 px-4 py-3 text-[13px] font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:disabled:bg-gray-800">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {ready ? 'Submit for review' : 'Fill the offer, value and detail'}
          </button>
        </form>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex items-baseline justify-between">
              <SectionLabel>How founders will see it</SectionLabel>
              <span className="text-[10.5px] text-gray-500">live preview</span>
            </div>
            <div className="mt-2">
              <PerkCard
                preview
                p={{
                  partner_name: form.partner_name.trim() || 'Your company',
                  category: form.category,
                  offer: form.offer.trim() || 'Your offer appears here',
                  blurb: form.blurb.trim() || form.detail.trim() || 'The detail you write appears here — founders read this before claiming.',
                  kind: form.kind,
                  credits: Number(form.credits) || 0,
                  required_tier: form.required_tier,
                  price_cents: form.kind === 'money' && form.price_cents !== '' ? Math.round(Number(form.price_cents) * 100) : null,
                  value_cents: form.value.trim() && Number.isFinite(Number(form.value.replace(/[$,\s]/g, ''))) ? Math.round(Number(form.value.replace(/[$,\s]/g, '')) * 100) : null,
                  rating: { count: 0, average: null },
                  claimable: true,
                }}
              />
            </div>
          </div>
          <Card>
            <SectionLabel>What review looks at</SectionLabel>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-600 dark:text-gray-400">
              {absent.review_criteria ? <Unrecorded reason={absent.review_criteria} /> : null}
              {absent.review_criteria ? ` — ${absent.review_criteria}` : null}
            </p>
          </Card>
          <Card padding="none">
            <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-800"><SectionLabel>Your submissions</SectionLabel></div>
            {items === null && !loadErr ? <p className="px-4 py-3 text-sm text-gray-500">Loading…</p>
              : rows.length === 0 ? <p className="px-4 py-3 text-sm text-gray-600">Nothing submitted yet.</p>
              : visible.length === 0 ? (
                // Which view found nothing, rather than a blank list under a
                // selected chip — that reads as "you have submitted nothing", and
                // the count says otherwise.
                <p className="px-4 py-3 text-sm text-gray-600">
                  No listing is {view === 'all' ? 'shown' : view}. {rows.length} submitted in total.
                </p>
              ) : (
                <div>
                  {visible.map((p) => (
                    <div key={p.uid} className="border-b border-gray-100 px-4 py-3 last:border-0 dark:border-gray-800">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-100">{p.offer}</div>
                          <div className="mt-0.5 text-[11px] text-gray-500">
                            {p.category} · submitted {String(p.created_at || '').slice(0, 10)} · {p.claim_cap == null ? 'uncapped' : `cap ${p.claim_cap}`}
                          </div>
                        </div>
                        <Pill tone={STATUS_PILL[p.status]}>{String(p.status).replace('_', ' ')}</Pill>
                      </div>
                      {p.status === 'rejected' && p.review_note && (
                        <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{p.review_note}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
          </Card>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Admin: the review queue                                             *
 * ------------------------------------------------------------------ */

function ReviewQueue() {
  const [items, setItems] = useState(null);
  const [note, setNote] = useState({});
  const [editorial, setEditorial] = useState({});
  const [featured, setFeatured] = useState({});
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    api.perkReviewQueue()
      .then((d) => setItems(d?.items || []))
      .catch((e) => { reportError('perk_queue_failed', e); setErr(e?.message || 'Could not read the queue.'); });
  }, []);
  useEffect(load, [load]);

  async function act(uid, action) {
    setErr('');
    try {
      // D413 — the featured flag and the editorial quote the marketplace's
      // "Featured this month" prints. Only this route writes the quote.
      await api.perkReview(uid, {
        action,
        review_note: note[uid] || '',
        ...(featured[uid] ? { featured: true } : {}),
        ...(editorial[uid] ? { editorial_note: editorial[uid] } : {}),
      });
      load();
    } catch (e) { reportError('perk_review_failed', e); setErr(e?.message || 'That review did not save.'); }
  }

  if (err && items === null) return <Unreadable what="The review queue" claim="It is not a sign nothing is waiting." onRetry={load} />;
  if (items === null) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
        <ClipboardCheck size={22} className="mx-auto text-gray-400" />
        <p className="mt-3 text-sm text-gray-600">Nothing is waiting for review.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {items.map((p) => (
        <div key={p.uid} className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{p.offer}</div>
          <div className="mt-0.5 text-xs text-gray-500">
            {p.partner_name} · {p.partner_email || 'no account'} · {priceLabel(p)}
            {p.value_cents != null ? ` · ${dollars(p.value_cents)} stated value` : ''}
          </div>
          {p.detail && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">{p.detail}</p>}
          <input
            className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
            placeholder="Note — required to reject, and the partner reads it"
            value={note[p.uid] || ''}
            onChange={(e) => setNote((n) => ({ ...n, [p.uid]: e.target.value }))}
          />
          <input
            className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
            placeholder="Axal’s quote, shown if featured (optional) — the partner cannot edit it"
            maxLength={500}
            value={editorial[p.uid] || ''}
            onChange={(e) => setEditorial((n) => ({ ...n, [p.uid]: e.target.value }))}
          />
          <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={!!featured[p.uid]} onChange={(e) => setFeatured((f) => ({ ...f, [p.uid]: e.target.checked }))} />
            Feature it in “Featured this month”
          </label>
          {err && <p className="mt-2 text-sm text-red-600" role="alert">{err}</p>}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => act(p.uid, 'approve')}
              className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700">Approve</button>
            <button type="button" onClick={() => act(p.uid, 'reject')}
              className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">Reject</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

// `embedded`: mounted on /offers/perk-deals as the zone body, inside a
// WorkspaceShell that has already drawn the crumb, the heading, the zone pills
// and the Worker rail, and which supplies its own page container. It renders
// `PartnerConsole` alone — no heading, no container of its own, no tab row.
//
// PO2 is the firm's own listings — "Live, expiring and expired offers with
// redemption against cap" — and D413 puts the Perks & Products canvas's two
// partner tabs, Submit a perk and Performance, in the same zone as sections
// rather than as a tab row PO2 does not draw. The Marketplace, My perks and
// the Review queue keep their home at `/perks`.
/**
 * `zoneActions` is the same render prop `ServiceCatalogPage` takes, for the same
 * reason: `/offers/perk-deals` mounts this page as a partner zone and wants the
 * zone's header actions; `/perks` wants none. The caller decides; this page
 * learns nothing about roles.
 */
export default function PerksPage({ user, embedded = false, zoneActions, zoneFilters, role: shellRole }) {
  // MOUNTED AS `/offers/perk-deals`, THE ZONE IS `PartnerConsole` AND NOTHING
  // ELSE. PO2 in `design/canvases/integrated/Pages · Partner Offers.dc.html`
  // declares `filters: ['All','Live','Expiring','Expired']` and `ops: ['New
  // perk','Extend','Export']` — one control row, no tabs.
  if (embedded) {
    return <PartnerConsole zoneActions={zoneActions} zoneFilters={zoneFilters} role={shellRole} />;
  }
  return <PerksMarket user={user} />;
}

/**
 * The standalone `/perks` page: the canvas's founder side. A partner never
 * reaches it (App.jsx sends them to /offers/perk-deals); an investor, advisor
 * or `exploring` account browses and is told once, in the Worker's words, why
 * it cannot claim.
 */
function PerksMarket({ user }) {
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const userTier = user?.subscription_tier || null;
  const [tab, setTab] = useState('market');
  const [catalog, setCatalog] = useState(null);
  const [catalogErr, setCatalogErr] = useState('');
  const [mine, setMine] = useState(null);
  const [mineErr, setMineErr] = useState('');
  const [open, setOpen] = useState(null);

  const loadCatalog = useCallback(() => {
    setCatalogErr('');
    api.perksCatalog()
      .then(setCatalog)
      .catch((e) => { reportError('perks_catalog_failed', e); setCatalogErr(e?.message || 'Could not load the marketplace.'); });
  }, []);
  const loadMine = useCallback(() => {
    setMineErr('');
    api.perksMine()
      .then(setMine)
      .catch((e) => { reportError('perks_mine_failed', e); setMineErr(e?.message || 'Could not load your perks.'); });
  }, []);
  useEffect(() => { loadCatalog(); loadMine(); }, [loadCatalog, loadMine]);

  const tabs = useMemo(() => {
    const t = [
      { k: 'market', label: 'Marketplace', icon: Grid3x3 },
      { k: 'mine', label: 'My perks', icon: Ticket, flag: mine ? String(mine.stats.claimed) : '' },
    ];
    if (isAdmin) t.push({ k: 'review', label: 'Review queue', icon: ClipboardCheck });
    return t;
  }, [isAdmin, mine]);

  const openPerk = (p) => {
    // A claimed card goes to where the claim is, as the canvas's does.
    if (p.claimed) { setTab('mine'); return; }
    setOpen(p);
  };

  const coverage = [
    catalog ? `${catalog.items.length} listing${catalog.items.length === 1 ? '' : 's'} live, each reviewed by Axal` : 'Marketplace loading',
    mine ? `${mine.stats.claimed} claim${mine.stats.claimed === 1 ? '' : 's'} and ${mine.ledger.length} ledger line${mine.ledger.length === 1 ? '' : 's'} on this account` : 'Your claims loading',
  ];

  return (
    <main className="perks-desk" data-testid="perks-desk">
      <section className="perks-canvas">
      <div className="perks-main">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white">
              <ShoppingBag className="h-6 w-6 text-violet-600" /> Perks &amp; Products
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Offers partners have agreed to honour, each reviewed by Axal before it is listed.
              Distinct from the services marketplace and from plan pricing.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {catalog && (
              <div className="flex items-center gap-1.5 rounded-[10px] border border-gray-200 px-3 py-1.5 dark:border-gray-800" title="Separate from introduction credits under Network — different unit, different balance.">
                <Coins size={14} className="text-violet-600" />
                <span className="font-mono text-[14px] font-extrabold">{n0(catalog.balance)}</span>
                <span className="text-[11px] text-gray-500">perk credits</span>
              </div>
            )}
            {userTier && <Pill tone="info">{tierName(userTier)} plan</Pill>}
          </div>
        </div>
        {catalog && (
          <p className="mt-2 text-[11px] text-gray-500">
            Perk credits are separate from introduction credits under Network — a different unit and a different balance.
          </p>
        )}

        {catalog && !catalog.allowance_configured && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
            No perk-credit allowance is set up on this platform yet, so every balance is zero.
            Credit-priced perks cannot be claimed until an allowance is decided or an admin grants
            credits directly. Perks included with a plan, and paid engagements, work today.
          </div>
        )}
        {catalog && !catalog.claimant && catalog.claimant_reason && (
          <p className="mt-3 text-sm text-amber-800 dark:text-amber-300" role="status">{catalog.claimant_reason}</p>
        )}

        <div className="mt-5 flex gap-5 border-b border-gray-200 dark:border-gray-800" role="tablist">
          {tabs.map(({ k, label, icon: Icon, flag }) => (
            <button
              key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 pb-2.5 text-[13px] ${
                tab === k ? 'border-violet-600 font-bold text-violet-700 dark:text-violet-300' : 'border-transparent font-semibold text-gray-600 hover:text-gray-900'
              }`}
            >
              <Icon size={14} />{label}
              {flag ? <span className={`min-w-4 rounded-full px-1 text-[9px] font-extrabold ${tab === k ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}>{flag}</span> : null}
            </button>
          ))}
        </div>

        <div className="mt-5">
          {tab === 'market' && (catalogErr
            ? <Unreadable what="The marketplace" claim="It is not a sign nothing is listed." onRetry={loadCatalog} />
            : !catalog ? <p className="text-sm text-gray-500">Loading…</p>
              : <Marketplace data={catalog} onOpen={openPerk} />)}
          {tab === 'mine' && (mineErr
            ? <Unreadable what="Your perks" claim="It is not a sign you have claimed nothing." onRetry={loadMine} />
            : !mine ? <p className="text-sm text-gray-500">Loading…</p>
              : <MyPerks data={mine} onRated={() => { loadMine(); loadCatalog(); }} />)}
          {tab === 'review' && isAdmin && <ReviewQueue />}
        </div>

        {open && (
          <ClaimModal
            perk={open}
            userTier={userTier}
            onClose={() => setOpen(null)}
            onClaimed={() => { loadCatalog(); loadMine(); }}
            onGoMine={() => { setOpen(null); setTab('mine'); }}
          />
        )}
      </div>
      <WorkerRail
        workspace="Perks & Products"
        // A literal: the canvas draws this page in violet (#7c3aed), the
        // founder accent, for every role that reaches it.
        role="founder"
        className="perks-rail"
        stance="You browse and claim"
        note="Nothing here is claimed, rated or chosen for you. Every listing is a partner’s offer that an Axal reviewer approved, and your balance is the sum of your ledger lines."
        coverage={coverage}
        unavailable={mine?.absent ? [
          ['Expiry reminders', mine.absent.expiry_reminder],
        ].filter(([, why]) => why) : []}
      />
      </section>
    </main>
  );
}
