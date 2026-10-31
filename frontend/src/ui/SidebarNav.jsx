import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Building2, ChevronDown, ChevronLeft, ChevronRight, Lock as LockIcon, Search, X } from 'lucide-react';
import { openPaywall } from '../components/PaywallModal';
import { defaultOpenGroups, hasTier, hasInvestorTier } from '../sidebarConfig';
import { safeReadJSON } from '../lib/storage';
import { hqRowFor } from '../lib/hqStrips.js';
import CompanySwitcher from './CompanySwitcher';
import { usePhoneWidth } from './phone/usePhoneWidth';
import { useActiveCompany } from '../contexts/ActiveCompanyContext';
import { BILLING_PATH, useScopeInView } from '../lib/settingsScope.js';
import useLicenceNeeds from '../hooks/useLicenceNeeds';
import { needsCount } from '../lib/licencePage';

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
 * CompanySwitcher → search filter → role groups → Companies and projects (D1140). The search
 * here is a client-side filter over already-rendered nav labels; it is NOT the
 * global Vectorize-backed /search.
 */

export default function SidebarNav({ groups, role, onNavigate, user, collapsed, onCollapse, onClose }) {
  const navLocation = useLocation();
  // D1497 (#3727, TM1e–TM1i): the bottom block follows the scope in view.
  const { company: activeCompany } = useActiveCompany();
  const settingsScope = useScopeInView(activeCompany);
  // D800 (#2233): a row may name a count (`count: 'licence_needs'`, the
  // Licences row), drawn as a pill beside its label. Read only when a row asks
  // for it; an unread or zero count draws nothing, never "0".
  const wantsLicenceNeeds = groups.some((g) => (g.items || []).some((i) => i.count === 'licence_needs'));
  const licenceNeeds = useLicenceNeeds(wantsLicenceNeeds);
  const rowCounts = { licence_needs: needsCount(licenceNeeds) };
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
  // D285 / H36 — in the HQ shell a strip's pages light the strip's row, even
  // where an item's address sits under another row's path (/monitoring is
  // Platform's). When it names a row, that row and no other is active, and
  // the path-only rules below decide nothing. D938: no admin page lives on a
  // query any more, so the Admin shell's rows light by path and `match` alone.
  const derivedRow = role === 'super_admin' ? hqRowFor(navLocation.pathname) : null;
  // When the user types, force-expand any group with a match so the
  // matching items are visible without manual clicking.
  const effectiveOpen = q
    ? new Set(groups.filter((g) => g.items.some((it) => it.label.toLowerCase().includes(q))).map((g) => g.key))
    : openKeys;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <CompanySwitcher collapsed={collapsed} role={role} />
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
              //
              // When `match` is present it is the COMPLETE statement of what
              // the row owns. The row's own `to` still matches exactly, but its
              // SUBTREE does not match implicitly, because one row's `to` can
              // be a prefix of paths another row owns: `/build` is the Build
              // overview, while `/build/discovery` is Validate's and
              // `/build/team` is Grow's. The implicit `${to}/` prefix lit all
              // three rows at once. Every row that declares `match` already
              // lists its own subtree there when it wants it, so no other row
              // loses coverage.
              const manualActive = Array.isArray(match)
                ? navLocation.pathname === to
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
                  : lockTier === 'plus' ? 'Plus'
                  : lockTier === 'studio' ? 'Raise + Grow'
                  : 'Validate + Build';
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
                    const active = derivedRow !== null
                      ? to === derivedRow
                      : (manualActive === null ? isActive : manualActive);
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
                    <>
                      <span className="truncate">{highlightMatch(label, q)}</span>
                      {item.count && rowCounts[item.count] > 0 && (
                        <span className="ml-auto rounded-full bg-slate-700 px-1.5 py-px font-mono text-[10.5px] font-bold text-white" data-testid="nav-row-count">
                          {rowCounts[item.count]}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        );
      })}
    </nav>
    <div className="flex-none border-t border-gray-200 dark:border-gray-700">
      {settingsScope ? <SettingsScopeBlock scope={settingsScope} collapsed={collapsed} onNavigate={onNavigate} activeUid={activeCompany?.uid || null} /> : null}
      {/* D1140 (#3020, CMP19a): the last row is Companies and projects; Company Settings moved under it. */}
      <NavLink
        to="/account/portfolio"
        onClick={onNavigate}
        className={({ isActive }) =>
          collapsed
            ? `flex flex-col items-center gap-0.5 px-1 py-2.5 text-[10px] w-full transition-colors ${isActive ? partnerAccent ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40' : 'text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800'}`
            : `flex items-center gap-3 px-5 py-2.5 text-sm w-full transition-colors ${isActive ? partnerAccent ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40' : 'text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800'}`
        }
        title={collapsed ? 'Companies and projects' : undefined}
      >
        <Building2 size={collapsed ? 18 : 16} />
        {collapsed ? (
          <span className="truncate w-full text-center">Co.</span>
        ) : (
          <span className="truncate">Companies and projects</span>
        )}
      </NavLink>
    </div>
    </div>
  );
}

