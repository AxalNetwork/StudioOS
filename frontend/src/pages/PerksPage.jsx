import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Gift, Ticket, Coins, Loader2, X, Check, AlertCircle, Copy, ExternalLink,
  ClipboardCheck, Send,
} from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';

/**
 * Perks & Products — /perks. One route, three audiences.
 *
 * A founder browses the catalogue and claims. A partner submits listings and
 * watches how they perform. An admin reviews the queue and grants credits. The
 * role decides which, so there is no second top-level route.
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
 */

const KIND_LABEL = { credits: 'Credits', tier: 'Included in plan', money: 'Paid' };

const STATUS_TONE = {
  live: 'bg-green-50 text-green-700 border-green-200',
  in_review: 'bg-amber-50 text-amber-700 border-amber-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  paused: 'bg-gray-100 text-gray-600 border-gray-200',
  draft: 'bg-gray-100 text-gray-600 border-gray-200',
};

const n0 = (n) => Number(n || 0).toLocaleString();
const money = (cents) => (cents === null || cents === undefined
  ? null
  : `$${(Math.round(Number(cents)) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

function priceLabel(p) {
  if (p.kind === 'tier') return p.required_tier ? `Included in ${p.required_tier}` : 'Included in your plan';
  if (p.kind === 'money') return money(p.price_cents) || 'Quoted';
  return `${n0(p.credits)} credits`;
}

function Pill({ children, tone }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
      {children}
    </span>
  );
}

function CopyLine({ label, value }) {
  const [done, setDone] = useState(false);
  if (!value) return null;
  return (
    <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-800">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 break-all font-mono text-sm text-gray-900 dark:text-gray-100">{value}</code>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900"
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
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Founder: the catalogue                                              *
 * ------------------------------------------------------------------ */

function ClaimDrawer({ perk, onClose, onClaimed }) {
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    api.perk(perk.uid)
      .then((d) => { if (live) setDetail(d); })
      .catch((e) => { reportError('perk_detail_failed', e); if (live) setErr('Could not load this perk.'); });
    return () => { live = false; };
  }, [perk.uid]);

  async function claim() {
    setBusy(true); setErr('');
    try {
      const r = await api.perkClaim(perk.uid);
      setResult(r);
      onClaimed?.();
    } catch (e) {
      reportError('perk_claim_failed', e);
      setErr(e?.message || 'Could not claim this perk.');
    } finally { setBusy(false); }
  }

  const d = detail || perk;
  const cost = d.kind === 'credits' ? Number(d.credits) || 0 : 0;
  const balance = Number(d.balance) || 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-gray-500">{d.partner_name} · {d.category}</div>
            <h2 className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{d.offer}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-gray-100" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {result ? (
          <div className="mt-5">
            <div className="flex items-center gap-2 text-green-700">
              <Check size={16} /><span className="font-medium">Claimed</span>
            </div>
            {result.credits_spent > 0 && (
              <p className="mt-2 text-sm text-gray-600">
                {n0(result.credits_spent)} perk credits deducted · balance now {n0(result.balance)}.
              </p>
            )}
            <CopyLine label="Redemption code" value={result.code} />
            {result.redeem_url && (
              <a
                href={result.redeem_url} target="_blank" rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline"
              >
                Open the partner's page <ExternalLink size={12} />
              </a>
            )}
            {result.fulfilment === 'intro' && (
              <p className="mt-3 text-sm text-gray-600">
                {d.partner_name} has your details and will be in touch. Nothing else is needed from you.
              </p>
            )}
            <p className="mt-4 text-xs text-gray-500">This is saved under My perks.</p>
          </div>
        ) : (
          <div className="mt-5">
            {d.blurb && <p className="text-sm text-gray-700 dark:text-gray-300">{d.blurb}</p>}
            {d.detail && <p className="mt-3 whitespace-pre-wrap text-sm text-gray-600">{d.detail}</p>}

            <div className="mt-5 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-gray-600">Cost</span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">{priceLabel(d)}</span>
              </div>
              {d.kind === 'credits' && (
                <div className="mt-2 flex items-baseline justify-between text-sm text-gray-600">
                  <span>Perk credit balance</span>
                  <span>{n0(balance)} → {n0(Math.max(0, balance - cost))}</span>
                </div>
              )}
              {d.kind === 'money' && (
                <p className="mt-2 text-xs text-gray-500">
                  Nothing is charged here. {d.partner_name} invoice you directly once scope is agreed.
                </p>
              )}
            </div>

            {err && (
              <p className="mt-3 flex items-start gap-1 text-sm text-red-600">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />{err}
              </p>
            )}
            {!d.claimable && d.reason === 'insufficient_credits' && (
              <p className="mt-3 text-sm text-amber-700">
                {n0(d.short_by)} perk credits short.
              </p>
            )}
            {!d.claimable && d.reason === 'tier_required' && (
              <p className="mt-3 text-sm text-amber-700">
                This one comes with the {d.required_tier} plan.
              </p>
            )}

            <button
              type="button"
              disabled={busy || !d.claimable}
              onClick={claim}
              className="mt-5 w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="mx-auto animate-spin" /> : 'Claim this perk'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Catalogue() {
  const [data, setData] = useState(null);
  const [cat, setCat] = useState('');
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    api.perksCatalog()
      .then(setData)
      .catch((e) => { reportError('perks_catalog_failed', e); setData({ items: [], balance: 0 }); });
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    const items = data?.items || [];
    return cat ? items.filter((p) => p.category === cat) : items;
  }, [data, cat]);

  if (!data) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <Coins size={16} className="text-indigo-600" />
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{n0(data.balance)} perk credits</span>
        <span className="text-xs text-gray-500">
          Separate from introduction credits under Network — different unit, different balance.
        </span>
      </div>

      {!data.allowance_configured && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          No perk-credit allowance is set up on this platform yet, so every balance is zero.
          Credit-priced perks cannot be claimed until an allowance is decided or an admin grants
          credits directly. Perks included with a plan, and paid engagements, work today.
        </div>
      )}

      {(data.categories || []).length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button" onClick={() => setCat('')}
            className={`rounded-full border px-3 py-1 text-xs ${cat === '' ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}
          >All</button>
          {data.categories.map((k) => (
            <button
              key={k} type="button" onClick={() => setCat(k)}
              className={`rounded-full border px-3 py-1 text-xs ${cat === k ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}
            >{k}</button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
          <Gift size={22} className="mx-auto text-gray-400" />
          <p className="mt-3 text-sm font-medium text-gray-900 dark:text-gray-100">No perks are listed yet.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-600">
            Partners submit offers and each one is reviewed before it appears here. Nothing is
            listed until a real partner has agreed to honour it.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p) => (
            <div key={p.uid} className="flex flex-col rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-gray-500">{p.partner_name}</div>
                  <div className="mt-0.5 text-sm font-semibold text-gray-900 dark:text-gray-100">{p.offer}</div>
                </div>
                {p.featured && <Pill tone="bg-indigo-50 text-indigo-700 border-indigo-200">Featured</Pill>}
              </div>
              {p.blurb && <p className="mt-2 flex-1 text-sm text-gray-600">{p.blurb}</p>}
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{priceLabel(p)}</span>
                {p.claimed ? (
                  <Pill tone="bg-green-50 text-green-700 border-green-200">Claimed</Pill>
                ) : (
                  <button
                    type="button" onClick={() => setOpen(p)}
                    disabled={!p.claimable}
                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                  >
                    {p.claimable ? 'Claim' : p.reason === 'tier_required' ? 'Needs an upgrade' : 'Not enough credits'}
                  </button>
                )}
              </div>
              <div className="mt-2 text-[11px] text-gray-500">{KIND_LABEL[p.kind]} · {p.category}</div>
            </div>
          ))}
        </div>
      )}

      {open && <ClaimDrawer perk={open} onClose={() => setOpen(null)} onClaimed={load} />}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Founder: my perks + the credit ledger                               *
 * ------------------------------------------------------------------ */

function MyPerks() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.perksMine()
      .then(setData)
      .catch((e) => { reportError('perks_mine_failed', e); setData({ items: [], ledger: [] }); });
  }, []);

  if (!data) return <p className="text-sm text-gray-500">Loading…</p>;
  const items = data.items || [];
  const ledger = data.ledger || [];

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Claimed</h3>
        {items.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">Nothing claimed yet.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {items.map((c) => (
              <div key={c.uid} className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{c.offer}</div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {c.partner_name} · claimed {String(c.created_at || '').slice(0, 10)}
                      {c.credits_spent > 0 ? ` · ${n0(c.credits_spent)} credits` : ' · no credits'}
                    </div>
                  </div>
                  <Pill tone={STATUS_TONE[c.status]}>{c.status}</Pill>
                </div>
                <CopyLine label="Redemption code" value={c.code} />
                {c.redeem_url && (
                  <a href={c.redeem_url} target="_blank" rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
                    Open partner page <ExternalLink size={12} />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Perk credit ledger</h3>
        <p className="mt-1 text-xs text-gray-500">
          Balance {n0(data.balance)}. Every line is a grant or a spend — the balance is the sum of
          them, not a number stored separately.
        </p>
        {ledger.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">
            No credits have been granted or spent on this account.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800">
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">What</th>
                  <th className="py-2 pr-4 text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2 pr-4 text-gray-500">{String(l.created_at || '').slice(0, 10)}</td>
                    <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">{l.note || l.kind}</td>
                    <td className={`py-2 pr-4 text-right font-medium ${l.delta < 0 ? 'text-gray-900' : 'text-green-700'}`}>
                      {l.delta > 0 ? '+' : ''}{n0(l.delta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Partner: submissions                                                *
 * ------------------------------------------------------------------ */

function PartnerConsole() {
  const [items, setItems] = useState(null);
  const [form, setForm] = useState({
    partner_name: '', offer: '', category: '', blurb: '', detail: '',
    kind: 'credits', credits: '', required_tier: 'growth', price_cents: '',
    fulfilment: 'code', redeem_url: '', claim_cap: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    api.perkSubmissions()
      .then((d) => setItems(d?.items || []))
      .catch((e) => { reportError('perk_submissions_failed', e); setItems([]); });
  }, []);
  useEffect(load, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api.perkSubmit({
        ...form,
        credits: form.kind === 'credits' ? Number(form.credits) || 0 : 0,
        // Entered in dollars, stored in cents. Money is an integer number of
        // cents everywhere in this codebase.
        price_cents: form.kind === 'money' ? Math.round((Number(form.price_cents) || 0) * 100) : null,
        claim_cap: form.claim_cap === '' ? null : Number(form.claim_cap),
      });
      setForm((f) => ({ ...f, offer: '', blurb: '', detail: '', credits: '', price_cents: '' }));
      load();
    } catch (e2) {
      reportError('perk_submit_failed', e2);
      setErr(e2?.message || 'Could not submit.');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      {/* Canvas stats strip — computed from submissions, not asserted. */}
      {items && items.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Listings', value: String(items.length), note: `${items.filter((i) => i.status === 'live').length} live` },
            { label: 'In review', value: String(items.filter((i) => i.status === 'in_review').length), note: 'awaiting approval' },
            // `claim_count` is singular — routes/perks.ts computes it as a subquery
            // alias. Reading `claims_count` produced 0 for every listing.
            { label: 'Claims', value: String(items.reduce((a, i) => a + (Number(i.claim_count) || 0), 0)), note: 'total redemptions' },
            { label: 'Paused', value: String(items.filter((i) => i.status === 'paused').length), note: 'not visible to founders' },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-[9.5px] font-extrabold uppercase tracking-[.09em] text-gray-500 dark:text-gray-400">{s.label}</div>
              <div className="mt-1 text-lg font-extrabold tabular-nums text-gray-900 dark:text-gray-100">{s.value}</div>
              <div className="mt-0.5 text-[10.5px] text-gray-500 dark:text-gray-400">{s.note}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Submit a perk</h3>
          <p className="mt-1 text-xs text-gray-500">
            Every submission is reviewed before founders see it. Editing a live listing sends it
            back for review — the terms founders were shown are the terms that were approved.
          </p>
        <form onSubmit={submit} className="mt-3 space-y-3">
          <input className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700" placeholder="Your company name"
            value={form.partner_name} onChange={set('partner_name')} required />
          <input className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700" placeholder="The offer, e.g. 3 months free"
            value={form.offer} onChange={set('offer')} required />
          <input className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700" placeholder="Category"
            value={form.category} onChange={set('category')} />
          <textarea className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700" rows={2} placeholder="One line founders see on the card"
            value={form.blurb} onChange={set('blurb')} />
          <textarea className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700" rows={3} placeholder="Full terms, shown before anything is spent"
            value={form.detail} onChange={set('detail')} />
          <div className="flex gap-2">
            <select className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700" value={form.kind} onChange={set('kind')}>
              <option value="credits">Costs credits</option>
              <option value="tier">Included in a plan</option>
              <option value="money">Paid engagement</option>
            </select>
            {form.kind === 'credits' && (
              <input type="number" min="0" className="w-32 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
                placeholder="Credits" value={form.credits} onChange={set('credits')} />
            )}
            {form.kind === 'tier' && (
              <select className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700" value={form.required_tier} onChange={set('required_tier')}>
                <option value="growth">Growth</option>
                <option value="studio">Studio</option>
              </select>
            )}
            {form.kind === 'money' && (
              <input type="number" min="0" step="0.01" className="w-32 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
                placeholder="Price $" value={form.price_cents} onChange={set('price_cents')} />
            )}
          </div>
          <div className="flex gap-2">
            <select className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700" value={form.fulfilment} onChange={set('fulfilment')}>
              <option value="code">Issue a code</option>
              <option value="link">Send to a link</option>
              <option value="intro">You contact them</option>
            </select>
            {form.fulfilment === 'link' && (
              <input className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700" placeholder="https://…"
                value={form.redeem_url} onChange={set('redeem_url')} />
            )}
            <input type="number" min="1" className="w-28 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
              placeholder="Cap" value={form.claim_cap} onChange={set('claim_cap')} />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button type="submit" disabled={busy}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Submit for review
          </button>
        </form>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Your listings</h3>
        {items === null ? <p className="mt-2 text-sm text-gray-500">Loading…</p>
          : items.length === 0 ? <p className="mt-2 text-sm text-gray-600">Nothing submitted yet.</p>
          : (
            <div className="mt-2 space-y-2">
              {items.map((p) => (
                <div key={p.uid} className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{p.offer}</div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        {priceLabel(p)} · {n0(p.claim_count)} claim{Number(p.claim_count) === 1 ? '' : 's'}
                      </div>
                    </div>
                    <Pill tone={STATUS_TONE[p.status]}>{p.status.replace('_', ' ')}</Pill>
                  </div>
                  {p.status === 'rejected' && p.review_note && (
                    <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{p.review_note}</p>
                  )}
                </div>
              ))}
            </div>
          )}
      </section>
    </div>
  </div>
  );
}

/* ------------------------------------------------------------------ *
 * Admin: the review queue                                             *
 * ------------------------------------------------------------------ */

function ReviewQueue() {
  const [items, setItems] = useState(null);
  const [note, setNote] = useState({});

  const load = useCallback(() => {
    api.perkReviewQueue()
      .then((d) => setItems(d?.items || []))
      .catch((e) => { reportError('perk_queue_failed', e); setItems([]); });
  }, []);
  useEffect(load, [load]);

  async function act(uid, action) {
    try {
      await api.perkReview(uid, { action, review_note: note[uid] || '' });
      load();
    } catch (e) { reportError('perk_review_failed', e); }
  }

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
          </div>
          {p.detail && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">{p.detail}</p>}
          <input
            className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
            placeholder="Note — required to reject, and the partner reads it"
            value={note[p.uid] || ''}
            onChange={(e) => setNote((n) => ({ ...n, [p.uid]: e.target.value }))}
          />
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

export default function PerksPage({ user }) {
  const role = String(user?.role || '').toLowerCase();
  const isPartner = role === 'partner';
  const isAdmin = role === 'admin';
  const tabs = useMemo(() => {
    const t = [{ k: 'browse', label: 'Perks', icon: Gift }, { k: 'mine', label: 'My perks', icon: Ticket }];
    if (isPartner || isAdmin) t.push({ k: 'partner', label: 'My listings', icon: Send });
    if (isAdmin) t.push({ k: 'review', label: 'Review queue', icon: ClipboardCheck });
    return t;
  }, [isPartner, isAdmin]);
  const [tab, setTab] = useState('browse');

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Perks &amp; products</h1>
      <p className="mt-1 text-sm text-gray-600">
        Offers partners have agreed to honour for people on the platform. Distinct from the
        services marketplace and from plan pricing.
      </p>

      <div className="mt-5 flex gap-1 border-b border-gray-200 dark:border-gray-800">
        {tabs.map(({ k, label, icon: Icon }) => (
          <button
            key={k} type="button" onClick={() => setTab(k)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${
              tab === k ? 'border-indigo-600 font-medium text-indigo-700' : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === 'browse' && <Catalogue />}
        {tab === 'mine' && <MyPerks />}
        {tab === 'partner' && <PartnerConsole />}
        {tab === 'review' && <ReviewQueue />}
      </div>
    </div>
  );
}
