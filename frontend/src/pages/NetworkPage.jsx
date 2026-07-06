import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Network, Inbox, Users } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { ContactsPanel } from './ContactsPage';
import { RelationshipsPanel } from './RelationshipsPage';

// Task #1 — unified Network page. Merges the former Contacts inbox and the
// Network/Relationships surface into one page with two tabs (Contacts default,
// Relationships), selected via the ?tab= query param. Contacts is admin/founder
// only; partner/investor see Relationships alone (no tab bar). The legacy
// /contacts and /relationships routes redirect here.
export default function NetworkPage() {
  const { role } = useAuth();
  const [params, setParams] = useSearchParams();
  const canContacts = role === 'admin' || role === 'founder';

  const tabs = [
    ...(canContacts ? [{ id: 'contacts', label: 'Contacts', icon: Inbox }] : []),
    { id: 'relationships', label: 'Relationships', icon: Users },
  ];

  const requested = params.get('tab');
  let activeTab;
  if (requested === 'relationships') activeTab = 'relationships';
  else if (requested === 'contacts' && canContacts) activeTab = 'contacts';
  else activeTab = canContacts ? 'contacts' : 'relationships';

  const selectTab = (id) => {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    setParams(next, { replace: true });
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Network className="text-violet-600" size={24} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Network &amp; Relationships</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">Contacts, partner relationships, and your network graph in one place.</p>
        </div>
      </div>

      {tabs.length > 1 && (
        <div className="flex gap-1 border-b border-gray-200 overflow-x-auto [&>button]:whitespace-nowrap dark:border-gray-800">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button key={t.id} onClick={() => selectTab(t.id)}
                className={`flex items-center gap-1 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${active ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900 dark:hover:text-gray-200'}`}>
                <Icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>
      )}

      {activeTab === 'contacts' && canContacts
        ? <ContactsPanel />
        : <RelationshipsPanel />}
    </div>
  );
}
