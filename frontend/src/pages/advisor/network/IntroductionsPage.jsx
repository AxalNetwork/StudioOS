import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  MapPin, Mail, Users, Sparkles, Lock, Send, Check, X, Clock, ShieldCheck,
  UserPlus, MessageSquare, Loader2, SlidersHorizontal, Award, Zap, Heart,
  Layers, RefreshCw, Star,
} from 'lucide-react';
import {
  Avatar, Chip, SlideOver, Section, Field, EmptyState, SubTabs, SearchInput,
} from './kit';
import { api } from '../../../lib/api';

// Introductions — the Network › Introductions surface. Two modes:
//   • "Discover" — a people-only, card-based matchmaking experience (Task #24).
//     Ranks other members by shared values, complementary skills, archetype,
//     specialization and location; shows a trust score + Axal fit graph + a
//     short "why this is a fit". Connect sends a privacy-safe request (spends a
//     connect credit); contact details never appear until both sides accept.
//   • "My introductions" — the live secure intro flow. Contact details stay
//     hidden until BOTH sides accept.

export default function IntroductionsPage() {
  const [tab, setTab] = useState('discover');
  return (
    <div className="space-y-4">
      <SubTabs
        tabs={[
          { id: 'discover', label: 'Discover', icon: Sparkles },
          { id: 'mine', label: 'My introductions', icon: Users },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'discover' ? <DiscoverFeed /> : <MyIntroductions />}
    </div>
  );
}

// ===========================================================================
// Discover — people-only matchmaking
// ===========================================================================
const VALUE_ICON = Star;

function CreditPill({ credits }) {
  if (!credits) return null;
  const low = credits.balance <= 2;
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border ${
        low
          ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-900/40 text-amber-700 dark:text-amber-300'
          : 'bg-violet-50 dark:bg-violet-900/20 border-violet-100 dark:border-violet-900/40 text-violet-700 dark:text-violet-300'
      }`}
      title={`${credits.balance} of ${credits.total} connect credits left this month`}
    >
      <Zap size={13} />
      {credits.balance} / {credits.total} connect credits
    </div>
  );
}

function ScoreRing({ value, label, tone = 'violet' }) {
  const tones = {
    violet: 'text-violet-600 dark:text-violet-300',
    emerald: 'text-emerald-600 dark:text-emerald-300',
  };
  return (
    <div className="flex flex-col items-center">
      <div className={`text-2xl font-bold leading-none ${tones[tone]}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400 mt-1">{label}</div>
    </div>
  );
}

function FitGraph({ axes }) {
  if (!axes || axes.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {axes.map((a) => (
        <div key={a.key} className="flex items-center gap-2">
          <div className="w-24 text-[11px] text-gray-500 dark:text-gray-400 flex-shrink-0 truncate">
            {a.label}
          </div>
          <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-400 to-violet-600"
              style={{ width: `${Math.max(4, Math.min(100, a.score))}%` }}
            />
          </div>
          <div className="w-7 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
            {a.score}
          </div>
        </div>
      ))}
    </div>
  );
}

const EMPTY_FILTERS = {
  location: '', role: '', specialization: '', value: '', archetype: '',
  min_trust: 0, min_fit: 0, q: '',
};

function FilterBar({ open, options, filters, onChange, onReset }) {
  if (!open) return null;
  const sel = (label, key, opts) => (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <select
        value={filters[key]}
        onChange={(e) => onChange({ ...filters, [key]: e.target.value })}
        className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm"
      >
        <option value="">Any</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40 p-4 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {sel('Location', 'location', (options.locations || []).map((l) => ({ value: l, label: l })))}
        {sel('Role', 'role', (options.roles || []).map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) })))}
        {sel('Specialization', 'specialization', (options.specializations || []).map((s) => ({ value: s, label: s })))}
        {sel('Shared value', 'value', (options.values || []).map((v) => ({ value: v.key, label: v.label })))}
        {sel('Archetype', 'archetype', (options.archetypes || []).map((a) => ({ value: a.slug, label: a.label })))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-gray-500 dark:text-gray-400">
            Min trust score: <span className="font-semibold text-gray-700 dark:text-gray-200">{filters.min_trust}</span>
          </span>
          <input
            type="range" min="0" max="99" step="1" value={filters.min_trust}
            onChange={(e) => onChange({ ...filters, min_trust: Number(e.target.value) })}
            className="accent-violet-600"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-gray-500 dark:text-gray-400">
            Min Axal fit: <span className="font-semibold text-gray-700 dark:text-gray-200">{filters.min_fit}</span>
          </span>
          <input
            type="range" min="0" max="99" step="1" value={filters.min_fit}
            onChange={(e) => onChange({ ...filters, min_fit: Number(e.target.value) })}
            className="accent-violet-600"
          />
        </label>
      </div>
      <div className="flex justify-end">
        <button onClick={onReset} className="text-xs text-violet-600 dark:text-violet-300 font-medium">
          Reset filters
        </button>
      </div>
    </div>
  );
}

