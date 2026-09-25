// Territory licences — the HQ ledger for the subsidiary model.
//
// Design handoff: Admin · Super.dc.html, "Licences" nav row and the five-step
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
  Loader2, AlertCircle, AlertTriangle, Check, X, Globe, Users, FileText, Ban, RotateCw,
  Send, ShieldOff, UserPlus,
} from 'lucide-react';
import { api } from '../../lib/api';
import { bpsPercent as pct } from '../../lib/bps';
import { coverageCells, renewalPipeline, sortCells } from '../../lib/licenceCoverage';
import { DEPLOY_TIMELINE, deployProgress } from '../../lib/deployTimeline';
import { reportError } from '../../lib/log';
import {
  FREEZING_STATUSES, NOTICE_KINDS, noticeKindLabel, noticeRank, daysTo,
} from '../../lib/notices';

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
// D136 — the third unnumbered tab, and the same argument a third time. Issuing a
// compliance notice is something HQ does to a licence that has been running for
// months; putting it in the numbered flow would say a licence cannot be issued
// without one.
const NOTICES_STEP = STEPS.length + 3;
// D198 — the fourth unnumbered tab, and the argument is H26's own rather than
// the previous three's. It is unnumbered for a REASON THE CANVAS FORCES: H26
// calls the brand kit "Step 6" and says in the same header "Unique to this
// kind · an Axal subsidiary never sees this step". A numbered step that only
// some licences have would renumber the flow per licence, and two tests pin
// the six as six (`licence_admins_ui_d134.test.mjs`, `hq_licences_h2h3`).
// H26's "Step 6" is its own seven-step strip — which begins with Kind, and
// Kind is not one of this page's STEPS either.
const BRAND_STEP = STEPS.length + 4;

// The ladder's own statuses, which are NOT licence statuses. `STATUS_TONE` above
// covers `active`/`suspended`/`terminated`/`draft`/`pending_activation` and none
// of the six below is in it — a notice reusing that map would fall through to
// the `draft` grey and render `overdue` as the calmest thing on the screen.
//
// The two FREEZING statuses (`overdue`, `rejected`, per `util/authErrors.ts`)
// are the two in rose, because what they have in common is not their position in
// the sequence — it is that the account cannot write.
const NOTICE_TONE = {
  issued: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  overdue: 'bg-rose-50 text-rose-700 border-rose-200',
  responded: 'bg-amber-50 text-amber-800 border-amber-200',
  accepted: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
  withdrawn: 'bg-gray-100 text-gray-500 border-gray-200',
};

// D138 — `NOTICE_KINDS`, `noticeKindLabel` and the freezing set were declared
// here AND in `MyLicencePage.jsx` when D136 shipped both surfaces on one day.
// They live in `lib/notices.js` now, on the rule `lib/README.md` already
// states: "If a helper appears in two places, put it here once rather than a
// third time." `NOTICE_TONE` below deliberately did NOT move — see that file's
// header for why two tone maps are two visual treatments and not one fact.

// MIN/MAX/DEFAULT_RESPOND_DAYS in `services/complianceLadder.ts`. The server
// clamps to this range whatever arrives, so the input's bounds are the same
// numbers rather than a looser set the server would silently correct.
const RESPOND_DAYS = { min: 1, max: 90, def: 14 };

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

// The workflow's charset, and never `hq`: HQ's own code in the metrics store (D211).
const BRANCH_CODE_RE = /^(?!hq$)[a-z][a-z0-9-]{1,15}$/;

const n0 = (n) => Number(n || 0).toLocaleString();

// Basis points in, percent out — now `lib/bps.js`, imported above as `pct` so
// no call site in this file changes.
//
// THE COMMENT THIS REPLACES SAID "this is the only place a fraction is ever
// computed", AND IT WAS ALREADY FALSE when it was written: `MyLicencePage`
// declared the same body as `fmtBps`, `NeedsBoardPage` had it inline on a tax
// rate, and HQ's Revenue page was about to be the fourth. That is the same
// class of stale claim D129 and D131 each deleted — a sentence that describes
// an intention rather than the tree. It is true now because there IS one
// definition, and `frontend/test/bps_single_definition.test.mjs` keeps it true.

const fee = (cents, currency) => (cents === null || cents === undefined
  ? null
  : `${currency || ''} ${(Math.round(Number(cents)) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`.trim());

