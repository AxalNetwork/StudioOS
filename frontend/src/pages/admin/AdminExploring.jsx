// Task #9 — Admin review queue for 'exploring' users.
//
// Lists users held at role='exploring' after chatbot onboarding, with the
// role suggestion inferred from their persona (user_role_review), profiling
// progress, and the binding-agreement envelope status. Two actions:
//   1. Send binding agreement (e-sign envelope; native or DocuSign).
//   2. Assign final role — the server rejects this until the envelope is
//      status='completed', so the button stays disabled until signed.
import React, { useCallback, useEffect, useState } from 'react';
import {
  Compass, RefreshCw, Loader2, Send, UserCheck, AlertCircle,
  FileSignature, CheckCircle2, Clock,
} from 'lucide-react';
import { adminExploring as api } from '../../lib/api';
import { useToast } from '../../components/useToast';

const ASSIGNABLE_ROLES = ['founder', 'investor', 'partner', 'advisor'];

const ROLE_BADGE = {
  founder: 'bg-blue-100 text-blue-700',
  investor: 'bg-purple-100 text-purple-700',
  partner: 'bg-emerald-100 text-emerald-700',
  advisor: 'bg-amber-100 text-amber-700',
};

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).includes('T') ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Envelope status → badge. `null` status means no envelope sent yet.
function BindingBadge({ status }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
        <Clock size={12} /> Not sent
      </span>
    );
  }
  const s = String(status).toLowerCase();
  if (s === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
        <CheckCircle2 size={12} /> Signed
      </span>
    );
  }
  if (s === 'voided' || s === 'declined') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
        <AlertCircle size={12} /> {s === 'voided' ? 'Voided' : 'Declined'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
      <FileSignature size={12} /> Awaiting signature
    </span>
  );
}

function Row({ u, onSendBinding, onAssign, busy }) {
  // Default the role picker to the stored suggestion when there is one.
  const [role, setRole] = useState(
    ASSIGNABLE_ROLES.includes(u.suggested_role) ? u.suggested_role : '',
  );
  // Onboarding-conversation summary: clamped by default, click to expand.
  const [expanded, setExpanded] = useState(false);
  const signed = String(u.binding_status || '').toLowerCase() === 'completed';
  const assigned = !!u.assigned_role;

  return (
    <tr className="border-t border-gray-100 dark:border-gray-800">
      <td className="px-3 py-3 align-top">
        <div className="font-medium text-gray-900 dark:text-gray-100">{u.name || '—'}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{u.email}</div>
        <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Joined {fmtDate(u.created_at)}</div>
      </td>
      <td className="px-3 py-3 align-top">
        {u.suggested_role ? (
          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE[u.suggested_role] || 'bg-gray-100 text-gray-600'}`}>
            {u.suggested_role}
          </span>
        ) : (
          <span className="text-xs text-gray-400 dark:text-gray-500">none yet</span>
        )}
        {u.profile_persona && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{u.profile_persona}</div>
        )}
        {u.founder_track && (
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{u.founder_track}</div>
        )}
      </td>
      <td className="px-3 py-3 align-top max-w-xs">
        {u.onboarding_summary ? (
          <p
            className={`text-xs text-gray-600 dark:text-gray-300 leading-relaxed cursor-pointer ${expanded ? '' : 'line-clamp-3'}`}
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Click to collapse' : 'Click to expand'}
          >
            {u.onboarding_summary}
          </p>
        ) : (
          <span className="text-xs text-gray-400 dark:text-gray-500">No conversation captured</span>
        )}
      </td>
      <td className="px-3 py-3 align-top text-sm text-gray-700 dark:text-gray-300">
        {u.profiling_answered || 0} answered
        {u.profile_admin_status && (
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{u.profile_admin_status}</div>
        )}
      </td>
      <td className="px-3 py-3 align-top">
        <BindingBadge status={u.binding_status} />
        {u.binding_sent_at && (
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">Sent {fmtDate(u.binding_sent_at)}</div>
        )}
        {u.binding_completed_at && (
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Signed {fmtDate(u.binding_completed_at)}</div>
        )}
      </td>
      <td className="px-3 py-3 align-top">
        {assigned ? (
          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE[u.assigned_role] || 'bg-gray-100 text-gray-600'}`}>
            {u.assigned_role} ✓
          </span>
        ) : (
          <div className="flex flex-col gap-2">
            <button
              onClick={() => onSendBinding(u)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-50"
              title={u.binding_status ? 'Re-send / replace the binding agreement' : 'Send the binding agreement for signature'}
            >
              <Send size={12} /> {u.binding_status ? 'Re-send agreement' : 'Send agreement'}
            </button>
            <div className="flex items-center gap-1.5">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={busy || !signed}
                className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 disabled:opacity-50"
              >
                <option value="">Role…</option>
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <button
                onClick={() => onAssign(u, role)}
                disabled={busy || !signed || !role}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
                title={signed ? 'Assign the final role' : 'Requires a signed binding agreement'}
              >
                <UserCheck size={12} /> Assign
              </button>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}

export default function AdminExploring() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.list();
      setUsers(res?.users || []);
    } catch (e) {
      setError(e?.message || 'Failed to load exploring users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const sendBinding = async (u) => {
    if (!window.confirm(`Send the binding agreement to ${u.name || u.email}?`)) return;
    setBusyId(u.id);
    try {
      await api.sendBinding(u.id);
      showToast({ kind: 'success', msg: `Agreement sent to ${u.email}` });
      await load();
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Failed to send agreement' });
    } finally {
      setBusyId(null);
    }
  };

  const assignRole = async (u, role) => {
    if (!role) return;
    if (!window.confirm(`Assign role "${role}" to ${u.name || u.email}? This unlocks their workspace.`)) return;
    setBusyId(u.id);
    try {
      const res = await api.assignRole(u.id, role);
      showToast({
        kind: 'success',
        msg: `${u.email} is now a ${role}${res?.lab_started ? ' — Spin-Out Lab started' : ''}`,
      });
      await load();
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Role assignment failed' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Compass size={20} className="text-sky-600" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Exploring Users</h1>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Chat-onboarded users awaiting the binding agreement and final role assignment.
            Role assignment unlocks only after the agreement is signed.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-500 dark:text-gray-400">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading…
          </div>
        ) : users.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">
            No users are currently in the exploring state.
          </div>
        ) : (
          <table className="w-full text-sm min-w-[920px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <th className="px-3 py-2.5 font-medium">User</th>
                <th className="px-3 py-2.5 font-medium">Suggested role</th>
                <th className="px-3 py-2.5 font-medium">Conversation</th>
                <th className="px-3 py-2.5 font-medium">Profiling</th>
                <th className="px-3 py-2.5 font-medium">Agreement</th>
                <th className="px-3 py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <Row
                  key={u.id}
                  u={u}
                  busy={busyId === u.id}
                  onSendBinding={sendBinding}
                  onAssign={assignRole}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
