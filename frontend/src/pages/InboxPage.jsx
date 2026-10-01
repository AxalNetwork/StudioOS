import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCheck, Settings as SettingsIcon } from 'lucide-react';
import { api } from '../lib/api';
import NotificationList from '../components/NotificationList';

/**
 * `/inbox` — the notifications the bell shows, at an address (D144).
 *
 * WHY THIS PAGE EXISTS, and it is not "the inbox was missing". The inbox was
 * already built: `components/NotificationBell.jsx` is mounted in the shell and
 * reads `api.listNotifications()`, with per-row navigation, mark-one-read and
 * mark-all-read. Every worker route behind it exists
 * (`routes/notifications.ts`, mounted at `/api/notifications`).
 *
 * WHAT WAS MISSING IS A URL. `services/notify.ts` builds `${root}/inbox` into
 * the mail it sends — its own comment calls it "the in-app inbox at `/inbox`" —
 * and `App.jsx` registered no such route, so every notification email carried a
 * link to a 404. A dropdown cannot be linked to; that is the whole gap, and it
 * is why this is a page rather than a store. No migration, no new `/api/*`
 * method.
 *
 * THE ROWS COME FROM `NotificationList`, THE SAME COMPONENT THE BELL RENDERS.
 * Writing them again here is the obvious shortcut and the thing to avoid: two
 * renderings drift, and what they would drift about is what a person believes
 * they were told.
 */
export default function InboxPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unreadable, setUnreadable] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listNotifications();
      setItems(r?.notifications || []);
      setUnreadable(false);
    } catch {
      // A failed read is not an empty inbox — the list renders which one.
      setItems([]);
      setUnreadable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onItemClick = async (n) => {
    if (!n.read_at) {
      try { await api.markNotificationsRead({ ids: [n.id] }); } catch {}
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
    }
    if (n.link) navigate(n.link);
  };

  const markAll = async () => {
    setBusy(true);
    try { await api.markNotificationsRead({ all: true }); } catch {}
    setItems((prev) => prev.map((x) => (x.read_at ? x : { ...x, read_at: new Date().toISOString() })));
    setBusy(false);
  };

  const unread = items.filter((n) => !n.read_at).length;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Notifications</h1>
          <p className="mt-1 text-[12.5px] text-gray-500 dark:text-gray-400">
            {unreadable
              ? 'This list could not be loaded.'
              : `Everything the platform has sent you${unread ? ` · ${unread} unread` : ''}.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={markAll}
            disabled={busy || !unread}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <CheckCheck size={14} /> Mark all read
          </button>
          <button
            onClick={() => navigate('/account/notifications')}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <SettingsIcon size={14} /> Settings
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <NotificationList
          items={items}
          loading={loading}
          unreadable={unreadable}
          onItemClick={onItemClick}
        />
      </div>

      {unreadable && (
        <button
          onClick={load}
          className="mt-3 text-xs font-medium text-violet-700 hover:underline dark:text-violet-300"
        >
          Try again
        </button>
      )}
    </div>
  );
}
