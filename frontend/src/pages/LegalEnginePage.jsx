import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Scale, Building2, Users, CalendarCheck, FileSignature, Globe2,
  ChevronRight, Lock, ArrowLeft,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { hasTier } from '../sidebarConfig';
import { openPaywall } from '../components/PaywallModal';
import IncorporatePage from './IncorporatePage';
import CofounderAgreementPage from './CofounderAgreementPage';
import CompliancePage from './CompliancePage';
import Section83bPage from './Section83bPage';

// RAISE Workspaces (Task #1) — Legal Engine workspace.
//
// A dashboard-style page that collapses the former standalone founder nav items
// "Incorporate" (/incorporate), "Co-Founder Agreement"
// (/incorporate/cofounder-agreement), "Compliance Calendar" (/compliance) and
// "83(b) Tracker" (/incorporate/83b) into a single hub. The dashboard shows four
// cards; selecting one deep-links to a sub-route that renders the existing
// detail page in `embedded` mode below the cards (master-detail). The standalone
// routes stay intact for the personas that share them.
//
// Frontend-only — no page logic, data, or API changes. The studio-tier gates
// previously on the "Co-Founder Agreement" and "83(b) Tracker" sidebar items are
// preserved on the corresponding cards (Founders & Agreements, Equity
// Elections): non-studio founders see a locked card + upgrade panel.

// Jurisdiction options. TODO: wire to a real per-project/company jurisdiction
// store or GET endpoint once one exists — today the selection is local-only and
// purely presentational (the underlying Incorporate wizard owns real state).
const JURISDICTIONS = [
  { id: 'us_de', label: 'United States — Delaware C-Corp' },
  { id: 'us_de_llc', label: 'United States — Delaware LLC' },
  { id: 'uk_ltd', label: 'United Kingdom — Ltd' },
  { id: 'sg_pte', label: 'Singapore — Pte Ltd' },
  { id: 'ee_oy', label: 'Estonia — OÜ' },
];

// Equity election types. Only US 83(b) is implemented today; the others are
// structural placeholders so additional jurisdictions can plug in later without
// reworking this workspace. TODO markers indicate where each would be wired.
const ELECTION_TYPES = [
  { id: 'us_83b', jurisdiction: 'US', label: 'US — 83(b) Election', implemented: true },
  // TODO: UK — s.431 election (ITEPA 2003 s.431). Not implemented.
  { id: 'uk_s431', jurisdiction: 'UK', label: 'UK — s.431 Election', implemented: false },
  // TODO: AU — ESS (Employee Share Scheme) election. Not implemented.
  { id: 'au_ess', jurisdiction: 'AU', label: 'AU — ESS Election', implemented: false },
];

const CARDS = [
  {
    id: 'incorporation',
    to: '/raise/legal-engine/incorporation',
    title: 'Incorporation',
    icon: Building2,
    summary: 'Pick a jurisdiction in a few questions and file your entity.',
    Component: IncorporatePage,
  },
  {
    id: 'founders',
    to: '/raise/legal-engine/founders',
    title: 'Founders & Agreements',
    icon: Users,
    summary: 'Vesting cliffs, IP assignment, decision rights, and exit/buyout.',
    requiredTier: 'studio',
    Component: CofounderAgreementPage,
  },
  {
    id: 'compliance',
    to: '/raise/legal-engine/compliance',
    title: 'Compliance & Filings',
    icon: CalendarCheck,
    summary: 'Recurring obligations to keep your entity in good standing.',
    Component: CompliancePage,
  },
  {
    id: 'equity',
    to: '/raise/legal-engine/equity',
    title: 'Equity Elections',
    icon: FileSignature,
    summary: '83(b) and equivalents — the deadlines that bite if you miss them.',
    requiredTier: 'studio',
    Component: Section83bPage,
  },
];