// D138 — `toUtcInstant` and `daysTo` moved to `lib/notices.js`. They were
// exported from this PAGE for their test, and `HqTeamTable.jsx` needs the same
// normalisation: `admin_notices` stamps are SQL `YYYY-MM-DD HH:MM:SS`, which
// V8 reads as the READER'S LOCAL time and other engines reject. Importing one
// page's export from another page is what `lib/README.md` exists to prevent.

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
      <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
        This refusal is the Axal-subsidiary rule: one country, one Axal licence.
        A white-label in the same country is a separate exclusivity flag, and that flag is not stored,
        so this step cannot yet tell the two apart.
      </p>
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
    // THREE STATES, BECAUSE TWO WERE THE DEFECT — the derivation and the whole
    // argument for it are `lib/deployTimeline.js`'s, so that a test can put a
    // RUNNING deployment and a FAILED one through it and see them differ. A
    // scan of this file could only ever see that three markers are written,
    // which is not the thing that was broken.
    const { failed, done, total, states, summary } = deployProgress(mine.status);
    return (
      <div data-testid="licence-deploy-step" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Globe size={14} className="text-gray-500" />
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{mine.hostname}</span>
          {/* One definition of failed, shared with the timeline below, so the
              chip and the marks can never disagree about the same row. */}
          <Chip tone={failed
            ? 'bg-red-50 text-red-700 border-red-200'
            : 'bg-indigo-50 text-indigo-700 border-indigo-200'}>{mine.status.replace(/_/g, ' ')}</Chip>
          {/* The live read is its own chip, never folded into the status: a
              deployment that reached `worker_live` and is unreachable right
              now has not regressed to `requested`. */}
          <Chip tone={mine.live_state === 'ok'
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-gray-100 text-gray-600 border-gray-200'}>{mine.live_state.replace(/_/g, ' ')}</Chip>
        </div>
        {mine.status_note && (
          <div
            data-testid="deploy-status-note"
            className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          >
            {/* The heading says whose sentence this is. The note is written by
                the route that stopped (admin_deployments.ts names the missing
                credential and the 403 scope apart, rather than calling both
                "not configured"), so it is repeated here and never restated —
                a second copy of a server sentence is the thing the credential
                block below already refuses. */}
            <span className="block text-[11px] font-medium uppercase tracking-wide">
              {failed ? 'Why it stopped' : 'Reported by provisioning'}
            </span>
            <span className="mt-1 block">{mine.status_note}</span>
          </div>
        )}
        {mine.live_state !== 'ok' && mine.live_reason && (
          <p className="text-xs text-gray-600 dark:text-gray-400">{mine.live_reason}</p>
        )}
        <p data-testid="deploy-summary" className="text-sm text-gray-700 dark:text-gray-300">
          {summary}
        </p>
        <ol data-testid="deploy-timeline" data-done={done} data-total={total} className="space-y-1 text-sm">
          {DEPLOY_TIMELINE.map(([key, label], i) => {
            const state = states[i];
            return (
              <li key={key} data-state={state} className="flex items-center gap-2">
                {state === 'ok' && <Check size={13} className="shrink-0 text-green-600" />}
                {state === 'wait' && (
                  <span className="inline-block h-[13px] w-[13px] shrink-0 rounded-full border border-gray-300 dark:border-gray-700" />
                )}
                {/* Dashed, not a cross: the mark means "not recorded", and a
                    cross would say this step ran and failed, which is a claim
                    the row cannot support for any particular step. */}
                {state === 'unknown' && (
                  <span className="inline-block h-[13px] w-[13px] shrink-0 rounded-full border border-dashed border-amber-500" />
                )}
                <span className={state === 'ok' ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500'}>
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
        <p data-testid="deploy-timeline-bound" className="text-[11px] text-gray-500">
          No step carries a time or a note of its own: the deployment row holds one status and one
          note for the whole request, so the note above belongs to the deployment rather than to any
          step of it.
        </p>
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
/* ------------------------------------------------------------------ *
 * D198 — the brand kit, drawn only for a white-label licence          *
 * ------------------------------------------------------------------ */

function BrandKitEditor({ licence, onSaved }) {
  const kit = licence.brand_kit || null;
  const [primary, setPrimary] = useState(kit?.primary_hex || '');
  const [accent, setAccent] = useState(kit?.accent_hex || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // The mark's URL carries a cache-buster keyed on the kit's own stamp. The
  // route's path does not change when a mark is replaced — it is the licence's
  // uid — so without this the browser would go on drawing the previous logo.
  const markSrc = kit?.mark_url ? `${kit.mark_url}?v=${encodeURIComponent(kit.updated_at || '')}` : null;

  async function run(fn) {
    setBusy(true); setErr(null);
    try { await fn(); onSaved?.(); }
    catch (e) {
      reportError('AdminLicences:brandKit', e);
      setErr(e?.message || 'That did not go through.');
    } finally { setBusy(false); }
  }

  // The same condition the server enforces, mirrored so the form does not
  // offer a save the route would refuse. `#rgb` and `#rrggbb` are both what
  // `cleanHex` admits, so the two agree rather than the client being stricter.
  const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const canSave = HEX.test(primary.trim()) && HEX.test(accent.trim());

  // UNREADABLE IS NOT ABSENT. A database without migration 281 has no store,
  // and "this licence has no kit" would be a claim about the licence rather
  // than about the database.
  if (licence.brand_kit_available === false) {
    return (
      <div data-testid="licence-brand-kit-unreadable">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Brand kit</h3>
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
          {licence.brand_kit_reason || 'The brand-kit store could not be read.'} Nothing below is a
          statement about this licence — it is a statement about this database.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="licence-brand-kit">
      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Brand kit</h3>
      <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
        A white-label operator sets their own mark. HQ does not approve it. HQ captures it here
        because a licence is issued before any administrator is named on it, so at issue time
        there is nobody else to type it — and the colours are required before the licence can be
        activated, because a shell with no palette of its own renders Axal&rsquo;s.
      </p>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Field
            label="Public name"
            value={licence.brand_name || null}
            hint="This is the brand name already on the licence. A separate public-name column does not exist."
          />

          <div data-testid="licence-brand-colours">
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Colours</div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[12px] text-gray-600 dark:text-gray-400">
                Primary
                <input
                  type="text" value={primary} onChange={(e) => setPrimary(e.target.value)}
                  placeholder="#0f766e" spellCheck={false}
                  className="w-28 rounded-md border border-gray-300 px-2 py-1 font-mono text-[12px] dark:border-gray-700 dark:bg-gray-900"
                />
                <span
                  className="inline-block h-5 w-5 rounded border border-gray-300 dark:border-gray-700"
                  style={HEX.test(primary.trim()) ? { backgroundColor: primary.trim() } : undefined}
                />
              </label>
              <label className="flex items-center gap-2 text-[12px] text-gray-600 dark:text-gray-400">
                Accent
                <input
                  type="text" value={accent} onChange={(e) => setAccent(e.target.value)}
                  placeholder="#f59e0b" spellCheck={false}
                  className="w-28 rounded-md border border-gray-300 px-2 py-1 font-mono text-[12px] dark:border-gray-700 dark:bg-gray-900"
                />
                <span
                  className="inline-block h-5 w-5 rounded border border-gray-300 dark:border-gray-700"
                  style={HEX.test(accent.trim()) ? { backgroundColor: accent.trim() } : undefined}
                />
              </label>
              <button
                type="button" disabled={busy || !canSave}
                onClick={() => run(() => api.licenceBrandSet(licence.uid, {
                  primary_hex: primary.trim(), accent_hex: accent.trim(),
                }))}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Save colours
              </button>
            </div>
            <p className="mt-1 text-[11px] text-gray-500">
              Both are required together. A value that is not a hex colour is refused rather than
              replaced with a default &mdash; a brand colour quietly swapped for a fallback is a
              wrong claim about somebody&rsquo;s brand, which is worse than a missing one.
            </p>
          </div>

          <div data-testid="licence-brand-mark">
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Mark</div>
            {markSrc ? (
              <div className="mt-1 flex items-center gap-3">
                {/* WHITE IN BOTH THEMES, deliberately. A mark is usually drawn
                    in the operator's own dark ink, and on a dark ground it
                    would disappear — so the backing does not follow the theme.
                    The pair is spelled out so the guard reads it as a decision
                    rather than an omission. */}
                <img
                  src={markSrc} alt={`${licence.brand_name} mark`}
                  className="h-10 w-auto max-w-[140px] rounded border border-gray-200 bg-white object-contain p-1 dark:border-gray-800 dark:bg-white"
                />
                <span className="text-[11px] text-gray-500">
                  {kit.mark_mime}{kit.mark_bytes ? ` · ${Math.round(kit.mark_bytes / 1024)} KB` : ''}
                </span>
                <button
                  type="button" disabled={busy}
                  onClick={() => run(() => api.licenceBrandMarkRemove(licence.uid))}
                  className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="mt-0.5 text-sm text-gray-400">Not recorded</div>
            )}
            <input
              type="file" accept="image/png,image/jpeg,image/svg+xml" disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) run(() => api.licenceBrandMarkUpload(licence.uid, file));
              }}
              className="mt-2 block w-full text-[11px] text-gray-600 file:mr-2 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-2 file:py-1 file:text-[11px]"
            />
            <p className="mt-1 text-[11px] text-gray-500">
              PNG, JPEG or SVG, up to 512 KB. An SVG is sanitised before it is stored, so a mark
              can never carry a script into a shell that renders it.
            </p>
          </div>
        </div>

        {/* H26's preview. Every value in it comes from a field above or from
            the licence; nothing here is sample data. */}
        <div
          className="rounded-lg border border-gray-200 p-3 dark:border-gray-800"
          data-testid="licence-brand-preview"
        >
          <div className="text-[11px] uppercase tracking-wide text-gray-500">Preview</div>
          <div
            className="mt-2 flex items-center gap-3 rounded-md p-3"
            style={HEX.test(primary.trim()) ? { backgroundColor: primary.trim() } : undefined}
          >
            {markSrc
              ? <img src={markSrc} alt="" className="h-8 w-auto max-w-[110px] object-contain" />
              : <span className="text-[11px] text-white/80">No mark</span>}
            <span className="text-sm font-semibold text-white">{licence.brand_name}</span>
            <span
              className="ml-auto inline-block h-4 w-4 rounded-full border border-white/40"
              style={HEX.test(accent.trim()) ? { backgroundColor: accent.trim() } : undefined}
            />
          </div>
          <dl className="mt-3 space-y-2 text-[11px]">
            <div>
              <dt className="uppercase tracking-wide text-gray-500">Email from</dt>
              <dd className="text-gray-700 dark:text-gray-300">
                {licence.domain?.hostname
                  ? `${licence.brand_name} <hello@${licence.domain.hostname}>`
                  : 'Derived from the public name and the bound host. No host is bound yet, so there is nothing to derive it from.'}
              </dd>
            </div>
            <div>
              <dt className="uppercase tracking-wide text-gray-500">Issued at deploy</dt>
              <dd className="text-gray-700 dark:text-gray-300">
                The platform host the deploy issued. It is not collected in this kit &mdash; the
                custom host the Admin binds is on the Deploy step.
              </dd>
            </div>
            <div>
              <dt className="uppercase tracking-wide text-gray-500">&ldquo;Powered by Axal VC&rdquo;</dt>
              <dd className="text-gray-700 dark:text-gray-300">
                Hidden, and not a stored switch. Nothing in the shell renders a platform credit at
                all, so a setting here would turn something off that is already off.
              </dd>
            </div>
            <div>
              <dt className="uppercase tracking-wide text-gray-500">Exclusive vs other white-labels</dt>
              <dd className="text-gray-700 dark:text-gray-300">
                Not stored. Territory exclusivity is enforced on the territory itself; a separate
                flag would relax that constraint rather than add to it.
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}

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
 * Notices — the compliance ladder, from HQ's end                       *
 * ------------------------------------------------------------------ */

// D136 — D135 built the whole ladder and gave it no door: `licenceNotices`,
// `licenceNoticeIssue` and `licenceNoticeReview` shipped with zero callers, so
// issuing a notice meant SQL — and the sweep runs every minute, which means a
// notice issued that way would freeze an account whose only screen said nothing
// about why. This is HQ's end of it.
//
// ACCEPT AND REJECT ARE DISABLED UNTIL THE ADDRESSEE HAS ANSWERED, rather than
// offered and refused. The server answers 409 `not_responded` every time, which
// is D134's `still_an_admin` one route over: a UI that offers a button the
// server always refuses teaches the operator that its buttons are advisory.
//
// AND THE ADDRESSEE IS A PICKER, NOT A TEXT BOX. `POST /notices` resolves the
// email against `licence_admins` and 404s `not_an_administrator` for anyone
// else, so a free-text field would be a field whose wrong answers are only
// discoverable by submitting. The options are this licence's own administrators.
function NoticesEditor({ licence, onSaved }) {
  const [items, setItems] = useState(undefined);
  const [holders, setHolders] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [admins, setAdmins] = useState(undefined);
  const [form, setForm] = useState({
    email: '', kind: 'renewal_terms', subject: '', body: '', respond_days: String(RESPOND_DAYS.def),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [lastReview, setLastReview] = useState(null);

  const load = useCallback(() => {
    setLoadErr(null);
    api.licenceNotices(licence.uid)
      .then((d) => {
        // `notices_available: false` arrives with a 200 and an empty array, so
        // the UNREADABLE state has to be read off the flag rather than off the
        // length — otherwise a database that has not applied migration 264
        // renders "no notices", which is a claim about the licence that nothing
        // measured. Same null-means-unreadable contract as AdminsEditor.
        if (d?.notices_available === false) {
          setItems(null);
          setLoadErr(d.notices_reason || 'The notices could not be read.');
          setHolders(null);
          return;
        }
        setItems(Array.isArray(d?.items) ? d.items : []);
        setHolders(Number.isFinite(Number(d?.freeze_holders)) ? Number(d.freeze_holders) : null);
      })
      .catch((e) => {
        reportError('AdminLicences:licenceNotices', e);
        setItems(null);
        setLoadErr(e?.message || 'The notices could not be read.');
      });
    // The addressee picker's options. Its own failure is its own state: a
    // notices list that reads fine beside an administrator list that does not
    // is a real combination, and collapsing the two would hide one of them.
    api.licenceAdmins(licence.uid)
      .then((d) => setAdmins(Array.isArray(d?.items) ? d.items : []))
      .catch((e) => { reportError('AdminLicences:noticeAddressees', e); setAdmins(null); });
  }, [licence.uid]);
  useEffect(load, [load]);

  const refresh = () => { load(); onSaved?.(); };

  async function run(fn) {
    setBusy(true); setErr(null);
    try { await fn(); refresh(); }
    catch (e) { reportError('AdminLicences:noticeAction', e); setErr(e?.message || 'That did not go through.'); }
    finally { setBusy(false); }
  }

  // WORST FIRST, and "worst" means frozen rather than newest. A notice holding
  // an account frozen is the only kind anybody has to do something about, so it
  // sorts above one waiting on HQ, which sorts above one waiting on the
  // addressee, which sorts above the closed ones. Inside a band, oldest first:
  // the longest-frozen account is the one furthest down the ladder.
  const sorted = useMemo(() => {
    if (!Array.isArray(items)) return items;
    return [...items].sort((a, b) => {
      const r = noticeRank(a.status) - noticeRank(b.status);
      if (r !== 0) return r;
      return String(a.froze_at || a.respond_by || '')
        .localeCompare(String(b.froze_at || b.respond_by || ''));
    });
  }, [items]);

  const days = Number(form.respond_days);
  const canIssue = form.email.trim().length > 0
    && form.subject.trim().length >= 3
    && form.body.trim().length >= 10
    && Number.isFinite(days) && days >= RESPOND_DAYS.min && days <= RESPOND_DAYS.max;

  return (
    <div data-testid="licence-notices">
      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Compliance notices</h3>
      <p className="mt-1 text-[11px] text-gray-500">
        A notice is the first rung: the administrator is told what is wrong and by when to answer.
        A deadline that passes unanswered freezes their account and suspends this licence — writes
        stop, reading does not. Answering lifts the freeze; you accept or reject afterwards.
        Terminating is never automatic and is the button at the top of this page.
      </p>

      {items === undefined && <p className="mt-3 text-sm text-gray-500">Loading…</p>}
      {items === null && (
        <p data-testid="licence-notices-unreadable" className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          {loadErr} This is not the same as there being none — nothing was read.
        </p>
      )}
      {Array.isArray(items) && items.length === 0 && (
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
          No notice has been issued against this licence.
        </p>
      )}

      {holders !== null && holders > 0 && (
        <p data-testid="licence-freeze-holders" className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertTriangle size={13} className="mr-1.5 -mt-0.5 inline" />
          {holders === 1
            ? 'One notice is holding this licence frozen.'
            : `${holders} notices are holding this licence frozen.`}{' '}
          Accepting one is not enough — the freeze lifts when the last of them is answered and accepted.
        </p>
      )}

      {lastReview && (
        <p data-testid="licence-notice-reviewed" className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          Recorded as <strong className="font-semibold">{lastReview.status}</strong>.{' '}
          {lastReview.reinstated
            ? 'That was the last one holding it, so the licence is active again.'
            : `${lastReview.freeze_holders} notice${lastReview.freeze_holders === 1 ? '' : 's'} still holding the freeze.`}
        </p>
      )}

      {Array.isArray(sorted) && sorted.length > 0 && (
        <ul className="mt-3 space-y-2">
          {sorted.map((n) => {
            const reviewable = n.status === 'responded';
            const frozenDays = FREEZING_STATUSES.has(n.status) ? daysTo(n.froze_at) : null;
            const due = daysTo(n.respond_by);
            return (
              <li key={n.uid} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{n.subject}</div>
                    <div className="text-xs text-gray-500">
                      {n.name || n.email} · {noticeKindLabel(n.kind)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={NOTICE_TONE[n.status]}>{String(n.status || '').replace(/_/g, ' ')}</Chip>
                    <button
                      type="button" disabled={busy || !reviewable}
                      onClick={() => run(async () => {
                        const note = window.prompt('A note on why this is accepted. Optional, and it is recorded.') || '';
                        const res = await api.licenceNoticeReview(licence.uid, n.uid, { decision: 'accept', note });
                        setLastReview(res);
                      })}
                      className="inline-flex items-center gap-1 rounded-md border border-green-300 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-40"
                    >
                      <Check size={12} /> Accept
                    </button>
                    <button
                      type="button" disabled={busy || !reviewable}
                      onClick={() => run(async () => {
                        const note = window.prompt('Why is this response not accepted? The account stays frozen, and this is what they read.');
                        if (note === null) return;
                        const res = await api.licenceNoticeReview(licence.uid, n.uid, { decision: 'reject', note });
                        setLastReview(res);
                      })}
                      className="inline-flex items-center gap-1 rounded-md border border-rose-300 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                    >
                      <X size={12} /> Reject
                    </button>
                  </div>
                </div>

                <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{n.body}</p>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
                  <span>
                    Due {String(n.respond_by || '').slice(0, 10)}
                    {due === null ? '' : due < 0 ? ` · ${Math.abs(due)} days overdue` : ` · in ${due} days`}
                  </span>
                  {/* THE ONLY CLOCK ON THIS SCREEN, and it counts UP from the
                      freeze rather than down to anything. There is no second
                      deadline: HQ decides when an account has had long enough,
                      and a countdown would imply the platform decides. */}
                  {frozenDays !== null && (
                    <span data-testid="licence-notice-frozen-for" className="font-medium text-rose-700">
                      Frozen since {String(n.froze_at || '').slice(0, 10)} · {Math.abs(frozenDays)} days
                    </span>
                  )}
                  {n.responded_at && <span>Answered {String(n.responded_at).slice(0, 10)}</span>}
                  {n.reviewed_at && <span>Reviewed {String(n.reviewed_at).slice(0, 10)}</span>}
                </div>

                {n.response
                  ? (
                    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-2.5 dark:border-gray-800 dark:bg-gray-900">
                      <div className="text-[11px] font-medium text-gray-500">Their response</div>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200">{n.response}</p>
                    </div>
                  )
                  : (
                    <p className="mt-2 text-[11px] text-gray-500">
                      Accept and Reject are available once the administrator has answered — there is
                      nothing to review until they have.
                    </p>
                  )}

                {n.review_note && (
                  <p className="mt-2 text-[11px] text-gray-500">Your note: {n.review_note}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Issue a notice</div>
        {admins === undefined && <p className="mt-1 text-[11px] text-gray-500">Loading administrators…</p>}
        {admins === null && (
          <p data-testid="licence-notice-addressees-unreadable" className="mt-1 text-[11px] text-gray-600">
            The administrator list could not be read, so there is nobody to address. That is not the
            same as this licence having none.
          </p>
        )}
        {Array.isArray(admins) && admins.length === 0 && (
          <p className="mt-1 text-[11px] text-gray-600">
            Nobody administers this licence, so a notice would have nobody to act on it. Appoint an
            administrator first.
          </p>
        )}
        {Array.isArray(admins) && admins.length > 0 && (
          <>
            <p className="mt-1 text-[11px] text-gray-500">
              The addressee has to be an administrator of this licence — the freeze lands on their
              account, so a notice to anyone else would have no remedy behind it.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <select
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
              >
                <option value="">Who is this for…</option>
                {admins.map((a) => (
                  <option key={a.user_id} value={a.email}>{a.name ? `${a.name} — ${a.email}` : a.email}</option>
                ))}
              </select>
              <select
                value={form.kind}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
              >
                {NOTICE_KINDS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
              {/* A COUNT OF DAYS, NEVER A DATE PICKER. `respond_by` is computed
                  server-side as `datetime('now', '+N days')` so the deadline and
                  the sweep that reads it share one format and one clock; a date
                  input would say the browser sets the deadline, in the reader's
                  own zone, which is the timestamp defect this repo keeps fixing. */}
              <input
                type="number" min={RESPOND_DAYS.min} max={RESPOND_DAYS.max} value={form.respond_days}
                onChange={(e) => setForm((f) => ({ ...f, respond_days: e.target.value }))}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
                aria-label="Days to respond"
              />
            </div>
            <input
              type="text" placeholder="Subject — what this is about, in a line" value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
            />
            <textarea
              rows={4} maxLength={5000}
              placeholder="What is wrong and what would settle it. At least 10 characters — this is what they act on, and what a tribunal reads afterwards."
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
            />
            <button
              type="button" disabled={busy || !canIssue}
              onClick={() => run(async () => {
                await api.licenceNoticeIssue(licence.uid, {
                  email: form.email, kind: form.kind, subject: form.subject.trim(),
                  body: form.body.trim(), respond_days: Number(form.respond_days),
                });
                setForm({
                  email: '', kind: 'renewal_terms', subject: '', body: '',
                  respond_days: String(RESPOND_DAYS.def),
                });
              })}
              className="mt-2 inline-flex items-center gap-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <><Send size={14} /> Issue notice</>}
            </button>
            <p className="mt-2 text-[11px] text-gray-500">
              Between {RESPOND_DAYS.min} and {RESPOND_DAYS.max} days to answer. The clock starts now,
              and the administrator is emailed and told in the app.
            </p>
          </>
        )}
      </div>

      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <p className="mt-3 text-[11px] text-gray-500">
        Issuing and reviewing need a recent TOTP step-up as well as the Super Admin elevation, so a
        403 can mean &quot;step up and try again&quot; rather than &quot;you may not&quot;.
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
  // D197 — the detach's own reason and its own error. `act` below reports a
  // failure to the beacon and renders nothing, which is right for a control
  // whose effect is visible on the next load; it is wrong for this one,
  // because a silently-failed detach tells HQ a host was taken away when it
  // was not. The server's sentence is shown instead.
  const [detachReason, setDetachReason] = useState('');
  const [detachErr, setDetachErr] = useState('');

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
          <div className="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-400" data-testid="licence-kind-pill">
            {d.kind === 'white_label'
              ? 'White-label · platform supervised, brand unsupervised'
              : 'Axal subsidiary · platform supervised'}
          </div>
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

      {/* H31 — THE DOMAIN STRIP, AND THE ONE THING HQ MAY DO TO IT (D197).
          The artboard's own sentence: "There is no Approve, no Add domain, and
          no DNS editor for HQ to complete on a tenant's behalf." So five
          columns of status, a footer saying where the records live, and Detach
          as the only control. Before D197 `d.custom_domain` was read off a
          table that had no such column, so this strip said "Not recorded" on
          every licence that has ever existed. */}
      <div
        className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950"
        data-testid="licence-domain-strip"
      >
        <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-gray-500 dark:text-gray-400">Domain</div>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field
            label="Platform host"
            // THE HOST MEMBERS ACTUALLY USE, and it is never blank while a
            // licence is deployed — S17's "a licence never waits on DNS" is
            // only true because this column exists.
            value={d.deployment_available === false ? null : (d.deployment?.hostname || null)}
            hint={d.deployment_available === false
              ? 'The deployment registry could not be read.'
              : d.deployment ? null : 'No branch is deployed for this licence yet.'}
          />
          <Field
            label="Custom host"
            value={d.domain_available === false ? null : (d.domain?.hostname || null)}
            hint={d.domain_available === false
              ? d.domain_reason
              : d.domain ? null : 'The Admin has bound none. HQ does not add one.'}
          />
          <Field
            label="State"
            value={d.domain_available === false ? null : (d.domain?.state || null)}
            hint={d.domain?.state === 'verified' ? 'Both records confirmed' : null}
          />
          <Field
            label="Certificate"
            // NOT A DATE, AND NOT "PENDING". Issuing one needs a Cloudflare for
            // SaaS custom hostname that is not configured, so there is no
            // certificate and no queue it is waiting in. The server writes the
            // reason; printing a date here would be the invented figure this
            // strip existed to avoid.
            value={null}
            hint={d.domain?.serves_reason
              || 'No certificate is issued for a custom host, and none is pending.'}
          />
          <Field
            label="Primary"
            // `is_primary` exists and nothing writes 1: a host members are sent
            // to has to serve first. Saying so beats a "No" that reads like a
            // choice somebody made.
            value={null}
            hint="No custom host is primary. Members are on the platform host."
          />
        </div>
        <p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
          Status only — the records live in the tenant&rsquo;s own zone. The Admin binds the hostname in
          Settings → Domain, including a white-label. HQ does not set a CNAME, a certificate, or a
          fallback host, and Super Admin stays on axal.vc and app.axal.vc.
        </p>
        {/* DETACH IS DRAWN ONLY WHEN THERE IS A HOST TO DETACH, and never on a
            row Super Admin has already detached — both would 409, and a button
            that can only refuse is the `still_an_admin` mistake D134 named. */}
        {d.domain && d.domain.state !== 'detached' && (
          <form
            className="mt-2 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setDetachErr('');
              api.licenceDomainDetach(d.uid, detachReason)
                .then(() => { setDetachReason(''); refresh(); })
                .catch((e2) => {
                  reportError('licence_domain_detach_failed', e2);
                  setDetachErr(e2?.data?.error || e2?.message || 'The detach did not go through, and the host is unchanged.');
                })
                .finally(() => setBusy(false));
            }}
          >
            <input
              value={detachReason}
              onChange={(e) => setDetachReason(e.target.value)}
              placeholder="Why this host is being detached (≥10 characters)"
              className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
            />
            <button
              type="submit"
              disabled={detachReason.trim().length < 10 || busy}
              className="rounded border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 disabled:opacity-40 dark:border-rose-800 dark:text-rose-300"
              data-testid="licence-domain-detach"
            >
              Detach
            </button>
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              The operator is sent this reason, and the host stays claimed so nobody else can take it.
            </span>
            {detachErr && (
              <p className="w-full text-[11px] text-rose-700 dark:text-rose-300" data-testid="licence-domain-detach-error">
                {detachErr}
              </p>
            )}
          </form>
        )}
        {d.domain?.state === 'detached' && (
          <p className="mt-2 text-[11px] leading-relaxed text-rose-700 dark:text-rose-300" data-testid="licence-domain-detached">
            Detached{d.domain.detached_at ? ` ${String(d.domain.detached_at).slice(0, 10)}` : ''}.
            {d.domain.detach_reason ? ` ${d.domain.detach_reason}` : ''} The hostname stays claimed, so
            re-binding it is not something the operator can do from their side.
          </p>
        )}
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
        {/* Unnumbered, because none is a step of the issue flow — one is the
            append-only record of what the flow did, one is who runs the
            subsidiary afterwards, and one is a compliance notice served months
            later. The brand kit is unnumbered for a different reason: it is
            drawn only for the kind that has one. */}
        {d.kind === 'white_label' && (
          <button
            type="button" onClick={() => setStep(BRAND_STEP)}
            data-testid="licence-brand-tab"
            className={`-mb-px border-b-2 px-3 py-2 text-xs ${
              step === BRAND_STEP ? 'border-indigo-600 font-medium text-indigo-700' : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Brand kit
          </button>
        )}
        <button
          type="button" onClick={() => setStep(ADMINS_STEP)}
          className={`-mb-px border-b-2 px-3 py-2 text-xs ${
            step === ADMINS_STEP ? 'border-indigo-600 font-medium text-indigo-700' : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          Administrators
        </button>
        <button
          type="button" onClick={() => setStep(NOTICES_STEP)}
          className={`-mb-px border-b-2 px-3 py-2 text-xs ${
            step === NOTICES_STEP ? 'border-indigo-600 font-medium text-indigo-700' : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          Notices
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
          <div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Legal entity" value={d.legal_entity_name} />
              <Field label="Brand name in product" value={d.brand_name} />
              <Field label="Registered address" value={d.registered_address} />
              <Field label="Signatory"
                value={d.signatory_name ? `${d.signatory_name}${d.signatory_title ? ` · ${d.signatory_title}` : ''}` : null} />
            </div>
            {/* D198 — the brand kit moved to its own tab and is drawn only for a
                white-label. What stays here is the one sentence Entity needs:
                which brand this licence trades under, and who decides it. */}
            <p className="mt-4 max-w-2xl text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
              {d.kind === 'white_label'
                ? 'This is a white-label licence, so the operator trades under their own brand. '
                  + 'The mark and the colours are on the Brand kit tab; HQ captures them because a '
                  + 'licence is issued before anybody is named on it, and HQ does not approve them.'
                : 'This is an Axal subsidiary, so it trades under Axal\u2019s brand. That brand is '
                  + 'fixed and is not stored per licence, which is why there is no brand-kit tab '
                  + 'here \u2014 only a white-label licence has one of its own.'}
            </p>
          </div>
        )}
        {step === 2 && <TerritoryEditor licence={d} held={held} onSaved={refresh} />}
        {step === 3 && <SeatEditor licence={d} onSaved={refresh} />}
        {step === 4 && <TermsEditor licence={d} onSaved={refresh} />}
        {step === 5 && <ContractStep licence={d} onSaved={refresh} />}
        {step === 6 && <DeployStep licence={d} />}
        {step === ADMINS_STEP && <AdminsEditor licence={d} onSaved={refresh} />}
        {step === NOTICES_STEP && <NoticesEditor licence={d} onSaved={refresh} />}
        {/* The kind is re-checked here as well as on the tab: the tab is what an
            operator clicks, and this is what decides what renders. A licence
            whose kind changed while the tab was open falls back to nothing
            rather than to an editor for a store its kind has no row in. */}
        {step === BRAND_STEP && d.kind === 'white_label'
          && <BrandKitEditor licence={d} onSaved={refresh} />}
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
/**
 * SORT MODES, and why `state` is the one that ships selected (D146). The canvas
 * draws the control with the first segment styled as chosen, and that is the
 * segment labelled "By state" — so this changes the order the grid opens in,
 * which is a visible change and is meant to be. Grouping is what makes the
 * white space countable at a glance; A–Z is one click away and is the order
 * `coverageCells()` already emits.
 */
const COVERAGE_SORTS = [
  { key: 'state', label: 'By state' },
  { key: 'az', label: 'A–Z' },
];

function Coverage({ items, onOpen }) {
  const { cells, held_active: active, held_suspended: suspended, free, outside_eu: outside } =
    useMemo(() => coverageCells(items), [items]);
  const [sort, setSort] = useState('state');
  const ordered = useMemo(() => sortCells(cells, sort), [cells, sort]);
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
        {/* The sort control, on SecurityPage's HQ filter-chip shape: same tier,
            same oxblood accent, `aria-pressed` carrying the state so the choice
            is readable to a screen reader and not only to the eye. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5" data-testid="hq-coverage-sort">
          {COVERAGE_SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSort(s.key)}
              aria-pressed={sort === s.key}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${
                sort === s.key
                  ? 'border-rose-200 bg-rose-50 text-[#881337] dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200'
                  : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5">
          {ordered.map((c) => {
            const cls = `rounded-md border px-1.5 py-1 text-center ${tone[c.state]}`;
            const label = c.licence
              ? `${c.name} — ${c.licence.licence_ref} (${c.licence.status})`
              : `${c.name} — available`;
            const body = (
              <>
                <div className="text-[12px] font-bold tabular-nums">{c.code}</div>
                <div className="truncate text-[9.5px] leading-tight">
                  {c.licence ? c.licence.licence_ref : '—'}
                </div>
              </>
            );
            // A HELD CELL OPENS ITS LICENCE; WHITE SPACE STAYS A DIV. There is
            // nothing to open behind a country nobody holds, and a button that
            // refuses is the `still_an_admin` mistake D134 named — it teaches
            // the operator that some of this grid's controls are a lie.
            return c.licence ? (
              <button
                key={c.code}
                type="button"
                onClick={() => onOpen?.(c.licence.uid)}
                title={label}
                data-testid={`coverage-${c.code}`}
                data-state={c.state}
                className={`${cls} hover:brightness-95`}
              >
                {body}
              </button>
            ) : (
              <div
                key={c.code}
                title={label}
                data-testid={`coverage-${c.code}`}
                data-state={c.state}
                className={cls}
              >
                {body}
              </div>
            );
          })}
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
  const [form, setForm] = useState({ licence_ref: '', legal_entity_name: '', brand_name: '', kind: 'subsidiary' });
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
      const payload = {
        licence_ref: form.licence_ref,
        legal_entity_name: form.legal_entity_name,
        brand_name: form.brand_name,
        // Step 1 of H26. Migration 279 gave the ledger its kind column, so the
        // refusal that used to sit above this is gone rather than reworded:
        // the reason it gave stopped being true.
        kind: form.kind,
      };
      const r = await api.licenceCreate(payload);
      setCreating(false);
      setForm({ licence_ref: '', legal_entity_name: '', brand_name: '', kind: 'subsidiary' });
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

      {/* `setSel` is the same selector the licence rows below use, so a click on
          a held country and a click on its row land in exactly one place. */}
      <Coverage items={items} onOpen={setSel} />

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
          <div className="mb-3" data-testid="licence-kind">
            <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-gray-500">Kind</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {[
                ['subsidiary', 'Axal subsidiary'],
                ['white_label', 'White-label operator'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, kind: id }))}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    form.kind === id
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200'
                      : 'border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
              {form.kind === 'white_label'
                ? 'Same subsidiary console, their brand, no HQ brand desk. Members land on a platform host at activation; their admin binds a custom one later, in Settings → Domain. Super Admin stays on axal.vc.'
                : 'Axal-branded territory. They still bind their own host in Admin Settings → Domain. Super Admin stays on axal.vc and app.axal.vc.'}
            </p>
          </div>
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
          <button
            type="submit"
            className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
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
                  <span className="flex items-center gap-1.5">
                    {/* D198 / H28 — "a white-label row shows its public name and
                        its own mark, never the Axal wordmark". The mark on a ROW
                        is the operator's own colour, not their logo: a row is a
                        line of text and an image in it would either be too small
                        to identify or too big to be a row. A subsidiary gets no
                        swatch at all, because its brand is Axal's and drawing a
                        chip of it here would say the opposite. */}
                    {l.kind === 'white_label' && l.brand_kit?.primary_hex && (
                      <span
                        data-testid="licence-row-swatch"
                        aria-hidden="true"
                        className="inline-block h-3 w-3 shrink-0 rounded-sm border border-black/10"
                        style={{ backgroundColor: l.brand_kit.primary_hex }}
                      />
                    )}
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{l.brand_name}</span>
                  </span>
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
