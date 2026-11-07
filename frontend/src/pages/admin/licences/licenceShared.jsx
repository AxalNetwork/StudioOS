/**
 * #4707 — what every part of the HQ licence page shares: the status and notice
 * tones, the seat types, the step numbers, residency choices, and the two
 * small presentational pieces (`Chip`, `Field`). Moved here from
 * `AdminLicences.jsx` unchanged when the page was split by domain.
 */
import React from 'react';

export const UNAVAILABLE = Symbol('unavailable');

export const SEAT_TYPES = [
  { k: 'founder', label: 'Founder' },
  { k: 'investor', label: 'Investor / LP' },
  { k: 'advisor', label: 'Advisor' },
  { k: 'partner', label: 'Service partner' },
];

export const STATUS_TONE = {
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
export const STEPS = ['Entity', 'Territory', 'Seats', 'Terms', 'Contract', 'Deploy'];
export const HISTORY_STEP = STEPS.length + 1;
// D134 — also unnumbered, and for the same reason History is: appointing an
// administrator is not a step of the issue flow. A licence can be issued,
// activated and deployed with nobody named on it, and an administrator can be
// changed years later without any of the six steps running again.
export const ADMINS_STEP = STEPS.length + 2;
// D136 — the third unnumbered tab, and the same argument a third time. Issuing a
// compliance notice is something HQ does to a licence that has been running for
// months; putting it in the numbered flow would say a licence cannot be issued
// without one.
export const NOTICES_STEP = STEPS.length + 3;
// D198 — the fourth unnumbered tab, and the argument is H26's own rather than
// the previous three's. It is unnumbered for a REASON THE CANVAS FORCES: H26
// calls the brand kit "Step 6" and says in the same header "Unique to this
// kind · an Axal subsidiary never sees this step". A numbered step that only
// some licences have would renumber the flow per licence, and two tests pin
// the six as six (`licence_admins_ui_d134.test.mjs`, `hq_licences_h2h3`).
// H26's "Step 6" is its own seven-step strip — which begins with Kind, and
// Kind is not one of this page's STEPS either.
export const BRAND_STEP = STEPS.length + 4;
// D801 — the terms schedule (D797), unnumbered like the tabs above: it is the
// contract's schedule, edited whenever the terms change, not a step of the issue.
export const SCHEDULE_STEP = STEPS.length + 5;
// D802 (#2238) — invoicing the annual fee happens every year a licence runs,
// not once in the issue flow, so it is unnumbered too.
export const FEE_INVOICES_STEP = STEPS.length + 6;

// The ladder's own statuses, which are NOT licence statuses. `STATUS_TONE` above
// covers `active`/`suspended`/`terminated`/`draft`/`pending_activation` and none
// of the six below is in it — a notice reusing that map would fall through to
// the `draft` grey and render `overdue` as the calmest thing on the screen.
//
// The two FREEZING statuses (`overdue`, `rejected`, per `util/authErrors.ts`)
// are the two in rose, because what they have in common is not their position in
// the sequence — it is that the account cannot write.
export const NOTICE_TONE = {
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
export const RESPOND_DAYS = { min: 1, max: 90, def: 14 };

// Residency, exactly as Cloudflare offers it (A.4, D.1). `eu` is the only
// guarantee on D1; a hint is a hint, and there is no in-country option outside
// the EU — which the step says rather than leaving someone to discover it.
export const D1_JURISDICTIONS = [
  { v: 'eu', label: 'EU — guaranteed' },
  { v: 'none', label: 'No jurisdiction — region-hinted only' },
];
export const LOCATION_HINTS = [
  { v: 'none', label: 'No hint' },
  { v: 'weur', label: 'Western Europe' },
  { v: 'eeur', label: 'Eastern Europe' },
  { v: 'enam', label: 'Eastern North America' },
  { v: 'wnam', label: 'Western North America' },
  { v: 'apac', label: 'Asia-Pacific' },
  { v: 'oc', label: 'Oceania' },
];
export const DO_JURISDICTIONS = [
  { v: 'none', label: 'No jurisdiction' },
  { v: 'eu', label: 'EU' },
  { v: 'us', label: 'US' },
];

// The workflow's charset, and never `hq`: HQ's own code in the metrics store (D211).
export const BRANCH_CODE_RE = /^(?!hq$)[a-z][a-z0-9-]{1,15}$/;

export const n0 = (n) => Number(n || 0).toLocaleString();

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

export const fee = (cents, currency) => (cents === null || cents === undefined
  ? null
  : `${currency || ''} ${(Math.round(Number(cents)) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`.trim());

// D138 — `toUtcInstant` and `daysTo` moved to `lib/notices.js`. They were
// exported from this PAGE for their test, and `HqTeamTable.jsx` needs the same
// normalisation: `admin_notices` stamps are SQL `YYYY-MM-DD HH:MM:SS`, which
// V8 reads as the READER'S LOCAL time and other engines reject. Importing one
// page's export from another page is what `lib/README.md` exists to prevent.

export function Chip({ children, tone }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone || STATUS_TONE.draft}`}>
      {children}
    </span>
  );
}

export function Field({ label, value, hint }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-0.5 text-sm text-gray-900 dark:text-gray-100">{value ?? <span className="text-gray-400">Not recorded</span>}</div>
      {hint && <div className="mt-0.5 text-[11px] text-gray-500">{hint}</div>}
    </div>
  );
}
