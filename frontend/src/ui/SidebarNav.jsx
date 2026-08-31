import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Building2, ChevronDown, ChevronLeft, ChevronRight, Lock as LockIcon, Search, X } from 'lucide-react';
import { openPaywall } from '../components/PaywallModal';
import { defaultOpenGroups, hasTier, hasInvestorTier } from '../sidebarConfig';
import { safeReadJSON } from '../lib/storage';
import CompanySwitcher from './CompanySwitcher';

/**
 * SidebarNav — the left navigation, lifted out of App.jsx unchanged.
 *
 * The design canvases include their own left rail, but the pattern census found
 * this implementation already beats it on every axis that matters: collapsed
 * mode, the sidebar search filter, tier locks with the paywall modal, and
 * persistence. The census's recommendation was therefore to LIFT this, not
 * rebuild from the canvas — so this file is a pure extraction from App.jsx
 * (which was 2,190 lines) with no behaviour change. Any visual or functional
 * difference from before the move is a bug, not an improvement.
 *
 * Rendered by ProtectedLayout on every authenticated route. Its `groups` come
 * from getSidebarGroups() in sidebarConfig.js, keyed by the active role.
 *
 * Note the render order, which is the app's universal chrome and is deliberate:
 * CompanySwitcher → search filter → role groups → Company Settings. The search
 * here is a client-side filter over already-rendered nav labels; it is NOT the
 * global Vectorize-backed /search.
 */

