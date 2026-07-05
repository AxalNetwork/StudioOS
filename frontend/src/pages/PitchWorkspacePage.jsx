import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sparkles, FileText, Lock } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { hasTier } from '../sidebarConfig';
import { openPaywall } from '../components/PaywallModal';
import PitchDeckPage from './PitchDeckPage';
import DeckReviewerPage from './DeckReviewerPage';

// RAISE Workspaces (Task #1) — Pitch workspace.
//
// Collapses the former standalone founder nav items "Pitch Deck"
// (/build/deck) and "Pitch Deck Reviewer" (/build/deck-reviewer) into one
// workspace with two tabs, reusing both existing pages in `embedded` mode so a
// single workspace title governs. Old founder deep links redirect here to the
// right tab (see App.jsx). Frontend-only — no page logic, data, or API changes.
//
// The Edit Deck tab preserves the existing growth-tier gate (previously enforced
// on the "Pitch Deck" sidebar item): non-growth founders see an upgrade panel
// instead of the builder. The Review tab stays free for everyone, exactly as the
// standalone reviewer was.

const TABS = [
  { id: 'deck', to: '/raise/pitch', label: 'Edit Deck', icon: Sparkles },
  { id: 'review', to: '/raise/pitch/review', label: 'Review', icon: FileText },
];

export default function PitchWorkspacePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const active = location.pathname.startsWith('/raise/pitch/review') ? 'review' : 'deck';
  const deckLocked = !hasTier(user, 'growth');

  return (
    <div data-testid="pitch-workspace" className="p-6 max-w-[1600px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-violet-600" /> Pitch
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Build your investor deck and get an honest, AI-driven review — all in one place.
        </p>
      </div>

      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800 mb-6">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = active === t.id;
          const locked = t.id === 'deck' && deckLocked;
          return (
            <button
              key={t.id}
              type="button"
              data-testid={`pitch-tab-${t.id}`}
              onClick={() => navigate(t.to)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive
                  ? 'border-violet-600 text-violet-700 dark:text-violet-300'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <Icon size={16} /> {t.label}
              {locked && <Lock size={12} className="text-gray-400" />}
            </button>
          );
        })}
      </div>

      {active === 'deck' && (deckLocked ? <LockedDeck /> : <PitchDeckPage embedded />)}
      {active === 'review' && <DeckReviewerPage embedded />}
    </div>
  );
}

function LockedDeck() {
  return (
    <div className="max-w-xl mx-auto text-center border border-dashed border-gray-300 dark:border-gray-700 rounded-2xl p-10">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300">
        <Sparkles size={22} />
      </div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
        The Pitch Deck Builder is a Growth feature
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
        Upgrade to Growth to auto-fill investor-ready decks from your project, financials, and cap
        table. The Review tab stays free.
      </p>
      <button
        type="button"
        onClick={() => openPaywall('growth')}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium"
      >
        Upgrade to Growth
      </button>
    </div>
  );
}