function DiscoverFeed() {
  const [data, setData] = useState(null);
  const [credits, setCredits] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [idx, setIdx] = useState(0);
  const [connectFor, setConnectFor] = useState(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const [feed, cr] = await Promise.all([
        api.networkIntros.candidates(filters),
        api.networkIntros.connectCredits().catch(() => null),
      ]);
      setData(feed);
      if (cr) setCredits(cr);
      setIdx(0);
    } catch (e) {
      setError(e?.message || 'Could not load matches');
      setData({ candidates: [], filter_options: {}, viewer: null });
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const candidates = data?.candidates || [];
  const current = candidates[idx];
  const options = data?.filter_options || {};

  const advance = () => setIdx((i) => i + 1);

  const onConnected = async () => {
    setConnectFor(null);
    setToast('Request sent — they\u2019ll see it in their notifications.');
    setTimeout(() => setToast(''), 3500);
    try { setCredits(await api.networkIntros.connectCredits()); } catch { /* noop */ }
    advance();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-600 dark:text-gray-400 max-w-xl">
          Meet members matched to you by shared values, complementary skills, archetype and focus.
          Connect to send a private request — contact details stay hidden until you both accept.
        </p>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          <div className="w-56">
            <SearchInput
              value={filters.q}
              onChange={(v) => setFilters((f) => ({ ...f, q: v }))}
              placeholder="Search people, focus, skills…"
            />
          </div>
          <CreditPill credits={credits} />
          <button
            onClick={() => setShowFilters((s) => !s)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${
              showFilters
                ? 'border-violet-300 text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/20'
                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
            }`}
          >
            <SlidersHorizontal size={15} /> Filters
          </button>
        </div>
      </div>

      <FilterBar
        open={showFilters}
        options={options}
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(EMPTY_FILTERS)}
      />

      {toast && (
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/40 p-3 text-sm text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-2">
          <Check size={15} /> {toast}
        </div>
      )}
      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/40 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {data === null ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-16 justify-center">
          <Loader2 className="animate-spin" size={16} /> Finding your best matches…
        </div>
      ) : outOfCredits ? (
        <OutOfCredits credits={credits} onDismiss={() => setOutOfCredits(false)} />
      ) : !current ? (
        <AllCaughtUp count={candidates.length} onRefresh={load} />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Match {idx + 1} of {candidates.length}</span>
            <span>{data.total} people match your filters</span>
          </div>
          <CandidateCard
            candidate={current}
            onSkip={advance}
            onConnect={() => setConnectFor(current)}
          />
        </div>
      )}

      {connectFor && (
        <ConnectPanel
          candidate={connectFor}
          onClose={() => setConnectFor(null)}
          onConnected={onConnected}
          onOutOfCredits={() => { setConnectFor(null); setOutOfCredits(true); }}
        />
      )}
    </div>
  );
}

function AllCaughtUp({ count, onRefresh }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center space-y-3">
      <div className="w-12 h-12 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300 flex items-center justify-center mx-auto">
        <Sparkles size={22} />
      </div>
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
        {count === 0 ? 'No matches with these filters' : 'You\u2019re all caught up'}
      </p>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {count === 0
          ? 'Try widening your filters to see more people.'
          : 'You\u2019ve reviewed everyone for now. Check back soon for new members.'}
      </p>
      <button
        onClick={onRefresh}
        className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2"
      >
        <RefreshCw size={14} /> Refresh matches
      </button>
    </div>
  );
}

function OutOfCredits({ credits, onDismiss }) {
  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 p-8 text-center space-y-3">
      <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300 flex items-center justify-center mx-auto">
        <Zap size={22} />
      </div>
      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Out of connect credits</p>
      <p className="text-sm text-amber-800/80 dark:text-amber-200/80 max-w-md mx-auto">
        You've used all {credits?.total ?? 0} of your connect credits this month. Earn more by
        referring members, or your allowance resets next month.
      </p>
      <button
        onClick={onDismiss}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-sm font-medium px-4 py-2"
      >
        Keep browsing
      </button>
    </div>
  );
}

function CandidateCard({ candidate: c, onSkip, onConnect }) {
  const roleLabel = c.role ? c.role[0].toUpperCase() + c.role.slice(1) : null;
  const strongValues = (c.values || []).filter((v) => v.score >= 70).slice(0, 4);
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden shadow-sm">
      {/* Header */}
      <div className="p-5 bg-gradient-to-br from-violet-50 to-white dark:from-violet-900/20 dark:to-gray-900 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-start gap-4">
          <Avatar name={c.name} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">{c.name}</h3>
              {!c.on_platform && <Chip>Off-platform</Chip>}
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
              {[roleLabel, c.company].filter(Boolean).join(' · ') || '—'}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              {c.location && <span className="inline-flex items-center gap-1"><MapPin size={12} /> {c.location}</span>}
              <span className="inline-flex items-center gap-1">
                <Layers size={12} /> {c.archetype?.label}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4 pl-2 flex-shrink-0">
            <ScoreRing value={c.match_score} label="Match" tone="violet" />
            <ScoreRing value={c.trust_score} label="Trust" tone="emerald" />
          </div>
        </div>
        {c.headline && (
          <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">{c.headline}</p>
        )}
      </div>

      {/* Body */}
      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="space-y-4">
          {c.why?.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 inline-flex items-center gap-1">
                <Sparkles size={12} /> Why this is a fit
              </div>
              <ul className="space-y-1.5">
                {c.why.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <Check size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" /> {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {c.specializations?.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Focus areas</div>
              <div className="flex flex-wrap gap-1.5">
                {c.specializations.map((s) => <Chip key={s} tone="blue">{s}</Chip>)}
              </div>
            </div>
          )}

          {c.skills?.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Skills</div>
              <div className="flex flex-wrap gap-1.5">
                {c.skills.map((s) => <Chip key={s} tone="emerald">{s}</Chip>)}
              </div>
            </div>
          )}

          {strongValues.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Values</div>
              <div className="flex flex-wrap gap-1.5">
                {strongValues.map((v) => (
                  <Chip key={v.key} tone="violet"><VALUE_ICON size={10} /> {v.label}</Chip>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 inline-flex items-center gap-1">
            <Award size={12} /> Axal fit graph
          </div>
          <FitGraph axes={c.fit?.axes} />
          <div className="mt-3 rounded-lg bg-gray-50 dark:bg-gray-800/60 p-3 text-center">
            <div className="text-xs text-gray-400 uppercase tracking-wide">Overall Axal fit</div>
            <div className="text-2xl font-bold text-violet-600 dark:text-violet-300">{c.fit?.overall}</div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex items-center gap-3">
        <button
          onClick={onSkip}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm font-medium px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <X size={16} /> Not now
        </button>
        <button
          onClick={onConnect}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2.5"
        >
          <Heart size={16} /> Connect
        </button>
      </div>
      <div className="px-4 pb-3 -mt-1">
        <p className="text-[11px] text-gray-400 inline-flex items-center gap-1">
          <Lock size={11} /> Connecting spends one credit; contact details unlock only if you both accept.
        </p>
      </div>
    </div>
  );
}

function ConnectPanel({ candidate: c, onClose, onConnected, onOutOfCredits }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const payload = c.on_platform
        ? { recipient_user_id: c.user_id }
        : { recipient_investor_id: c.investor_id };
      await api.networkIntros.create({ ...payload, message: message.trim() || undefined });
      await onConnected();
    } catch (e) {
      if (e?.status === 402 || e?.data?.code === 'connect_credits_exhausted') {
        onOutOfCredits();
        return;
      }
      setError(e?.message || 'Could not send the request');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SlideOver open onClose={onClose} title="Connect" subtitle={`Send ${c.name} a private request`}>
      <div className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-800 p-3">
        <Avatar name={c.name} size={44} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{c.name}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {[c.company, c.headline].filter(Boolean).join(' · ') || c.archetype?.label}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-lg font-bold text-violet-600 dark:text-violet-300 leading-none">{c.match_score}</div>
          <div className="text-[10px] uppercase tracking-wide text-gray-400">match</div>
        </div>
      </div>

      <Field label="Add a note (optional)">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          placeholder="Say why you'd like to connect. This is shared with them; your email is not."
          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
        />
      </Field>

      <p className="text-xs text-gray-500 inline-flex items-center gap-1">
        <Lock size={12} /> Your contact details stay private until they accept.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        disabled={busy}
        onClick={submit}
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2.5 disabled:opacity-50"
      >
        {busy ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />} Send connect request
      </button>
    </SlideOver>
  );
}

// ===========================================================================
// Live secure introductions ("My introductions")
// ===========================================================================
const STATUS_META = {
  pending: { label: 'Pending', tone: 'gray', icon: Clock },
  invited: { label: 'Invited', tone: 'blue', icon: Send },
  viewed: { label: 'Viewed', tone: 'blue', icon: Clock },
  accepted: { label: 'Accepted', tone: 'emerald', icon: Check },
  connected: { label: 'Connected', tone: 'emerald', icon: ShieldCheck },
  declined: { label: 'Declined', tone: 'gray', icon: X },
  expired: { label: 'Expired', tone: 'gray', icon: Clock },
};

function MyIntroductions() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    try {
      setError('');
      const rows = await api.networkIntros.list();
      setItems(rows);
    } catch (e) {
      setError(e?.message || 'Could not load introductions');
      setItems([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const { incoming, outgoing } = useMemo(() => {
    const inc = [];
    const out = [];
    (items || []).forEach((it) => (it.direction === 'incoming' ? inc : out).push(it));
    return { incoming: inc, outgoing: out };
  }, [items]);

  if (items === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-10 justify-center">
        <Loader2 className="animate-spin" size={16} /> Loading introductions…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-900/40 p-3 flex items-start gap-2">
        <Lock size={14} className="text-violet-500 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-violet-800 dark:text-violet-200">
          Requests you send from Discover appear here. Emails and private contact details are never
          shared until both people accept the introduction.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/40 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {incoming.length > 0 && (
        <Section title={`Requests for you (${incoming.length})`}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {incoming.map((it) => (
              <IntroCard key={it.uid} intro={it} onOpen={() => setSelected(it)} onChanged={load} />
            ))}
          </div>
        </Section>
      )}

      <Section title={`Your requests (${outgoing.length})`}>
        {outgoing.length === 0 ? (
          <EmptyState>You haven't connected with anyone yet — head to Discover to find your matches.</EmptyState>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {outgoing.map((it) => (
              <IntroCard key={it.uid} intro={it} onOpen={() => setSelected(it)} onChanged={load} />
            ))}
          </div>
        )}
      </Section>

      {selected && (
        <IntroDetail
          introUid={selected.uid}
          introId={selected.id}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function StatusChip({ status }) {
  const meta = STATUS_META[status] || STATUS_META.pending;
  const Icon = meta.icon;
  return <Chip tone={meta.tone}><Icon size={10} /> {meta.label}</Chip>;
}

function IntroCard({ intro, onOpen, onChanged }) {
  const cp = intro.counterpart || {};
  const isIncoming = intro.direction === 'incoming';
  const [busy, setBusy] = useState(false);

  const act = async (fn) => {
    setBusy(true);
    try { await fn(); await onChanged(); } finally { setBusy(false); }
  };

  return (
    <div className="text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <button onClick={onOpen} className="w-full text-left">
        <div className="flex items-start gap-3">
          <Avatar name={cp.name || 'Unknown'} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{cp.name}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {[cp.role && cp.role[0].toUpperCase() + cp.role.slice(1), cp.company].filter(Boolean).join(' · ') || '—'}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusChip status={intro.status} />
              <Chip tone={isIncoming ? 'violet' : 'blue'}>{isIncoming ? 'Incoming' : 'Outgoing'}</Chip>
              {intro.off_platform && <Chip>Off-platform</Chip>}
            </div>
          </div>
        </div>
        {intro.draft_message && (
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400 line-clamp-2">“{intro.draft_message}”</p>
        )}
        {!intro.contact_unlocked && (
          <p className="mt-3 inline-flex items-center gap-1 text-xs text-gray-400">
            <Lock size={11} /> Contact details hidden until connected
          </p>
        )}
      </button>

      {isIncoming && !['connected', 'declined', 'expired'].includes(intro.status) && (
        <div className="mt-3 flex gap-2">
          <button
            disabled={busy}
            onClick={() => act(() => api.networkIntros.accept(intro.id))}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5 disabled:opacity-50"
          >
            <Check size={13} /> Accept
          </button>
          <button
            disabled={busy}
            onClick={() => act(() => api.networkIntros.decline(intro.id))}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-xs font-medium px-3 py-1.5 disabled:opacity-50"
          >
            <X size={13} /> Decline
          </button>
        </div>
      )}
      {intro.status === 'connected' && (
        <button
          onClick={onOpen}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-violet-600 dark:text-violet-300"
        >
          <MessageSquare size={13} /> Open conversation
        </button>
      )}
    </div>
  );
}

function IntroDetail({ introId, onClose, onChanged }) {
  const [intro, setIntro] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const fresh = await api.networkIntros.get(introId);
    setIntro(fresh);
  }, [introId]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn) => {
    setBusy(true);
    try { await fn(); await load(); await onChanged(); } finally { setBusy(false); }
  };

  if (!intro) {
    return (
      <SlideOver open onClose={onClose} title="Introduction">
        <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
          <Loader2 className="animate-spin" size={16} /> Loading…
        </div>
      </SlideOver>
    );
  }

  const cp = intro.counterpart || {};
  const isIncoming = intro.direction === 'incoming';

  return (
    <SlideOver
      open
      onClose={onClose}
      title={cp.name}
      subtitle={[cp.role && cp.role[0].toUpperCase() + cp.role.slice(1), cp.company].filter(Boolean).join(' · ')}
    >
      <div className="flex items-center gap-3">
        <Avatar name={cp.name || 'Unknown'} size={56} />
        <div className="flex flex-wrap gap-1.5">
          <StatusChip status={intro.status} />
          {intro.off_platform && <Chip>Off-platform</Chip>}
        </div>
      </div>

      {cp.headline && <p className="text-sm text-gray-700 dark:text-gray-300">{cp.headline}</p>}

      {intro.draft_message && (
        <Section title={isIncoming ? 'Their message' : 'Your message'}>
          <p className="text-sm text-gray-700 dark:text-gray-300">“{intro.draft_message}”</p>
        </Section>
      )}

      <Section title="Contact details">
        {intro.contact_unlocked && intro.contact ? (
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 text-sm text-gray-800 dark:text-gray-200 break-all">
              <Mail size={13} />
              {isIncoming ? intro.contact.initiator_email : intro.contact.recipient_email}
            </div>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
              <ShieldCheck size={12} /> Unlocked — you're both connected.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-4 text-sm text-gray-500 inline-flex items-center gap-2">
            <Lock size={14} /> Hidden until you both accept the introduction.
          </div>
        )}
      </Section>

      {isIncoming && !['connected', 'declined', 'expired'].includes(intro.status) && (
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() => act(() => api.networkIntros.accept(intro.id))}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
          >
            <Check size={15} /> Accept introduction
          </button>
          <button
            disabled={busy}
            onClick={() => act(() => api.networkIntros.decline(intro.id))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm font-medium px-4 py-2 disabled:opacity-50"
          >
            <X size={15} /> Decline
          </button>
        </div>
      )}

      {intro.status === 'connected' && intro.can_message && (
        <MessageThread introId={intro.id} />
      )}
    </SlideOver>
  );
}

function MessageThread({ introId }) {
  const [messages, setMessages] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setMessages(await api.networkIntros.messages(introId)); }
    catch { setMessages([]); }
  }, [introId]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    try {
      await api.networkIntros.sendMessage(introId, body);
      setDraft('');
      await load();
    } finally { setBusy(false); }
  };

  return (
    <Section title="Messages">
      <div className="space-y-2 max-h-64 overflow-y-auto mb-3">
        {(messages || []).length === 0 && (
          <p className="text-xs text-gray-400">No messages yet — say hello.</p>
        )}
        {(messages || []).map((m) => (
          <div key={m.uid} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
              m.mine
                ? 'bg-violet-600 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200'
            }`}>
              {!m.mine && <div className="text-[10px] opacity-70 mb-0.5">{m.sender_name}</div>}
              {m.body}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Write a message…"
          className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
        />
        <button
          disabled={busy || !draft.trim()}
          onClick={send}
          className="inline-flex items-center gap-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-3 py-2 disabled:opacity-50"
        >
          <Send size={14} />
        </button>
      </div>
    </Section>
  );
}