export default function SidebarNav({ groups, role, onNavigate, user, collapsed, onCollapse, onClose }) {
  const navLocation = useLocation();
  const advisorAccent = role === 'advisor';
  const partnerAccent = role === 'partner';
  const [query, setQuery] = useState('');
  // Persisted open-state per group key. We seed once from
  // localStorage merged with `defaultOpenGroups()` so first-time users
  // land with Home + the first content group expanded.
  const [openKeys, setOpenKeys] = useState(() => {
    const stored = safeReadJSON('sidebar_open_groups');
    if (stored && typeof stored === 'object') {
      return new Set(Object.keys(stored).filter((k) => stored[k]));
    }
    // Seed defaults from the first role we render — refined per render below.
    return new Set();
  });
  const [seeded, setSeeded] = useState(false);

  // Lazy-seed defaults once we know the role's group keys (groups change
  // when the admin toggles "View as"). We only seed when localStorage
  // had nothing for us (first visit).
  useEffect(() => {
    if (seeded) return;
    const stored = safeReadJSON('sidebar_open_groups');
    if (stored && typeof stored === 'object' && Object.keys(stored).length > 0) {
      setSeeded(true);
      return;
    }
    const defaults = role ? defaultOpenGroups(role) : new Set(groups.slice(0, 2).map((g) => g.key));
    setOpenKeys(defaults);
    setSeeded(true);
  }, [groups, role, seeded]);

  const persistOpen = useCallback((next) => {
    const obj = {};
    next.forEach((k) => { obj[k] = true; });
    try { localStorage.setItem('sidebar_open_groups', JSON.stringify(obj)); } catch { /* ignore */ }
  }, []);

  const toggleGroup = useCallback((key) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      persistOpen(next);
      return next;
    });
  }, [persistOpen]);

  const q = query.trim().toLowerCase();
  // When the user types, force-expand any group with a match so the
  // matching items are visible without manual clicking.
  const effectiveOpen = q
    ? new Set(groups.filter((g) => g.items.some((it) => it.label.toLowerCase().includes(q))).map((g) => g.key))
    : openKeys;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <CompanySwitcher collapsed={collapsed} />
      <div className="px-3 pb-2 pt-2 flex-none">
        {!collapsed ? (
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                aria-label="Search sidebar"
                className={`w-full pl-8 pr-2 py-1.5 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 focus:bg-white dark:focus:bg-gray-900 focus:outline-none focus:ring-2 placeholder:text-gray-400 dark:placeholder:text-gray-500 ${
                  partnerAccent ? 'focus:ring-amber-500/40 focus:border-amber-400' : 'focus:ring-violet-500/40 focus:border-violet-400'
                }`}
              />
            </div>
            {onCollapse && (
              <button
                type="button"
                onClick={onCollapse}
                className="hidden lg:inline-flex flex-none items-center justify-center w-7 h-7 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
              >
                <ChevronLeft size={15} />
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="lg:hidden flex-none inline-flex items-center justify-center w-7 h-7 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label="Close menu"
                title="Close menu"
              >
                <X size={15} />
              </button>
            )}
          </div>
        ) : (
          onCollapse && (
            <div className="flex justify-center pt-0.5">
              <button
                type="button"
                onClick={onCollapse}
                className="hidden lg:inline-flex items-center justify-center w-7 h-7 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label="Expand sidebar"
                title="Expand sidebar"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          )
        )}
      </div>
      <nav className="flex-1 overflow-y-auto min-h-0 py-2" aria-label="Primary navigation" data-tour="sidebar-nav">
      {groups.map((group) => {
        const visibleItems = q
          ? group.items.filter((it) => it.label.toLowerCase().includes(q))
          : group.items;
        // An empty group is never a header. The guard used to be `q &&`, so it
        // only fired while searching — which left the admin sidebar rendering a
        // dead "ACCOUNT" row: commit 7c93b83e moved the last item out of that
        // group and left the declaration behind, so it expanded to nothing.
        // Found by documentation/architecture/PAGE_INVENTORY.md, which counts a
        // role's groups from their items.
        if (visibleItems.length === 0) return null;
        const isHeaderless = group.key === 'home' || !group.label;
        // Home and explicitly-unlabelled role shells render flat and always open.
        const isOpen = isHeaderless ? true : (collapsed ? true : effectiveOpen.has(group.key));
        return (
          <div key={group.key} className="mb-0.5">
            {isHeaderless ? null : collapsed ? (
              <div
                className="px-2 pt-3 pb-1 text-[9px] font-semibold uppercase tracking-wider text-gray-400 text-center"
                title={group.label}
              >
                {group.label}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                aria-expanded={isOpen}
                className="w-full flex items-center gap-1 px-5 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                <span>{group.label}</span>
              </button>
            )}
            {isOpen && visibleItems.map((item) => {
              const { to, icon: Icon, label, highlight, requiredTier, requiredInvestorTier, match } = item;
              const abbr = abbreviateLabel(label);
              // Task #12 — items may declare `match` (path prefixes) so a
              // consolidated destination (e.g. Execution) highlights across
              // all of its sub-views instead of only its exact `to` path.
              const manualActive = Array.isArray(match)
                ? navLocation.pathname === to
                  || navLocation.pathname.startsWith(`${to}/`)
                  || match.some((p) => navLocation.pathname === p || navLocation.pathname.startsWith(`${p}/`))
                : null;
              // Task #6 / #7 — items the user can't afford render as a
              // "locked" button that opens PaywallModal. Bypass roles + users
              // on the right tier render as normal NavLinks. Investor tier
              // gates take precedence when present (investor-only nav).
              const founderLocked = !!requiredTier && !hasTier(user, requiredTier);
              const investorLocked = !!requiredInvestorTier && !hasInvestorTier(user, requiredInvestorTier);
              const locked = founderLocked || investorLocked;
              if (locked) {
                const lockTier = investorLocked ? requiredInvestorTier : requiredTier;
                const lockLabel = lockTier === 'institutional' ? 'Institutional'
                  : lockTier === 'professional' ? 'Professional'
                  : lockTier === 'studio' ? 'Studio'
                  : 'Growth';
                return (
                  <button
                    key={to}
                    type="button"
                    onClick={() => openPaywall(lockTier)}
                    className={collapsed
                      ? 'w-full flex flex-col items-center gap-0.5 px-1 py-2 text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors'
                      : 'w-full flex items-center gap-3 px-5 py-2 text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors'}
                    title={`${label} — requires ${lockLabel} plan`}
                  >
                    {Icon && <Icon size={collapsed ? 18 : 16} />}
                    {collapsed ? (
                      <span className="truncate w-full text-center">{abbr}</span>
                    ) : (
                      <>
                        <span className="truncate flex-1 text-left">{highlightMatch(label, q)}</span>
                        <LockIcon size={11} className="flex-shrink-0" />
                      </>
                    )}
                  </button>
                );
              }
              return (
                <NavLink
                  key={to}
                  to={to}
                  end={manualActive === null}
                  onClick={onNavigate}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) => {
                    const active = manualActive === null ? isActive : manualActive;
                    return collapsed
                      ? `flex flex-col items-center gap-0.5 px-1 py-2 text-[10px] transition-colors ${
                          active
                            ? advisorAccent
                              ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-r-2 border-emerald-600'
                              : partnerAccent
                                ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-r-2 border-amber-500'
                                : 'text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 border-r-2 border-violet-600'
                            : highlight
                              ? 'text-violet-700 dark:text-violet-300 font-medium bg-violet-50/60 dark:bg-violet-900/20 hover:bg-violet-100 dark:hover:bg-violet-900/40'
                              : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`
                      : `flex items-center gap-3 px-5 py-2 text-sm transition-colors ${
                          active
                            ? advisorAccent
                              ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-r-2 border-emerald-600'
                              : partnerAccent
                                ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-r-2 border-amber-500'
                                : 'text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 border-r-2 border-violet-600'
                            : highlight
                              ? 'text-violet-700 dark:text-violet-300 font-medium bg-violet-50/60 dark:bg-violet-900/20 hover:bg-violet-100 dark:hover:bg-violet-900/40'
                              : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`;
                  }}
                >
                  {Icon && <Icon size={collapsed ? 18 : 16} />}
                  {collapsed ? (
                    <span className="truncate w-full text-center">{abbr}</span>
                  ) : (
                    <span className="truncate">{highlightMatch(label, q)}</span>
                  )}
                </NavLink>
              );
            })}
          </div>
        );
      })}
    </nav>
    <div className="flex-none border-t border-gray-200 dark:border-gray-700">
      <NavLink
        to="/company-settings"
        onClick={onNavigate}
        className={({ isActive }) =>
          collapsed
            ? `flex flex-col items-center gap-0.5 px-1 py-2.5 text-[10px] w-full transition-colors ${isActive ? partnerAccent ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40' : 'text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800'}`
            : `flex items-center gap-3 px-5 py-2.5 text-sm w-full transition-colors ${isActive ? partnerAccent ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40' : 'text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800'}`
        }
        title={collapsed ? 'Company Settings' : undefined}
      >
        <Building2 size={collapsed ? 18 : 16} />
        {collapsed ? (
          <span className="truncate w-full text-center">Co.</span>
        ) : (
          <span className="truncate">Company Settings</span>
        )}
      </NavLink>
    </div>
    </div>
  );
}

// Highlight matching substring inside a label. Returns a JSX-friendly
// fragment when there's a match, otherwise the plain label.
function highlightMatch(label, query) {
  if (!query) return label;
  const lower = label.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return label;
  return (
    <>
      {label.slice(0, idx)}
      <mark className="bg-yellow-200 text-gray-900 rounded px-0.5">
        {label.slice(idx, idx + query.length)}
      </mark>
      {label.slice(idx + query.length)}
    </>
  );
}

// Sidebar abbreviations for the collapsed rail. First letter of each word
// (split on whitespace and hyphens), filtering out filler words, capped at
// 3 chars. Examples: Dashboard→D, Admin Console→AC, Pipeline Board→PB,
// Refer & Earn→RE.
function abbreviateLabel(label) {
  if (!label) return '';
  const parts = String(label).split(/[\s\-/&]+/).filter((w) => {
    if (!w) return false;
    return !/^(and|the|of|a|to|for|on|in|my)$/i.test(w);
  });
  return parts.map((w) => w[0].toUpperCase()).join('').slice(0, 3) || label[0].toUpperCase();
}
