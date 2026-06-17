// Task #40 (E2) — MyEventsPage: hosting + attending tabs.
// Hosting lists the events the caller owns (create / edit / manage); Attending
// lists the caller's tickets, each rendering a QR of its check-in code.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Calendar, MapPin, Users, Settings, Pencil, Ticket } from 'lucide-react';
import { eventsApi } from '../../lib/eventsApi';
import { useToast } from '../../components/useToast';
import PageExplainer from '../../components/PageExplainer';
import EventQRCode from '../../components/events/EventQRCode';

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  pending_review: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  published: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const REG_STATUS_STYLES = {
  registered: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  confirmed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  waitlisted: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  attended: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  declined: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

function fmtDate(value, tz) {
  if (!value) return 'Date TBD';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  try {
    return d.toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      ...(tz ? { timeZone: tz } : {}),
    });
  } catch { return d.toLocaleString(); }
}

function StatusBadge({ status, map = STATUS_STYLES }) {
  const cls = map[status] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {String(status || '').replace(/_/g, ' ') || 'draft'}
    </span>
  );
}

export default function MyEventsPage() {
  const [tab, setTab] = useState('hosting');
  const [hosting, setHosting] = useState([]);
  const [attending, setAttending] = useState([]);
  const [loading, setLoading] = useState(true);
  const { toast, showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await eventsApi.list();
      setHosting(Array.isArray(res?.hosting) ? res.hosting : (Array.isArray(res) ? res : []));
      setAttending(Array.isArray(res?.attending) ? res.attending : []);
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not load your events.' });
      setHosting([]); setAttending([]);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Events</h1>
        <Link
          to="/events/new"
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
        >
          <Plus size={16} /> New event
        </Link>
      </div>

      <PageExplainer pageKey="my_events" />

      <div className="mt-4 flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {[['hosting', 'Hosting', hosting.length], ['attending', 'Attending', attending.length]].map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === key
                ? 'border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {label}{count ? ` (${count})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="py-12 text-center text-gray-500 dark:text-gray-400">Loading…</p>
      ) : tab === 'hosting' ? (
        <HostingList events={hosting} />
      ) : (
        <AttendingList tickets={attending} />
      )}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${
          toast.kind === 'error' ? 'bg-red-600' : 'bg-gray-900 dark:bg-gray-700'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function HostingList({ events }) {
  if (!events.length) {
    return (
      <div className="py-12 text-center">
        <Calendar size={32} className="mx-auto text-gray-300 dark:text-gray-600" />
        <p className="mt-3 text-gray-500 dark:text-gray-400">You're not hosting any events yet.</p>
        <Link to="/events/new" className="mt-3 inline-block text-sm font-medium text-violet-700 dark:text-violet-300 hover:underline">
          Create your first event →
        </Link>
      </div>
    );
  }
  return (
    <ul className="mt-4 space-y-3">
      {events.map((ev) => (
        <li key={ev.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">{ev.title}</h3>
                <StatusBadge status={ev.status} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                <span className="inline-flex items-center gap-1"><Calendar size={14} /> {fmtDate(ev.starts_at, ev.timezone)}</span>
                {(ev.location_text || ev.location_kind) && (
                  <span className="inline-flex items-center gap-1"><MapPin size={14} /> {ev.location_text || ev.location_kind}</span>
                )}
                <span className="inline-flex items-center gap-1 capitalize"><Users size={14} /> {ev.visibility}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Link
                to={`/events/${ev.id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <Pencil size={14} /> Edit
              </Link>
              <Link
                to={`/events/${ev.id}/manage`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
              >
                <Settings size={14} /> Manage
              </Link>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AttendingList({ tickets }) {
  if (!tickets.length) {
    return (
      <div className="py-12 text-center">
        <Ticket size={32} className="mx-auto text-gray-300 dark:text-gray-600" />
        <p className="mt-3 text-gray-500 dark:text-gray-400">You don't have any tickets yet.</p>
      </div>
    );
  }
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2">
      {tickets.map((t) => {
        const code = t.checkin_code || t.code || t.qr_code;
        return (
          <li key={t.id || t.registration_id} className="flex gap-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">{t.title || t.event_title}</h3>
              <div className="mt-1 space-y-1 text-sm text-gray-500 dark:text-gray-400">
                <div className="inline-flex items-center gap-1"><Calendar size={14} /> {fmtDate(t.starts_at, t.timezone)}</div>
                {(t.location_text || t.location_kind) && (
                  <div className="inline-flex items-center gap-1"><MapPin size={14} /> {t.location_text || t.location_kind}</div>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge status={t.status} map={REG_STATUS_STYLES} />
                {t.comp ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    Free seat
                  </span>
                ) : null}
              </div>
            </div>
            {code ? (
              <div className="flex flex-col items-center">
                <EventQRCode value={code} size={120} />
                <span className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">Show at check-in</span>
              </div>
            ) : (
              <div className="flex w-[120px] items-center justify-center text-center text-[11px] text-gray-400 dark:text-gray-500">
                QR available once confirmed
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