/**
 * D1497 (#3727, TM1e–TM1i) — the sidebar's bottom block, by scope (the owner's
 * rule, 2026-10-31): "Company settings" with Team · Company settings (General,
 * Legal) · Projects in a company or a project inside one; "Project settings"
 * with Team · Project settings (General) in a standalone project, which has no
 * Legal entry because it is not a legal entity. Billing is not in the block: it
 * is a link to Account › Billing under it, still marked "pending owner" as
 * #3727's authority addendum leaves it. `lib/settingsScope.js` decides the
 * entries; this draws them.
 *
 *   desktop  every entry and its children; a parent whose child is the same
 *            page is a group label, not a second link to it; the block
 *            scrolls on its own so a long project list never pushes the
 *            footer off screen.
 *   drawer   (below 1024px, where this same component is the phone drawer) one row
 *            per top-level entry, its sub-label right-aligned ("General ·
 *            Legal", "Projects [2]"), children hidden (TM1i).
 *
 * An entry with no address yet (the company's Legal page) is drawn off, with
 * its reason, never as a link that 404s; so is a page that reads only the
 * company active on this device (`activeOnly`) when another company is in view.
 */
const SCOPE_ROW = 'flex items-center gap-2 py-1.5 text-[13px] w-full transition-colors';
const SCOPE_PAD = (depth) => (depth ? (depth > 1 ? 'pl-12 pr-5' : 'pl-9 pr-5') : 'px-5');
const scopeRowClass = (isActive, depth) => `${SCOPE_ROW} ${SCOPE_PAD(depth)} ${isActive ? 'text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 font-semibold' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800'}`;
const NOT_ACTIVE_HERE = 'Full company settings open for the company active on this device. Make it active from its page.';

/** The entry as it can be drawn for this viewer: off with a reason when its page would not serve them. */
function reachable(entry, scope, activeUid) {
  if (entry.activeOnly && scope.company?.uid && scope.company.uid !== activeUid) return { ...entry, path: null, reason: NOT_ACTIVE_HERE };
  return entry;
}

function ScopeRow({ entry, depth, onNavigate, aside = null, group = false }) {
  const tail = aside ? <span className="ml-auto shrink-0 font-mono text-[11px] text-gray-400 dark:text-gray-500">{aside}</span> : null;
  if (entry.path && !group) {
    return (
      <NavLink to={entry.path} end onClick={onNavigate} className={({ isActive }) => scopeRowClass(isActive, depth)} data-testid={`scope-row-${entry.key}`}>
        <span className="truncate">{entry.label}</span>{tail}
      </NavLink>
    );
  }
  return (
    <span className={`${SCOPE_ROW} ${SCOPE_PAD(depth)} ${entry.reason ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-300'}`}
      aria-disabled={entry.reason ? 'true' : undefined} title={entry.reason || undefined} data-testid={`scope-row-${entry.key}`}>
      <span className="truncate">{entry.label}</span>{tail}
    </span>
  );
}

function ScopeEntry({ entry: raw, depth, onNavigate, scope, activeUid }) {
  const entry = reachable(raw, scope, activeUid);
  const children = entry.children || [];
  // A parent whose own page is one of its children is drawn as their label, so one page never lights two rows.
  const group = children.some((c) => c.path && c.path === raw.path);
  return (
    <>
      <ScopeRow entry={entry} depth={depth} onNavigate={onNavigate} group={group} />
      {children.map((c) => <ScopeEntry key={c.key} entry={c} depth={depth + 1} onNavigate={onNavigate} scope={scope} activeUid={activeUid} />)}
    </>
  );
}

const subOf = (e) => e.sub || (e.count != null ? `[${e.count}]` : null);

export function SettingsScopeBlock({ scope, collapsed, onNavigate, drawer: forced, activeUid = null }) {
  const phone = usePhoneWidth();
  const drawer = forced ?? phone;
  if (collapsed) {
    const top = scope.entries.map((e) => reachable(e, scope, activeUid)).filter((e) => e.path).slice(0, 2);
    return (
      <div className="flex flex-col py-1" data-testid="settings-scope-block" data-scope={scope.kind}>
        {top.map((e) => {
          const name = e.key === 'team' ? `${scope.label} · Team` : e.label;
          return (
            <NavLink key={e.key} to={e.path} end onClick={onNavigate} title={name} aria-label={name}
              className={({ isActive }) => `flex flex-col items-center gap-0.5 px-1 py-2 text-[10px] w-full ${isActive ? 'text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
              <span className="truncate w-full text-center" aria-hidden="true">{e.key === 'team' ? 'Team' : 'Set.'}</span>
            </NavLink>
          );
        })}
      </div>
    );
  }
  return (
    <nav aria-label={scope.label} className={`flex flex-col py-2 ${drawer ? '' : 'max-h-[38vh] overflow-y-auto'}`} data-testid="settings-scope-block" data-scope={scope.kind} data-form={drawer ? 'drawer' : 'desktop'}>
      <span className="px-5 pb-1 font-mono text-[10.5px] font-semibold uppercase tracking-[.11em] text-gray-500 dark:text-gray-400" data-testid="settings-scope-label">{scope.label}</span>
      {drawer
        ? scope.entries.map((e) => <ScopeRow key={e.key} entry={reachable(e, scope, activeUid)} depth={0} onNavigate={onNavigate} aside={subOf(e)} />)
        : scope.entries.map((e) => <ScopeEntry key={e.key} entry={e} depth={0} onNavigate={onNavigate} scope={scope} activeUid={activeUid} />)}
      <span className="flex flex-wrap items-center gap-1.5 px-5 pt-2">
        <NavLink to={BILLING_PATH} onClick={onNavigate} className="text-[12px] text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100" data-testid="settings-scope-billing">
          Billing · in Account ↗
        </NavLink>
        <span className="rounded-full border border-dashed border-gray-300 px-1.5 text-[10px] font-semibold text-gray-500 dark:border-gray-600 dark:text-gray-400" data-testid="settings-scope-billing-pending">pending owner</span>
      </span>
    </nav>
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
