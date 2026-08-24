// Task #5 — Cohort application lifecycle admin console. Rendered as the
// "Cycles" tab of AdminSpinoutLab. Shows the per-cycle application funnel
// (open → reviewing → active/postponed), the minimum-size threshold
// indicator, close/start countdowns, applicant decisions (reason required,
// audited), force-proceed, the notification log, and cycle history events.
//
// Everything time-based is decided by the Worker cron — this UI only
// inspects state and issues audited admin actions. Worker-only endpoints
// (dev backend answers 404/405) get the explanatory fallback, matching the
// dev/Worker parity convention.
import React, { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw, CalendarRange, AlertTriangle, CheckCircle2, XCircle,
  Hourglass, Bell, History, Zap, Settings2,
} from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';

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
function timeUntil(ts) {
  const ms = parseUtc(ts);
  if (ms === null) return null;
  const diff = ms - Date.now();
  if (diff <= 0) return 'passed';
  const h = Math.floor(diff / 3600_000);
  if (h >= 48) return `${Math.floor(h / 24)}d`;
  return `${h}h ${Math.floor((diff % 3600_000) / 60000)}m`;
}

const APP_STATUS_BADGE = {
  open: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  reviewing: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  active: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  postponed: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
};
const APPLICANT_BADGE = {
  pending: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
  approved: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  rejected: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  waitlisted: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  activated: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  rolled_forward: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
};

