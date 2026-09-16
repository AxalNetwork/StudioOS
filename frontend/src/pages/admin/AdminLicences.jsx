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
// D110 — THE COVERAGE MAP IS DRAWN, AS A 27-CELL GRID. The refusal that stood
// here said a map was "presentation of the same data the territory list
// already carries", which was true of a map of what is HELD and missed what
// the canvas asks for: the white space. A list of holders cannot show which
// countries are still available, and that is the question H2 exists to answer.
// A grid rather than a choropleth because the shape of a country carries no
// information here and a projection is a large dependency for none.
//
// Still not reproduced: the token P&L and the per-subsidiary health grid. Both
// need account attribution that does not exist, and inventing the numbers
// under them is the thing this file refuses.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2, AlertCircle, Check, X, Globe, Users, FileText, Ban, RotateCw, ShieldOff, UserPlus,
} from 'lucide-react';
import { api } from '../../lib/api';
import { coverageCells, renewalPipeline } from '../../lib/licenceCoverage';
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

// The canvas's six-step issue flow (D110). It was five, ending in "Activate",
// and the Activate BUTTON has always sat above these tabs rather than inside
// them — so the fifth tab was really the history. Steps 5 and 6 are now the
// two the canvas draws, and the record keeps its own unnumbered tab: it is
// provenance, not a step anybody performs.
const STEPS = ['Entity', 'Territory', 'Seats', 'Terms', 'Contract', 'Deploy'];
const HISTORY_STEP = STEPS.length + 1;
// D134 — also unnumbered, and for the same reason History is: appointing an
// administrator is not a step of the issue flow. A licence can be issued,
// activated and deployed with nobody named on it, and an administrator can be
// changed years later without any of the six steps running again.
const ADMINS_STEP = STEPS.length + 2;

// Residency, exactly as Cloudflare offers it (A.4, D.1). `eu` is the only
// guarantee on D1; a hint is a hint, and there is no in-country option outside
// the EU — which the step says rather than leaving someone to discover it.
const D1_JURISDICTIONS = [
  { v: 'eu', label: 'EU — guaranteed' },
  { v: 'none', label: 'No jurisdiction — region-hinted only' },
];
const LOCATION_HINTS = [
  { v: 'none', label: 'No hint' },
  { v: 'weur', label: 'Western Europe' },
  { v: 'eeur', label: 'Eastern Europe' },
  { v: 'enam', label: 'Eastern North America' },
  { v: 'wnam', label: 'Western North America' },
  { v: 'apac', label: 'Asia-Pacific' },
  { v: 'oc', label: 'Oceania' },
];
const DO_JURISDICTIONS = [
  { v: 'none', label: 'No jurisdiction' },
  { v: 'eu', label: 'EU' },
  { v: 'us', label: 'US' },
];

// What provisioning reports, in the order it happens (migration 258). Kept as
// a list rather than inferred from the row so a deployment sitting at
// `schema_applied` shows the four steps still ahead of it.
const DEPLOY_TIMELINE = [
  ['requested', 'Requested'],
  ['database_created', 'Database created'],
  ['schema_applied', 'Schema applied'],
  ['secrets_present', 'Secrets present'],
  ['principal_seeded', 'Principal seeded'],
  ['worker_live', 'Worker live'],
  ['hostname_active', 'Hostname active'],
  ['linked', 'Linked to HQ'],
];

const BRANCH_CODE_RE = /^[a-z][a-z0-9-]{1,15}$/;

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
 * H3 step 5 — Contract                                                 *
 * ------------------------------------------------------------------ */

/**
 * The licence agreement, instantiated from a master template at a version.
 *
 * TWO HONESTY STATES THIS STEP MUST KEEP. The library may hold no templates at
 * all, in which case there is nothing to instantiate and the step says so
 * rather than showing an empty picker; and a template may ask for a merge
 * field the licence cannot fill, in which case the placeholder is LEFT VISIBLE
 * and listed. A contract with a silently blanked clause reads as finished.
 */
