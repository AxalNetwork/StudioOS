/** D1078: the member’s requirements, agreements, verifications and data. */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import MemberOverview, { MemberUnreadable } from './trust/MemberOverview';
import RequirementDialog from './trust/RequirementDialog';
import MemberData from './trust/MemberData';
import { memberRequirements, requirementCounts, REQUIREMENTS } from './trust/memberTrustModel';
import {
  ShieldCheck, Lock, FileText, CheckCircle2, Loader2,
  Globe, IdCard, Building2, BadgeCheck, FileSignature,
  Link2 as LinkIcon,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { isSuperAdminUser, branchOfUser } from '../lib/shellRole';
import { api, getActiveCompanyId } from '../lib/api';
import { safeReadJSON } from '../lib/storage';
import { usePhoneWidth } from '../ui/phone/usePhoneWidth';
import { AccountPhonePage, phonePending } from './account/AccountPhonePage';
import {
  collapseEnvelopeHistory, envelopeEventLabel, envelopeEventTone,
  envelopeEventWhen, NO_ENVELOPE_HISTORY_NOTE,
} from '../lib/trustCenter';

// D1073 — seedObligations waives legacy KYC rows for every non-investor.
// A legacy row, even one still pending, must not invent a required Identity tab.
const KYC_ELIGIBLE_ROLES = new Set(['investor']);

// ---------------------------------------------------------------------------
// Obligation key → human label + which tab the obligation lives under.
// Keep in sync with `obligationsForRole()` on the worker side.
// ---------------------------------------------------------------------------
const OBLIGATION_META = {
  tos_v1:               { label: 'Terms of Service',           tab: 'overview' },
  privacy_v1:           { label: 'Privacy Policy',             tab: 'overview' },
  founder_nda_v1:       { label: 'Founder NDA',                tab: 'agreements' },
  investor_nda_v1:      { label: 'Investor NDA',               tab: 'agreements' },
  mentor_nda_v1:        { label: 'Advisor NDA',                 tab: 'agreements' },
  mentor_disclaimer_v1: { label: 'Advisor disclaimer',          tab: 'agreements' },
  partner_msa_v1:       { label: 'Partner MSA',                tab: 'agreements' },
  kyc_v1:               { label: 'Identity verification (KYC)', tab: 'identity' },
  kyb_v1:               { label: 'Entity verification (KYB)',   tab: 'entity' },
  accreditation_v1:     { label: 'Accreditation evidence',      tab: 'accreditation' },
};

// ---------------------------------------------------------------------------
// Status → severity tone.
//
// This replaces a status → CSS-class map, and the difference is not cosmetic.
// That map enumerated eleven statuses and the platform writes more than eleven:
// `active`, `revoked` and `cancelled` are all real `pairwise_ndas.status`
// values (trust.ts:708 branches on the first two by name) and NONE of them was
// listed, so all three fell through to the `unverified` grey. An ACTIVE NDA —
// signed, in force — and a REVOKED one rendered in exactly the same neutral
// grey as an agreement nobody had started. Two opposite ends of the spectrum,
// drawn identically.
//
// Mapping to four TONES instead of eleven classes does not by itself fix that;
// the canvas this restyle came from has the same hole (its toneOf lists
// satisfied/signed/verified/clear/none and misses active, revoked, cancelled
// and waived). What fixes it is deriving the map from the vocabulary the
// worker actually writes and then GUARDING it: trust_center_contract.test.mjs
// parses the status literals out of routes/trust.ts and fails if one of them
// has no tone here. A status the platform can produce but this file has never
// heard of is the defect; the test is what keeps it from recurring.
//
// `waived` is deliberately `ok`, not neutral. computeTrustScore counts waived
// alongside satisfied, so a grey pill beside a green score said two different
// things about the same row. The pill still reads "waived", so the reader can
// tell a waiver from a completion — it is the TONE that has to agree with the
// score, not the word.
const STATUS_TONE = {
  // legal_obligations.status — the obligation matrix behind /trust/me
  satisfied:     'ok',
  waived:        'ok',
  pending:       'prog',
  in_review:     'prog',
  expired:       'bad',
  // pairwise_ndas.status — the Agreements tab
  signed:        'ok',
  active:        'ok',
  revoked:       'bad',
  cancelled:     'bad',
  // The first Trust Center's vocabulary — rows written before v2 still carry it
  verified:      'ok',
  self_attested: 'prog',
  rejected:      'bad',
  not_started:   'neutral',
  unverified:    'neutral',
};

const TONE = {
  ok: {
    pill: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800',
    bar: 'border-l-emerald-500',
    // v2's score panel: the ring stroke and the card edge. Separate keys
    // rather than rewriting `bar` at the call site — a class name built by
    // string surgery is invisible to Tailwind's scanner and ships unstyled.
    ring: 'stroke-emerald-500',
    edge: 'border-emerald-200 dark:border-emerald-900',
  },
  prog: {
    pill: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800',
    bar: 'border-l-amber-500',
    ring: 'stroke-amber-500',
    edge: 'border-amber-200 dark:border-amber-900',
  },
  bad: {
    pill: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-950 dark:text-red-200 dark:border-red-800',
    bar: 'border-l-red-500',
    ring: 'stroke-red-500',
    edge: 'border-red-200 dark:border-red-900',
  },
  neutral: {
    pill: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600',
    bar: 'border-l-slate-300 dark:border-l-slate-600',
  },
};

function toneOf(status) {
  return STATUS_TONE[String(status || '').toLowerCase()] || 'neutral';
}

/**
 * A date is not a state. `expires 3/14/2027` reads the same whether it is two
 * years out or lapsed last month, which is how an EXPIRED obligation could sit
 * in the list looking like any other row. This says what the date means.
 *
 * `expires_at` has always been on the wire from /trust/me — it was rendered,
 * just not interpreted.
 */
function expiryNote(iso, now = new Date()) {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const days = Math.round((at - now) / 86400000);
  if (days < 0) {
    const n = -days;
    return { text: `Expired ${n} ${n === 1 ? 'day' : 'days'} ago`, tone: 'bad' };
  }
  if (days <= 30) {
    return { text: `Expires in ${days} ${days === 1 ? 'day' : 'days'}`, tone: 'prog' };
  }
  return { text: `Expires ${at.toLocaleDateString()}`, tone: 'neutral' };
}

function StatusPill({ status }) {
  const t = TONE[toneOf(status)];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${t.pill}`}>
      {status ? String(status).replace(/_/g, ' ') : 'Not recorded'}
    </span>
  );
}

/**
 * The last four of an identity document number, and nothing more.
 *
 * `GET /kyc/status` runs its payload through `publicKycData` (`kyc.ts:40-54`),
 * which strips the document BYTES and spreads everything else — so `id_number`
 * arrives in full. That is fine for the form at `/kyc`, which the holder opened
 * deliberately to edit it. It is not fine here: this is a status page, often the
 * first thing on screen, and a passport or national ID number printed on it is a
 * disclosure the page has no reason to make. The canvas draws `•••• 4471` and is
 * right to.
 *
 * Masked in the CLIENT, deliberately: the value still crosses the wire, so this
 * is a display decision and not a claim that the number is protected. Masking it
 * server-side would be the stronger fix and is a separate change — the form at
 * `/kyc` needs the full value to prefill.
 */
function maskIdNumber(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const tail = s.slice(-4);
  return tail.length === s.length ? s : `•••• ${tail}`;
}

/**
 * One read-only field. A value the platform does not hold reads "Not recorded",
 * on an amber card — never blank, and never a plausible-looking placeholder.
 *
 * The canvas says "Not provided", which is subtly a claim about the USER (they
 * did not provide it). "Not recorded" is a claim about the PLATFORM, which is
 * the only one this page can actually stand behind: a value can be absent
 * because it was never asked for, because a legacy record predates the field, or
 * because the read failed. The page cannot tell those apart, so it does not try.
 */
function ReadOnlyField({ label, value }) {
  const missing = value == null || value === '';
  return (
    <div className={`rounded-lg border px-3.5 py-3 ${missing
      ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40'
      : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50'}`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1 text-sm ${missing
        ? 'text-amber-700 dark:text-amber-300'
        : 'text-slate-900 dark:text-slate-100'}`}
      >
        {missing ? 'Not recorded' : value}
      </div>
    </div>
  );
}

/**
 * Says where a value is edited, on a page that edits nothing.
 *
 * This is the whole point of the Trust Center v2 canvas and the reason `/trust`
 * did not match it: the page used to render an editable KYC form inline, so it
 * was two things at once — a status report and a submission surface. The canvas
 * splits them, and the split is worth having: a page that only reports can be
 * read without fear of changing anything.
 *
 * The link goes to `/kyc`, which is where the form actually is, rather than to
 * Settings, which merely links onward to it (`SettingsPage.jsx:1050`). The
 * canvas's label says "Account Settings"; naming the destination the reader
 * actually lands on beats matching the canvas's wording.
 */
function ManagedElsewhere({ children, href = '/kyc', cta = 'Open identity verification →' }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
      <Lock className="w-3.5 h-3.5 flex-none" />
      <span>{children}</span>
      <a href={href} className="font-semibold text-violet-700 underline hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200">
        {cta}
      </a>
    </div>
  );
}

/** A titled grid of read-only fields. */
function FieldGrid({ title, fields }) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</div>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => <ReadOnlyField key={f.label} label={f.label} value={f.value} />)}
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, subtitle, children }) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-6 mb-6 shadow-sm">
      <div className="flex items-start gap-3 mb-4">
        <Icon className="w-6 h-6 text-emerald-600 mt-0.5" />
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          {subtitle && <p className="text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// KybCard, AccreditationCard and NdaCard USED TO LIVE HERE.
//
// The first two were unreachable: each rendered only on the true branch of
// `legacy?.kyb ? …` / `legacy?.accreditation ? …`, and `legacy` came from
// GET /trust/summary, which answered both as literal nulls. Their dead
// endpoints (POST /trust/kyb/submit, GET /trust/kyb/status, the four
// /trust/accreditation/* paths) were never routed; the components, their
// client methods and six drift-baseline entries went together.
//
// NdaCard was reachable and was the one signing path for a role NDA. It drew
// a second list of the same obligations the Role agreements section drew
// above it (the template-NDA card), and only that copy offered "Open to sign".
// D432 folds it: the Role agreements rows now carry the button, through
// `OpenToSignButton` below, fed by the same GET /trust/nda/required the card
// read. One list, one action.
//
// POST /trust/kyb/start and GET /trust/summary are retired with D432 (nothing
// called either; their client methods startKyb and getTrustSummary had no caller). The
// gap they did not fill stays recorded on the worker: a partner seeded a
// required kyb_v1 once changed to in_review on a click without evidence.
// D1073 retires that generic Start transition; real evidence submission
// remains responsible for review status. kyb_v1 has no working satisfier either
// (cloudflare-worker/test/obligation_satisfiable.test.ts).
//
// Accreditation evidence has no upload route on either side, so the tab says
// that rather than drawing a file input that cannot POST.

/**
 * The one signing path for a role NDA, drawn on its Role agreements row.
 *
 * The worker signs by ENVELOPE, not by role, and returns a link into the
 * e-sign flow rather than accepting a typed name — so an in-page signature
 * ceremony was never the shape. `api.trustMySigningUrl` already reaches that
 * route and is what the pairwise rows use too. A recipient row can exist
 * without a live token, so each refusal says which, rather than failing
 * silently on a button that looked like it would work.
 */
function OpenToSignButton({ item, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function openSigning() {
    setErr(null); setBusy(true);
    try {
      const res = await api.trustMySigningUrl(item.evidence_envelope_uuid);
      if (res?.signing_url) { window.location.href = res.signing_url; return; }
      setErr(res?.status === 'expired'
        ? 'That signing link has expired. Ask the sender to re-issue it.'
        : res?.status === 'signed'
          ? 'This one is already signed — reload to refresh the list.'
          : 'No signing link is available for this agreement yet.');
      onChanged?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={openSigning}
        disabled={busy}
        data-testid={`open-to-sign-${item.obligation_key}`}
        className="text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white min-h-11 px-3 py-2 rounded inline-flex items-center gap-1.5"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
        Open to sign
      </button>
      {err && <span className="text-red-600 dark:text-red-400 text-xs">{err}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Obligation list — generic renderer used on every tab.
// ---------------------------------------------------------------------------
function EnvelopeHistory({ envelopeUuid }) {
  const [state, setState] = useState({ phase: 'loading', events: [], error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ phase: 'loading', events: [], error: null });
    api.trustAgreementHistory(envelopeUuid)
      .then(res => {
        if (!live) return;
        setState({ phase: 'ready', events: collapseEnvelopeHistory(res?.history || []), error: null });
      })
      .catch(e => {
        if (!live) return;
        // A failed read is stated as a failed read. An empty timeline here
        // would say "nothing ever happened to this envelope", which is a
        // different and much worse claim.
        setState({ phase: 'error', events: [], error: e?.message || 'Could not load this envelope’s history' });
      });
    return () => { live = false; };
  }, [envelopeUuid, attempt]);

  return (
    <div className="mt-2 border-t border-slate-200 dark:border-slate-700 pt-3 pl-7">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2.5">
        Envelope history
      </div>
      {state.phase === 'loading' && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 size={12} className="animate-spin" /> Loading…
        </div>
      )}
      {state.phase === 'error' && (
        <MemberUnreadable what="This agreement’s history" onRetry={() => setAttempt((n) => n + 1)} />
      )}
      {state.phase === 'ready' && state.events.length === 0 && (
        <div className="text-xs text-slate-500 dark:text-slate-400">{NO_ENVELOPE_HISTORY_NOTE}</div>
      )}
      {state.phase === 'ready' && state.events.map((e, i) => {
        const tone = envelopeEventTone(e.action);
        const last = i === state.events.length - 1;
        const when = envelopeEventWhen(e.at);
        return (
          // NOT `items-start`. The dot column is a flex column whose connector
          // is `flex-1`, and under `items-start` the column shrinks to the
          // dot and the line resolves to zero height — the timeline rendered
          // as four loose dots. Stretching is the default; saying nothing is
          // the fix.
          <div key={`${e.action}-${e.at}-${i}`} className="flex gap-2.5">
            <div className="flex flex-none flex-col items-center">
              <span className={`mt-1.5 h-2 w-2 rounded-full ${
                tone === 'bad' ? 'bg-red-500'
                  : last ? 'bg-violet-600 dark:bg-violet-400'
                    : 'bg-slate-300 dark:bg-slate-600'}`} />
              {/* The connector stops at the last dot — a line trailing past
                  the final event would imply something is still to come. */}
              {!last && <span className="w-px flex-1 bg-slate-200 dark:bg-slate-700" />}
            </div>
            <div className="min-w-0 pb-3">
              <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                {envelopeEventLabel(e.action)}
                {e.count > 1 && (
                  <span className="ml-1 font-semibold text-slate-500 dark:text-slate-400">×{e.count}</span>
                )}
              </div>
              {/* No time rather than "Invalid Date" — the row still records
                  that the event happened. */}
              {when && <div className="mt-0.5 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">{when}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * `rowAction(o)` lets a tab put its own control on a row — the Role
 * agreements section uses it for "Open to sign" (D432) — without changing status.
 * Null means the row gets nothing extra.
 */
function ObligationList({ obligations, emptyText, rowAction = null }) {
  if (!obligations.length) {
    return <p className="text-sm text-slate-600">{emptyText || 'Nothing required for this section.'}</p>;
  }
  return (
    <ul className="space-y-2">
      {obligations.map(o => {
        const meta = OBLIGATION_META[o.obligation_key] || { label: o.obligation_key };
        const exp = expiryNote(o.expires_at);
        return (
          <li
            key={o.obligation_key}
            data-testid={`requirement-${o.obligation_key}`}
            className={`flex items-center justify-between bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 border-l-4 ${TONE[toneOf(o.status)].bar} rounded px-3 py-2`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <FileText size={16} className="text-slate-500 dark:text-slate-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm text-slate-900 dark:text-slate-100 truncate">{meta.label}</div>
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  {o.required ? 'Required' : 'Optional'}
                  {exp ? ' · ' : ''}
                  {exp && (
                    <span className={exp.tone === 'bad'
                      ? 'text-red-700 dark:text-red-300 font-medium'
                      : exp.tone === 'prog' ? 'text-amber-700 dark:text-amber-300 font-medium' : ''}>
                      {exp.text}
                    </span>
                  )}
                </div>
                {/* PROVENANCE — Trust Center v2 draws "where this status came
                    from" under every row. `source` is derived server-side from
                    `evidence_meta` / `evidence_envelope_uuid`; it is null for a
                    row nothing has satisfied, and a row with no evidence shows
                    no line rather than a filler claim about its origin. */}
                {o.source && (
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <LinkIcon size={11} className="shrink-0" aria-hidden="true" />
                    <span className="truncate">{o.source}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StatusPill status={o.status} />
              {rowAction ? rowAction(o) : null}

            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Agreements tab — pairwise NDAs touching the caller (both directions).
// ---------------------------------------------------------------------------
function PairwiseSignButton({ envelopeUuid }) {
  const [state, setState] = useState('idle'); // idle | loading | unavailable
  const [err, setErr] = useState(null);
  async function go() {
    setErr(null); setState('loading');
    try {
      const r = await api.trustMySigningUrl(envelopeUuid);
      if (r?.signing_url) {
        // Use a hard nav so the eSign page receives a clean route +
        // can capture its own auth state.
        window.location.assign(r.signing_url);
        return;
      }
      setState('unavailable');
    } catch (e) {
      setErr(e?.message || 'Failed');
      setState('idle');
    }
  }
  if (state === 'unavailable') {
    return <span className="text-[11px] text-slate-500">Already signed or expired</span>;
  }
  return (
    <button
      onClick={go}
      disabled={state === 'loading'}
      className="text-xs bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white min-h-11 px-3 py-2 rounded inline-flex items-center gap-1"
      title="Open the signing page for this NDA"
    >
      {state === 'loading' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
      Sign
      {err && <span className="text-red-200 ml-1">·{err}</span>}
    </button>
  );
}

/**
 * Who the other party is, by name. The worker joins `users` for both sides
 * (D432: `party_a_name` / `party_b_name` beside the emails it already sent),
 * so a row reads "Mutual NDA · Marisol Vega" to a party and
 * "Novacraft Labs ↔ Marisol Vega" to an admin, as the canvas draws it, rather
 * than "parties #12 ↔ #40". A party whose account is gone is said to be gone
 * rather than given a made-up name.
 */
function partyLabel(row, side) {
  const name = row[`party_${side}_name`];
  const email = row[`party_${side}_email`];
  if (name) return name;
  if (email) return email;
  return `account #${row[`party_${side}_user_id`]} · removed`;
}

function pairwiseTitle(row, meId, isAdmin) {
  if (isAdmin) return `${partyLabel(row, 'a')} ↔ ${partyLabel(row, 'b')}`;
  const other = Number(row.party_a_user_id) === Number(meId) ? 'b' : 'a';
  return `Mutual NDA · ${partyLabel(row, other)}`;
}

function AgreementsTab({ obligations, role, requiredNdas = [], onChanged }) {
  const [items, setItems] = useState([]);
  const [pending, setPending] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  // One row open at a time, as the canvas draws it. Keyed by envelope uuid
  // rather than by pair id so the open row survives a `reload()` that
  // renumbers nothing but re-fetches everything.
  const [expandedEnvelope, setExpandedEnvelope] = useState(null);
  const [documentsFailed, setDocumentsFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const isAdmin = role === 'admin';

  async function reload() {
    setErr(null); setLoading(true); setDocumentsFailed(false);
    try {
      // Admin's platform-wide list belongs in Contracts. Members keep only
      // their own pairs; other contracts always remain scoped to the caller.
      const [pairs, agree] = await Promise.allSettled([
        api.trustListPairwiseNdas(),
        api.trustAgreements(),
      ]);
      if (pairs.status === 'fulfilled') {
        setItems(pairs.value?.items || []);
      } else {
        setItems([]);
        setErr('Your agreements with other members could not be read.');
      }
      if (agree.status === 'fulfilled') {
        setPending(agree.value?.pending_envelopes || []);
        setDocuments(agree.value?.documents || []);
      } else {
        setPending([]); setDocuments([]); setDocumentsFailed(true);
      }
    } catch (e) {
      setErr('Your agreements could not be read.'); setDocumentsFailed(true);
    } finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const ndaObligations = obligations.filter(o => OBLIGATION_META[o.obligation_key]?.tab === 'agreements');
  // D432 — the template-NDA card is folded into these rows. GET /nda/required
  // says, per role NDA, whether it is still open and which envelope to sign;
  // the row draws "Open to sign" when there is an envelope and says "Not
  // issued yet" when the obligation is open but no envelope exists.
  const ndaByKey = new Map((requiredNdas || []).map((it) => [it.obligation_key, it]));
  const roleNdaAction = (o) => {
    const it = ndaByKey.get(o.obligation_key) || (o.evidence_envelope_uuid ? { ...o, open: Number(o.required) === 1 && !['satisfied', 'waived', 'in_review'].includes(o.status) } : null);
    if (!it || !it.open) return null;
    if (it.evidence_envelope_uuid) return <OpenToSignButton item={it} onChanged={onChanged} />;
    return <span className="text-xs text-slate-500 dark:text-slate-400">Not issued yet</span>;
  };
  const meId = safeReadJSON('user', {})?.id;
  const visibleItems = items.filter((r) => pairwiseTitle(r, meId, isAdmin).toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || r.status === filter)).sort((a, b) => (sort === 'oldest' ? 1 : -1) * (String(a.created_at || '').localeCompare(String(b.created_at || ''))));

  return (
    <>
      <Section icon={FileSignature} title="Role agreements" subtitle="Standing NDAs and disclosures required for your role.">
        {requiredNdas === null && <MemberUnreadable what="Your signing requirements" onRetry={onChanged} />}
        <ObligationList obligations={ndaObligations} emptyText="No role-level agreements required." rowAction={roleNdaAction} />
      </Section>
      {<Section icon={Lock} title="Agreements with other members" subtitle="Active and pending mutual NDAs between you and other parties.">
        {loading && <p className="text-sm text-slate-600">Loading…</p>}
        {err && <MemberUnreadable what="Your agreements with other members" claim="This is not a claim that none are recorded." onRetry={reload} />}
        {!loading && !err && items.length === 0 && (
          <p className="text-sm text-slate-600">No agreements with other members yet.</p>
        )}
        {!loading && !err && items.length > 0 && <div className="mb-3 flex flex-wrap gap-3">
          <label className="text-sm">Search by member <input className="ml-2 min-h-11 rounded border border-slate-300 bg-white px-2 dark:border-slate-700 dark:bg-slate-900" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
          <label className="text-sm">State <select className="ml-2 min-h-11 rounded border bg-white px-2 dark:border-slate-700 dark:bg-slate-900" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All states</option>{[...new Set(items.map((r) => r.status).filter(Boolean))].map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}</select></label>
          <label className="text-sm">Sort <select className="ml-2 min-h-11 rounded border bg-white px-2 dark:border-slate-700 dark:bg-slate-900" value={sort} onChange={(e) => setSort(e.target.value)}><option value="newest">Newest</option><option value="oldest">Oldest</option></select></label>
        </div>}
        {!loading && !err && items.length > 0 && visibleItems.length === 0 && <p className="text-sm">No recorded agreements match these filters.</p>}
        {!loading && !err && visibleItems.length > 0 && (
          <ul className="space-y-2">
            {visibleItems.map(a => {
              const validUntil = a.valid_until ? new Date(a.valid_until) : null;
              const expired = validUntil && validUntil.getTime() < Date.now();
              const voided = a.status === 'voided' || a.status === 'revoked' || !!a.voided_at;
              const display = voided ? 'revoked' : (expired ? 'expired' : a.status);
              const validExp = expiryNote(a.valid_until);
              const canSign = !voided && !expired && !['active', 'signed', 'cancelled', 'completed'].includes(a.status) && !!a.nda_envelope_uuid && !(a.signers || []).some((signer) => signer.signed_at && ((signer.user_id != null && Number(signer.user_id) === Number(meId)) || (signer.email && String(signer.email).toLowerCase() === String(safeReadJSON('user', {})?.email || '').toLowerCase())));
              // Backend computes the signer list on read (joining
              // esign_recipients) and ships it as `signers`. Fall back
              // to the legacy `signers_json` blob if the enrichment
              // step was unavailable.
              const signers = (() => {
                if (Array.isArray(a.signers)) return a.signers;
                try { return Array.isArray(a.signers_json) ? a.signers_json : JSON.parse(a.signers_json || '[]'); }
                catch { return []; }
              })();
              const open = expandedEnvelope === a.nda_envelope_uuid;
              return (
                <li
                  key={a.id}
                  className={`bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 border-l-4 ${TONE[toneOf(display)].bar} rounded px-3 py-2`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <Lock size={16} className="text-slate-500 dark:text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm text-slate-900 dark:text-slate-100 truncate" data-testid="pairwise-title">
                        {pairwiseTitle(a, meId, isAdmin)}
                      </div>
                      <div className="text-xs text-slate-500">
                        envelope {a.nda_envelope_uuid?.slice(0, 8)}…
                        {validExp ? ' · ' : ''}
                        {validExp && (
                          <span className={validExp.tone === 'bad'
                            ? 'text-red-700 dark:text-red-300 font-medium'
                            : validExp.tone === 'prog' ? 'text-amber-700 dark:text-amber-300 font-medium' : ''}>
                            {validExp.text.replace('Expires', 'Valid until').replace('Expired', 'Lapsed')}
                          </span>
                        )}
                        {signers.length > 0 ? ` · signed: ${signers.map(s => s.name || s.email).join(', ')}` : ''}
                        {voided && a.voided_reason ? ` · voided: ${a.voided_reason}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* v2's expander. Only offered where there is an envelope
                        to have a history — a pairwise row with no
                        `nda_envelope_uuid` predates the e-sign flow, and a
                        control that always answers "nothing recorded" is
                        worse than no control. */}
                    {a.nda_envelope_uuid && (
                      <button
                        type="button"
                        onClick={() => setExpandedEnvelope(open ? null : a.nda_envelope_uuid)}
                        aria-expanded={open}
                        className="flex h-6 w-6 items-center justify-center rounded border border-slate-300 text-sm font-bold leading-none text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        <span aria-hidden="true">{open ? '−' : '+'}</span>
                        <span className="sr-only">{open ? 'Hide' : 'Show'} envelope history</span>
                      </button>
                    )}
                    <StatusPill status={display} />
                    {canSign && <PairwiseSignButton envelopeUuid={a.nda_envelope_uuid} />}

                  </div>
                  </div>
                  {open && <EnvelopeHistory envelopeUuid={a.nda_envelope_uuid} />}
                </li>
              );
            })}
          </ul>
        )}
      </Section>}
      {documentsFailed && <Section icon={FileText} title="Other contracts"><MemberUnreadable what="Your other contracts" onRetry={reload} /></Section>}
      {(pending.length > 0 || documents.length > 0) && (
        <Section icon={FileText} title="Other contracts" subtitle="Pending envelopes awaiting your signature and signed documents on file.">
          {pending.length > 0 && (
            <>
              <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Awaiting your signature</h3>
              <ul className="space-y-1 mb-4">
                {pending.map(p => (
                  <li key={p.envelope_uuid} className="text-sm text-slate-700 dark:text-slate-300 flex items-center justify-between">
                    {/*
                      `document_type`, not `agreement_type`. The worker's select
                      says so in its own comment — "there is no `agreement_type`
                      column on esign_envelopes" (`trust.ts:93`) — and it has
                      never sent that key, so this label fell through to the
                      literal 'Agreement' on every pending row since it shipped.
                      The fallback stays for rows whose type really is null.
                    */}
                    <span>{p.document_type || 'Agreement'} · envelope {p.envelope_uuid?.slice(0, 8)}…</span>
                    <StatusPill status={p.status} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {documents.length > 0 && (
            <>
              <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Signed documents</h3>
              <ul className="space-y-1">
                {documents.map(d => (
                  <li key={d.id} className="text-sm text-slate-700 dark:text-slate-300 flex items-center justify-between">
                    <span>{d.title} <span className="text-xs text-slate-500">({d.doc_type})</span></span>
                    <span className="text-xs text-slate-500">{d.signed_at ? new Date(d.signed_at).toLocaleDateString() : ''}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The company's own KYB, one row per company — task #108, migration 220.
//
// D432 — HOISTED OUT OF THE PAGE'S RENDER. It was declared inside
// `TrustCenterPage`'s body, so every render of the page minted a new component
// type, React unmounted the card and mounted a fresh one, and its effect
// re-fetched GET /trust/companies/kyb on every keystroke elsewhere on the
// page. A module-level component keeps its identity and fetches once.
//
// A FAILED READ IS SAID, NOT HIDDEN. The card used to catch the error and set
// `loaded`, which drew exactly what "no companies" draws: nothing. The worker
// now refuses with a sentence (D278), and the card draws "Unreadable" with a
// retry — a member with three companies whose read failed must not be told
// they have none.
// ---------------------------------------------------------------------------
function CompanyKybCard() {
  // 'loading' → 'ready' | 'failed'. Three states because an empty list and a
  // failed read are different facts and draw differently.
  const [state, setState] = useState({ phase: 'loading', items: [], message: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((s) => (s.phase === 'failed' ? { ...s, phase: 'loading' } : s));
    api.companyKybList()
      .then((r) => { if (alive) setState({ phase: 'ready', items: r?.items || [], message: null }); })
      .catch((e) => { if (alive) setState({ phase: 'failed', items: [], message: e?.message || null }); });
    return () => { alive = false; };
  }, [attempt]);

  if (state.phase === 'loading') return <p className="text-sm text-slate-500 dark:text-slate-400">Reading your companies’ entity records…</p>;
  if (state.phase === 'failed') {
    return (
      <div className="mt-4" data-testid="company-kyb-unreadable">
        <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">Your companies</h4>
        <MemberUnreadable what="Your companies’ entity records" claim="This is not a claim that you have no companies." onRetry={() => setAttempt((n) => n + 1)} />
      </div>
    );
  }
  // NOT an empty card. Someone who belongs to no company has no company
  // entity to verify, and a row of zeroes would imply they are missing a step
  // they cannot take.
  if (!state.items.length) return null;

  // Read at render rather than held in state: the company switcher writes it
  // synchronously and this list is re-rendered by the switch, so state would
  // only add a way for the badge to lag the workspace it names.
  const activeCompanyId = getActiveCompanyId();

  return (
    <div className="mt-4" data-testid="company-kyb-card">
      <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">Your companies</h4>
      <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Each company has its own entity record. This is separate from your account&rsquo;s own
        entity above — that one is who signs your contracts, these are who the workspaces
        belong to.
      </p>
      {state.items.map((row) => (
        <div key={row.company_id} className="mt-2 flex items-start gap-3 border-t border-slate-100 py-2 dark:border-slate-800">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-slate-900 dark:text-slate-100">{row.company_name}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {row.kyb
                ? `${row.kyb.status.replace(/_/g, ' ')}${row.kyb.entity_name ? ` · ${row.kyb.entity_name}` : ''}`
                : 'Not started'}
            </div>
          </div>
          <div className="flex flex-none items-center gap-2">
            {/* v2 marks which of these rows is the workspace you are
                currently in. Without it a reader with three companies
                cannot tell which record the rest of the app is acting on.
                Compared as strings: the id arrives from localStorage as
                text and from the API as a number. */}
            {String(row.company_id) === String(activeCompanyId) && (
              <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300">
                Active workspace
              </span>
            )}
            {row.is_primary_admin
              ? <span className="text-[11px] text-slate-500 dark:text-slate-400">You administer this company</span>
              : <span className="text-[11px] text-slate-400">{row.role_in_company}</span>}
          </div>
        </div>
      ))}
      {/* This page reports; Account Settings is where an entity record is
          changed. The canvas puts the way out at the foot of the list. */}
      <a
        href="/account/companies"
        className="mt-3 inline-block text-xs font-semibold text-violet-700 hover:underline dark:text-violet-400"
      >
        Edit in Account Settings &rarr;
      </a>
    </div>
  );
}

// D1073 — administration leaves the member surface. Reuse its existing
// Section rather than putting a platform-wide list or write form here.
export function TrustAdminTools({ user: suppliedUser } = {}) {
  const { user: sessionUser } = useAuth();
  const adminUser = suppliedUser || sessionUser;
  const superAdmin = isSuperAdminUser(adminUser) && !branchOfUser(adminUser);
  return (
    <Section icon={ShieldCheck} title="Admin tools" subtitle="Platform reviews and agreements live in their admin tools.">
      <ul className="space-y-2 text-sm text-violet-700 dark:text-violet-300" data-testid="trust-admin-tools">
        <li><a className="underline" href="/admin/contracts?tab=ndas">Open Contracts · Pairwise NDAs →</a></li>
        <li><a className="underline" href="/admin/kyc">Open identity and sanctions reviews →</a></li>
      </ul>
      {superAdmin && <div className="mt-4"><h3 className="font-semibold">Public trust center</h3><p className="text-sm text-slate-600 dark:text-slate-400">Manage the public trust center in HQ Security.</p><a className="inline-flex min-h-11 items-center underline" href="/admin/security/trust-center">Edit public content</a></div>}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Tab definitions — role-gated.
// ---------------------------------------------------------------------------
function tabsForRole(role, obligations) {
  return [{ key: 'overview', label: 'Overview', icon: Globe }, { key: 'agreements', label: 'Agreements', icon: FileSignature }, { key: 'verifications', label: 'Verifications', icon: IdCard }, { key: 'data', label: 'Your data', icon: Lock }];
}

function RequirementsUnreadable({ reload }) {
  return (
    <div role="alert" data-testid="trust-read-unreadable" className="text-sm text-red-700 dark:text-red-300">
      <strong>Unreadable</strong> — Your requirements could not be read.
      <button type="button" onClick={reload} className="ml-2 underline">Try again</button>
    </div>
  );
}

export function trustPhoneGroups({ status, obligations = [], reload, onSelect }) {
  if (status === 'loading') return [{ label: 'Requirements', rows: [], note: phonePending('Reading requirements…') }];
  if (status === 'unreadable') return [{ label: 'Requirements', rows: [], note: <RequirementsUnreadable reload={reload} /> }];
  const { done, total } = requirementCounts(obligations);
  return [{ label: 'Requirements', rows: [{ title: `Requirements met: ${done} of ${total}`, description: total ? 'From your recorded required items.' : 'Nothing is asked of you right now.', testid: 'trust-phone-summary-row' }] },
    { label: 'Your requirements', rows: obligations.map((o) => ({ title: OBLIGATION_META[o.obligation_key]?.label || o.obligation_key, description: o.source || 'Evidence source not recorded.', testid: 'trust-phone-obligation', onClick: () => onSelect?.(o.obligation_key) })) }];
}

export function TrustPhoneView({ status, obligations, reload, onSelect, children = null }) {
  return (
    <AccountPhonePage pageKey="trust" testid="trust-phone" groups={trustPhoneGroups({ status, obligations, reload, onSelect })}>
      {children}
    </AccountPhonePage>
  );
}

export default function TrustCenterPage({ chromeless = false }) {
  const [matrix, setMatrix] = useState(null);   // /api/trust/me
  const [requiredNdas, setRequiredNdas] = useState([]); // /api/trust/nda/required
  const [kyc, setKyc] = useState(null);         // /api/kyc/status — READ ONLY here
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useSearchParams();
  const tab = ['overview', 'agreements', 'verifications', 'data'].includes(search.get('tab')) ? search.get('tab') : 'overview';
  const setTab = (key) => { const next = new URLSearchParams(search); next.set('tab', key); next.delete('requirement'); next.delete('member'); setSearch(next); };
  const openRequirement = (key) => { const next = new URLSearchParams(search); next.set('requirement', key); setSearch(next); };
  const closeRequirement = () => { const next = new URLSearchParams(search); next.delete('requirement'); next.delete('member'); setSearch(next, { replace: true }); };
  const [kycFailed, setKycFailed] = useState(false);

  // Task #18 — read role from /api/trust/me once it resolves so a stale
  // localStorage user (impersonation, server-side role change, signup
  // session that hasn't been refreshed) can't hide tabs the caller
  // actually qualifies for. localStorage is only consulted as a
  // first-paint fallback while the matrix is still loading; once
  // /trust/me has answered, the server is the sole source of truth.
  const cachedRole = safeReadJSON('user', {})?.role;
  const role = matrix?.role || cachedRole || 'member';

  async function load() {
    setErr(null); setLoading(true);
    try {
      // /api/trust/me is the canonical obligation matrix. Every call here is
      // resilient — we render whatever loaded successfully.
      // GET /nda/required was already being called here and its result THROWN
      // AWAY — `try { await api.getRequiredNdas(); } catch {}` — while the NDA
      // card was fed `summary.ndas`, which is pairwise_ndas rows in a different
      // shape. It is a settled promise now, and the card reads it.
      // `api.kycStatus()` is the same call `<KycVerification />` makes at
      // `/kyc`. It joins the settled set rather than getting its own effect so
      // one failed read still leaves the rest of the page standing — the
      // partial-failure resilience the contract test pins.
      // `/trust/summary` WAS A FOURTH CALL HERE AND IS GONE. Every field it
      // returned had already been repointed — role, score and obligations to
      // /trust/me, the NDA card to /nda/required — and its `kyb` and
      // `accreditation` are hardcoded null server-side, so their cards were
      // deleted. Its result was stored in a `legacy` state nothing read, which
      // meant the page paid requireAuth + ensureTrustSchema + seedObligations
      // and two D1 reads on EVERY load for a payload it discarded in full.
      const [m, n, k] = await Promise.allSettled([
        api.trustMe(),
        api.getRequiredNdas(),
        api.kycStatus(),
      ]);
      // The shared API client uses its fixed "Session expired" error for 401s.
      // Both widths distinguish an unreadable matrix from an empty one.
      if (m.status === 'fulfilled' && Array.isArray(m.value?.obligations)) setMatrix(m.value); else setMatrix({ obligations: [], role, failed: true, unauthorized: m.status === 'rejected' && (m.reason?.status === 401 || m.reason?.message === 'Session expired') });
      setRequiredNdas(n.status === 'fulfilled' ? (n.value?.items || []) : null);
      setKyc(k.status === 'fulfilled' ? k.value : null); setKycFailed(k.status !== 'fulfilled');
    } catch (e) {
      setErr('trust_unreadable');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const obligations = memberRequirements(matrix?.obligations || [], role);
  const tabs = tabsForRole(role, obligations);
  const phone = usePhoneWidth() && !chromeless;
  if (matrix?.unauthorized) return <div className="p-6 text-slate-900 dark:text-slate-100"><h1>Sign in to see what is asked of you.</h1><p>Your trust lists your own agreements, verifications and data.</p><a className="mr-5 underline" href="/login">Sign in</a><a className="underline" href="/trust">Read the public trust center</a></div>;
  if (loading) return <div className="p-8 text-slate-600 dark:text-slate-400">Reading your requirements…</div>;
  const selected = search.get('requirement');
  const selectedRow = search.has('member') ? null : obligations.find((o) => o.obligation_key === selected);
  const renderRows = (rows) => <ObligationList obligations={rows} rowAction={(o) => <button type="button" className="min-h-11 text-sm font-semibold text-violet-700 underline dark:text-violet-300" onClick={() => openRequirement(o.obligation_key)}>Details</button>} />;
  const overview = matrix?.failed || err ? <RequirementsUnreadable reload={load} /> : <MemberOverview role={role} obligations={obligations} acceptances={matrix?.acceptances} renderRows={renderRows} companies={role === 'founder' ? <CompanyKybCard /> : null} onAgreements={() => setTab('agreements')} />;

  /**
   * Identity — REPORTED, not edited.
   *
   * Task #25 embedded `<KycVerification embedded />` here, turning the tab into
   * a submission surface. Trust Center v2 splits that back apart: "Identity data
   * is managed in Account Settings · this page reports status only." This tab is
   * now the report.
   *
   * NOBODY IS STRANDED BY THE REMOVAL, which is the thing to check before taking
   * a form away. `/kyc` is still mounted (`App.jsx:2019`) and still renders the
   * same component full-page; `SettingsPage.jsx:1050` links to it, and so does
   * every callout on this tab. The form did not go away — it stopped being in
   * two places at once.
   *
   * Every field below comes from `publicKycData`. Where the canvas draws a
   * filename and an upload date for the document, this draws presence: the
   * payload carries `document_uploaded` as a boolean and nothing else, and a
   * filename nobody sent is exactly the kind of detail this pass exists to stop.
   */
  const kd = kyc?.kyc_data || null;
  const fullName = [kd?.legal_first_name, kd?.legal_last_name].filter(Boolean).join(' ') || null;
  const identity = (
    <Section
      icon={IdCard}
      title="Identity verification (KYC)"
      subtitle="Your recorded identity verification status. Requirement status comes from your requirements read."
    >
      <ManagedElsewhere>
        These values are read from your account profile. This page never edits them.
      </ManagedElsewhere>

      <ObligationList
        obligations={obligations.filter(o => OBLIGATION_META[o.obligation_key]?.tab === 'identity')}
        emptyText="Identity verification is not required for your role."

      />

      {kyc ? (
        <div className="mt-5">
          <FieldGrid
            title="Legal identity"
            fields={[
              { label: 'Legal name', value: fullName },
              { label: 'Date of birth', value: kd?.date_of_birth },
              { label: 'Nationality', value: kd?.nationality },
              { label: 'Phone', value: kd?.phone },
            ]}
          />
          <FieldGrid
            title="Residential address"
            fields={[
              { label: 'Country', value: kd?.country },
              { label: 'Address line 1', value: kd?.address_line1 },
              { label: 'City', value: kd?.city },
              { label: 'State / region', value: kd?.state_region },
              { label: 'Postal code', value: kd?.postal_code },
            ]}
          />
          <FieldGrid
            title="Government ID"
            fields={[
              { label: 'ID type', value: kd?.id_type },
              // Last four only — see `maskIdNumber`.
              { label: 'ID number', value: maskIdNumber(kd?.id_number) },
              // A boolean is all the payload carries, so a boolean is all this says.
              { label: 'Document', value: kd?.document_uploaded ? 'Uploaded' : null },
            ]}
          />
          <FieldGrid
            title="Screening & disclosure"
            fields={[
              {
                label: 'Politically-exposed-person disclosure',
                value: kd?.pep_self_disclosed === true ? 'Declared'
                  : kd?.pep_self_disclosed === false ? 'Declared: not a PEP' : null,
              },
              {
                // The platform will not screen without this, and says so rather
                // than leaving an unexplained gap in the sanctions tab.
                label: 'Sanctions screening consent',
                value: kd?.sanctions_acknowledged ? 'Granted' : null,
              },
            ]}
          />
        </div>
      ) : (
        <p className="mt-5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Your identity record could not be read just now, so the fields behind it are not shown.
          The obligation status above comes from a different call and is still current.
        </p>
      )}
    </Section>
  );

  // The obligation matrix is the real source of the account's KYB state and
  // always was: the first Trust Center's /trust/summary (retired, D432) never
  // carried a KYB object, so the KybCard branch this used to carry never ran.
  const entity = obligations.some(o => o.obligation_key === 'kyb_v1') && (
    <Section icon={Building2} title="Entity verification (KYB)" subtitle="Your account’s entity record, separate from each company’s record.">
      <ManagedElsewhere cta="Open entity details →" href="/account">
        Entity details are maintained in Account Settings. This page reports their status.
      </ManagedElsewhere>
      <ObligationList
        obligations={obligations.filter(o => OBLIGATION_META[o.obligation_key]?.tab === 'entity')}
        emptyText="KYB not required."

      />
      {/*
        THE "YOUR COMPANIES" CARD, WHICH THIS TAB REFUSED TO DRAW UNTIL NOW.

        Trust Center v2 put a row per company here, each with its own KYB pill,
        and this tab used to explain in its place that the platform did not work
        that way: `corporate_profiles` upserts `ON CONFLICT(user_id)`, the
        obligation was updated `WHERE user_id = ? AND obligation_key = 'kyb_v1'`,
        and none of the eighteen `/trust/*` routes accepted a company. One user
        had one KYB, so a selector over three companies would have changed
        nothing when clicked — which is worse than not offering it. Task #108
        carried the product question; migration 220 answered it.

        THE ACCOUNT'S RECORD ABOVE IS STILL THE ACCOUNT'S. D40 and D42 both say
        these are different objects — "the account's entity is who signs your
        contracts; the company's is who the workspace belongs to. They must not
        drift into each other" — so this card is placed BESIDE the obligation
        list, never over it, and says which is which.
      */}
      <CompanyKybCard />
    </Section>
  );

  const accreditation = role === 'investor' && (
    <Section icon={BadgeCheck} title="Accredited investor verification" subtitle="Your accreditation obligation and its current status.">
      {/* Wording is the canvas's: v2 says "Manage in Account Settings" here
          and "Edit in Account Settings" on Entity. They are different verbs
          on purpose — accreditation is an ongoing status you maintain, an
          entity record is a document you amend. */}
      <ManagedElsewhere cta="Manage in Account Settings →" href="/account">
        This page reports the requirement state. Evidence upload is not available here.
      </ManagedElsewhere>
      <ObligationList
        obligations={obligations.filter(o => OBLIGATION_META[o.obligation_key]?.tab === 'accreditation')}
        emptyText="Accreditation not required."

      />
      {/*
        THE ONE THING THIS TAB CANNOT DO. The card here used to offer a basis
        picker and a file input over POST /trust/accreditation/upload, which
        does not exist — nor do /status, /badge/:id or /:id/review. It was
        unreachable, so nobody hit the 404; saying so is better than leaving
        the absence to be read as an oversight, and better than a file input
        that cannot POST.
      */}
      <p className="mt-4 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        Evidence upload is not available here. The platform records whether your accreditation obligation is
        satisfied, but has no route to accept the document behind it — so there is no upload to offer yet.
        Ask through the <a href="/help" className="underline hover:text-gray-700 dark:hover:text-gray-300">Help Center</a> and
        the fund team will tell you how they need it.
      </p>
    </Section>
  );

  // The page's promise about itself — OUTSIDE the `chromeless` guard, and
  // that placement is a correction.
  //
  // It went inside first, with the heading, on the reasoning that the
  // investor frame supplies its own header and must not get two. Rendering
  // the investor frame showed the cost: `chromeless` suppressed the line
  // entirely, so the one reader most likely to be mid-verification never saw
  // the sentence explaining why nothing here is editable. It is not a
  // heading — `investorWorkspace` draws an <h1> and no provenance line, so
  // there was never anything to duplicate. It sits above the tabs now, where
  // both frames show it exactly once — and on a phone, under A4m's sections.
  const provenance = (
    <p className="mb-5 text-xs text-slate-500 dark:text-slate-400">
      Identity data is managed in{' '}
      <a href="/kyc" className="underline hover:text-slate-700 dark:hover:text-slate-300">identity verification</a>
      {' '}· this page reports status only.
    </p>
  );

  const requirementAction = (() => {
    if (!selectedRow) return null;
    if (['satisfied', 'waived'].includes(selectedRow.status)) return <p className="text-sm text-slate-600 dark:text-slate-400">No action is required.</p>;
    if (selectedRow.status === 'in_review') return <p className="text-sm text-slate-600 dark:text-slate-400">The platform records this requirement as in review. No action is required here while it is checked.</p>;
    const isAgreement = /nda|msa|disclaimer/.test(selectedRow.obligation_key);
    const entry = (requiredNdas || []).find((r) => r.obligation_key === selectedRow.obligation_key) || (isAgreement && selectedRow.evidence_envelope_uuid ? { ...selectedRow, open: true } : null);
    if (requiredNdas === null && isAgreement && !entry?.evidence_envelope_uuid) return <span className="text-sm">Unreadable. Signing requirements could not be read. <button className="underline" onClick={load}>Try again</button></span>;
    if (entry?.open && entry.evidence_envelope_uuid) return <OpenToSignButton item={entry} onChanged={load} />;
    if (entry && !entry.open) return <p className="text-sm text-slate-600 dark:text-slate-400">Signing is not currently required for this agreement.</p>;
    const href = REQUIREMENTS[selectedRow.obligation_key]?.[3];
    if (href) return <a className="inline-flex min-h-11 items-center font-semibold text-violet-700 underline dark:text-violet-300" href={href}>{selectedRow.obligation_key === 'kyc_v1' ? 'Open identity check' : selectedRow.obligation_key === 'kyb_v1' ? 'Open Account' : selectedRow.obligation_key === 'accreditation_v1' ? 'Open Help Center' : 'Read document'}</a>;
    return <p className="text-sm text-slate-600 dark:text-slate-400">{selectedRow.status === 'satisfied' || selectedRow.status === 'waived' ? 'No action is required.' : 'No signing envelope is recorded yet. Ask through the Help Center.'}</p>;
  })();
  const panels = (
    <>
      <div id="trust-tabs" className="mb-5 flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_0_#e2e8f0] dark:shadow-[inset_0_-1px_0_0_#334155]" role="tablist" aria-label="Your trust">
        {tabs.map((t) => { const Icon = t.icon; const active = tab === t.key; return <button type="button" key={t.key} role="tab" aria-selected={active} data-testid={`trust-tab-${t.key}`} onClick={() => setTab(t.key)} className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm ${active ? 'border-violet-600 font-semibold text-violet-700 dark:text-violet-300' : 'border-transparent text-slate-600 dark:text-slate-400'}`}><Icon size={14} />{t.label}</button>; })}
      </div>
      {tab === 'overview' && overview}
      {tab === 'agreements' && <div data-testid="trust-agreements-panel"><AgreementsTab obligations={obligations} role={role} requiredNdas={requiredNdas} onChanged={load} /></div>}
      {tab === 'verifications' && <div className="space-y-4">{matrix?.failed ? <RequirementsUnreadable reload={load} /> : <>{KYC_ELIGIBLE_ROLES.has(role) && (kycFailed ? <Section icon={IdCard} title="Identity check">{renderRows(obligations.filter((o) => o.obligation_key === 'kyc_v1'))}<MemberUnreadable what="Your identity check" claim="The requirements above come from a different read." onRetry={load} /></Section> : identity)}{entity}{accreditation}{!entity && !accreditation && !KYC_ELIGIBLE_ROLES.has(role) && <p className="text-sm text-slate-600 dark:text-slate-400">No verification is required for your profile today.</p>}</>}</div>}
      {tab === 'data' && <MemberData role={role} />}
      {role === 'admin' && <TrustAdminTools />}
      {(selected || search.has('member')) && <RequirementDialog row={selectedRow} onClose={closeRequirement} action={requirementAction} status={selectedRow && <StatusPill status={selectedRow.status} />} />}
    </>
  );
  return (
    <div className={phone ? 'p-4' : 'p-6'}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        {chromeless ? <div /> : (<div><h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-slate-100"><ShieldCheck className="h-7 w-7 text-emerald-600" />Your trust</h1><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Your requirements, agreements and data.</p></div>)}
      </div>
      {provenance}
      {panels}
    </div>
  );
}
