// Task #40 (E2) — "Send invites" modal.
//
// The host picks people from their network/connections OR pastes emails, adds
// an optional personal message, then POSTs to /api/events/:id/invitations
// (eventsApi.invite). Comp (free-seat) badges are shown for candidates whose
// role the event's audience_rules_json grants a free seat (design §7.1) — a
// client-side hint; the authoritative comp minting happens server-side.
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { X, Search, Mail, Users, Gift, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { eventsApi } from '../../lib/eventsApi';
import { useEscapeClose } from '../useEscapeClose';

// Map a candidate role → the audience rule that would comp them (design §7.1).
const ROLE_COMP_RULE = {
  partner: 'comp_official_partners',
  investor: 'comp_investors',
  founder: 'comp_project_founders',
};

function compsRole(rules, role) {
  const rule = ROLE_COMP_RULE[String(role || '').toLowerCase()];
  return !!(rule && rules && rules[rule]);
}

export default function InvitePeopleModal({ eventId, audienceRules = {}, onClose, onInvited }) {
  const [candidates, setCandidates] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [emails, setEmails] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEscapeClose(onClose);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.listUsers();
        const list = Array.isArray(res) ? res : (res?.users || res?.items || []);
        if (alive) setCandidates(list);
      } catch {
        if (alive) setCandidates([]); // network picker is best-effort; emails still work
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Task #7 — matching-ranked "suggested to invite" list (best-effort; the
  // email + network picker still work if this 404s or returns nothing).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await eventsApi.inviteSuggestions(eventId);
        if (alive) setSuggestions(Array.isArray(res?.suggestions) ? res.suggestions : []);
      } catch {
        if (alive) setSuggestions([]);
      }
    })();
    return () => { alive = false; };
  }, [eventId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((u) => {
      const hay = `${u.name || ''} ${u.full_name || ''} ${u.email || ''} ${u.role || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [candidates, query]);

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const parsedEmails = useMemo(
    () => emails.split(/[\s,;]+/).map((e) => e.trim()).filter((e) => e.includes('@')),
    [emails],
  );

  const total = selected.size + parsedEmails.length;

  const submit = async () => {
    if (!total || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await eventsApi.invite(eventId, {
        user_ids: [...selected],
        emails: parsedEmails,
        personal_message: message.trim() || undefined,
      });
      onInvited?.(result, total);
    } catch (e) {
      setError(e?.message || 'Could not send invitations.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Invite people</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Suggested to invite — matching-ranked (Task #7) */}
          {suggestions.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                <Sparkles size={15} /> Suggested to invite
              </div>
              <div className="space-y-1 rounded-lg border border-violet-200 bg-violet-50/40 p-1.5 dark:border-violet-900/40 dark:bg-violet-900/10">
                {suggestions.map((s) => {
                  const comp = compsRole(audienceRules, s.role);
                  return (
                    <label
                      key={s.user_id}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-white dark:hover:bg-gray-800"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(s.user_id)}
                        onChange={() => toggle(s.user_id)}
                        className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-violet-600 focus:ring-violet-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                          {s.name || `User #${s.user_id}`}
                          {s.role ? <span className="font-normal text-gray-500 dark:text-gray-400"> · {s.role}</span> : null}
                        </div>
                        {s.reason ? (
                          <div className="truncate text-xs text-violet-700 dark:text-violet-300">{s.reason}</div>
                        ) : null}
                      </div>
                      {comp && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                          <Gift size={11} /> Free seat
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Network / connections picker */}
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
              <Users size={15} /> From your network
            </div>
            <div className="relative mb-2">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search people…"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-2 pl-9 pr-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div className="max-h-44 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
              {loading ? (
                <div className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                  No connections found — invite by email below.
                </div>
              ) : (
                filtered.map((u) => {
                  const comp = compsRole(audienceRules, u.role);
                  return (
                    <label
                      key={u.id}
                      className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(u.id)}
                        onChange={() => toggle(u.id)}
                        className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-violet-600 focus:ring-violet-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                          {u.name || u.full_name || u.email || `User #${u.id}`}
                        </div>
                        <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                          {u.email}{u.role ? ` · ${u.role}` : ''}
                        </div>
                      </div>
                      {comp && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                          <Gift size={11} /> Free seat
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {/* Paste emails */}
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
              <Mail size={15} /> Or invite by email
            </div>
            <textarea
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              rows={2}
              placeholder="guest@example.com, another@example.com"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            {parsedEmails.length > 0 && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {parsedEmails.length} email{parsedEmails.length === 1 ? '' : 's'} recognised.
              </p>
            )}
          </div>

          {/* Personal message */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-200">
              Personal message <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="Hope you can make it…"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-gray-200 dark:border-gray-700 px-5 py-4">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {total} recipient{total === 1 ? '' : 's'} selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!total || submitting}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {submitting ? 'Sending…' : 'Send invites'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
