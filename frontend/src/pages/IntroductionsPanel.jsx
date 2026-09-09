import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Sparkles, Loader2, ExternalLink, RefreshCw, AlertTriangle,
  Wallet, Gift, Package, History, ChevronDown, ChevronUp, Handshake, Scale,
} from 'lucide-react';
import { api } from '../lib/api';
import ZoneToolbar from '../workspaces/ZoneToolbar';
import ZoneDraft from '../workspaces/ZoneDraft';
import { Eyebrow, Instrument } from '../workspaces/canvasKit';
import { Pill } from '../ui';

// Introductions tab body for the unified Network page. Curated warm-intro
// propositions for every user type: the platform proposes matches (shared
// values / complementary skills / archetypes / jurisdiction / specialization)
// and the user accepts (one introduction credit) or declines (free).
// Self-contained: owns the credit summary, the pipeline table, and the ledger
// history. Rendered by NetworkPage as the "Introductions" tab.
//
// `STATUS_META` AND `daysUntil` WENT WITH THE CARD STACK. The first mapped a
// raw `status` to a chip — `Pending`, `Accepted` — which is one side of a
// two-sided consent and reads as a conclusion about the introduction rather
// than about the reader's own answer; `stateOf` below is the pair, and the
// artboard's five states are what it returns. The second counted days to
// `expires_at` for an urgency chip on a card that no longer exists; expiry is
// now a state (`Lapsed`) rather than a countdown, because a reader who cannot
// act alone cannot be hurried.

const ROLE_LABEL = {
  founder: 'Founder', investor: 'Investor', partner: 'Partner',
  advisor: 'Advisor', admin: 'Axal Team',
};

// Persona ids → entity-type labels (mirrors cloudflare-worker/src/personas.ts,
// same local-fallback pattern as lib/personas.js).
const PERSONA_LABEL = {
  lp_individual: 'LP — Individual', lp_institutional: 'LP — Institutional',
  gp_external: 'VC / GP', angel_scout: 'Angel / Scout', corporate_vc: 'Corporate VC',
  sovereign_family_office: 'Family Office', academic: 'University / Academic',
  founder_new: 'Founder', founder_existing: 'Founder', operator_advisor: 'Operator / Advisor',
  service_provider: 'Service Provider', press_analyst: 'Press / Analyst',
};

function entityLabel(target) {
  return PERSONA_LABEL[target?.persona] || ROLE_LABEL[target?.role] || 'Member';
}

function StatCell({ label, value, hint }) {
  return (
    <div className="min-w-[92px]">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{value}</div>
      {hint && <div className="text-[11px] text-gray-500 dark:text-gray-400">{hint}</div>}
    </div>
  );
}

// Credit summary header — balance + the three tracked buckets + CTAs.
function CreditSummary({ credits, onHistoryToggle, historyOpen }) {
  if (!credits) return null;
  const empty = credits.balance <= 0;
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 flex items-center gap-1">
              <Wallet size={12} /> Credits available
            </div>
            <div className={`text-3xl font-bold ${empty ? 'text-red-600 dark:text-red-400' : 'text-violet-700 dark:text-violet-300'}`}>
              {credits.balance}
            </div>
          </div>
          <StatCell label="Monthly allowance" value={credits.monthly_allowance} hint="Resets monthly" />
          <StatCell label="Used this month" value={credits.used_this_month} />
          <StatCell label="Purchased" value={credits.purchased_remaining} hint={`of ${credits.purchased_total} bought`} />
          <StatCell label="From referrals" value={credits.referral_remaining} hint={`${credits.referral_total} earned`} />
        </div>
        <div className="flex flex-col items-stretch gap-2">
          <Link
            to="/plans-and-pricing#introduction-packs"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium"
          >
            <Package size={14} /> Buy credits
          </Link>
          <Link
            to="/account/referrals"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-violet-300 dark:border-violet-800 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/40 text-sm font-medium"
          >
            <Gift size={14} /> Refer &amp; earn +1 each
          </Link>
        </div>
      </div>
      {empty && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            You're out of introduction credits. Your allowance of {credits.monthly_allowance} replenishes
            next month — or top up now with a credit pack, or earn one credit per referred member.
          </span>
        </div>
      )}
      <button
        onClick={onHistoryToggle}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
      >
        <History size={12} /> Credit history {historyOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
    </div>
  );
}

