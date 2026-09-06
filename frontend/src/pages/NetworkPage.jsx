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
/**
 * `zoneActions` is forwarded, not interpreted: the caller hands this page a
 * `(zone, rows) => items` function and it calls it with whichever panel is on
 * screen. `/network` for an operator passes nothing and gets nothing.
 */
export default function NetworkPage({ embedded = false, zoneActions = null }) {
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

  // AND EMBEDDED, THE CARD IS THE WHOLE BODY. The note below tells the reader
  // that "the tabs below are what this page actually holds" — which is true on
  // this page's own mount and false inside the shell, where the tab row is
  // suppressed because the shell's zone pills already are that navigation. So
  // an operator on /network/organizations read the card and then an unlabelled
  // introductions list: a body the heading above it does not name, which is
  // the same route-says-one-thing-body-shows-another defect this bucket was
  // reported for, surviving in the one zone that has no body at all. A zone
  // with nothing behind it renders nothing behind it.
  const unservedAlone = embedded && Boolean(unservedZone);

  const selectTab = (id) => {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    // Stale proposition deep-links shouldn't survive a manual tab switch.
    next.delete('intro');
    setParams(next, { replace: true });
  };

  const content = (
    <div className={`${role === 'partner' || embedded ? 'space-y-6' : 'p-6 max-w-6xl mx-auto space-y-6'}`}>
      {/* Embedded, the shell above has already drawn the crumb, the heading
          and the sub-line for the zone the URL names. This block is the page's
          own title for its own mount, and rendering it inside the shell put a
          second, differently-worded heading under the first. */}
      {!embedded && (
        <div className="flex items-center gap-3">
          <Network className={role === 'partner' ? 'text-amber-600' : 'text-violet-600'} size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Network &amp; Relationships</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">Contacts, curated introductions, partner relationships, and your network graph in one place.</p>
          </div>
        </div>
      )}

      {unservedZone && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-gray-500">
            No store behind this yet
          </div>
          <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400">
            Grouping your network by company, fund or firm needs a link from a person you know to
            the organisation they are in, and nothing on this licence records one.{' '}
            {unservedAlone
              ? 'Relationships and Introductions above are what this page actually holds — neither is a stand-in for it.'
              : 'The tabs below are what this page actually holds — they are not a stand-in for it.'}
          </p>
        </div>
      )}

      {/* And embedded, the shell's zone pills ARE this navigation. Only a
          partner reaches this page through the shell (`networkRole` sends
          admins down the founder branch), and a partner cannot see Contacts —
          so these tabs are Introductions and Relationships, two of the three
          pills already sitting above them, wired to `?tab=` instead of to the
          route. Two rows navigating the same three places by two different
          mechanisms is how a zone route came to disagree with its own body. */}
      {!embedded && tabs.length > 1 && (
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

      {!unservedAlone && activeTab === 'contacts' && canContacts && <ContactsPanel />}
      {!unservedAlone && activeTab === 'introductions' && <IntroductionsPanel zoneActions={zoneActions && ((rows) => zoneActions('introductions', rows))} />}
      {!unservedAlone && activeTab === 'relationships' && <RelationshipsPanel zoneActions={zoneActions && ((rows) => zoneActions('relationships', rows))} />}
    </div>
  );

  // The advisor branch below has honoured `embedded` since #391; this one
  // never did, and it is the reason partner `/network/*` was the worst surface
  // in the product: `PartnerWorkspaceShell` draws its own header, its own tab
  // row and its own Worker AI rail, all of it inside the WorkspaceShell that
  // had already drawn each one. Three headings, two nav rows, two rails.
  if (role === 'partner') {
    if (embedded) return content;
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
