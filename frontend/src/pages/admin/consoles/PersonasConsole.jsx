import React, { useEffect, useState } from 'react';
import { reportError } from '../../../lib/log';
import { api } from '../../../lib/api';
import { RefreshCw, Sparkles, Loader2 } from 'lucide-react';
import { PERSONAS as PERSONA_TAXONOMY } from '../../../lib/personas';
import { ROLE_BADGES, ConsoleUnreadable } from './shared';

/**
 * D648 (#1448) — the Personas console.
 */

export function PersonasPanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [filter, setFilter] = useState('');
  // D648 — a failed read is said, never drawn as an empty list.
  const [failed, setFailed] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const r = await api.listPersonasAdmin(); setRows(r.users || []); setFailed(false); }
    catch (e) { reportError('AdminPage:personas', e); setFailed(true); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const retag = async (userId, personaId, selectEl) => {
    if (!personaId) return;
    // D255 — the row's own persona is what the select must fall back to,
    // whether the operator cancels or the write fails; it is a live DOM
    // reset (the select is uncontrolled — `defaultValue`, not `value`) so
    // a cancelled or failed re-tag never leaves the row showing a persona
    // nothing actually saved.
    const restore = () => { if (selectEl) selectEl.value = ''; };
    const row = rows.find((r) => r.user_id === userId);
    const label = PERSONA_TAXONOMY.find((p) => p.id === personaId)?.label || personaId;
    if (!confirm(`Re-tag ${row?.email || row?.name || `user ${userId}`} as ${label}?`)) {
      restore();
      return;
    }
    setSavingId(userId);
    try {
      await api.retagPersonaAdmin(userId, personaId);
      await load();
    } catch (e) {
      alert(e.message || 'Re-tag failed');
      restore();
    } finally { setSavingId(null); }
  };

  const filtered = rows.filter((r) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (r.email || '').toLowerCase().includes(f) || (r.name || '').toLowerCase().includes(f);
  });

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 flex-wrap dark:border-gray-800">
        <Sparkles size={16} className="text-gray-600" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">User Personas</h3>
        <div className="ml-auto flex items-center gap-2">
          {/* T21 — Enter in the search input now triggers a Refresh. */}
          <form onSubmit={(e) => { e.preventDefault(); load(); }} className="flex items-center gap-2">
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search name or email"
              className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-md w-56 focus:outline-none focus:border-violet-400 dark:border-gray-800" />
            <button type="submit" className="text-xs px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-700 flex items-center gap-1 dark:text-gray-300">
              <RefreshCw size={12} /> Refresh
            </button>
          </form>
        </div>
      </div>
      {loading ? (
        <div className="p-8 text-center text-sm text-gray-500 flex items-center justify-center gap-2">
          <Loader2 className="animate-spin" size={14} /> Loading…
        </div>
      ) : failed ? (
        <ConsoleUnreadable what="The personas" onRetry={() => load()} />
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-500">No users.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800">
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">User</th>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Role</th>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Current Persona</th>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Source</th>
                <th className="text-right px-4 py-2.5 text-gray-600 font-medium text-xs">Re-tag</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.user_id} className="border-b border-gray-100 hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{r.name || '—'}</div>
                    <div className="text-xs text-gray-500">{r.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_BADGES[r.role] || 'bg-gray-100 text-gray-700'}`}>{r.role}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300">
                    {r.persona_id
                      ? (PERSONA_TAXONOMY.find((p) => p.id === r.persona_id)?.label || r.persona_id)
                      : <span className="text-gray-400 italic">— not set —</span>}
                    {r.confidence != null && r.persona_id && (
                      <span className="ml-2 text-[10px] text-gray-500">conf {(Number(r.confidence) * 100).toFixed(0)}%</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {r.source || '—'}
                    {Number(r.manual_override) === 1 && <span className="ml-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">override</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <select disabled={savingId === r.user_id} defaultValue=""
                      onChange={(e) => retag(r.user_id, e.target.value, e.target)}
                      className="text-xs px-2 py-1.5 border border-gray-200 rounded-md bg-white dark:border-gray-800 dark:bg-gray-900">
                      <option value="">{savingId === r.user_id ? 'Saving…' : 'Re-tag as…'}</option>
                      {PERSONA_TAXONOMY.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default PersonasPanel;
