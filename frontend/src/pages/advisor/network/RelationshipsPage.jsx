import React, { useMemo, useState } from 'react';
import {
  Users, Activity, GitBranch, Share2, Calendar, Mail, Phone, Video, CalendarClock, ArrowRight,
} from 'lucide-react';
import {
  CONTACTS, INTERACTIONS, MEETINGS, REFERRALS, WARM_INTROS, contactById, formatRelativeDay,
} from '../../../data/advisor/network';
import { Avatar, Chip, StatCard, SubTabs, Section, StrengthBar, EmptyState } from './kit';

// Relationships — network-intelligence workspace. A relationship-graph
// placeholder plus mutual connections, relationship strength, interaction
// timeline, contact/meeting history, referrals, and warm introductions,
// organized as sub-tabs.

const SUB_TABS = [
  { id: 'overview', label: 'Overview', icon: GitBranch },
  { id: 'interactions', label: 'Interactions', icon: Activity },
  { id: 'referrals', label: 'Referrals & Intros', icon: Share2 },
];

export default function RelationshipsPage() {
  const [tab, setTab] = useState('overview');

  const stats = useMemo(() => {
    const strengths = CONTACTS.map((c) => c.strength);
    const avg = Math.round(strengths.reduce((a, b) => a + b, 0) / strengths.length);
    const strong = CONTACTS.filter((c) => c.strength >= 70).length;
    const mutuals = CONTACTS.reduce((a, c) => a + c.mutuals, 0);
    const pendingIntros = WARM_INTROS.filter((w) => w.status === 'pending').length;
    return { avg, strong, mutuals, pendingIntros };
  }, []);

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Network intelligence across your relationships — strength, mutual connections, interaction history,
        referrals, and warm introductions.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Active relationships" value={CONTACTS.length} />
        <StatCard label="Avg. strength" value={stats.avg} hint={`${stats.strong} strong (70+)`} />
        <StatCard label="Mutual connections" value={stats.mutuals} />
        <StatCard label="Pending intros" value={stats.pendingIntros} />
      </div>

      <SubTabs tabs={SUB_TABS} value={tab} onChange={setTab} />

      {tab === 'overview' && <Overview />}
      {tab === 'interactions' && <Interactions />}
      {tab === 'referrals' && <ReferralsAndIntros />}
    </div>
  );
}

