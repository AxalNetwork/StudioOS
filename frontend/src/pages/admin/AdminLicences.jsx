// Territory licences — the HQ ledger for the subsidiary model.
//
// Design handoff: Admin · Super.dc.html, "Licenses" nav row and the five-step
// issue flow (Entity → Territory → Seats → Terms → Activate). Recreated
// natively in the admin shell like AdminLpApplications and AdminExploring,
// rather than ported as a standalone page, so it inherits auth, nav and dark
// mode.
//
// WHAT THIS IS. The ledger: who holds a licence, over which countries, on what
// terms, until when. Migration 187 + routes/admin_licences.ts.
//
// WHAT IT IS NOT, AND WHAT THAT COSTS ON SCREEN. It is not the tenancy SCOPE.
// No account carries a licence, so nothing here can say how many seats are
// used, how many accounts a subsidiary has, or what revenue it generated —
// three of the canvas's headline numbers. Those are shown as unavailable with
// the reason, not as zero and not as an estimate: "0 of 325 seats used" is a
// false statement about a real business, and a plausible-looking dashboard is
// exactly how a false number gets quoted in a board meeting.
//
// TWO RULES THE CANVAS IS RIGHT ABOUT, AND WHICH THE UI MUST NOT SOFTEN:
//
//   1. A territory conflict is REFUSED, not flagged. The canvas: "a conflict
//      found after signature is an amendment to two contracts, found here it
//      is one click." The picker will not let a held country be selected.
//   2. Suspension does not release territory. A suspended holder still blocks
//      its countries; releasing them is a termination. The status chip says so
//      explicitly, because the intuition runs the other way.
//
// Not reproduced from the design: the EU choropleth map, the token P&L and the
// per-subsidiary health grid. The map is presentation of the same data the
// territory list already carries; the other two need account attribution that
// does not exist. A map is worth adding; inventing the numbers under it is not.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2, AlertCircle, Check, X, Globe, Users, FileText, Ban, RotateCw,
} from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';

const SEAT_TYPES = [
  { k: 'founder', label: 'Founder' },
  { k: 'investor', label: 'Investor / LP' },
  { k: 'advisor', label: 'Advisor' },
  { k: 'partner', label: 'Service partner' },
];

const STATUS_TONE = {
  active: 'bg-green-50 text-green-700 border-green-200',
  suspended: 'bg-amber-50 text-amber-800 border-amber-200',
  pending_activation: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  draft: 'bg-gray-100 text-gray-600 border-gray-200',
  terminated: 'bg-gray-100 text-gray-500 border-gray-200',
};

const STEPS = ['Entity', 'Territory', 'Seats', 'Terms', 'Activate'];

const n0 = (n) => Number(n || 0).toLocaleString();

// Basis points in, percent out. 3500 → "35%". Integer bps is the stored form
// precisely so this is the only place a fraction is ever computed.
const pct = (bps) => (bps === null || bps === undefined ? null : `${(Number(bps) / 100).toFixed(2).replace(/\.?0+$/, '')}%`);

const fee = (cents, currency) => (cents === null || cents === undefined
  ? null
  : `${currency || ''} ${(Math.round(Number(cents)) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`.trim());

function daysTo(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - Date.now()) / 86400000);
}