const KIND_LABEL = {
  monthly_grant: 'Monthly allowance',
  purchase: 'Purchased pack',
  referral_reward: 'Referral reward',
  spend: 'Introduction accepted',
  admin_adjust: 'Adjustment',
};

function CreditHistory({ rows }) {
  if (!rows) {
    return <div className="py-4 text-center text-sm text-gray-500 dark:text-gray-400"><Loader2 size={14} className="inline animate-spin mr-1" /> Loading history…</div>;
  }
  if (rows.length === 0) {
    return <p className="py-3 text-sm text-gray-500 dark:text-gray-400">No credit activity yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Event</th>
            <th className="px-3 py-2">Bucket</th>
            <th className="px-3 py-2 text-right">Credits</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100 dark:border-gray-800/60 last:border-0">
              <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                {new Date((r.created_at || '').replace(' ', 'T') + 'Z').toLocaleDateString()}
              </td>
              <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{r.note || KIND_LABEL[r.kind] || r.kind}</td>
              <td className="px-3 py-2 text-gray-500 dark:text-gray-400 capitalize">{r.bucket}</td>
              <td className={`px-3 py-2 text-right font-mono font-medium ${r.delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {r.delta > 0 ? `+${r.delta}` : r.delta}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Chip({ children, tone = 'gray' }) {
  const tones = {
    gray: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${tones[tone] || tones.gray}`}>
      {children}
    </span>
  );
}

function scoreTone(score) {
  if (score >= 70) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 45) return 'text-violet-600 dark:text-violet-400';
  return 'text-gray-600 dark:text-gray-400';
}

/**
 * ══ THE FIVE STATES, AND WHERE EACH ONE COMES FROM ═══════════════════════
 *
 * The `pn2` artboard draws a pipeline — `Requested → One side → Both agreed →
 * Made → Outcome` — over a store that has held both halves of the consent since
 * migration 150 and never returned the second one. `counterpart_status` is that
 * second half, so four of these five states are simply the two statuses read
 * together; `Made` is the one that needed a store, because two consents mean an
 * introduction MAY happen and nothing recorded that it did.
 *
 * `Declined` IS TERMINAL AND STAYS VISIBLE. The artboard is explicit: "a decline
 * is a normal outcome, and deleting it would only invite the same ask again."
 *
 * `Lapsed` IS NOT ON THE ARTBOARD AND IS DRAWN ANYWAY. `intro_propositions`
 * CHECKs `status IN ('pending','accepted','declined','expired')` and the list
 * route expires stale rows on every read, so expiry is a state this store
 * produces whether or not the artboard's seven sample rows happened to contain
 * one. It is not "at a gate" — a gate is something a consent can open, and an
 * expired proposition cannot be advanced by anyone — so it is counted in none
 * of the four tiles and reachable only through `All`.
 */
export const STATES = ['Requested', 'One side', 'Both agreed', 'Made', 'Outcome'];

export function stateOf(p) {
  if (p.status === 'declined' || p.counterpart_status === 'declined') return 'Declined';
  if (p.status === 'expired' || p.counterpart_status === 'expired') return 'Lapsed';
  if (p.terms?.made_at) return 'Made';
  const mine = p.status === 'accepted';
  const theirs = p.counterpart_status === 'accepted';
  if (mine && theirs) return 'Both agreed';
  if (mine || theirs) return 'One side';
  return 'Requested';
}

const STATE_TONE = {
  Made: 'ok', 'Both agreed': 'ok', 'One side': 'warn', Requested: 'warn',
  Declined: 'danger', Lapsed: 'neutral',
};

/** `Gated` on the artboard: a state a recorded consent could still open. */
const isGated = (state) => state === 'Requested' || state === 'One side';

const NARROW = {
  gated: (p) => isGated(stateOf(p)),
  made: (p) => stateOf(p) === 'Made',
  declined: (p) => stateOf(p) === 'Declined',
};

/**
 * The consent record, in the artboard's own voice: "Dev agreed Aug 27 · Verwood
 * not recorded". Two clauses, one per side, and the missing half is named
 * rather than left blank — which is the difference between showing a gate and
 * showing an empty cell.
 */