// --- Overview: graph placeholder + strength ranking + mutuals ----------------
function Overview() {
  const ranked = useMemo(() => [...CONTACTS].sort((a, b) => b.strength - a.strength), []);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <Section title="Relationship graph">
        <RelationshipGraph />
      </Section>
      <Section title="Relationship strength">
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {ranked.slice(0, 8).map((c) => (
            <div key={c.id} className="flex items-center gap-3 p-3">
              <Avatar name={c.name} size={32} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{c.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  <Users size={10} className="inline mr-1" />{c.mutuals} mutual · {formatRelativeDay(c.lastInteraction)}
                </div>
              </div>
              <StrengthBar value={c.strength} />
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

// A deterministic radial graph placeholder — "You" at the centre with the
// strongest relationships around it. Positions are computed from index only.
function RelationshipGraph() {
  const nodes = useMemo(() => [...CONTACTS].sort((a, b) => b.strength - a.strength).slice(0, 9), []);
  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 120;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-auto" role="img" aria-label="Relationship graph">
        {nodes.map((n, i) => {
          const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(angle) * radius;
          const y = cy + Math.sin(angle) * radius;
          const opacity = 0.25 + (n.strength / 100) * 0.6;
          return (
            <line
              key={`e-${n.id}`}
              x1={cx} y1={cy} x2={x} y2={y}
              stroke="#8b5cf6" strokeOpacity={opacity} strokeWidth={1 + (n.strength / 100) * 2}
            />
          );
        })}
        {nodes.map((n, i) => {
          const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(angle) * radius;
          const y = cy + Math.sin(angle) * radius;
          const initials = n.name.split(' ').map((p) => p[0]).slice(0, 2).join('');
          return (
            <g key={`n-${n.id}`}>
              <circle cx={x} cy={y} r={18} fill="#ede9fe" stroke="#c4b5fd" />
              <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="600" fill="#6d28d9">
                {initials}
              </text>
            </g>
          );
        })}
        <circle cx={cx} cy={cy} r={26} fill="#7c3aed" />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="700" fill="#fff">You</text>
      </svg>
      <p className="text-[11px] text-center text-gray-400 dark:text-gray-500 mt-1">
        Preview — connection thickness reflects relationship strength.
      </p>
    </div>
  );
}

// --- Interactions: timeline + meeting history --------------------------------
const INTERACTION_ICON = { meeting: Users, call: Phone, email: Mail, event: Calendar, video: Video };

function Interactions() {
  const timeline = useMemo(
    () => [...INTERACTIONS].sort((a, b) => b.date.localeCompare(a.date)),
    [],
  );
  const meetings = useMemo(
    () => [...MEETINGS].sort((a, b) => b.date.localeCompare(a.date)),
    [],
  );
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <Section title="Interaction timeline">
        <ol className="relative border-l border-gray-200 dark:border-gray-800 ml-3 space-y-4">
          {timeline.map((it) => {
            const c = contactById(it.contactId);
            const Icon = INTERACTION_ICON[it.type] || Activity;
            return (
              <li key={it.id} className="ml-6">
                <span className="absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300">
                  <Icon size={12} />
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{c?.name || 'Unknown'}</span>
                  <Chip tone="gray">{it.type}</Chip>
                  <span className="text-xs text-gray-400">{formatRelativeDay(it.date)}</span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{it.note}</p>
              </li>
            );
          })}
        </ol>
      </Section>

      <Section title="Meetings">
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {meetings.map((m) => {
            const c = contactById(m.contactId);
            const upcoming = m.status === 'upcoming';
            return (
              <div key={m.id} className="flex items-center gap-3 p-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${upcoming ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}`}>
                  <CalendarClock size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{m.title}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{c?.name} · {m.channel}</div>
                </div>
                <div className="text-right">
                  <Chip tone={upcoming ? 'violet' : 'gray'}>{upcoming ? 'Upcoming' : 'Completed'}</Chip>
                  <div className="text-[11px] text-gray-400 mt-1">{formatRelativeDay(m.date)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

// --- Referrals & warm intros -------------------------------------------------
const INTRO_STATUS = {
  made: { label: 'Made', tone: 'emerald' },
  pending: { label: 'Pending', tone: 'amber' },
  declined: { label: 'Declined', tone: 'gray' },
};

function ReferralsAndIntros() {
  const referrals = useMemo(() => [...REFERRALS].sort((a, b) => b.date.localeCompare(a.date)), []);
  const intros = useMemo(() => [...WARM_INTROS].sort((a, b) => b.date.localeCompare(a.date)), []);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <Section title="Warm introductions">
        {intros.length === 0 ? <EmptyState>No introductions yet.</EmptyState> : (
          <div className="space-y-2">
            {intros.map((w) => {
              const from = contactById(w.from);
              const to = contactById(w.to);
              const meta = INTRO_STATUS[w.status] || INTRO_STATUS.pending;
              return (
                <div key={w.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{from?.name}</span>
                    <ArrowRight size={13} className="text-gray-400" />
                    <span className="font-medium text-gray-900 dark:text-gray-100">{to?.name}</span>
                    <Chip tone={meta.tone} className="ml-auto">{meta.label}</Chip>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{w.note}</p>
                  <div className="text-[11px] text-gray-400 mt-1">{formatRelativeDay(w.date)}</div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Referrals">
        {referrals.length === 0 ? <EmptyState>No referrals yet.</EmptyState> : (
          <div className="space-y-2">
            {referrals.map((r) => {
              const referrer = contactById(r.referrer);
              const referred = contactById(r.referred);
              return (
                <div key={r.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    <Avatar name={referrer?.name} size={24} />
                    <span className="font-medium text-gray-900 dark:text-gray-100">{referrer?.name}</span>
                    <span className="text-xs text-gray-400">referred</span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{referred?.name}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-xs text-gray-600 dark:text-gray-400">{r.context}</p>
                    <span className="text-[11px] text-gray-400">{formatRelativeDay(r.date)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
