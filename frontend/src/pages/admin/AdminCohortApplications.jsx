// The Spin-Out Lab's cohort settings and logs, under Applications' queue
// (D948, #2753). Until D948 this was the whole Cycles console, deciding with
// browser prompts; every decision is now SL4's dialogs in
// `lab/LabApplications.jsx`. What stays here: Settings' minimum and places,
// edited in an in-page dialog, and the notification log and cycle history.
// D971's Settings and Activity tabs now repeat them; retiring this is its own
// change (D948 §5).
//
// Everything time-based is decided by the Worker cron — this console only
// reads state and saves the two settings, audited.
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Bell, History, Settings2 } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Dialog, Field, INPUT, SUB, useWrite } from './lab/labParts';
import { refusalText } from './lab/labDesksModel';

function parseUtc(ts) {
  if (!ts) return null;
  const ms = Date.parse(ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? ms : null;
}
function fmt(ts) {
  const ms = parseUtc(ts);
  if (ms === null) return '—';
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * D511 — the size settings as the Worker read them. `settings` is null when the
 * read failed: the button says so, and never shows a number nobody set.
 */
export function SizeSettingsLabel({ settings }) {
  if (!settings) return <span data-testid="app-settings-unreadable">Min · Max unreadable</span>;
  return <>Min {settings.min} · Max {settings.max}</>;
}

const whole = (v) => /^\d+$/.test(String(v).trim()) && Number(v) <= 1000;

/** D948 — the minimum and places, changed in an in-page dialog that says what they decide. */
function SettingsDialog({ settings, onClose, onChanged }) {
  const [min, setMin] = useState(settings ? String(settings.min) : '');
  const [max, setMax] = useState(settings ? String(settings.max) : '');
  const w = useWrite(onChanged, {}, refusalText);
  const ok = whole(min) && whole(max);
  return (
    <Dialog title="Change the cohort minimum and places?" testId="app-settings-dialog" onClose={onClose} w={w} action="Save" disabled={!ok}
      sub="A cohort below the minimum moves to the next one about 12 hours before it starts, unless an admin runs it anyway. Approving past the places needs a confirmation. Every admin sees the change."
      onAction={() => w.run(() => api.adminCohortAppSettings({ min_cohort_size: Number(min), max_cohort_size: Number(max) }))}
      done={w.reply ? `Minimum ${min}, places ${max}, saved.` : null}>
      {settings ? null : <p className={`m-0 ${SUB}`}>The current settings could not be read, so the fields start empty.</p>}
      <span className="flex flex-wrap gap-3">
        <Field label="Minimum"><input inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))} disabled={Boolean(w.reply)} className={`${INPUT} w-28 font-mono`} data-testid="app-settings-min" /></Field>
        <Field label="Places"><input inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} disabled={Boolean(w.reply)} className={`${INPUT} w-28 font-mono`} data-testid="app-settings-max" /></Field>
      </span>
    </Dialog>
  );
}

export default function AdminCohortApplications() {
  const [settings, setSettings] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [events, setEvents] = useState([]);
  const [subView, setSubView] = useState('notifications'); // notifications | history
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [apps, notifs, evts] = await Promise.all([
        api.adminCohortApplications(),
        api.adminCohortAppNotifications(),
        api.adminCohortAppEvents(),
      ]);
      setSettings(apps?.settings ?? null);
      setNotifications(notifs?.notifications || []);
      setEvents(evts?.events || []);
      setFailed(false);
    } catch (e) {
      reportError('AdminCohortApplications:load', e);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (failed) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 text-sm text-gray-600 dark:text-gray-300" data-testid="app-logs-unreadable">
        <span>The cohort settings and logs could not be read. That is not the same as none.</span>
        <button type="button" onClick={load} className="font-semibold underline">Try again</button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="admin-cohort-applications">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Cohort logs">
          {[['notifications', 'Notification log', Bell], ['history', 'History', History]].map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={subView === key}
              onClick={() => setSubView(key)}
              data-testid={`tab-app-${key}`}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 ${subView === key ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            data-testid="button-app-settings"
            className="px-2.5 py-1 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-1"
          >
            <Settings2 size={12} /> <SizeSettingsLabel settings={settings} />
          </button>
          <button type="button" onClick={load} className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" data-testid="button-app-refresh" aria-label="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {subView === 'notifications' && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800" data-testid="app-notification-log">
          {notifications.length === 0 && <div className="p-4 text-sm text-gray-500 dark:text-gray-400">No notifications sent yet.</div>}
          {notifications.map((n) => (
            <div key={n.id} className="px-4 py-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-gray-900 dark:text-gray-100">{n.notif_type}</span>
              <span className="text-gray-500 dark:text-gray-400">→ {n.name || n.email || `user #${n.user_id}`}</span>
              {n.status !== 'sent' && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">{n.status}</span>}
              <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{fmt(n.sent_at)}</span>
            </div>
          ))}
        </div>
      )}

      {subView === 'history' && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800" data-testid="app-event-history">
          {events.length === 0 && <div className="p-4 text-sm text-gray-500 dark:text-gray-400">No cycle events yet.</div>}
          {events.map((ev) => (
            <div key={ev.id} className="px-4 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-gray-900 dark:text-gray-100">{ev.event_type}</span>
                <span className="text-[11px] text-gray-400 dark:text-gray-500">{ev.actor}</span>
                <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{fmt(ev.created_at)}</span>
              </div>
              {ev.details && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ev.details}</div>}
            </div>
          ))}
        </div>
      )}
      {editing ? <SettingsDialog settings={settings} onClose={() => setEditing(false)} onChanged={load} /> : null}
    </div>
  );
}
