import React, { useEffect, useState } from 'react';
import PageExplainer from '../components/PageExplainer';
import { MessageSquare, Plus, Trash2, Mail, Send, UserPlus, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { markMilestone } from '../lib/spinoutLabHooks';
import { reportError } from '../lib/log';

// Task #14 — Customer Discovery now persists via the worker's
// /api/progress/discovery API instead of localStorage. Interviews are
// stored against the user's first project; the first three successful
// saves still fire the `customer_interview_logged_1|_2|_3` Spin-Out Lab
// milestones (Task #13). Admins / founders without a project see a
// friendly empty state telling them to create one first.
//
// Task #5 — below the interview log we surface customer-audience waitlist
// signups (strict audience='customer'), grouped by project, with a
// lightweight CRM layer: promote-to-interview, send a product-invitation
// email, and send a follow-up email. Each action shows per-button loading
// and an inline result (including when email is not configured).

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

export default function CustomerDiscoveryPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [interviews, setInterviews] = useState([]);
  const [form, setForm] = useState({ title: '', contact: '', notes: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Per-project waitlist state: { [pid]: { signups, loading, error } }.
  const [waitlist, setWaitlist] = useState({});
  // Per-signup action state: { [sid]: { busy: 'invite'|'follow_up'|'promote'|null, msg, isError } }.
  const [actions, setActions] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = (await api.listProjects()) || [];
        if (cancelled) return;
        setProjects(list);
        if (list.length === 0) {
          setProjectId(null);
          setInterviews([]);
          setLoading(false);
          return;
        }
        const pid = list[0].id;
        setProjectId(pid);
        const res = await api.listInterviews(pid);
        if (cancelled) return;
        setInterviews(res?.interviews || []);

        // Kick off a per-project waitlist load. Each project is independent so
        // one failing load never blocks the others.
        setWaitlist(Object.fromEntries(list.map((p) => [p.id, { signups: [], loading: true, error: null }])));
        await Promise.all(
          list.map(async (p) => {
            try {
              const w = await api.listWaitlistCustomers(p.id);
              if (cancelled) return;
              setWaitlist((prev) => ({ ...prev, [p.id]: { signups: w?.signups || [], loading: false, error: null } }));
            } catch (e) {
              if (cancelled) return;
              reportError('CustomerDiscoveryPage:waitlist', e);
              setWaitlist((prev) => ({ ...prev, [p.id]: { signups: [], loading: false, error: e?.message || 'Failed to load signups.' } }));
            }
          })
        );
      } catch (e) {
        if (cancelled) return;
        const msg = (e?.message || '').toLowerCase();
        if (e?.status === 404 || msg.includes('not found')) {
          setProjectId(null);
          setInterviews([]);
        } else {
          setError(e.message || 'Failed to load interviews.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onSave = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !projectId) return;
    setSaving(true);
    setError(null);
    try {
      // Map this page's lightweight fields onto the worker's interview
      // schema: `title` -> interviewee_name, `contact` -> interviewee_role,
      // free-form `notes` -> notes. Hypotheses/pains stay empty here — the
      // richer DiscoveryPage covers that.
      const payload = {
        interviewee_name: form.title.trim(),
        interviewee_role: form.contact.trim() || null,
        notes: form.notes.trim(),
      };
      const created = await api.createInterview(projectId, payload);
      const next = [created, ...interviews];
      setInterviews(next);
      setForm({ title: '', contact: '', notes: '' });

      // Fire the milestone for the N-th save (N = 1..3).
      const n = next.length;
      if (n >= 1 && n <= 3) {
        await markMilestone(user, `customer_interview_logged_${n}`);
      }
    } catch (err) {
      reportError('CustomerDiscoveryPage:create', err);
      setError(err?.message || 'Failed to save interview.');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id) => {
    const prev = interviews;
    setInterviews(interviews.filter((i) => i.id !== id));
    try {
      await api.deleteInterview(id);
    } catch (err) {
      reportError('CustomerDiscoveryPage:delete', err);
      setError(err?.message || 'Failed to delete interview.');
      setInterviews(prev);
    }
  };

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
        // If this signup belongs to the project whose interviews are shown,
        // reflect the new interview immediately.
        if (
          res?.interview &&
          !res?.already_promoted &&
          String(res.interview.project_id) === String(projectId)
        ) {
          setInterviews((cur) => [res.interview, ...cur]);
        }
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
      reportError(`CustomerDiscoveryPage:${kind}`, err);
      const code = err?.data?.detail?.code;
      const msg = code === 'email_send_failed'
        ? 'Email failed to send — not recorded.'
        : (err?.message || 'Action failed.');
      setActions((prev) => ({ ...prev, [sid]: { busy: null, msg, isError: true } }));
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2 dark:text-gray-100">
          <MessageSquare className="text-violet-600" size={22} /> Customer Discovery
        </h1>
        <PageExplainer pageKey="customer_discovery" />
        <p className="text-sm text-gray-600 mt-1 dark:text-gray-400">
          Log your customer conversations as you go. Three logged interviews
          unlocks the next week of the Spin-Out Lab.
        </p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700 dark:bg-rose-900/30 dark:border-rose-800 dark:text-rose-300">
          {error}
        </div>
      )}

      {!loading && !projectId ? (
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-600 dark:bg-gray-900 dark:border-gray-800 dark:text-gray-400">
          You need a startup before you can log interviews. Create one from
          Studio, then come back here.
        </div>
      ) : (
        <>
          <form onSubmit={onSave} className="bg-white border border-gray-200 rounded-xl p-5 mb-6 space-y-3 dark:bg-gray-900 dark:border-gray-800">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Title</label>
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Convo with VP Eng @ Acme"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Contact</label>
              <input
                value={form.contact}
                onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
                placeholder="Name, role, company, email…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={4}
                placeholder="What did they say? Pains, current workflow, willingness to pay…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              />
            </div>
            <button
              type="submit"
              disabled={saving || loading || !form.title.trim() || !projectId}
              className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
            >
              <Plus size={14} /> {saving ? 'Saving…' : 'Log interview'}
            </button>
          </form>

          <div className="bg-white border border-gray-200 rounded-xl mb-6 dark:bg-gray-900 dark:border-gray-800">
            <div className="px-5 py-3 border-b border-gray-200 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:text-gray-100">
              Logged interviews ({interviews.length})
            </div>
            {loading ? (
              <div className="px-5 py-10 text-center text-sm text-gray-500 dark:text-gray-400">Loading…</div>
            ) : interviews.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                No interviews yet — log your first one above.
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {interviews.map((i) => (
                  <li key={i.id} className="px-5 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{i.interviewee_name}</div>
                      {i.interviewee_role && (
                        <div className="text-xs text-gray-500 mt-0.5 dark:text-gray-400">{i.interviewee_role}</div>
                      )}
                      {i.notes && (
                        <div className="text-xs text-gray-600 mt-1 whitespace-pre-wrap dark:text-gray-400">{i.notes}</div>
                      )}
                      <div className="text-[11px] text-gray-400 mt-1 dark:text-gray-500">
                        {i.created_at ? new Date(i.created_at).toLocaleString() : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => onDelete(i.id)}
                      className="text-gray-400 hover:text-rose-600 p-1"
                      aria-label="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Task #5 — Waitlist customers, grouped by project. */}
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
        </>
      )}
    </div>
  );
}