const shortDate = (iso) => {
  const at = Date.parse((iso || '').replace(' ', 'T') + 'Z');
  return Number.isFinite(at)
    ? new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;
};

export function consentRecord(p, theirName) {
  const side = (status, when, who) => {
    if (status === 'accepted') return `${who} agreed${when ? ` ${when}` : ''}`;
    if (status === 'declined') return `${who} declined${when ? ` ${when}` : ''}`;
    if (status === 'expired') return `${who} never answered`;
    return `${who} not recorded`;
  };
  const mine = side(p.status, shortDate(p.responded_at), 'You');
  // NO MIRROR ROW IS NOT "NOT RECORDED". A hand-curated proposition has no
  // counterpart row, so the other side has never been asked — reporting that as
  // an unanswered question would describe one nobody put.
  const theirs = p.counterpart_status == null
    ? `${theirName} has not been asked`
    : side(p.counterpart_status, shortDate(p.counterpart_responded_at), theirName);
  return `${mine} · ${theirs}`;
}

/** `Where it stands`, when the firm has not written an outcome of its own. */
function standing(state, theirName) {
  if (state === 'Declined') return 'Terminal. Not re-asked.';
  if (state === 'Lapsed') return 'Expired before both sides answered. Not re-asked.';
  if (state === 'Made') return 'Made. No outcome recorded.';
  if (state === 'Both agreed') return 'Both consents recorded. Not yet marked as made.';
  if (state === 'One side') return 'Held at the gate until the second consent lands.';
  return `Asked. Cannot advance until ${theirName} answers.`;
}

const feePct = (bps) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;

/**
 * `zoneActions` is the same render prop `RelationshipsPanel` takes, called with
 * the propositions on screen and the ops this page performs itself. One route,
 * four licences, four different sets of zone actions.
 *
 * WHAT THIS PAGE LOOKED LIKE, AND WHY THE LIST BECAME A TABLE. It was a stack
 * of match cards — avatar, score, reasons, dimension chips — with its own
 * status chip row above them. Everything the cards uniquely carried is still
 * reachable (`Why this match` opens it per row); what changed is that the
 * primary read is now the pipeline the artboard draws, because the question
 * this page answers is "where does each introduction stand", and a card sorted
 * by match score cannot answer it. The panel's own status chips are gone with
 * the cards: their four values are the zone row's four chips, and two controls
 * onto one state is how the two came to disagree.
 */