// Generic 3-state status pill. TODO: derive real state per card from backend
// data (incorporation order status, agreement/tracker existence, open
// compliance events). Placeholder defaults to "Not set up" for now.
function StatusPill({ state = 'not_set_up' }) {
  const cfg = {
    not_set_up: { label: 'Not set up', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
    in_progress: { label: 'In progress', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300' },
    complete: { label: 'Complete', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' },
  }[state] || { label: state, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

export default function LegalEnginePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  // Local-only jurisdiction selection (see JURISDICTIONS TODO above).
  const [jurisdiction, setJurisdiction] = useState(JURISDICTIONS[0].id);

  const activeId = CARDS.find((c) => location.pathname.startsWith(c.to))?.id || null;
  const activeCard = CARDS.find((c) => c.id === activeId) || null;
  const isLocked = (card) => !!card.requiredTier && !hasTier(user, card.requiredTier);

  const openCard = (card) => {
    if (isLocked(card)) {
      openPaywall(card.requiredTier);
      return;
    }
    navigate(card.to);
  };

  return (
    <div data-testid="legal-engine-workspace" className="p-6 max-w-[1600px] mx-auto">
      {/* Jurisdiction header */}
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Scale className="w-6 h-6 text-violet-600" /> Legal Engine
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Incorporation, founder paperwork, compliance, and equity elections — one legal hub.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <Globe2 size={16} className="text-gray-400" />
          <span className="hidden sm:inline">Jurisdiction</span>
          <select
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
            data-testid="legal-engine-jurisdiction"
            className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 dark:text-gray-100"
          >
            {JURISDICTIONS.map((j) => (
              <option key={j.id} value={j.id}>{j.label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Cards grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => {
          const Icon = card.icon;
          const locked = isLocked(card);
          const selected = card.id === activeId;
          return (
            <button
              key={card.id}
              type="button"
              data-testid={`legal-card-${card.id}`}
              onClick={() => openCard(card)}
              className={`group text-left rounded-2xl border p-5 transition-colors ${
                selected
                  ? 'border-violet-400 dark:border-violet-600 bg-violet-50/50 dark:bg-violet-950/20'
                  : 'border-gray-200 dark:border-gray-800 hover:border-violet-300 dark:hover:border-violet-700 bg-white dark:bg-gray-900'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300">
                  <Icon size={20} />
                </span>
                <div className="flex items-center gap-2">
                  <StatusPill state="not_set_up" />
                  {locked ? <Lock size={14} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-300 group-hover:text-violet-500" />}
                </div>
              </div>
              <div className="mt-3 font-semibold text-gray-900 dark:text-white">{card.title}</div>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{card.summary}</p>
              {locked && (
                <p className="mt-2 text-xs font-medium text-violet-600 dark:text-violet-300">Requires Studio plan</p>
              )}
            </button>
          );
        })}
      </div>

      {/* Master-detail: selected card renders its existing page embedded below */}
      {activeCard && (
        <div className="mt-8 border-t border-gray-200 dark:border-gray-800 pt-6" data-testid="legal-engine-detail">
          <button
            type="button"
            onClick={() => navigate('/raise/legal-engine')}
            className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 mb-4"
          >
            <ArrowLeft size={14} /> Back to Legal Engine
          </button>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{activeCard.title}</h2>
          </div>
          {isLocked(activeCard) ? (
            <LockedCard requiredTier={activeCard.requiredTier} />
          ) : (
            <activeCard.Component embedded />
          )}
        </div>
      )}
    </div>
  );
}

function LockedCard({ requiredTier }) {
  const label = requiredTier === 'studio' ? 'Studio' : 'Growth';
  return (
    <div className="max-w-xl mx-auto text-center border border-dashed border-gray-300 dark:border-gray-700 rounded-2xl p-10">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300">
        <Lock size={22} />
      </div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
        This is a {label} feature
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
        Upgrade to {label} to unlock it.
      </p>
      <button
        type="button"
        onClick={() => openPaywall(requiredTier)}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium"
      >
        Upgrade to {label}
      </button>
    </div>
  );
}
