import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { dealSyndicatesApi } from '../../lib/api/dealSyndicates';
import { parseMinor } from '../../lib/money';
import { STATES, SYNDICATE_CLOSE_CONFIRM, SYNDICATE_FLOW, centsMoney, whenLine } from './dealRoomCopy';
import { Loading, Empty, Unreadable, NotRecorded, StatusPill, BTN, INPUT } from './DealRoomKit';
import Sheet from '../../ui/Sheet.jsx';
import Lightbox from '../../ui/Lightbox.jsx';

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
 *
 * D6200 (#6200, DL13) — given a `dealId`, the list also reads the open
 * syndicates on the company that the investor's invitation to that exact deal
 * lets them see (`GET /networkfx/syndicates?deal_id=`). Those rows carry the
 * lead, target, minimum and a member count, never a name, and open the DL13
 * lightbox with Join this syndicate. Joining is a second step in the same
 * dialog that says what it records; the join call is made only from that
 * step's own button, bound to the deal.
 */
// D1149: project-level syndicates retain USD; a deal cannot relabel them.
export default function DealSyndicates({ projectId, dealId = null, user }) {
  const [state, setState] = useState({ loading: true, error: false, rows: null });
  const [found, setFound] = useState({ loading: dealId != null, error: false, rows: [] });
  const [open, setOpen] = useState(null);
  const [joining, setJoining] = useState(null);
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
  const discover = useCallback(async () => {
    if (dealId == null) { setFound({ loading: false, error: false, rows: [] }); return; }
    setFound((f) => ({ ...f, loading: true, error: false }));
    try {
      const rows = await dealSyndicatesApi.open(dealId);
      setFound({ loading: false, error: false, rows: Array.isArray(rows) ? rows : [] });
    } catch {
      setFound({ loading: false, error: true, rows: [] });
    }
  }, [dealId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { discover(); }, [discover]);
  const reload = async () => { await Promise.all([load(), discover()]); };
  const joinable = state.rows ? joinableSyndicates(state.rows, found.rows) : [];
  const rows = state.rows ? [...state.rows.map((s) => ({ ...s, joinable: false })), ...joinable] : null;

  return (
    <section className="mt-6" data-testid="dr-syndicates">
      <h3 className="mb-2 text-sm font-bold text-gray-900 dark:text-gray-100">Syndicates</h3>
      {state.loading && !state.rows ? <Loading what="syndicates" />
        : state.error ? <Unreadable onRetry={load}>{STATES.syndicates.unread}</Unreadable>
          : !rows.length && !found.error && !found.loading ? <Empty>{STATES.syndicates.empty}</Empty>
            : rows.length > 0 && (
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
                {rows.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3" data-testid={s.joinable ? 'dr-syndicate-joinable' : undefined}>
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 dark:text-gray-100">{s.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{syndicateLine(s)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <SyndicateStatus status={s.status} />
                      <button type="button" onClick={() => (s.joinable ? setJoining(s) : setOpen(s.id))} className={`${BTN.link} min-h-[44px] px-1`}>Open</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
      {found.error && <div className="mt-2"><Unreadable onRetry={discover}>{SYNDICATE_JOIN.unread}</Unreadable></div>}
      {open != null && (
        <SyndicateDrawerLoader id={open} user={user} onClose={() => setOpen(null)} onClosed={load} />
      )}
      {joining && (
        <SyndicateJoinDialog syndicate={joining} dealId={dealId} onClose={async (joined) => { setJoining(null); if (joined) await reload(); }} />
      )}
    </section>
  );
}

/** D6200: the copy of the DL13 lightbox and its join step. */
export const SYNDICATE_JOIN = {
  unread: 'The open syndicates on this deal could not be read just now. That is not a claim that there are none.',
  counted: 'Counted, not named',
  notIn: 'You are not in this syndicate.',
  whoSees: 'Only the lead sees members by name. Members see the count.',
  does: 'Joining records your pledge to this syndicate, for this deal. It moves no money and does not mark the syndicate funded. The lead sees your name and amount; other members see only the count.',
  noMinimum: 'No minimum is recorded for this syndicate.',
};

/**
 * The open syndicates the deal's invitation shows, less the ones already in the
 * investor's own list (they lead or belong to those, so they read the drawer).
 */
export function joinableSyndicates(own, found) {
  const mine = new Set((own || []).map((s) => Number(s.id)));
  return (found || [])
    .filter((s) => !mine.has(Number(s.id)) && !Number(s.is_member) && !Number(s.is_lead) && s.status === 'open')
    .map((s) => ({ ...s, joinable: true }));
}

/** One row's line: who leads it, the count and, for a syndicate the investor is in, what is committed. */
export function syndicateLine(s) {
  const count = `${Number(s.members) || 0} member${Number(s.members) === 1 ? '' : 's'}`;
  const lead = s.creator_name ? `Lead ${s.creator_name} · ` : '';
  if (s.joinable) {
    const min = Number(s.min_commitment_cents) > 0 ? ` · Minimum ${centsMoney(s.min_commitment_cents)}` : '';
    return `${lead}${count}${min} · You are not in this syndicate`;
  }
  return `${lead}${centsMoney(s.committed_cents) || 'Not recorded'} committed · ${count}`;
}

/** The pledge typed in dollars, as whole cents, or the sentence that stops it. */
export function pledgeCheck(text, minCents) {
  const raw = String(text ?? '').replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { error: 'Enter an amount in dollars, such as 25000.' };
  const parsed = parseMinor(raw, 'USD');
  if (!parsed.ok) return { error: 'Enter an amount in dollars, such as 25000.' };
  const cents = parsed.minor;
  if (!Number.isSafeInteger(cents) || cents <= 0) return { error: 'Enter an amount above zero.' };
  if (Number(minCents) > 0 && cents < Number(minCents)) return { error: `The minimum for this syndicate is ${centsMoney(minCents)}. Nothing was recorded.` };
  return { cents };
}

/** A refused join, as the sentence the dialog prints. Nothing is ever recorded on a refusal. */
export function joinRefusal(e) {
  const status = Number(e?.status);
  const msg = String(e?.message || '');
  if (status === 403) return 'Your identity check must be approved before you can join a syndicate. Nothing was recorded.';
  if (status === 404) return 'This syndicate is not open to you on this deal. Nothing was recorded.';
  if (status === 409 && /already/i.test(msg)) return 'You are already in this syndicate. Nothing changed.';
  if (status === 409) return 'This syndicate is no longer open to you. Nothing was recorded.';
  if (status === 400 && /minimum/i.test(msg)) return 'That is below this syndicate’s minimum. Nothing was recorded.';
  if (status === 400 && /not open/i.test(msg)) return 'This syndicate is no longer open. Nothing was recorded.';
  if (status === 400 && /own syndicate/i.test(msg)) return 'You lead this syndicate, so you cannot join it. Nothing was recorded.';
  return 'Your pledge did not save. Nothing was recorded. Try again.';
}

/**
 * DL13: a syndicate the investor is not in, as a centred lightbox (a bottom
 * sheet on a phone). Its facts come from the count-only row; no member read is
 * made. Join this syndicate turns the same dialog into the pledge step.
 * Rendered directly by the tests.
 */
export function SyndicateJoinDialog({ syndicate: s, dealId, onClose, initialStep = 'facts' }) {
  const [step, setStep] = useState(initialStep);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [pledged, setPledged] = useState(null);
  const members = Number(s.members) || 0;

  const confirmJoin = async () => {
    const checked = pledgeCheck(amount, s.min_commitment_cents);
    if (checked.error) { setRefusal(checked.error); return; }
    setBusy(true); setRefusal('');
    try {
      await dealSyndicatesApi.join(s.id, { commitmentCents: checked.cents, dealId });
      setPledged(checked.cents);
      setStep('done');
    } catch (e) {
      setRefusal(joinRefusal(e));
    } finally {
      setBusy(false);
    }
  };

  const footer = step === 'facts' ? (
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" onClick={() => onClose(false)} className={`${BTN.ghost} min-h-[44px]`}>Close</button>
      <button type="button" onClick={() => { setRefusal(''); setStep('pledge'); }} className={`${BTN.primary} min-h-[44px]`} data-testid="dr-syndicate-join">Join this syndicate</button>
    </div>
  ) : step === 'pledge' ? (
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" onClick={() => { setRefusal(''); setStep('facts'); }} disabled={busy} className={`${BTN.ghost} min-h-[44px]`}>Back</button>
      <button type="button" onClick={confirmJoin} disabled={busy} className={`${BTN.primary} min-h-[44px]`} data-testid="dr-syndicate-join-confirm">
        {busy && <Loader2 size={14} className="animate-spin" />} Join and pledge
      </button>
    </div>
  ) : (
    <div className="flex justify-end">
      <button type="button" onClick={() => onClose(true)} className={`${BTN.primary} min-h-[44px]`} data-testid="dr-syndicate-join-done">Done</button>
    </div>
  );

  return (
    <Lightbox label={s.name || 'Syndicate'} eyebrow="Syndicate" title={step === 'pledge' ? `Join ${s.name || 'this syndicate'}?` : (s.name || 'Syndicate')}
      width={560} phone="sheet" testId="dr-syndicate-join-dialog" focusKey={step}
      onClose={() => { if (!busy) onClose(step === 'done'); }} footer={footer}>
      <div className="flex flex-col gap-4 px-5 py-4 text-sm text-gray-900 dark:text-gray-100">
        {step === 'facts' && (
          <>
            <div><SyndicateStatus status={s.status} /></div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3" data-testid="dr-syndicate-facts">
              <div><dt className="text-xs text-gray-500 dark:text-gray-400">Lead</dt><dd className="font-semibold">{s.creator_name || <NotRecorded reason="Not recorded: no lead name is stored." />}</dd></div>
              <div><dt className="text-xs text-gray-500 dark:text-gray-400">Target</dt><dd className="font-mono font-semibold">{Number(s.target_cents) > 0 ? centsMoney(s.target_cents) : <NotRecorded reason={STATES.syndicates.nrTarget} />}</dd></div>
              <div><dt className="text-xs text-gray-500 dark:text-gray-400">Minimum</dt><dd className="font-mono font-semibold">{Number(s.min_commitment_cents) > 0 ? centsMoney(s.min_commitment_cents) : <NotRecorded reason={SYNDICATE_JOIN.noMinimum} />}</dd></div>
              <div><dt className="text-xs text-gray-500 dark:text-gray-400">Members</dt><dd><span className="font-mono font-semibold">{members}</span> <span className="text-xs text-gray-500 dark:text-gray-400">{SYNDICATE_JOIN.counted}</span></dd></div>
            </dl>
            <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
              <p className="m-0 font-semibold">{SYNDICATE_JOIN.notIn}</p>
              <p className="m-0 text-xs text-gray-500 dark:text-gray-400">{SYNDICATE_JOIN.whoSees}</p>
            </div>
          </>
        )}
        {step === 'pledge' && (
          <>
            <p className="m-0" data-testid="dr-syndicate-join-does">{SYNDICATE_JOIN.does}</p>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Your pledge · USD</span>
              <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy}
                className={`${INPUT} min-h-[44px] font-mono`} placeholder="25000" data-testid="dr-syndicate-join-amount" />
              <span className="text-xs text-gray-500 dark:text-gray-400">{Number(s.min_commitment_cents) > 0 ? `Minimum ${centsMoney(s.min_commitment_cents)}.` : SYNDICATE_JOIN.noMinimum}</span>
            </label>
          </>
        )}
        {step === 'done' && (
          <p className="m-0" role="status" data-testid="dr-syndicate-joined">You are in {s.name || 'this syndicate'}. Your pledge of {centsMoney(pledged)} is recorded. No money has moved.</p>
        )}
        {refusal && <p className="m-0 text-sm text-red-700 dark:text-red-300" role="alert" data-testid="dr-syndicate-join-refusal">{refusal}</p>}
      </div>
    </Lightbox>
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
    // D1317: the syndicate opens as the shared Sheet (480px, its own max-w-md).
    <Sheet label="Syndicate" title={s?.name || 'Syndicate'} width={480} testId="dr-syndicate-drawer" onClose={onClose}>
      <div className="p-5">
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
                  <dd className="font-mono">{centsMoney(s.committed_cents) || 'Not recorded'}</dd>
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
                {s.show_member_names === false
                  ? (
                    <>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400" data-testid="dr-syndicate-counted">{memberCountLine(s.member_count)}</p>
                      <YourLine line={s.my_line} />
                    </>
                  )
                  : (s.members || []).length === 0
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
      </div>
    </Sheet>
  );
}

/**
 * D9018 (#9018, DL13l "As a member"): the signed-in member's own pledge, from
 * the detail read's `my_line` (the caller's row only). The pill is the stored
 * status: the Worker writes `committed` when a member joins, drawn "Pledged"
 * because a join records a pledge and moves no money. A status this build does
 * not know is drawn as stored. Without `my_line` nothing is drawn.
 */
export const YOUR_LINE_WHO = 'Only you and the lead see this line.';
export const LINE_STATUS = { committed: { label: 'Pledged', tone: 'violet' } };

export function yourLineParts(line) {
  if (!line || typeof line !== 'object') return null;
  const known = LINE_STATUS[line.status];
  return {
    amount: centsMoney(line.commitment_cents) || null,
    status: known ? known.label : (line.status ? String(line.status) : null),
    tone: known ? known.tone : 'grey',
    since: whenLine(line.joined_at),
  };
}

export function YourLine({ line }) {
  const p = yourLineParts(line);
  if (!p) return null;
  return (
    <div className="mt-3 rounded-lg border border-gray-200 px-3 py-2.5 dark:border-gray-700" data-testid="dr-syndicate-your-line">
      <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Your line</span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-gray-900 dark:text-gray-100">{p.amount || <NotRecorded reason="Not recorded: no amount is stored for your pledge." />}</span>
          {p.status && <StatusPill tone={p.tone} testid="dr-syndicate-your-line-status">{p.status}</StatusPill>}
        </span>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{p.since ? `Joined ${p.since} UTC. ` : ''}{YOUR_LINE_WHO}</p>
    </div>
  );
}

/** D6200: a member's view of the roster. Others are counted; only the lead sees names. */
export function memberCountLine(count) {
  const n = Number(count) || 0;
  return `${n} member${n === 1 ? '' : 's'}. Others are counted, not named; only the lead sees members by name.`;
}
