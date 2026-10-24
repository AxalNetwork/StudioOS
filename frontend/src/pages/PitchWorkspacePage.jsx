import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sparkles, FileText, Lock, Megaphone } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { hasTier } from '../sidebarConfig';
import { openPaywall } from '../components/PaywallModal';
import PitchDeckPage from './PitchDeckPage';
import PitchPositioningPage from './PitchPositioningPage';
import { EDIT_PATH, MOVED_KEY, MOVED_NOTICE, REVIEW_PATH } from './raise/pitch/pitchStudioModel';

// RAISE Workspaces (Task #1) — Pitch workspace.
//
// Collapses the former standalone founder nav items "Pitch Deck"
// (/build/deck) and "Pitch Deck Reviewer" (/build/deck-reviewer) into one
// workspace with two tabs, reusing both existing pages in `embedded` mode so a
// single workspace title governs. Old founder deep links redirect here to the
// right tab (see App.jsx). Frontend-only — no page logic, data, or API changes.
//
// The Deck Builder tab preserves the existing growth-tier gate (previously enforced
// on the "Pitch Deck" sidebar item): non-growth founders see an upgrade panel
// instead of the builder. The Review tab stays free for everyone, exactly as the
// standalone reviewer was.
//
// D894 (#2434): the builder now lives at /raise/pitch/edit inside the Pitch deck
// studio, and Review is the studio's own tab. Positioning stays here until the
// Investor narrative tool takes it (#2454). Each tab keeps the venture in the
// address; the Deck Builder tab used to drop it and land on the read-only page.

const TABS = [
  { id: 'deck', to: EDIT_PATH, label: 'Deck Builder', icon: Sparkles },
  { id: 'positioning', to: '/raise/investor-narrative/positioning', label: 'Positioning', icon: Megaphone },
  { id: 'review', to: REVIEW_PATH, label: 'Review', icon: FileText },
];

// Task #10 — Positioning shares the Deck Builder's Growth gate (its
// one-click generator hits a Growth-tier Worker endpoint).
const GROWTH_TABS = new Set(['deck', 'positioning']);

export default function PitchWorkspacePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const raiseSeed = location.state?.founderRaiseSeed;

  const active = location.pathname.startsWith('/raise/pitch/positioning') ? 'positioning' : 'deck';
  const deckLocked = !hasTier(user, 'growth');
  const params = new URLSearchParams(location.search);
  const moved = params.get('moved') === MOVED_KEY;
  const venture = params.get('project_id');
  const keep = venture ? `?project_id=${encodeURIComponent(venture)}` : '';
  const dismissMoved = () => {
    params.delete('moved');
    const q = params.toString();
    navigate({ pathname: location.pathname, search: q ? `?${q}` : '', hash: location.hash }, { replace: true });
  };

  return (
    <div data-testid="pitch-workspace" className="p-6 max-w-[1600px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-violet-600" /> Pitch
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Build your investor deck and get an honest, AI-driven review — all in one place.
        </p>
        {moved && (
          <div role="status" className="mt-4 flex items-center justify-between gap-3 rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3 py-2 text-[13px] text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100" data-testid="pitch-moved">
            <span>{MOVED_NOTICE}</span>
            <button type="button" aria-label="Dismiss" className="flex h-8 w-8 items-center justify-center text-[16px] leading-none" onClick={dismissMoved}>×</button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800 mb-6">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = active === t.id;
          const locked = GROWTH_TABS.has(t.id) && deckLocked;
          return (
            <button
              key={t.id}
              type="button"
              data-testid={`pitch-tab-${t.id}`}
              onClick={() => navigate(`${t.to}${keep}`)}
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

      {active === 'deck' && (deckLocked ? <LockedDeck /> : (
        <PitchDeckPage
          embedded
          initialProjects={raiseSeed?.projects}
          initialProjectId={raiseSeed?.projectId}
        />
      ))}
      {active === 'positioning' && (deckLocked ? <LockedDeck /> : <PitchPositioningPage embedded />)}
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
        Upgrade to Growth to auto-fill investor-ready decks from your startup, financials, and cap
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
