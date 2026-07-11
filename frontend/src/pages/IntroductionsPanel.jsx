import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Sparkles, Loader2, Check, X, ExternalLink, RefreshCw, Clock, AlertTriangle,
  Wallet, Gift, Package, History, ChevronDown, ChevronUp, Handshake, Scale,
} from 'lucide-react';
import { api } from '../lib/api';

// Introductions tab body for the unified Network page. Curated warm-intro
// propositions for every user type: the platform proposes matches (shared
// values / complementary skills / archetypes / jurisdiction / specialization)
// and the user accepts (one introduction credit) or declines (free).
// Self-contained: owns the credit summary, filters, proposition list, and
// ledger history. Rendered by NetworkPage as the "Introductions" tab.

const STATUS_META = {
  pending:  { label: 'Pending',  chip: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  accepted: { label: 'Accepted', chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  declined: { label: 'Declined', chip: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  expired:  { label: 'Expired',  chip: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500' },
};

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

function daysUntil(iso) {
  if (!iso) return null;
  const d = Math.ceil((new Date(iso.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 86_400_000);
  return Number.isFinite(d) ? d : null;
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
            to="/products#introduction-packs"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium"
          >
            <Package size={14} /> Buy credits
          </Link>
          <Link
            to="/settings/referrals"
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

function PropositionCard({ prop, busy, highlighted, onAccept, onDecline }) {
  const [expanded, setExpanded] = useState(highlighted);
  const b = prop.breakdown || {};
  const t = prop.target || {};
  const meta = STATUS_META[prop.status] || STATUS_META.pending;
  const expiresIn = prop.status === 'pending' ? daysUntil(prop.expires_at) : null;
  const urgent = expiresIn != null && expiresIn <= 3;
  const reasons = Array.isArray(b.reasons) ? b.reasons : [];
  const cardRef = useRef(null);

  useEffect(() => {
    if (highlighted && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlighted]);

  return (
    <div
      ref={cardRef}
      className={`rounded-2xl border bg-white dark:bg-gray-900 p-4 transition-shadow ${
        highlighted
          ? 'border-violet-400 dark:border-violet-600 shadow-md shadow-violet-100 dark:shadow-none'
          : 'border-gray-200 dark:border-gray-800'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        {t.headshot_url ? (
          <img src={t.headshot_url} alt="" className="w-11 h-11 rounded-full object-cover flex-shrink-0" />
        ) : (
          <div className="w-11 h-11 rounded-full bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 flex items-center justify-center font-bold flex-shrink-0">
            {(t.name || '?').charAt(0).toUpperCase()}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">{t.name || 'Member'}</span>
            <Chip tone="blue">{entityLabel(t)}</Chip>
            {t.country && <Chip><Scale size={10} className="mr-0.5" /> {t.country}</Chip>}
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.chip}`}>{meta.label}</span>
            {urgent && (
              <Chip tone="amber"><Clock size={10} className="mr-0.5" /> {expiresIn <= 0 ? 'Expires today' : `${expiresIn}d left`}</Chip>
            )}
          </div>
          {t.headline && <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400 truncate">{t.headline}</p>}

          {/* Why this intro */}
          {reasons.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {(expanded ? reasons : reasons.slice(0, 2)).map((r, i) => (
                <li key={i} className="text-xs text-gray-700 dark:text-gray-300 flex items-start gap-1.5">
                  <Sparkles size={11} className="text-violet-500 dark:text-violet-400 mt-0.5 flex-shrink-0" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Match dimension chips */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(b.shared_values || []).slice(0, 3).map((v) => <Chip key={`v-${v}`} tone="emerald">{v}</Chip>)}
            {b.archetypes?.candidate && <Chip tone="violet">{b.archetypes.candidate}</Chip>}
            {(b.specializations || []).slice(0, 3).map((s) => <Chip key={`s-${s}`}>{s}</Chip>)}
          </div>

          {b.relationship_context && (
            <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
              <Handshake size={11} /> {b.relationship_context}
            </p>
          )}

          {expanded && (b.complementary_skills || []).length > 0 && (
            <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
              <span className="font-medium text-gray-700 dark:text-gray-300">Complementary skills: </span>
              {b.complementary_skills.join(' · ')}
            </div>
          )}

          {reasons.length > 2 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1.5 text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:underline"
            >
              {expanded ? 'Show less' : `Why this intro (${reasons.length} reasons)`}
            </button>
          )}
        </div>

        {/* Score */}
        <div className="text-right flex-shrink-0">
          <div className={`text-2xl font-bold ${scoreTone(prop.score)}`}>{prop.score}</div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">match</div>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 dark:border-gray-800 pt-3">
        {t.profile_path && (
          <Link
            to={t.profile_path}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <ExternalLink size={12} /> View profile
          </Link>
        )}
        {prop.status === 'pending' && (
          <>
            <button
              onClick={() => onAccept(prop)}
              disabled={busy}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Accept intro · 1 credit
            </button>
            <button
              onClick={() => onDecline(prop)}
              disabled={busy}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              <X size={12} /> Decline
            </button>
            <span className="text-[11px] text-gray-400 dark:text-gray-500 ml-auto">Declining is free</span>
          </>
        )}
        {prop.status === 'accepted' && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium inline-flex items-center gap-1">
            <Check size={12} /> Accepted{prop.responded_at ? ` · ${new Date((prop.responded_at || '').replace(' ', 'T') + 'Z').toLocaleDateString()}` : ''}
          </span>
        )}
      </div>
    </div>
  );
}

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'declined', label: 'Declined' },
  { id: 'expired', label: 'Expired' },
];

export default function IntroductionsPanel() {
  const [params] = useSearchParams();
  const highlightUid = params.get('intro') || '';

  const [data, setData] = useState(null);       // { propositions, credits }
  const [err, setErr] = useState('');
  const [busyUid, setBusyUid] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [outOfCredits, setOutOfCredits] = useState(null); // 402 payload
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(null);

  // Filters / sort (client-side — the list is bounded at 200).
  const [statusFilter, setStatusFilter] = useState('all');
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
    let list = props_;
    if (statusFilter !== 'all') list = list.filter((p) => p.status === statusFilter);
    if (entityFilter !== 'all') list = list.filter((p) => entityLabel(p.target) === entityFilter);
    if (jurisdictionFilter !== 'all') list = list.filter((p) => p.target?.country === jurisdictionFilter);
    if (specFilter !== 'all') list = list.filter((p) => (p.breakdown?.specializations || []).includes(specFilter));
    if (sourceFilter !== 'all') list = list.filter((p) => p.source === sourceFilter);
    return [...list].sort((a, b) => sortBy === 'newest'
      ? String(b.created_at).localeCompare(String(a.created_at))
      : b.score - a.score);
  }, [props_, statusFilter, entityFilter, jurisdictionFilter, specFilter, sourceFilter, sortBy]);

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
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Curated warm introductions matched on shared values, complementary skills, archetypes,
        jurisdiction and specialization. Accepting an introduction uses one credit; declining is always free.
      </p>

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
                to="/products#introduction-packs"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium"
              >
                <Package size={12} /> {p.label} — ${(p.amount_cents / 100).toLocaleString()}
              </Link>
            ))}
            <Link
              to="/settings/referrals"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40"
            >
              <Gift size={12} /> Refer a member
            </Link>
          </div>
        </div>
      )}

      {/* Filters + sort */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                statusFilter === f.id
                  ? 'bg-violet-600 border-violet-600 text-white'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-violet-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
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

      {/* List */}
      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 py-12 text-center">
          <Sparkles size={22} className="mx-auto text-violet-400 dark:text-violet-500" />
          <p className="mt-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            {props_.length === 0 ? 'No introductions yet' : 'Nothing matches these filters'}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
            {props_.length === 0
              ? 'Complete your profile and values assessment so the matching engine can curate the right people for you — then check back, or search now.'
              : 'Try clearing a filter, or find new matches.'}
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
        <div className="space-y-3">
          {visible.map((p) => (
            <PropositionCard
              key={p.uid}
              prop={p}
              busy={busyUid === p.uid}
              highlighted={highlightUid === p.uid}
              onAccept={onAccept}
              onDecline={onDecline}
            />
          ))}
        </div>
      )}
    </div>
  );
}
