import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * D493 (U8) — a relationship someone records about you is a request you answer.
 *
 * `POST /partnernet/relationships` used to write the row straight into both
 * books and both network scores. It now writes a pending request: the other
 * person sees who asked and what type, and nothing else, until they accept.
 * A decline is not announced to the requester; their outgoing list says
 * "Declined" because the row is theirs to see.
 *
 * Draws nothing when there is nothing pending either way and no record to
 * manage — the card is a queue, not a feature tour.
 */
// The Worker's REL_TYPES (routes/partnernet.ts), in words.
const TYPE_LABEL = {
  co_investor: 'co-investor', advisor_founder: 'advisor and founder', operator_partner: 'operator and partner',
  strategic_alliance: 'strategic alliance', advisor_mentee: 'advisor and mentee',
};
const typeLabel = (t) => TYPE_LABEL[t] || t || 'relationship';

export default function RelationshipRequests({ onChange }) {
  const [state, setState] = useState({ incoming: [], outgoing: [], accepted: [], error: '' });
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const [req, book] = await Promise.allSettled([api.relationshipRequests(), api.partnerRelationships()]);
    const accepted = book.status === 'fulfilled' && Array.isArray(book.value) ? book.value : [];
    if (req.status === 'fulfilled') {
      setState({ incoming: req.value?.incoming || [], outgoing: req.value?.outgoing || [], accepted, error: '' });
    } else {
      setState({ incoming: [], outgoing: [], accepted, error: req.reason?.message || 'Relationship requests could not be read.' });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (id, fn) => {
    setBusy(id);
    try {
      await fn();
      await load();
      onChange?.();
    } catch (e) {
      setState((c) => ({ ...c, error: e?.message || 'That could not be saved.' }));
    } finally { setBusy(null); }
  };

  const { incoming, outgoing, accepted, error } = state;
  if (!error && incoming.length === 0 && outgoing.length === 0 && accepted.length === 0) return null;

  return (
    <section className="mb-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4" data-testid="relationship-requests">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Relationship requests</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
        A relationship appears in either book, and counts towards either network score, only once the other person accepts.
      </p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {incoming.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
          {incoming.map((r) => (
            <li key={`in-${r.id}`} className="py-2 flex items-center justify-between gap-3">
              <span className="text-sm text-gray-800 dark:text-gray-200">
                <strong>{r.requester?.name || 'Someone'}</strong> wants to record you as {typeLabel(r.relationship_type)}
              </span>
              <span className="flex gap-2 shrink-0">
                <button type="button" disabled={busy === r.id}
                  onClick={() => act(r.id, () => api.respondRelationship(r.id, 'accept'))}
                  className="px-3 py-1 text-xs rounded-lg bg-violet-600 text-white disabled:opacity-50">Accept</button>
                <button type="button" disabled={busy === r.id}
                  onClick={() => act(r.id, () => api.respondRelationship(r.id, 'decline'))}
                  className="px-3 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 disabled:opacity-50">Decline</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {outgoing.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
          {outgoing.map((r) => (
            <li key={`out-${r.id}`} className="py-2 flex items-center justify-between gap-3">
              <span className="text-sm text-gray-800 dark:text-gray-200">
                You asked to record <strong>{r.other?.name || 'this person'}</strong> as {typeLabel(r.relationship_type)}
                {' · '}{r.status === 'declined' ? 'Declined' : 'Waiting for them to accept'}
              </span>
              {r.status === 'pending' && (
                <button type="button" disabled={busy === r.id}
                  onClick={() => act(r.id, () => api.withdrawRelationship(r.id))}
                  className="shrink-0 px-3 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 disabled:opacity-50">Withdraw</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {/* Every accepted record, including the ones recorded before requests
          existed (migration 368) — which their subjects were told about and
          may not recognise. Either side can end one. */}
      {accepted.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
            Relationship records with you ({accepted.length}) — remove any you do not recognise
          </summary>
          <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
            {accepted.map((r) => (
              <li key={`acc-${r.id}`} className="py-2 flex items-center justify-between gap-3">
                <span className="text-sm text-gray-800 dark:text-gray-200">
                  <strong>{r.other?.name || r.other?.email || 'A member'}</strong> · {typeLabel(r.relationship_type)}
                </span>
                <button type="button" disabled={busy === r.id}
                  onClick={() => act(r.id, () => api.removeRelationship(r.id))}
                  className="shrink-0 px-3 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 disabled:opacity-50">Remove</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