export default function IntroductionsPanel({ zoneActions, zoneFilters = null, role = 'partner' }) {
  const [params] = useSearchParams();
  const highlightUid = params.get('intro') || '';

  const [data, setData] = useState(null);       // { propositions, credits }
  const [err, setErr] = useState('');
  const [busyUid, setBusyUid] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [outOfCredits, setOutOfCredits] = useState(null); // 402 payload
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [detail, setDetail] = useState(null);   // the proposition whose match reasoning is open
  const [terms, setTerms] = useState(null);     // the proposition whose terms are being written
  const [consentOpen, setConsentOpen] = useState(false);

  // The zone row's chip, over derived state. `all` is the artboard's default.
  const [filter, setFilter] = useState('all');
  const [entityFilter, setEntityFilter] = useState('all');
  const [jurisdictionFilter, setJurisdictionFilter] = useState('all');
  const [specFilter, setSpecFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sortBy, setSortBy] = useState('score'); // score | newest

  const load = useCallback(async (opts = {}) => {
    setErr('');
    try {
      const r = await api.introPropositions(opts);
      setData(r);
    } catch (e) {
      setErr(e?.message || 'Could not load introductions.');
      setData((d) => d || { propositions: [], credits: null });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!historyOpen || history) return;
    api.introCreditHistory()
      .then((r) => setHistory(r?.history || []))
      .catch(() => setHistory([]));
  }, [historyOpen, history]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load({ refresh: true });
    setRefreshing(false);
  }, [load]);

  const onAccept = useCallback(async (prop) => {
    setBusyUid(prop.uid);
    setErr('');
    setOutOfCredits(null);
    try {
      const r = await api.introAccept(prop.uid);
      setData((d) => d && ({
        ...d,
        credits: r?.credits || d.credits,
        propositions: d.propositions.map((p) =>
          p.uid === prop.uid ? { ...p, status: 'accepted', responded_at: new Date().toISOString() } : p),
      }));
      setHistory(null); // ledger changed — refetch on next open
    } catch (e) {
      if (e?.status === 402 || e?.data?.code === 'intro_credits_exhausted') {
        setOutOfCredits(e?.data || { packs: [] });
        if (e?.data?.credits) setData((d) => d && ({ ...d, credits: e.data.credits }));
      } else if (e?.status === 409) {
        load(); // someone/something already resolved it — resync
      } else {
        setErr(e?.message || 'Could not accept the introduction.');
      }
    } finally {
      setBusyUid(null);
    }
  }, [load]);

  const onDecline = useCallback(async (prop) => {
    setBusyUid(prop.uid);
    setErr('');
    try {
      const r = await api.introDecline(prop.uid);
      setData((d) => d && ({
        ...d,
        credits: r?.credits || d.credits,
        propositions: d.propositions.map((p) =>
          p.uid === prop.uid ? { ...p, status: 'declined', responded_at: new Date().toISOString() } : p),
      }));
    } catch (e) {
      if (e?.status === 409) load();
      else setErr(e?.message || 'Could not decline the introduction.');
    } finally {
      setBusyUid(null);
    }
  }, [load]);

  const onSaveTerms = useCallback(async (uid, fields) => {
    setBusyUid(uid);
    setErr('');
    try {
      const r = await api.introSetTerms(uid, fields);
      setData((d) => d && ({
        ...d,
        propositions: d.propositions.map((p) => (p.uid === uid ? { ...p, terms: r?.terms || p.terms } : p)),
      }));
      setTerms(null);
      return true;
    } catch (e) {
      setErr(e?.message || 'Those terms could not be saved.');
      return false;
    } finally {
      setBusyUid(null);
    }
  }, []);

  const props_ = data?.propositions || [];

  // Distinct filter options derived from the loaded list.
  const entityOptions = useMemo(
    () => [...new Set(props_.map((p) => entityLabel(p.target)))].sort(),
    [props_],
  );
  const jurisdictionOptions = useMemo(
    () => [...new Set(props_.map((p) => p.target?.country).filter(Boolean))].sort(),
    [props_],
  );
  const specOptions = useMemo(
    () => [...new Set(props_.flatMap((p) => p.breakdown?.specializations || []))].sort().slice(0, 30),
    [props_],
  );

  const visible = useMemo(() => {
    let list = NARROW[filter] ? props_.filter(NARROW[filter]) : props_;
    if (entityFilter !== 'all') list = list.filter((p) => entityLabel(p.target) === entityFilter);
    if (jurisdictionFilter !== 'all') list = list.filter((p) => p.target?.country === jurisdictionFilter);
    if (specFilter !== 'all') list = list.filter((p) => (p.breakdown?.specializations || []).includes(specFilter));
    if (sourceFilter !== 'all') list = list.filter((p) => p.source === sourceFilter);
    return [...list].sort((a, b) => sortBy === 'newest'
      ? String(b.created_at).localeCompare(String(a.created_at))
      : b.score - a.score);
  }, [props_, filter, entityFilter, jurisdictionFilter, specFilter, sourceFilter, sortBy]);

  // COUNTED OVER EVERY PROPOSITION, NEVER OVER THE CHIP-NARROWED LIST — a tile
  // that changes because you looked at it is not reporting what it claims to.
  const made = props_.filter((p) => stateOf(p) === 'Made');
  const gated = props_.filter((p) => isGated(stateOf(p)));
  const declined = props_.filter((p) => stateOf(p) === 'Declined');
  const withFee = props_.filter((p) => p.terms?.kind === 'referral');

  const choose = (key) => setFilter((current) => (current === key ? 'all' : key));

  const handlers = {
    consentLog: {
      onClick: () => setConsentOpen(true),
      disabled: props_.length === 0,
      title: 'every consent recorded on these introductions, both sides, with its date',
    },
  };

  if (data === null) {
    return (
      <div className="flex items-center gap-2 justify-center py-12 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 size={16} className="animate-spin" /> Loading introductions…
      </div>
    );
  }

  const selectCls = 'rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-xs text-gray-700 dark:text-gray-300';

  return (
    <div className="space-y-4">
      {(zoneActions || zoneFilters) && (
        <ZoneToolbar
          className="mb-3"
          role={role}
          filters={zoneFilters ? zoneFilters({ value: filter, onChange: choose }) : []}
          actions={zoneActions ? zoneActions(visible, handlers) : []}
        />
      )}

      <div>
        <h2 className="text-lg font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Double opt-in introductions</h2>
        <p className="mt-1 text-[12px] text-gray-600 dark:text-gray-400">
          Requested → one side → both agreed → made → outcome. Accepting uses one credit; declining
          is always free.
        </p>
      </div>

      <CreditSummary
        credits={data.credits}
        historyOpen={historyOpen}
        onHistoryToggle={() => setHistoryOpen((v) => !v)}
      />
      {historyOpen && <CreditHistory rows={history} />}

      {err && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 rounded-lg p-2.5 text-sm">
          {err}
        </div>
      )}

      {outOfCredits && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
            <AlertTriangle size={15} /> Out of introduction credits
          </div>
          <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">
            Your monthly allowance replenishes automatically. To keep going now, pick up a credit
            pack — or earn one credit for every member you refer.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(outOfCredits.packs || []).map((p) => (
              <Link
                key={p.key}
                to="/plans-and-pricing#introduction-packs"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium"
              >
                <Package size={12} /> {p.label} — ${(p.amount_cents / 100).toLocaleString()}
              </Link>
            ))}
            <Link
              to="/account/referrals"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40"
            >
              <Gift size={12} /> Refer a member
            </Link>
          </div>
        </div>
      )}

      {/* THE ARTBOARD'S FOUR TILES. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Made" value={made.length} note="outcome recorded" />
        <Tile label="At a gate" value={gated.length} note="cannot advance without consent" />
        <Tile label="Declined" value={declined.length} note="terminal, not re-asked" />
        <Tile label="With economics" value={withFee.length} note="referral fee stated on the row" />
      </div>

      <StepRow />

      {/* The narrowings the artboard does not draw and this page has had for
          longer than the artboard has existed. They are capability, not
          composition, so they sit under the strip rather than competing with
          the zone row above it. */}
      <div className="flex flex-wrap items-center gap-2">
        {entityOptions.length > 1 && (
          <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} className={selectCls}>
            <option value="all">All types</option>
            {entityOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        {jurisdictionOptions.length > 1 && (
          <select value={jurisdictionFilter} onChange={(e) => setJurisdictionFilter(e.target.value)} className={selectCls}>
            <option value="all">All jurisdictions</option>
            {jurisdictionOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        {specOptions.length > 1 && (
          <select value={specFilter} onChange={(e) => setSpecFilter(e.target.value)} className={selectCls}>
            <option value="all">All specializations</option>
            {specOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className={selectCls}>
          <option value="all">All sources</option>
          <option value="matching">Matched for you</option>
          <option value="reciprocal">Matched with you</option>
          <option value="admin">Curated by Axal</option>
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className={selectCls}>
          <option value="score">Best match first</option>
          <option value="newest">Newest first</option>
        </select>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Find new matches
        </button>
      </div>

      {props_.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 py-12 text-center">
          <Sparkles size={22} className="mx-auto text-violet-400 dark:text-violet-500" />
          <p className="mt-2 text-sm font-medium text-gray-700 dark:text-gray-300">No introductions yet</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
            Complete your profile and values assessment so the matching engine can curate the right
            people for you — then check back, or search now.
          </p>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium disabled:opacity-50"
          >
            {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Find new matches
          </button>
        </div>
      ) : (
        <Instrument
          testid="introduction-pipeline"
          title="Introduction pipeline"
          meta="Consent is a gate, not a warning"
          cols="1.7fr .9fr 1fr 1.6fr 1.8fr"
          head={['Introduction', 'State', 'Kind', 'Consent record', 'Where it stands']}
          rows={visible.map((p) => {
            const state = stateOf(p);
            const name = p.target?.name || 'Member';
            const gate = isGated(state);
            return {
              key: p.uid,
              rowClass: [
                state === 'Declined' || state === 'Lapsed' ? 'opacity-[.68]' : '',
                gate ? 'bg-amber-50/40 dark:bg-amber-950/15' : '',
                p.uid === highlightUid ? 'ring-1 ring-violet-400' : '',
              ].filter(Boolean).join(' '),
              cells: [
                {
                  text: name,
                  seam: p.source === 'reciprocal' ? 'Matched with you' : null,
                  ours: p.source === 'reciprocal' ? null : 'Ours',
                  sub: `${entityLabel(p.target)}${p.target?.country ? ` · ${p.target.country}` : ''} · ${p.score} match`,
                },
                {
                  pill: state,
                  pillTone: STATE_TONE[state] || 'neutral',
                  node: p.status === 'pending' ? (
                    <>
                      <button type="button" disabled={busyUid === p.uid} onClick={() => onAccept(p)}
                        className="text-[11px] font-bold text-violet-700 underline hover:text-violet-900 dark:text-violet-300">
                        Accept · 1 credit
                      </button>
                      <button type="button" disabled={busyUid === p.uid} onClick={() => onDecline(p)}
                        className="text-[11px] text-gray-500 underline hover:text-gray-700 dark:text-gray-400">
                        Decline
                      </button>
                    </>
                  ) : null,
                },
                p.terms
                  ? {
                    pill: p.terms.kind === 'referral' ? 'Referral fee' : 'Favour',
                    pillTone: p.terms.kind === 'referral' ? 'cite' : 'neutral',
                    sub: p.terms.kind === 'referral' ? feePct(p.terms.fee_bps) : 'no economics attached',
                    node: (
                      <button type="button" onClick={() => setTerms(p)}
                        className="text-[11px] text-gray-500 underline hover:text-gray-700 dark:text-gray-400">
                        Edit terms
                      </button>
                    ),
                  }
                  : {
                    nr: true,
                    node: (
                      <button type="button" onClick={() => setTerms(p)}
                        className="text-[11px] text-gray-500 underline hover:text-gray-700 dark:text-gray-400">
                        Set terms
                      </button>
                    ),
                  },
                { text: consentRecord(p, name), gate: gate ? 'Gated' : null },
                {
                  text: p.terms?.outcome || standing(state, name),
                  node: (
                    <button type="button" onClick={() => setDetail(p)}
                      className="text-[11px] text-gray-500 underline hover:text-gray-700 dark:text-gray-400">
                      Why this match
                    </button>
                  ),
                },
              ],
            };
          })}
          note={`Consent is read from both sides: your own decision and the counterpart's own record of theirs, which is why a half-consented introduction names the missing half rather than flagging a risk — the state simply is not reachable yet. ${declined.length ? `${declined.length} declined ${declined.length === 1 ? 'introduction stays' : 'introductions stay'} visible` : 'A declined introduction stays visible'}, because a decline is a normal outcome and deleting it would only invite the same ask again. Kind is stated per row so a favour and a referral are never read as the same act.`}
        />
      )}

      {!visible.length && props_.length > 0 && (
        <p className="text-[12px] text-gray-600 dark:text-gray-300">No introduction matches this view.</p>
      )}

      <ZoneDraft
        surface="network/introductions"
        label="Suggested match · possible paths"
        accept="Accept as drafts"
        run="Suggest paths"
        foot="Consent still collected from both sides."
        empty="Points to possible paths from your book — who you know well enough that an introduction is worth asking for. Every suggestion arrives as a draft ask requiring both consents before it can move; nothing is introduced by the draft itself."
        nothingToDraft="Your book needs at least two contacts with a recorded interaction before there is a path to suggest."
      />

      {detail && <MatchDetail prop={detail} onClose={() => setDetail(null)} />}
      {terms && (
        <TermsModal
          prop={terms}
          busy={busyUid === terms.uid}
          onClose={() => setTerms(null)}
          onSave={onSaveTerms}
        />
      )}
      {consentOpen && <ConsentLog rows={props_} onClose={() => setConsentOpen(false)} />}
    </div>
  );
}

/**
 * The five states as a row, with the two that cannot be entered without a
 * consent marked as gates.
 *
 * IT IS A LEGEND, NOT A PROGRESS BAR. Each introduction has its own state and
 * this page lists many, so nothing here is "current" — the row says what the
 * pipeline is, and the `State` column says where each row sits in it. Marking a
 * step active would be picking one of the rows below to speak for all of them.
 */
function StepRow() {
  return (
    <div className="rounded-[10px] border border-axal-hairline bg-white p-3.5 dark:border-gray-800 dark:bg-gray-900">
      <Eyebrow>Double opt-in · consent is structural</Eyebrow>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2">
        {STATES.map((s, i) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-extrabold ${
              i <= 2
                ? 'bg-fuchsia-50 text-fuchsia-800 ring-1 ring-fuchsia-200 dark:bg-fuchsia-950/40 dark:text-fuchsia-300 dark:ring-fuchsia-900'
                : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700'}`}>
              {i + 1}
            </span>
            <span className="text-[11.5px] font-bold text-axal-ink dark:text-gray-200">{s}</span>
            {i === 1 || i === 2 ? <Pill tone="neutral" className="!text-[9.5px]">consent required</Pill> : null}
            {i < STATES.length - 1 ? <span aria-hidden="true" className="text-gray-400">→</span> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * `Consent log` — every consent recorded on these introductions, both sides.
 *
 * IT IS A READ, NOT A SECOND STORE. The ops row's reason used to say "consent
 * is recorded per introduction, not as a log", which was true of the shape and
 * wrong as a conclusion: the consents ARE the log, one row per side, and the
 * only thing missing was returning the counterpart's. Gathering what is already
 * recorded into one chronological view invents nothing.
 */
function ConsentLog({ rows, onClose }) {
  const events = rows.flatMap((p) => {
    const name = p.target?.name || 'Member';
    const out = [];
    if (p.responded_at) out.push({ at: p.responded_at, who: 'You', what: p.status, name });
    if (p.counterpart_responded_at) {
      out.push({ at: p.counterpart_responded_at, who: name, what: p.counterpart_status, name });
    }
    return out;
  }).sort((a, b) => String(b.at).localeCompare(String(a.at)));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-extrabold tracking-tight">Consent log</h3>
        <p className="mt-1 text-[11.5px] text-gray-600 dark:text-gray-400">
          Every consent recorded on your introductions, both sides, newest first.
        </p>
        {events.length === 0 ? (
          <p className="mt-3 text-[12px] text-gray-600 dark:text-gray-400">
            Nothing has been answered yet, by you or by anyone you have been matched with.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {events.map((e, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-axal-hairline pb-1.5 text-[11.5px] last:border-0 dark:border-gray-800">
                <span>
                  <span className="font-semibold">{e.who}</span> {e.what}
                  <span className="text-gray-500"> · introduction to {e.name}</span>
                </span>
                <span className="font-mono text-[10.5px] text-gray-500">{shortDate(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="rounded px-4 py-2 text-sm text-gray-700 dark:text-gray-300">Close</button>
        </div>
      </div>
    </div>
  );
}

/**
 * What this introduction is, and what came of it.
 *
 * A REFERRAL MUST STATE ITS FEE. The store's CHECK refuses a referral with no
 * `fee_bps` and a favour with one, so the form does the same rather than letting
 * a reader discover it as a constraint failure: the fee field appears when
 * `referral` is chosen and the save is blocked until it is filled.
 */
function TermsModal({ prop, busy, onClose, onSave }) {
  const t = prop.terms || {};
  const [kind, setKind] = useState(t.kind || 'favour');
  const [pct, setPct] = useState(t.fee_bps ? String(t.fee_bps / 100) : '');
  const [madeAt, setMadeAt] = useState(t.made_at || '');
  const [outcome, setOutcome] = useState(t.outcome || '');
  const bps = Math.round(Number(pct) * 100);
  const feeOk = kind !== 'referral' || (Number.isInteger(bps) && bps > 0 && bps <= 10000);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-extrabold tracking-tight">
          Introduction to {prop.target?.name || 'this member'}
        </h3>
        <p className="mt-1 text-[11.5px] text-gray-600 dark:text-gray-400">
          Your own record of what this is. The other side keeps theirs.
        </p>

        <div className="mt-3 flex gap-2">
          {['favour', 'referral'].map((k) => (
            <button
              key={k} type="button" onClick={() => setKind(k)}
              className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${
                kind === k
                  ? 'border-violet-600 bg-violet-600 text-white'
                  : 'border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300'}`}
            >
              {k === 'favour' ? 'Favour' : 'Referral with a fee'}
            </button>
          ))}
        </div>

        {kind === 'referral' && (
          <label className="mt-3 block">
            <span className="text-[11px] font-bold uppercase tracking-[.08em] text-gray-600 dark:text-gray-300">Referral fee</span>
            <span className="mt-1 flex items-center gap-2">
              <input
                type="number" min="0.01" max="100" step="0.01" value={pct}
                onChange={(e) => setPct(e.target.value)} aria-label="Referral fee percent"
                className="w-28 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
              />
              <span className="text-sm text-gray-600 dark:text-gray-400">%</span>
            </span>
          </label>
        )}

        <label className="mt-3 block">
          <span className="text-[11px] font-bold uppercase tracking-[.08em] text-gray-600 dark:text-gray-300">
            Made on
          </span>
          <input
            type="date" value={madeAt} onChange={(e) => setMadeAt(e.target.value)}
            aria-label="The date the introduction was made"
            className="mt-1 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
          />
          <span className="mt-1 block text-[10.5px] text-gray-500">
            Two consents mean it may happen. This says it did — leave it empty until then.
          </span>
        </label>

        <label className="mt-3 block">
          <span className="text-[11px] font-bold uppercase tracking-[.08em] text-gray-600 dark:text-gray-300">Outcome</span>
          <textarea
            rows={3} value={outcome} onChange={(e) => setOutcome(e.target.value)}
            aria-label="What came of the introduction"
            className="mt-1 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
          />
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded px-4 py-2 text-sm text-gray-700 dark:text-gray-300">Cancel</button>
          <button
            type="button" disabled={busy || !feeOk}
            onClick={() => onSave(prop.uid, {
              kind,
              fee_bps: kind === 'referral' ? bps : null,
              made_at: madeAt || null,
              outcome: outcome.trim() || null,
            })}
            className="rounded bg-violet-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
        {!feeOk && (
          <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
            A referral states its fee. A percentage of nothing is a favour, and it has a word.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * `Why this match` — the matching engine's own reasoning, which the card stack
 * used to show inline. It is kept because it is the answer to the one question
 * a reader has before spending a credit, and it is behind a control because it
 * is reasoning about ONE row and the table is about where every row stands.
 */
function MatchDetail({ prop, onClose }) {
  const b = prop.breakdown || {};
  const t = prop.target || {};
  const reasons = Array.isArray(b.reasons) ? b.reasons : [];
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          {t.headshot_url ? (
            <img src={t.headshot_url} alt="" className="h-11 w-11 flex-shrink-0 rounded-full object-cover" />
          ) : (
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 font-bold text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
              {(t.name || '?').charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-extrabold tracking-tight">{t.name || 'Member'}</h3>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Chip tone="blue">{entityLabel(t)}</Chip>
              {t.country && <Chip><Scale size={10} className="mr-0.5" /> {t.country}</Chip>}
            </div>
            {t.headline && <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{t.headline}</p>}
          </div>
          <div className="flex-shrink-0 text-right">
            <div className={`text-2xl font-bold ${scoreTone(prop.score)}`}>{prop.score}</div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">match</div>
          </div>
        </div>

        {reasons.length > 0 && (
          <ul className="mt-3 space-y-1">
            {reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                <Sparkles size={11} className="mt-0.5 flex-shrink-0 text-violet-500 dark:text-violet-400" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {(b.shared_values || []).slice(0, 6).map((v) => <Chip key={`v-${v}`} tone="emerald">{v}</Chip>)}
          {b.archetypes?.candidate && <Chip tone="violet">{b.archetypes.candidate}</Chip>}
          {(b.specializations || []).slice(0, 6).map((s) => <Chip key={`s-${s}`}>{s}</Chip>)}
        </div>

        {(b.complementary_skills || []).length > 0 && (
          <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
            <span className="font-medium text-gray-700 dark:text-gray-300">Complementary skills: </span>
            {b.complementary_skills.join(' · ')}
          </p>
        )}

        {b.relationship_context && (
          <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
            <Handshake size={11} /> {b.relationship_context}
          </p>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          {t.profile_path ? (
            <Link to={t.profile_path} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
              <ExternalLink size={12} /> View profile
            </Link>
          ) : <span />}
          <button type="button" onClick={onClose} className="rounded px-4 py-2 text-sm text-gray-700 dark:text-gray-300">Close</button>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, note }) {
  return (
    <div className="rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1.5 font-mono text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{value}</div>
      <div className="mt-1 text-[10px] leading-snug text-gray-600 dark:text-gray-400">{note}</div>
    </div>
  );
}
