import React, { useEffect, useState } from 'react';
import { Mail, Send, UserPlus, Users } from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';

// Task #5 — the "Leads" tab of the unified Discovery workspace. Surfaces
// customer-audience waitlist signups (strict audience='customer', project-scoped
// server-side), grouped by project, with a lightweight CRM layer:
// promote-to-interview, send a product-invitation email, and send a follow-up
// email. Ported out of the retired /customer-discovery page so the redirect
// keeps this functionality. Self-contained: owns its own waitlist + action
// state and loads per project from the `projects` prop.

const CRM_BADGE = {
  new: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  invited: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  followed_up: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  promoted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
};
const CRM_LABEL = {
  new: 'New',
  invited: 'Invited',
  followed_up: 'Followed up',
  promoted: 'Promoted',
};

function StatusBadge({ status }) {
  const key = CRM_BADGE[status] ? status : 'new';
  return (
    <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${CRM_BADGE[key]}`}>
      {CRM_LABEL[key]}
    </span>
  );
}

export default function WaitlistLeadsPanel({ projects = [] }) {
  // Per-project waitlist state: { [pid]: { signups, loading, error } }.
  const [waitlist, setWaitlist] = useState({});
  // Per-signup action state: { [sid]: { busy, msg, isError } }.
  const [actions, setActions] = useState({});

  useEffect(() => {
    let cancelled = false;
    if (!projects.length) { setWaitlist({}); return; }
    // Each project is independent so one failing load never blocks the others.
    setWaitlist(Object.fromEntries(projects.map((p) => [p.id, { signups: [], loading: true, error: null }])));
    (async () => {
      await Promise.all(
        projects.map(async (p) => {
          try {
            const w = await api.listWaitlistCustomers(p.id);
            if (cancelled) return;
            setWaitlist((prev) => ({ ...prev, [p.id]: { signups: w?.signups || [], loading: false, error: null } }));
          } catch (e) {
            if (cancelled) return;
            reportError('WaitlistLeadsPanel:load', e);
            setWaitlist((prev) => ({ ...prev, [p.id]: { signups: [], loading: false, error: e?.message || 'Failed to load signups.' } }));
          }
        })
      );
    })();
    return () => { cancelled = true; };
  }, [projects]);

  // Replace a single signup row in a project's waitlist after an action.
  const patchSignup = (pid, signup) => {
    setWaitlist((prev) => {
      const cur = prev[pid];
      if (!cur) return prev;
      return {
        ...prev,
        [pid]: { ...cur, signups: cur.signups.map((s) => (s.id === signup.id ? signup : s)) },
      };
    });
  };

  const runAction = async (pid, signup, kind) => {
    const sid = signup.id;
    setActions((prev) => ({ ...prev, [sid]: { busy: kind, msg: null, isError: false } }));
    try {
      let res;
      let msg;
      if (kind === 'promote') {
        res = await api.promoteWaitlistCustomer(pid, sid);
        msg = res?.already_promoted ? 'Already promoted' : 'Promoted to interview';
      } else if (kind === 'invite') {
        res = await api.inviteWaitlistCustomer(pid, sid);
        msg = res?.email_sent ? 'Invitation sent' : 'Marked invited (email not configured)';
      } else {
        res = await api.followUpWaitlistCustomer(pid, sid);
        msg = res?.email_sent ? 'Follow-up sent' : 'Marked followed up (email not configured)';
      }
      if (res?.signup) patchSignup(pid, res.signup);
      setActions((prev) => ({ ...prev, [sid]: { busy: null, msg, isError: false } }));
    } catch (err) {
      reportError(`WaitlistLeadsPanel:${kind}`, err);
      const code = err?.data?.detail?.code;
      const msg = code === 'email_send_failed'
        ? 'Email failed to send — not recorded.'
        : (err?.message || 'Action failed.');
      setActions((prev) => ({ ...prev, [sid]: { busy: null, msg, isError: true } }));
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Users className="text-violet-600" size={18} />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Waitlist customers</h2>
      </div>
      <p className="text-sm text-gray-600 mb-4 dark:text-gray-400">
        People who joined your product waitlist. Promote a promising signup
        straight to an interview, or reach out by email.
      </p>

      <div className="space-y-5">
        {projects.map((p) => {
          const w = waitlist[p.id] || { signups: [], loading: true, error: null };
          return (
            <div key={p.id} className="bg-white border border-gray-200 rounded-xl dark:bg-gray-900 dark:border-gray-800">
              <div className="px-5 py-3 border-b border-gray-200 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:text-gray-100 flex items-center justify-between">
                <span className="truncate">{p.name}</span>
                <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                  {w.loading ? '…' : `${w.signups.length} signup${w.signups.length === 1 ? '' : 's'}`}
                </span>
              </div>
              {w.loading ? (
                <div className="px-5 py-8 text-center text-sm text-gray-500 dark:text-gray-400">Loading…</div>
              ) : w.error ? (
                <div className="px-5 py-8 text-center text-sm text-rose-600 dark:text-rose-400">{w.error}</div>
              ) : w.signups.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  No customer signups yet.
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {w.signups.map((s) => {
                    const a = actions[s.id] || {};
                    const busy = a.busy;
                    return (
                      <li key={s.id} className="px-5 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {s.name || s.email}
                            </div>
                            {s.name && (
                              <div className="text-xs text-gray-500 mt-0.5 dark:text-gray-400 truncate">{s.email}</div>
                            )}
                            <div className="text-[11px] text-gray-400 mt-1 dark:text-gray-500">
                              {s.source ? `${s.source} · ` : ''}
                              {s.created_at ? new Date(s.created_at).toLocaleDateString() : ''}
                            </div>
                          </div>
                          <StatusBadge status={s.crm_status} />
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => runAction(p.id, s, 'promote')}
                            disabled={!!busy || s.crm_status === 'promoted'}
                            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-800"
                          >
                            <UserPlus size={13} /> {busy === 'promote' ? 'Promoting…' : 'Promote'}
                          </button>
                          <button
                            onClick={() => runAction(p.id, s, 'invite')}
                            disabled={!!busy}
                            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-800"
                          >
                            <Mail size={13} /> {busy === 'invite' ? 'Sending…' : 'Send invite'}
                          </button>
                          <button
                            onClick={() => runAction(p.id, s, 'follow_up')}
                            disabled={!!busy}
                            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-800"
                          >
                            <Send size={13} /> {busy === 'follow_up' ? 'Sending…' : 'Follow up'}
                          </button>
                          {a.msg && (
                            <span className={`text-[11px] ${a.isError ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                              {a.msg}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
