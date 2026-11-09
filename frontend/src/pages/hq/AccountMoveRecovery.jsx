/**
 * D5043 (#5043) — HQ Team's moves to finish: a cross-branch move whose destination invitation did not land.
 *
 * The list is read from HQ's own record of each move (`GET /api/admin/account-moves`), so a refresh
 * or a later visit finds a partial move instead of losing it with the reply it arrived in. Each card
 * names the source and the destination, says the records stay at the source, and offers ONE action,
 * Retry invitation, which sends only the operation's id: the Worker invites the address the source
 * recorded. The normal Move control is never drawn for a move that already closed the account.
 *
 * After a retry the card says three things apart (`accountMoveModel.js`): whether the invitation was
 * created, whether the destination's mailer sent it, and the manual next step when it did not. It
 * never says the person was contacted.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCw } from 'lucide-react';
import { hqAccountMovesApi } from '../../lib/api/hqAccountMoves.js';
import { reportError } from '../../lib/log';
import { Unreadable } from '../../ui';
import { applyRetry, applyRetryError, failureLine, invitationLines, moveView } from './accountMoveModel';

const LINE_TONE = {
  created: 'text-axal-ink dark:text-gray-100',
  not_created: 'text-rose-700 dark:text-rose-300',
  sent: 'text-axal-muted',
  not_sent: 'text-amber-800 dark:text-amber-300',
  not_reported: 'text-axal-muted',
  manual: 'text-axal-ink dark:text-gray-100',
};

/** One move's outcome: the two legs, the records note, and Retry invitation while the second leg is open. */
export function MoveOutcome({ view, onRetried, onRefresh }) {
  // Seeded once: the caller keys this by the move and its last update, so a newer read remounts it,
  // and a retry's answer is not overwritten by the parent re-rendering.
  const [current, setCurrent] = useState(view);
  const [busy, setBusy] = useState(false);
  if (!current) return null;

  const failure = failureLine(current);
  const open = !current.invitation;
  const canRetry = open && current.recoverable && current.uid && !current.inProgress;

  const retry = async () => {
    setBusy(true);
    try {
      const res = await hqAccountMovesApi.retryInvitation(current.uid);
      setCurrent((v) => applyRetry(v, res));
      onRetried?.(res);
    } catch (ex) {
      reportError('hq-team-move-retry', ex);
      setCurrent((v) => applyRetryError(v, ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-1.5 rounded-lg border border-axal-hairline bg-axal-ground p-2.5 text-[12px]" data-testid="hq-team-move-outcome" data-move={current.uid || ''}>
      <p className="font-semibold text-axal-ink dark:text-white">
        {current.who}: {current.from} → {current.to}
      </p>
      <p className="text-axal-muted" data-testid="hq-team-move-source">
        Closed on {current.from}. Moving them out again would be refused, correctly.
      </p>
      {open && failure && (
        <p className="text-rose-700 dark:text-rose-300" role="status" data-testid="hq-team-move-failure" data-code={current.failure?.code || ''}>
          {failure}
        </p>
      )}
      {!open && (
        <ul className="grid gap-1" data-testid="hq-team-move-invitation">
          {invitationLines(current).map((line) => (
            <li key={line.key} className={LINE_TONE[line.state] || 'text-axal-muted'} data-state={line.state}>
              {line.text}
              {line.link && (
                <span className="mt-0.5 block break-all font-mono text-[11px]" data-testid="hq-team-move-link">{line.link}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {(current.inProgress || current.unknown) && onRefresh && (
        <button type="button" onClick={onRefresh} className="justify-self-start text-[11.5px] font-bold text-axal-violet dark:text-violet-300" data-testid="hq-team-move-refresh">
          Read the moves again
        </button>
      )}
      {current.recordsNote && <p className="text-[11.5px] text-axal-faint">{current.recordsNote}</p>}
      {open && !current.recoverable && (
        <p className="text-[11.5px] text-axal-muted" data-testid="hq-team-move-unrecoverable">
          HQ could not record that {current.from} closed this account, so Retry invitation is not offered for it.
          Search for the account on {current.from} before doing anything else.
        </p>
      )}
      {canRetry && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11.5px] text-axal-muted">
            Retry invitation asks {current.to} again to invite {current.email || current.who}
            {current.role ? ` as ${current.role}` : ''}, as {current.from} recorded them when it closed the account.
            It needs your authenticator and a fresh step-up.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={retry}
            data-testid="hq-team-move-retry"
            className="inline-flex items-center gap-1 rounded-md bg-axal-violet px-3 py-1 text-[11.5px] font-bold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
            {busy ? 'Retrying…' : 'Retry invitation'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The moves HQ still has to finish or follow up, from HQ's record. Drawn above the roster; nothing
 * is drawn when there are none. A failed read says so rather than implying there are none.
 */
export default function OpenAccountMoves({ reloadKey = 0 }) {
  const [items, setItems] = useState(undefined); // undefined loading, null unreadable
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const res = await hqAccountMovesApi.open();
      setItems(Array.isArray(res?.items) ? res.items : []);
      setError('');
    } catch (e) {
      reportError('hq-team-moves', e);
      setItems(null);
      setError(String(e?.message || e || 'Request failed'));
    }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  if (items === undefined || (Array.isArray(items) && items.length === 0)) return null;
  if (items === null) {
    return (
      <div className="mt-3" data-testid="hq-team-moves-unreadable">
        <Unreadable
          what="Moves to finish"
          claim={`A move whose invitation did not land may be waiting here. This is a read that failed, not a claim that there are none. ${error}`.trim()}
          onRetry={load}
        />
      </div>
    );
  }
  return (
    <section className="mt-4 grid gap-2" data-testid="hq-team-moves">
      <div className="text-[11px] font-extrabold uppercase tracking-[.08em] text-axal-ink">Moves to finish</div>
      <p className="text-[11.5px] text-axal-faint">
        Each account below was closed on its branch and its invitation on the destination did not land,
        or landed without its email. The records stay where they were.
      </p>
      {items.map((item) => (
        <MoveOutcome key={`${item.uid}:${item.updated_at || ''}`} view={moveView(item)} onRefresh={load} />
      ))}
    </section>
  );
}
