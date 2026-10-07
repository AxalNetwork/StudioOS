import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { api } from '../../lib/api';
import { STATES, SYNDICATE_CLOSE_CONFIRM, SYNDICATE_FLOW, centsMoney, whenLine } from './dealRoomCopy';
import { Loading, Empty, Unreadable, NotRecorded, StatusPill, BTN } from './DealRoomKit';

/**
 * D630 (#1388) — canvas `sy-close`: the syndicates on this deal's company,
 * and closing one, in its drawer.
 *
 * WHICH SYNDICATES. `syndicates.deal_id` holds a PROJECT id (the create form
 * on the Network page offers projects, and `GET /syndicates/:id` reads it back
 * from `projects`), so the list is `GET /networkfx/syndicates?project_id=`.
 *
 * The status runs Open, then Funded (the Worker sets it when commitments reach
 * the target), then Closed. Closing is its creator's or an admin's, and it
 * takes a confirmation that says members are not notified. The close call is
 * made only from the confirmation's own button.
 */
export default function DealSyndicates({ projectId, user }) {
  const [state, setState] = useState({ loading: true, error: false, rows: null });
  const [open, setOpen] = useState(null);
  const load = useCallback(async () => {
    if (!projectId) { setState({ loading: false, error: false, rows: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const rows = await api.networkFxProjectSyndicates(projectId);
      setState({ loading: false, error: false, rows: Array.isArray(rows) ? rows : [] });
    } catch {
      setState({ loading: false, error: true, rows: null });
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  return (
    <section className="mt-6" data-testid="dr-syndicates">
      <h3 className="mb-2 text-sm font-bold text-gray-900 dark:text-gray-100">Syndicates</h3>
      {state.loading && !state.rows ? <Loading what="syndicates" />
        : state.error ? <Unreadable onRetry={load}>{STATES.syndicates.unread}</Unreadable>
          : !state.rows.length ? <Empty>{STATES.syndicates.empty}</Empty>
            : (
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
                {state.rows.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 dark:text-gray-100">{s.name}</div>
                      <div className="text-xs text-gray-500">{centsMoney(s.committed_cents) || '$0.00'} committed · {s.members} member{Number(s.members) === 1 ? '' : 's'}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <SyndicateStatus status={s.status} />
                      <button type="button" onClick={() => setOpen(s.id)} className={BTN.link}>Open</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
      {open != null && (
        <SyndicateDrawerLoader id={open} user={user} onClose={() => setOpen(null)} onClosed={load} />
      )}
    </section>
  );
}

export function SyndicateStatus({ status }) {
  const step = SYNDICATE_FLOW.find((f) => f.key === status);
  return <StatusPill tone={status === 'funded' ? 'violet' : status === 'closed' ? 'grey' : 'ok'}>{step ? step.label : status}</StatusPill>;
}

function SyndicateDrawerLoader({ id, user, onClose, onClosed }) {
  const [state, setState] = useState({ loading: true, error: false, syndicate: null });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const syndicate = await api.networkFxSyndicate(id);
      setState({ loading: false, error: false, syndicate });
    } catch {
      setState({ loading: false, error: true, syndicate: null });
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const canClose = Boolean(state.syndicate) && (user?.role === 'admin' || Number(state.syndicate.created_by) === Number(user?.id));
  return (
    <SyndicateDrawer
      state={state}
      onRetry={load}
      canClose={canClose}
      onClose={onClose}
      onClosed={async () => { await load(); await onClosed?.(); }}
    />
  );
}

/** The drawer. Rendered directly by the tests. */
export function SyndicateDrawer({ state, onRetry, canClose, onClose, onClosed, initialConfirming = false }) {
  const [confirming, setConfirming] = useState(initialConfirming);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const s = state.syndicate;

  const confirmClose = async () => {
    setBusy(true); setRefusal('');
    try {
      await api.networkFxCloseSyndicate(s.id);
      setConfirming(false);
      await onClosed?.();
    } catch (e) {
      setRefusal(e?.message || 'The syndicate was not closed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl dark:bg-gray-900" role="dialog" aria-label="Syndicate" data-testid="dr-syndicate-drawer">
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{s?.name || 'Syndicate'}</h2>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700" aria-label="Close drawer"><X size={18} /></button>
        </div>
        {state.loading && !s ? <Loading what="this syndicate" />
          : state.error ? <Unreadable onRetry={onRetry}>This syndicate could not be read just now.</Unreadable>
            : (
              <>
                <p className="text-xs text-gray-500">Open while it gathers commitments, Funded once the target is reached, Closed when its creator or an admin closes it.</p>
                <ol className="mt-3 flex items-center gap-2" data-testid="dr-syndicate-flow">
                  {SYNDICATE_FLOW.map((f, i) => (
                    <li key={f.key} className="flex items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${f.key === s.status ? 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300' : 'border-gray-200 text-gray-500 dark:border-gray-700'}`} aria-current={f.key === s.status ? 'step' : undefined}>
                        {f.label}
                      </span>
                      {i < SYNDICATE_FLOW.length - 1 && <span aria-hidden="true" className="text-gray-300">→</span>}
                    </li>
                  ))}
                </ol>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-gray-500">Target</dt>
                  <dd>{s.target_cents ? centsMoney(s.target_cents) : <NotRecorded reason={STATES.syndicates.nrTarget} />}</dd>
                  <dt className="text-gray-500">Committed</dt>
                  <dd className="font-mono">{centsMoney(s.committed_cents) || '$0.00'}</dd>
                  <dt className="text-gray-500">Members</dt>
                  <dd>{s.member_count ?? (s.members || []).length}</dd>
                  <dt className="text-gray-500">Creator</dt>
                  <dd>{s.creator_name || `User #${s.created_by}`}</dd>
                  {s.status === 'closed' && (
                    <>
                      <dt className="text-gray-500">Closed</dt>
                      <dd>{whenLine(s.closed_at) || <NotRecorded reason="Not recorded: no close time is stored." />}</dd>
                    </>
                  )}
                </dl>
                <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">Members</h3>
                {(s.members || []).length === 0
                  ? <p className="mt-1 text-sm text-gray-500">{STATES.syndicates.noMembers}</p>
                  : (
                    <ul className="mt-1 divide-y divide-gray-100 text-sm dark:divide-gray-800">
                      {s.members.map((m) => (
                        <li key={m.id} className="flex justify-between py-1.5">
                          <span>{m.name || `User #${m.user_id}`}</span>
                          <span className="font-mono">{centsMoney(m.commitment_cents)}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                {canClose && s.status !== 'closed' && (
                  <div className="mt-6 border-t border-gray-100 pt-4 dark:border-gray-800">
                    {!confirming ? (
                      <button type="button" onClick={() => setConfirming(true)} className={BTN.danger} data-testid="dr-syndicate-close">Close syndicate</button>
                    ) : (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30" role="alertdialog" data-testid="dr-syndicate-confirm">
                        <div className="font-semibold text-red-800 dark:text-red-200">{SYNDICATE_CLOSE_CONFIRM.title}</div>
                        <p className="mt-1 text-sm text-red-700 dark:text-red-300">{SYNDICATE_CLOSE_CONFIRM.body}</p>
                        <div className="mt-3 flex gap-2">
                          <button type="button" onClick={() => setConfirming(false)} className={BTN.ghost}>Keep it open</button>
                          <button type="button" onClick={confirmClose} disabled={busy} className={BTN.danger} data-testid="dr-syndicate-confirm-close">
                            {busy && <Loader2 size={14} className="animate-spin" />} Yes, close it
                          </button>
                        </div>
                      </div>
                    )}
                    {refusal && <p className="mt-2 text-sm text-red-700 dark:text-red-300" role="alert">{refusal}</p>}
                  </div>
                )}
              </>
            )}
      </aside>
    </>
  );
}
