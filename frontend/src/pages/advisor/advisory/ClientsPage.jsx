import React, { useEffect, useMemo, useState } from 'react';
import { Mail } from 'lucide-react';
import { api } from '../../../lib/api';
import {
  Avatar, Chip, Section, SlideOver, EmptyState, StatCard, SearchInput,
  StatusBadge, RowCard, formatDateTime, formatRelativeDay, clientsFromBookings,
} from './kit';

// Clients — everyone who has booked this advisor, derived from their real
// bookings (Wave 1b; previously a fixture roster of invented companies with
// invented ARR and segment labels).
//
// There is no advisor_clients table, and inventing one would be the wrong
// answer: an advisor's client list IS their booking history. clientsFromBookings
// groups on founder_user_id so two people sharing a display name stay distinct.
export default function ClientsPage() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [noProfile, setNoProfile] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.getMyAdvisor();
        if (!me) { setNoProfile(true); setLoading(false); return; }
      } catch { setNoProfile(true); setLoading(false); return; }
      try {
        const r = await api.listMyAdvisorBookings();
        setBookings(r.items || []);
      } catch (e) { setError(e?.message || 'Could not load your clients.'); }
      setLoading(false);
    })();
  }, []);

  const clients = useMemo(() => clientsFromBookings(bookings), [bookings]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter((c) =>
      (c.name || '').toLowerCase().includes(needle)
      || (c.email || '').toLowerCase().includes(needle)
      || c.topics.some((t) => t.toLowerCase().includes(needle)));
  }, [clients, q]);

  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">Loading your clients…</div>;
  }
  if (noProfile) {
    return <EmptyState>You do not have an advisor profile yet, so there are no clients to show.</EmptyState>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-300">{error}</div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Clients" value={clients.length} hint="anyone who has booked you" />
        <StatCard label="Sessions held" value={clients.reduce((a, c) => a + c.completed, 0)} />
        <StatCard label="Returning" value={clients.filter((c) => c.total > 1).length} hint="booked more than once" />
      </div>

      <SearchInput value={q} onChange={setQ} placeholder="Search clients or topics" />

      <Section title={`Client roster (${filtered.length})`}>
        {filtered.length === 0 ? (
          <EmptyState>
            {clients.length === 0
              ? 'Nobody has booked you yet. Publish availability under Opportunities and your roster builds itself.'
              : 'No clients match your search.'}
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map((c) => (
              <RowCard key={c.id} onClick={() => setOpen(c)}>
                <div className="flex items-center gap-3">
                  <Avatar name={c.name} size={42} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{c.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {c.total} session{c.total === 1 ? '' : 's'} · last {formatRelativeDay(c.lastSeen)}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {c.upcoming > 0 && <Chip tone="blue">{c.upcoming} upcoming</Chip>}
                      {c.completed > 0 && <Chip tone="emerald">{c.completed} held</Chip>}
                    </div>
                  </div>
                </div>
              </RowCard>
            ))}
          </div>
        )}
      </Section>

      <SlideOver
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.name || ''}
        subtitle={open ? `${open.total} session${open.total === 1 ? '' : 's'}` : ''}
      >
        {open && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={open.name} size={56} />
              {open.email && (
                <a href={`mailto:${open.email}`} className="text-sm text-violet-600 hover:underline inline-flex items-center gap-1 break-all">
                  <Mail size={13} /> {open.email}
                </a>
              )}
            </div>

            {open.topics.length > 0 && (
              <Section title="Topics they have raised">
                <div className="flex flex-wrap gap-1.5">
                  {open.topics.map((t) => <Chip key={t} tone="violet">{t}</Chip>)}
                </div>
              </Section>
            )}

            <Section title="Session history">
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                {open.bookings.map((b) => (
                  <div key={b.id} className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-gray-900 dark:text-gray-100 truncate">{b.topic || 'Session'}</span>
                      <StatusBadge status={b.status} />
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{formatDateTime(b.scheduled_start || b.slot_starts_at)}</div>
                    {(b.client_message || b.questions || b.notes) && <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5">{b.client_message || b.questions || b.notes}</p>}
                  </div>
                ))}
              </div>
            </Section>

            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              Private per-client notes are not stored yet — what you see here is
              the booking record itself.
            </p>
          </div>
        )}
      </SlideOver>
    </div>
  );
}