function ContractStep({ licence, onSaved }) {
  const [data, setData] = useState(null);
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    api.licenceContract(licence.uid)
      .then((d) => { setData(d); setSlug((s) => s || d.templates?.[0]?.slug || ''); })
      .catch((e) => { reportError('licence_contract_load_failed', e); setData(false); });
  }, [licence.uid]);
  useEffect(load, [load]);

  async function instantiate() {
    setBusy(true); setErr(null);
    try { await api.licenceContractCreate(licence.uid, slug); load(); onSaved?.(); }
    catch (e) { reportError('licence_contract_create_failed', e); setErr(e?.message || 'Could not instantiate.'); }
    finally { setBusy(false); }
  }

  if (data === false) return <p className="text-sm text-red-600">Could not load this licence&apos;s contracts.</p>;
  if (!data) return <p className="text-sm text-gray-500">Loading…</p>;

  const current = (data.contracts || []).find((k) => !k.superseded_at) || null;
  const superseded = (data.contracts || []).filter((k) => k.superseded_at);

  return (
    <div data-testid="licence-contract-step" className="space-y-4">
      {!data.contracts_available && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {data.contracts_reason}
        </p>
      )}

      {current ? (
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <div className="flex flex-wrap items-center gap-2">
            <FileText size={14} className="text-gray-500" />
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{current.template_title}</span>
            <Chip tone="bg-gray-100 text-gray-600 border-gray-200">v{current.template_version}</Chip>
            <Chip tone={current.status === 'signed'
              ? 'bg-green-50 text-green-700 border-green-200'
              : 'bg-indigo-50 text-indigo-700 border-indigo-200'}>{current.status}</Chip>
          </div>
          <div className="mt-1 text-xs text-gray-500">
            Instantiated {String(current.created_at || '').slice(0, 10)} from{' '}
            <code>{current.template_slug}</code>
          </div>
          {current.unfilled_fields?.length > 0 && (
            <div data-testid="contract-unfilled" className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              This template asks for {current.unfilled_fields.length}{' '}
              {current.unfilled_fields.length === 1 ? 'value' : 'values'} the licence does not carry:{' '}
              {current.unfilled_fields.join(', ')}. They are left as placeholders in the text rather
              than blanked — a contract with an empty clause reads as finished.
            </div>
          )}
          <p className="mt-2 text-[11px] text-gray-500">
            Unsigned. A pending signature does not block activation; a territory conflict does.
          </p>
        </div>
      ) : (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          No contract has been instantiated for this licence.
        </p>
      )}

      {data.templates_reason ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">{data.templates_reason}</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-600 dark:text-gray-400">
            <span className="block">Master template</span>
            <select
              value={slug} onChange={(e) => setSlug(e.target.value)}
              className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
            >
              {data.templates.map((t) => (
                <option key={t.slug} value={t.slug}>{t.title} · v{t.version}</option>
              ))}
            </select>
          </label>
          <button
            type="button" disabled={busy || !slug || !data.contracts_available} onClick={instantiate}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {current ? 'Re-issue at current version' : 'Instantiate'}
          </button>
        </div>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}

      {superseded.length > 0 && (
        <div className="text-xs text-gray-500">
          {superseded.length} superseded {superseded.length === 1 ? 'contract' : 'contracts'} kept:
          a re-issue supersedes, it never overwrites.
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * H3 step 6 — Deploy                                                   *
 * ------------------------------------------------------------------ */

/**
 * Ask for a branch: residency, the hostname, what gets created, and where the
 * request got to.
 *
 * THE CREDENTIAL IS RENDERED AS A REASON, NOT AS AN ERROR. `dispatch_available`
 * comes back on the registry payload precisely so this button can be disabled
 * with the sentence rather than pressed into a 409 (D110, task #192). The
 * workflow still runs by hand from the Actions tab, and the step says so.
 */
function DeployStep({ licence }) {
  const [reg, setReg] = useState(null);
  const [code, setCode] = useState('');
  const [d1, setD1] = useState('eu');
  const [hint, setHint] = useState('none');
  const [doJur, setDoJur] = useState('none');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    api.deployments()
      .then(setReg)
      .catch((e) => { reportError('deployments_load_failed', e); setReg(false); });
  }, []);
  useEffect(load, [load]);

  if (reg === false) return <p className="text-sm text-red-600">Could not read the deployment registry.</p>;
  if (!reg) return <p className="text-sm text-gray-500">Loading…</p>;

  const mine = (reg.deployments || []).find((d) => d.licence_uid === licence.uid) || null;
  const codeOk = BRANCH_CODE_RE.test(code);

  async function deploy() {
    setBusy(true); setErr(null);
    try {
      await api.licenceDeploy(licence.uid, {
        code, d1_jurisdiction: d1, location_hint: hint, do_jurisdiction: doJur, principal_email: email,
      });
      load();
    } catch (e) {
      reportError('licence_deploy_failed', e);
      setErr(e?.message || 'The deploy request was refused.');
    } finally { setBusy(false); }
  }

  if (mine) {
    const at = DEPLOY_TIMELINE.findIndex(([k]) => k === mine.status);
    return (
      <div data-testid="licence-deploy-step" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Globe size={14} className="text-gray-500" />
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{mine.hostname}</span>
          <Chip tone={mine.status === 'failed'
            ? 'bg-red-50 text-red-700 border-red-200'
            : 'bg-indigo-50 text-indigo-700 border-indigo-200'}>{mine.status.replace(/_/g, ' ')}</Chip>
          {/* The live read is its own chip, never folded into the status: a
              deployment that reached `worker_live` and is unreachable right
              now has not regressed to `requested`. */}
          <Chip tone={mine.live_state === 'ok'
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-gray-100 text-gray-600 border-gray-200'}>{mine.live_state.replace(/_/g, ' ')}</Chip>
        </div>
        {mine.status_note && <p className="text-sm text-red-700">{mine.status_note}</p>}
        {mine.live_state !== 'ok' && mine.live_reason && (
          <p className="text-xs text-gray-600 dark:text-gray-400">{mine.live_reason}</p>
        )}
        <ol data-testid="deploy-timeline" className="space-y-1 text-sm">
          {DEPLOY_TIMELINE.map(([key, label], i) => {
            const done = at >= 0 && i <= at;
            return (
              <li key={key} className="flex items-center gap-2">
                {done
                  ? <Check size={13} className="shrink-0 text-green-600" />
                  : <span className="inline-block h-[13px] w-[13px] shrink-0 rounded-full border border-gray-300 dark:border-gray-700" />}
                <span className={done ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500'}>{label}</span>
              </li>
            );
          })}
        </ol>
        <p className="text-[11px] text-gray-500">
          Residency requested: {mine.residency_requested || 'none'}. Granted:{' '}
          {mine.residency_granted || 'not yet reported by provisioning'}.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="licence-deploy-step" className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-gray-600 dark:text-gray-400">
          <span className="block">Branch code</span>
          <input
            value={code} onChange={(e) => setCode(e.target.value)} placeholder="fr"
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
          <span className="mt-1 block text-[11px] text-gray-500">
            Lower case, 2–16 characters, starting with a letter. It names the Worker, the database
            and the hostname, so it is refused rather than corrected.
          </span>
        </label>
        <div className="text-xs text-gray-600 dark:text-gray-400">
          <span className="block">Hostname</span>
          <div className="mt-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
            {codeOk ? `${code}.axal.vc` : '—'}
          </div>
        </div>
        <label className="text-xs text-gray-600 dark:text-gray-400">
          <span className="block">Database residency</span>
          <select value={d1} onChange={(e) => setD1(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900">
            {D1_JURISDICTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600 dark:text-gray-400">
          <span className="block">Location hint</span>
          <select value={hint} onChange={(e) => setHint(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900">
            {LOCATION_HINTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600 dark:text-gray-400">
          <span className="block">Realtime residency</span>
          <select value={doJur} onChange={(e) => setDoJur(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900">
            {DO_JURISDICTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600 dark:text-gray-400">
          <span className="block">Licence principal&apos;s email</span>
          <input
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="principal@example.com"
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
          <span className="mt-1 block text-[11px] text-gray-500">
            Seeded as the branch&apos;s only account, with no password — they sign in by magic link.
            Leave empty and the branch is provisioned with nobody able to sign in to it.
          </span>
        </label>
      </div>

      <p data-testid="residency-caveat" className="rounded-md border border-gray-200 p-3 text-xs text-gray-600 dark:border-gray-800 dark:text-gray-400">
        Cloudflare guarantees EU residency and nothing else. A hint keeps the primary near a region;
        it is not a guarantee, and in-country storage outside the EU is not available on this
        platform — a branch that needs it is a different data tier.
      </p>

      <div className="rounded-lg border border-gray-200 p-3 text-xs text-gray-600 dark:border-gray-800 dark:text-gray-400">
        <div className="font-medium text-gray-900 dark:text-gray-100">What provisioning will create</div>
        <ul className="mt-1 space-y-0.5">
          <li>Worker <code>studioos-{codeOk ? code : '<code>'}</code> at <code>{codeOk ? `${code}.axal.vc` : '<code>.axal.vc'}</code></li>
          <li>D1 database, two KV namespaces, three R2 buckets, a queue and its dead-letter queue</li>
          <li>A Vectorize index, the schema from the baseline, and the Worker secrets</li>
          <li>A pull request giving HQ its service binding — HQ reaches the branch on its next deploy</li>
        </ul>
      </div>

      {!reg.dispatch_available && (
        <p data-testid="deploy-credential-reason" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {reg.dispatch_reason}
        </p>
      )}
      <button
        type="button" disabled={busy || !codeOk || !reg.dispatch_available} onClick={deploy}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        Deploy this branch
      </button>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Administrators — the door admin accounts are opened and closed by    *
 * ------------------------------------------------------------------ */

// D134 — `licence_admins` has existed since migration 190 and had no UI at all:
// its three api.js methods had zero callers, so naming a subsidiary's
// administrator meant SQL. This is the section, and it is deliberately the
// whole lifecycle rather than a list — appoint, demote, detach — because the
// three only make sense read together.
//
// THE TWO-STEP CLOSE IS ON SCREEN RATHER THAN IN A 409. Detach refuses while
// the account still holds the admin role, so the button says so and stays
// disabled until the demote has happened. A UI that offered both and let the
// server pick would teach the operator that one of its buttons is a lie.
//
// A FAILED READ IS NOT AN EMPTY LIST. `items === null` after a failure renders
// the server's own sentence; "no administrators" is a claim about the licence
// and must never be produced by a request that did not arrive.
function AdminsEditor({ licence, onSaved }) {
  const [items, setItems] = useState(undefined);
  const [loadErr, setLoadErr] = useState(null);
  const [form, setForm] = useState({ email: '', admin_role: 'principal', reason: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    setLoadErr(null);
    api.licenceAdmins(licence.uid)
      .then((d) => setItems(Array.isArray(d?.items) ? d.items : []))
      .catch((e) => {
        reportError('AdminLicences:licenceAdmins', e);
        setItems(null);
        setLoadErr(e?.message || 'The administrator list could not be read.');
      });
  }, [licence.uid]);
  useEffect(load, [load]);

  const refresh = () => { load(); onSaved?.(); };

  async function run(fn) {
    setBusy(true); setErr(null);
    try { await fn(); refresh(); }
    catch (e) { reportError('AdminLicences:adminAction', e); setErr(e?.message || 'That did not go through.'); }
    finally { setBusy(false); }
  }

  const canAppoint = form.email.trim().length > 0 && form.reason.trim().length >= 10;

  return (
    <div data-testid="licence-admins">
      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Administrators</h3>
      <p className="mt-1 text-[11px] text-gray-500">
        Appointing someone here makes the account an admin and binds it to this licence in one
        step, so no administrator exists without a territory behind them. Closing one is two
        steps, in this order: demote, then detach.
      </p>

      {items === undefined && <p className="mt-3 text-sm text-gray-500">Loading…</p>}
      {items === null && (
        <p data-testid="licence-admins-unreadable" className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          {loadErr} This is not the same as having none — nothing was read.
        </p>
      )}
      {Array.isArray(items) && items.length === 0 && (
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
          Nobody administers this licence yet.
        </p>
      )}
      {Array.isArray(items) && items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {items.map((a) => {
            const isAdmin = String(a.role || '').toLowerCase() === 'admin';
            const active = Number(a.is_active ?? 0) === 1;
            return (
              <li key={a.user_id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {a.name || a.email}
                    </div>
                    <div className="text-xs text-gray-500">{a.email} · {a.admin_role}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {isAdmin
                      ? <Chip tone={active ? STATUS_TONE.active : STATUS_TONE.suspended}>
                          {active ? 'admin' : 'admin · deactivated'}
                        </Chip>
                      : <Chip tone={STATUS_TONE.draft}>no longer an admin — detach</Chip>}
                    <button
                      type="button" disabled={busy || !isAdmin}
                      onClick={() => {
                        const reason = window.prompt('Why is this administrator being removed? At least 10 characters, and it is recorded.');
                        if (reason) run(() => api.adminDemoteAdmin(a.user_id, reason));
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-40"
                    >
                      <ShieldOff size={12} /> Demote
                    </button>
                    <button
                      type="button" disabled={busy || isAdmin}
                      onClick={() => run(() => api.licenceAdminRemove(licence.uid, a.user_id))}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
                    >
                      <X size={12} /> Detach
                    </button>
                  </div>
                </div>
                {isAdmin && (
                  <p className="mt-2 text-[11px] text-gray-500">
                    Detach is available once this account is no longer an admin — unbinding first
                    would leave an administrator with no licence behind them.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Appoint an administrator</div>
        <p className="mt-1 text-[11px] text-gray-500">
          The address must already have an account — appointing one nobody holds would create an
          administrator who cannot sign in.
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input
            type="email" placeholder="name@example.com" value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
          />
          <select
            value={form.admin_role}
            onChange={(e) => setForm((f) => ({ ...f, admin_role: e.target.value }))}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
          >
            <option value="principal">Principal</option>
            <option value="delegate">Delegate</option>
          </select>
        </div>
        <textarea
          rows={2} placeholder="Why this account, in at least 10 characters. It is recorded."
          value={form.reason}
          onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
        />
        <button
          type="button" disabled={busy || !canAppoint}
          onClick={() => run(async () => {
            await api.licenceAdminAdd(licence.uid, {
              email: form.email.trim(), admin_role: form.admin_role, reason: form.reason.trim(),
            });
            setForm({ email: '', admin_role: 'principal', reason: '' });
          })}
          className="mt-2 inline-flex items-center gap-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <><UserPlus size={14} /> Appoint</>}
        </button>
      </div>

      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <p className="mt-3 text-[11px] text-gray-500">
        Every act here needs a recent TOTP step-up as well as the Super Admin elevation, so a
        403 can mean "step up and try again" rather than "you may not".
      </p>
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
        {/* Unnumbered, because neither is a step of the issue flow — one is the
            append-only record of what the flow did, and the other is who runs
            the subsidiary afterwards. */}
        <button
          type="button" onClick={() => setStep(ADMINS_STEP)}
          className={`-mb-px border-b-2 px-3 py-2 text-xs ${
            step === ADMINS_STEP ? 'border-indigo-600 font-medium text-indigo-700' : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          Administrators
        </button>
        <button
          type="button" onClick={() => setStep(HISTORY_STEP)}
          className={`-mb-px border-b-2 px-3 py-2 text-xs ${
            step === HISTORY_STEP ? 'border-indigo-600 font-medium text-indigo-700' : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          History
        </button>
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
        {step === 5 && <ContractStep licence={d} onSaved={refresh} />}
        {step === 6 && <DeployStep licence={d} />}
        {step === ADMINS_STEP && <AdminsEditor licence={d} onSaved={refresh} />}
        {step === HISTORY_STEP && (
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

/**
 * H2 — EU coverage as 27 cells, and the renewal pipeline beside it.
 *
 * THE THREE CELL STATES ARE NOT THREE SHADES OF ONE IDEA. Held-active and
 * held-suspended are both TAKEN — a suspended licence keeps its territory, and
 * a grid that freed those cells would invite the double-issue the ledger's
 * UNIQUE index exists to prevent. Free is the third, and it is the reason the
 * grid is 27 cells rather than a list of holders.
 */
function Coverage({ items }) {
  const { cells, held_active: active, held_suspended: suspended, free, outside_eu: outside } =
    useMemo(() => coverageCells(items), [items]);
  const pipeline = useMemo(() => renewalPipeline(items), [items]);

  const tone = {
    held_active: 'border-green-300 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200',
    held_suspended: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
    free: 'border-gray-200 bg-white text-gray-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-500',
  };

  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]" data-testid="hq-coverage">
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">EU territory coverage</h2>
          <span className="text-[11.5px] text-gray-500">
            {active} held · {suspended} suspended · {free} white space
          </span>
        </div>
        <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5">
          {cells.map((c) => (
            <div
              key={c.code}
              title={c.licence ? `${c.name} — ${c.licence.licence_ref} (${c.licence.status})` : `${c.name} — available`}
              data-testid={`coverage-${c.code}`}
              data-state={c.state}
              className={`rounded-md border px-1.5 py-1 text-center ${tone[c.state]}`}
            >
              <div className="text-[12px] font-bold tabular-nums">{c.code}</div>
              <div className="truncate text-[9.5px] leading-tight">
                {c.licence ? c.licence.licence_ref : '—'}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-gray-500">
          A suspended licence still holds its countries — releasing them is a termination, not a
          suspension — so those cells are taken, not free.
          {outside.length > 0 && (
            <> Outside the EU and not on this grid: <span className="font-medium">{outside.join(' ')}</span>.</>
          )}
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Renewal pipeline</h2>
        {pipeline.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-gray-500">
            No licence on the ledger carries a renewal date yet.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-800" data-testid="hq-renewal-pipeline">
            {pipeline.map((p) => (
              <li key={p.uid} className="flex items-baseline justify-between gap-3 py-1.5 text-[12.5px]">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{p.licence_ref}</span> · {p.brand_name}
                </span>
                <span className={`shrink-0 tabular-nums ${
                  p.days === null ? 'text-gray-400'
                    : p.days < 0 ? 'font-semibold text-rose-700 dark:text-rose-300'
                      : p.days <= 60 ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500'
                }`}>
                  {/* An overdue renewal is kept and marked, never dropped for
                      sorting below zero — it is the most important row here. */}
                  {p.days === null ? p.renews_on : p.days < 0 ? `${-p.days}d overdue` : `${p.days}d`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

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

      <Coverage items={items} />

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