export default function AdminCohortApplications() {
  const [cycles, setCycles] = useState([]);
  const [settings, setSettings] = useState({ min: 1, max: 25 });
  const [notifications, setNotifications] = useState([]);
  const [events, setEvents] = useState([]);
  const [subView, setSubView] = useState('cycles'); // cycles | notifications | history
  const [loading, setLoading] = useState(true);
  const [unsupported, setUnsupported] = useState(false);
  const [busyKey, setBusyKey] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [apps, notifs, evts] = await Promise.all([
        api.adminCohortApplications(),
        api.adminCohortAppNotifications(),
        api.adminCohortAppEvents(),
      ]);
      setCycles(apps?.cycles || []);
      setSettings(apps?.settings || { min: 1, max: 25 });
      setNotifications(notifs?.notifications || []);
      setEvents(evts?.events || []);
      setUnsupported(false);
    } catch (e) {
      reportError('AdminCohortApplications:load', e);
      setUnsupported(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (key, fn) => {
    setBusyKey(key);
    try { await fn(); await load(); }
    catch (e) { reportError('AdminCohortApplications:action', e); window.alert(e?.message || 'Action failed'); }
    finally { setBusyKey(null); }
  };

  const decide = (applicant, status) => {
    const reason = (window.prompt(`Reason for marking this applicant ${status} (required, audited):`) || '').trim();
    if (!reason) { window.alert('A reason is required.'); return; }
    act(`decide:${applicant.id}`, () => api.adminCohortApplicantDecide(applicant.id, { status, reason }));
  };

  const forceProceed = (cycle) => {
    const reason = (window.prompt(`Run the ${cycle.label} cohort even below the minimum size? Reason (required, audited):`) || '').trim();
    if (!reason) { window.alert('A reason is required.'); return; }
    act(`force:${cycle.id}`, () => api.adminCohortForceProceed(cycle.id, { reason }));
  };

  const editSettings = () => {
    const min = parseInt(window.prompt('Minimum cohort size (cycles below this auto-postpone and roll forward):', String(settings.min)) || '', 10);
    if (!Number.isInteger(min) || min < 0) return;
    const max = parseInt(window.prompt('Maximum cohort size:', String(settings.max)) || '', 10);
    if (!Number.isInteger(max) || max < 0) return;
    act('settings', () => api.adminCohortAppSettings({ min_cohort_size: min, max_cohort_size: max }));
  };

  if (unsupported) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 text-sm text-gray-600 dark:text-gray-300">
        <AlertTriangle size={16} className="inline mr-1.5 text-amber-500" />
        Application cycle data is served by the production Worker — it isn't available on the local dev backend.
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="admin-cohort-applications">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5" role="tablist">
          {[['cycles', 'Cycles', CalendarRange], ['notifications', 'Notification log', Bell], ['history', 'History', History]].map(([key, label, Icon]) => (
            <button
              key={key}
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
            onClick={editSettings}
            disabled={busyKey === 'settings'}
            data-testid="button-app-settings"
            className="px-2.5 py-1 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-1"
          >
            <Settings2 size={12} /> Min {settings.min} · Max {settings.max}
          </button>
          <button onClick={load} className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" data-testid="button-app-refresh" aria-label="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {subView === 'cycles' && (
        <div className="space-y-4">
          {loading && cycles.length === 0 && (
            <div className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">Loading cycles…</div>
          )}
          {!loading && cycles.length === 0 && (
            <div className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">No cohort cycles yet — the scheduler creates them automatically.</div>
          )}
          {cycles.map((cy) => {
            const counts = cy.applicant_counts || {};
            const approvedish = (counts.approved || 0) + (counts.activated || 0);
            return (
              <div key={cy.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4" data-testid={`cycle-card-${cy.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-gray-900 dark:text-gray-100">{cy.label} cohort</span>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${APP_STATUS_BADGE[cy.app_status] || APP_STATUS_BADGE.open}`}>{cy.app_status}</span>
                  {cy.force_proceed === 1 && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 flex items-center gap-1"><Zap size={10} /> force-proceed</span>
                  )}
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${cy.meets_minimum ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'}`}>
                    {cy.meets_minimum ? <CheckCircle2 size={10} /> : <AlertTriangle size={10} />}
                    {approvedish}/{settings.min} approved
                  </span>
                  {['open', 'reviewing'].includes(cy.app_status) && !cy.force_proceed && (
                    <button
                      onClick={() => forceProceed(cy)}
                      disabled={busyKey === `force:${cy.id}`}
                      data-testid={`button-force-proceed-${cy.id}`}
                      className="ml-auto px-2.5 py-1 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50"
                    >
                      Force proceed
                    </button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                  <span>Apps close: <span className="font-semibold text-gray-700 dark:text-gray-200">{fmt(cy.applications_close_at)}</span>{cy.app_status === 'open' && timeUntil(cy.applications_close_at) !== 'passed' && <span className="ml-1 text-amber-600 dark:text-amber-400 font-semibold">({timeUntil(cy.applications_close_at)} left)</span>}</span>
                  <span>Cohort starts: <span className="font-semibold text-gray-700 dark:text-gray-200">{fmt(cy.start_at)}</span>{timeUntil(cy.start_at) !== 'passed' && <span className="ml-1">({timeUntil(cy.start_at)})</span>}</span>
                  <span>Pending {counts.pending || 0} · Approved {counts.approved || 0} · Waitlisted {counts.waitlisted || 0} · Rejected {counts.rejected || 0} · Activated {counts.activated || 0}{counts.rolled_forward ? ` · Rolled ${counts.rolled_forward}` : ''}</span>
                </div>
                {(cy.applicants || []).length > 0 && (
                  <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
                    {cy.applicants.map((a) => (
                      <div key={a.id} className="py-2 flex flex-wrap items-center gap-2 text-sm" data-testid={`applicant-row-${a.id}`}>
                        <div className="min-w-0 flex-1">
                          <span className="font-semibold text-gray-900 dark:text-gray-100">{a.company_name || '—'}</span>
                          <span className="text-gray-500 dark:text-gray-400"> · {a.name || a.email}</span>
                          {a.rolled_from_cycle_id && <span className="ml-1 text-[11px] text-gray-400 dark:text-gray-500">(rolled forward)</span>}
                          {a.decision_reason && <div className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{a.decided_by}: {a.decision_reason}</div>}
                        </div>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${APPLICANT_BADGE[a.status] || APPLICANT_BADGE.pending}`}>{a.status}</span>
                        {['pending', 'approved', 'waitlisted', 'rejected'].includes(a.status) && ['open', 'reviewing'].includes(cy.app_status) && (
                          <div className="flex items-center gap-1">
                            {a.status !== 'approved' && (
                              <button onClick={() => decide(a, 'approved')} disabled={busyKey === `decide:${a.id}`} data-testid={`button-approve-${a.id}`} className="p-1 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30" title="Approve"><CheckCircle2 size={15} /></button>
                            )}
                            {a.status !== 'waitlisted' && (
                              <button onClick={() => decide(a, 'waitlisted')} disabled={busyKey === `decide:${a.id}`} data-testid={`button-waitlist-${a.id}`} className="p-1 rounded text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30" title="Waitlist"><Hourglass size={15} /></button>
                            )}
                            {a.status !== 'rejected' && (
                              <button onClick={() => decide(a, 'rejected')} disabled={busyKey === `decide:${a.id}`} data-testid={`button-reject-${a.id}`} className="p-1 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30" title="Reject"><XCircle size={15} /></button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

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
    </div>
  );
}