function Chip({ children, tone }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone || STATUS_TONE.draft}`}>
      {children}
    </span>
  );
}

function Field({ label, value, hint }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-0.5 text-sm text-gray-900 dark:text-gray-100">{value ?? <span className="text-gray-400">Not recorded</span>}</div>
      {hint && <div className="mt-0.5 text-[11px] text-gray-500">{hint}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Step 2 — the territory picker that refuses                          *
 * ------------------------------------------------------------------ */

function TerritoryEditor({ licence, held, onSaved }) {
  const [codes, setCodes] = useState((licence.territories || []).join(', '));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // Who holds what, excluding this licence's own countries — keeping your own
  // is not a conflict.
  const heldByOthers = useMemo(() => {
    const m = new Map();
    for (const h of held || []) {
      if (h.licence_uid === licence.uid) continue;
      m.set(h.country_code, h);
    }
    return m;
  }, [held, licence.uid]);

  const entered = useMemo(
    () => codes.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
    [codes],
  );
  const clashes = entered.filter((c) => heldByOthers.has(c));

  async function save() {
    setBusy(true); setErr(null);
    try {
      await api.licenceSetTerritories(licence.uid, entered);
      onSaved?.();
    } catch (e) {
      reportError('licence_territories_failed', e);
      setErr(e?.message || 'Could not save the territory.');
    } finally { setBusy(false); }
  }

  return (
    <div>
      <label className="text-[11px] uppercase tracking-wide text-gray-500" htmlFor="lic-terr">
        Countries — ISO 3166-1 alpha-2, comma separated
      </label>
      <input
        id="lic-terr"
        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700"
        value={codes}
        onChange={(e) => setCodes(e.target.value)}
        placeholder="FR, BE, LU"
      />
      {clashes.length > 0 && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <div className="flex items-start gap-1.5">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div>
              {clashes.map((c) => (
                <div key={c}>
                  <strong>{c}</strong> is held by {heldByOthers.get(c).licence_ref} ({heldByOthers.get(c).status}).
                </div>
              ))}
              <p className="mt-1.5">
                Two licences cannot hold one country, and a suspended holder still holds its
                territory — releasing it is a termination, not a lapse. This will be refused,
                not recorded with a warning.
              </p>
            </div>
          </div>
        </div>
      )}
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <button
        type="button" onClick={save} disabled={busy || clashes.length > 0}
        className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : 'Save territory'}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Steps 3 + 4                                                         *
 * ------------------------------------------------------------------ */

function SeatEditor({ licence, onSaved }) {
  const [seats, setSeats] = useState(() => {
    const s = {};
    for (const t of SEAT_TYPES) s[t.k] = String(licence.seats?.[t.k] ?? 0);
    return s;
  });
  const [busy, setBusy] = useState(false);
  const total = SEAT_TYPES.reduce((a, t) => a + (Number(seats[t.k]) || 0), 0);

  async function save() {
    setBusy(true);
    try {
      const out = {};
      for (const t of SEAT_TYPES) out[t.k] = Number(seats[t.k]) || 0;
      await api.licenceSetSeats(licence.uid, out);
      onSaved?.();
    } catch (e) { reportError('licence_seats_failed', e); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-2">
        {SEAT_TYPES.map((t) => (
          <label key={t.k} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-gray-700 dark:text-gray-300">{t.label}</span>
            <input
              type="number" min="0"
              className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
              value={seats[t.k]}
              onChange={(e) => setSeats((s) => ({ ...s, [t.k]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <p className="mt-2 text-sm text-gray-600">{n0(total)} seats licensed.</p>
      <p className="mt-1 text-[11px] text-gray-500">
        Seats used is not shown: it needs every account to name its licence, and none does yet.
      </p>
      <button
        type="button" onClick={save} disabled={busy}
        className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : 'Save seats'}
      </button>
    </div>
  );
}

function TermsEditor({ licence, onSaved }) {
  const [f, setF] = useState({
    term_years: licence.term_years ?? '',
    annual_fee: licence.annual_fee_cents === null || licence.annual_fee_cents === undefined
      ? '' : String(Math.round(Number(licence.annual_fee_cents)) / 100),
    currency: licence.currency || 'EUR',
    revenue_share_bps: licence.revenue_share_bps ?? '',
    token_split_bps: licence.token_split_bps ?? '',
    starts_on: licence.starts_on || '',
    renews_on: licence.renews_on || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    try {
      await api.licenceSetTerms(licence.uid, {
        term_years: f.term_years === '' ? null : Number(f.term_years),
        // Entered in whole currency units, stored as an integer of cents.
        annual_fee_cents: f.annual_fee === '' ? null : Math.round(Number(f.annual_fee) * 100),
        currency: f.currency,
        revenue_share_bps: f.revenue_share_bps === '' ? null : Number(f.revenue_share_bps),
        token_split_bps: f.token_split_bps === '' ? null : Number(f.token_split_bps),
        starts_on: f.starts_on,
        renews_on: f.renews_on,
      });
      onSaved?.();
    } catch (e) { reportError('licence_terms_failed', e); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">Term (years)</span>
        <input type="number" min="1" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
          value={f.term_years} onChange={set('term_years')} />
      </label>
      <label className="text-sm">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">Annual fee</span>
        <div className="mt-1 flex gap-2">
          <input type="number" min="0" step="0.01" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
            value={f.annual_fee} onChange={set('annual_fee')} />
          <input className="w-20 rounded-md border border-gray-300 px-2 py-2 text-sm uppercase dark:border-gray-700"
            value={f.currency} onChange={set('currency')} maxLength={3} />
        </div>
      </label>
      <label className="text-sm">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">
          Revenue share (basis points)
        </span>
        <input type="number" min="0" max="10000" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
          value={f.revenue_share_bps} onChange={set('revenue_share_bps')} />
        <span className="text-[11px] text-gray-500">{pct(f.revenue_share_bps) || '—'}</span>
      </label>
      <label className="text-sm">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">
          Token split to HQ (basis points)
        </span>
        <input type="number" min="0" max="10000" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
          value={f.token_split_bps} onChange={set('token_split_bps')} />
        <span className="text-[11px] text-gray-500">{pct(f.token_split_bps) || '—'}</span>
      </label>
      <label className="text-sm">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">Starts</span>
        <input type="date" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
          value={f.starts_on} onChange={set('starts_on')} />
      </label>
      <label className="text-sm">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">First renewal</span>
        <input type="date" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
          value={f.renews_on} onChange={set('renews_on')} />
      </label>
      <div className="sm:col-span-2">
        <button type="button" onClick={save} disabled={busy}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : 'Save terms'}
        </button>
        <p className="mt-2 text-[11px] text-gray-500">
          Rates are stored as integer basis points, not as a fraction — 3500 is 35%. The same
          reason money is stored in cents: 0.35 is not exactly representable in binary floating
          point, and a revenue share is a contractual number.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Detail                                                              *
 * ------------------------------------------------------------------ */

function Detail({ uid, held, onChanged }) {
  const [d, setD] = useState(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.licence(uid)
      .then(setD)
      .catch((e) => { reportError('licence_load_failed', e); setD(false); });
  }, [uid]);
  useEffect(load, [load]);

  const refresh = () => { load(); onChanged?.(); };

  async function act(fn, ...args) {
    setBusy(true);
    try { await fn(...args); refresh(); }
    catch (e) { reportError('licence_action_failed', e); }
    finally { setBusy(false); }
  }

  if (d === false) return <p className="text-sm text-red-600">Could not load this licence.</p>;
  if (!d) return <p className="text-sm text-gray-500">Loading…</p>;

  const days = daysTo(d.renews_on);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{d.brand_name}</h2>
            <Chip tone={STATUS_TONE[d.status]}>{d.status.replace('_', ' ')}</Chip>
          </div>
          <div className="mt-0.5 text-xs text-gray-500">{d.licence_ref} · {d.legal_entity_name}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {d.status === 'suspended' ? (
            <button type="button" disabled={busy} onClick={() => act(api.licenceReinstate, d.uid)}
              className="inline-flex items-center gap-1 rounded-md border border-green-300 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50">
              <Check size={12} /> Reinstate
            </button>
          ) : d.status === 'active' && (
            <button type="button" disabled={busy}
              onClick={() => {
                const note = window.prompt('Why is this licence being suspended? The reason is recorded.');
                if (note) act(api.licenceSuspend, d.uid, note);
              }}
              className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50">
              <Ban size={12} /> Suspend
            </button>
          )}
          {d.status !== 'terminated' && (
            <>
              <button type="button" disabled={busy} onClick={() => act(api.licenceRenew, d.uid, {})}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300">
                <RotateCw size={12} /> Renew
              </button>
              <button type="button" disabled={busy}
                onClick={() => {
                  const note = window.prompt(
                    'Terminating releases every country this licence holds, permanently. Why?',
                  );
                  if (note) act(api.licenceTerminate, d.uid, note);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
                <X size={12} /> Terminate
              </button>
            </>
          )}
        </div>
      </div>

      {d.status === 'suspended' && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Suspended{d.status_note ? `: ${d.status_note}` : ''}. It still holds{' '}
          {d.territories.length === 1 ? 'its country' : `all ${d.territories.length} of its countries`} —
          releasing them is a termination, not a lapse.
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field label="Territory" value={d.territories.length ? d.territories.join(' · ') : null} />
        <Field label="Seats licensed" value={n0(d.seats_licensed)}
          hint="Used is unavailable — no account carries a licence yet." />
        <Field label="Annual fee" value={fee(d.annual_fee_cents, d.currency)} />
        <Field label="Revenue share" value={pct(d.revenue_share_bps)} />
        <Field label="Token split to HQ" value={pct(d.token_split_bps)} />
        <Field
          label="Renews"
          value={d.renews_on || null}
          hint={days === null ? null : days < 0 ? `${Math.abs(days)} days overdue` : `in ${days} days`}
        />
      </div>

      {d.blockers?.length > 0 && d.status !== 'active' && (
        <div className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Before this can be activated</div>
          <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
            {d.blockers.map((b, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <AlertCircle size={13} className="mt-0.5 shrink-0 text-red-500" />{b}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-gray-500">A pending signature does not block activation.</p>
        </div>
      )}
      {d.status !== 'active' && d.status !== 'terminated' && !d.blockers?.length && (
        <button type="button" disabled={busy} onClick={() => act(api.licenceActivate, d.uid)}
          className="mt-4 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
          Activate
        </button>
      )}

      <div className="mt-6 flex gap-1 border-b border-gray-200 dark:border-gray-800">
        {STEPS.map((label, i) => (
          <button
            key={label} type="button" onClick={() => setStep(i + 1)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs ${
              step === i + 1 ? 'border-indigo-600 font-medium text-indigo-700' : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {i + 1}. {label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {step === 1 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Legal entity" value={d.legal_entity_name} />
            <Field label="Brand name in product" value={d.brand_name} />
            <Field label="Registered address" value={d.registered_address} />
            <Field label="Signatory"
              value={d.signatory_name ? `${d.signatory_name}${d.signatory_title ? ` · ${d.signatory_title}` : ''}` : null} />
          </div>
        )}
        {step === 2 && <TerritoryEditor licence={d} held={held} onSaved={refresh} />}
        {step === 3 && <SeatEditor licence={d} onSaved={refresh} />}
        {step === 4 && <TermsEditor licence={d} onSaved={refresh} />}
        {step === 5 && (
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">History</h3>
            {(d.events || []).length === 0 ? (
              <p className="mt-2 text-sm text-gray-600">Nothing recorded yet.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-sm">
                {d.events.map((e, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="w-24 shrink-0 text-gray-500">{String(e.created_at || '').slice(0, 10)}</span>
                    <span className="text-gray-900 dark:text-gray-100">{e.event.replace('_', ' ')}</span>
                    {e.note && <span className="text-gray-600">— {e.note}</span>}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-gray-500">
              Append-only. A contract dispute is exactly the case where an overwritten status is
              useless, so nothing here is ever edited or removed.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function AdminLicences() {
  const [data, setData] = useState(null);
  const [held, setHeld] = useState([]);
  const [sel, setSel] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ licence_ref: '', legal_entity_name: '', brand_name: '' });
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    api.licences()
      .then((d) => { setData(d); if (!sel && d?.items?.[0]) setSel(d.items[0].uid); })
      .catch((e) => { reportError('licences_failed', e); setData({ items: [] }); });
    api.licenceTerritories()
      .then((d) => setHeld(d?.items || []))
      .catch((e) => reportError('licence_territories_load_failed', e));
  }, [sel]);
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function create(e) {
    e.preventDefault();
    setErr('');
    try {
      const r = await api.licenceCreate(form);
      setCreating(false);
      setForm({ licence_ref: '', legal_entity_name: '', brand_name: '' });
      setSel(r.uid);
      load();
    } catch (e2) {
      reportError('licence_create_failed', e2);
      setErr(e2?.message || 'Could not create the licence.');
    }
  }

  if (!data) return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  const items = data.items || [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Territory licences</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Who holds a licence, over which countries, on what terms, until when. Two licences
            cannot hold the same country — the territory step refuses an overlap rather than
            recording one.
          </p>
        </div>
        <button type="button" onClick={() => setCreating((v) => !v)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          {creating ? 'Cancel' : 'New licence'}
        </button>
      </div>

      {data.seats_used_available === false && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-800 dark:text-gray-300">
          <div className="flex items-start gap-1.5">
            <Globe size={14} className="mt-0.5 shrink-0 text-gray-500" />
            <span>{data.seats_used_reason}</span>
          </div>
        </div>
      )}

      {creating && (
        <form onSubmit={create} className="mt-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="grid gap-3 sm:grid-cols-3">
            <input className="rounded-md border border-gray-300 px-3 py-2 text-sm uppercase dark:border-gray-700"
              placeholder="Reference, e.g. AXL-005" required
              value={form.licence_ref} onChange={(e) => setForm((f) => ({ ...f, licence_ref: e.target.value }))} />
            <input className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
              placeholder="Legal entity name" required
              value={form.legal_entity_name} onChange={(e) => setForm((f) => ({ ...f, legal_entity_name: e.target.value }))} />
            <input className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
              placeholder="Brand name in product"
              value={form.brand_name} onChange={(e) => setForm((f) => ({ ...f, brand_name: e.target.value }))} />
          </div>
          {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
          <button type="submit" className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            Create draft
          </button>
          <p className="mt-2 text-[11px] text-gray-500">
            A new licence starts as a draft holding no territory. It cannot be activated until it
            has a country, seats, terms and a renewal date.
          </p>
        </form>
      )}

      {items.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
          <FileText size={22} className="mx-auto text-gray-400" />
          <p className="mt-3 text-sm font-medium text-gray-900 dark:text-gray-100">No licences have been issued.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-600">
            This ledger starts empty. No subsidiary is seeded, because a licence is a signed
            contract with a real entity and inventing one would misrepresent the business.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[260px_1fr]">
          <div className="space-y-1.5">
            {items.map((l) => (
              <button
                key={l.uid} type="button" onClick={() => setSel(l.uid)}
                className={`w-full rounded-lg border p-3 text-left ${
                  sel === l.uid ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{l.brand_name}</span>
                  <Chip tone={STATUS_TONE[l.status]}>{l.status.replace('_', ' ')}</Chip>
                </div>
                <div className="mt-1 text-[11px] text-gray-500">
                  {l.licence_ref} · {l.territories.length ? l.territories.join(' ') : 'no territory'}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-500">
                  <Users size={11} /> {n0(l.seats_licensed)} seats
                </div>
              </button>
            ))}
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            {sel ? <Detail uid={sel} held={held} onChanged={load} /> : <p className="text-sm text-gray-500">Pick a licence.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
