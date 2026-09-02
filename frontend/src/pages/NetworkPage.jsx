import React from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Network, Inbox, Users, Sparkles } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { ContactsPanel } from './ContactsPage';
import { RelationshipsPanel } from './RelationshipsPage';
import IntroductionsPanel from './IntroductionsPanel';
import { AdvisorWorkspaceShell } from './advisor/AdvisorWorkspaceShell';
import PartnerWorkspaceShell from './partner/PartnerWorkspaceShell';

// Task #1 — unified Network page. Merges the former Contacts inbox and the
// Network/Relationships surface into one page with tabs selected via the
// ?tab= query param. Contacts is admin/founder only; other roles see the
// remaining tabs. The legacy /contacts and /relationships routes redirect here.
//
// Introductions — curated warm-intro propositions for EVERY user type,
// deliberately a tab here (not a sidebar entry) so the feature lives under
// Network only. Notification deep links land on ?tab=introductions&intro=<uid>.
// `embedded`: set by NetworkWorkspace, which already wraps this page in
// `workspaces/WorkspaceShell` — breadcrumb, h1, zone pills and Worker AI rail.
// Without it the advisor branch below drew a second header and a second rail
// inside the first. The investor arm has had this seam since #391.
//
// THE TAB FOLLOWS THE PATH. `?tab=` was the ONLY input for years, which was
// fine while `/network` was the single URL. Once `/network/relationships`,
// `/network/introductions` and `/network/organizations` became real routes,
// every one of them landed on this page's default tab — Contacts for a
// founder, Introductions for anyone who cannot see Contacts. So the route said
// Relationships and the body showed something else, on two licences at once.
// The query param still wins where it is set, because notification deep links
// (`?tab=introductions&intro=<uid>`) depend on it; the path is the fallback
// beneath it, and the hardcoded default is the fallback beneath that.
export default function NetworkPage({ embedded = false }) {
  const { role } = useAuth();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const canContacts = role === 'admin' || role === 'founder';

  const tabs = [
    ...(canContacts ? [{ id: 'contacts', label: 'Contacts', icon: Inbox }] : []),
    { id: 'introductions', label: 'Introductions', icon: Sparkles },
    { id: 'relationships', label: 'Relationships', icon: Users },
  ];

  const fromPath = location.pathname.startsWith('/network/')
    ? location.pathname.slice('/network/'.length).split('/')[0]
    : null;
  const requested = params.get('tab') || fromPath;
  let activeTab;
  if (requested === 'relationships') activeTab = 'relationships';
  else if (requested === 'introductions') activeTab = 'introductions';
  else if (requested === 'contacts' && canContacts) activeTab = 'contacts';
  else activeTab = canContacts ? 'contacts' : 'introductions';

  // A zone this page has no tab for. `organizations` is the live case: the
  // route exists for every licence, but the roll-up needs an edge from a person
  // to an organisation and this page has none — so rather than silently
  // showing a different tab under the Organizations heading, it says so.
  const unservedZone = fromPath && !params.get('tab')
    && !['relationships', 'introductions', 'contacts'].includes(fromPath)
    ? fromPath : null;

  const selectTab = (id) => {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    // Stale proposition deep-links shouldn't survive a manual tab switch.
    next.delete('intro');
    setParams(next, { replace: true });
  };

  const content = (
    <div className={`${role === 'partner' ? 'space-y-6' : 'p-6 max-w-6xl mx-auto space-y-6'}`}>
      <div className="flex items-center gap-3">
        <Network className={role === 'partner' ? 'text-amber-600' : 'text-violet-600'} size={24} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Network &amp; Relationships</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">Contacts, curated introductions, partner relationships, and your network graph in one place.</p>
        </div>
      </div>

      {unservedZone && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-gray-500">
            No store behind this yet
          </div>
          <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400">
            Grouping your network by company, fund or firm needs a link from a person you know to
            the organisation they are in, and nothing on this licence records one. The tabs below
            are what this page actually holds — they are not a stand-in for it.
          </p>
        </div>
      )}

      {tabs.length > 1 && (
        <div className="flex gap-1 border-b border-gray-200 overflow-x-auto no-scrollbar [&>button]:whitespace-nowrap dark:border-gray-800">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button key={t.id} onClick={() => selectTab(t.id)}
                className={`flex items-center gap-1 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                  active
                    ? role === 'partner'
                      ? 'border-amber-500 text-amber-700 dark:text-amber-300'
                      : 'border-violet-600 text-violet-700'
                    : 'border-transparent text-gray-600 hover:text-gray-900 dark:hover:text-gray-200'
                }`}>
                <Icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>
      )}

      {activeTab === 'contacts' && canContacts && <ContactsPanel />}
      {activeTab === 'introductions' && <IntroductionsPanel />}
      {activeTab === 'relationships' && <RelationshipsPanel />}
    </div>
  );

  if (role === 'partner') {
    return (
      <PartnerWorkspaceShell workspace="network" icon={Network}>
        {content}
      </PartnerWorkspaceShell>
    );
  }
  if (role === 'advisor') {
    return (
      <AdvisorWorkspaceShell
        eyebrow="Network"
        title="Work my relationships"
        description="Keep warm introductions, relationships, and consented contact context in one scoped workspace."
        icon={Network}
        rail
        embedded={embedded}
      >
        {content}
      </AdvisorWorkspaceShell>
    );
  }
  return content;
}
