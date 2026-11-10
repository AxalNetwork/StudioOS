/**
 * D5044 (#5044) — HQ Team's branch search: each branch's answer, and the actions on a branch hit.
 *
 * H9's model: "There is no global accounts table. HQ asks each branch over its private link and
 * groups what comes back … and when one branch does not answer, its group says so instead of
 * showing zero." The groups are read once with the roster (`useHqTeamRoster`); this file draws them.
 *
 * A HIT CARRIES THREE ACTIONS, each its own file on the shared state model (`governedAction.js`):
 *  · Support (`SupportSessionAction`) — not under the view-as overlay (it reads one branch and the
 *    scoped note promises nothing here can be acted on, D153), and only on an active account.
 *  · Move (`MoveAccountAction`) — only when another branch code exists, only on an active account,
 *    never on an administrator. HQ-held rows have no source branch, so they carry no Move.
 *  · Unbind (`UnbindAdminAction`, D262) — on an administrator's hit instead of Move: an
 *    administrator is unbound, not moved. Support stays on an admin hit: the branch treats
 *    supporting its own administrator as the ordinary case.
 * One panel is open at a time. Once a move has answered, the hit shows the move's outcome
 * (`../AccountMoveRecovery.jsx`) and never its controls again.
 */
import React, { useRef, useState } from 'react';
import { Unreadable } from '../../../ui';
import { branchStateText } from '../hqTeamBranchModel';
import { MoveOutcome } from '../AccountMoveRecovery';
import { moveView } from '../accountMoveModel';
import SupportSessionAction from './SupportSessionAction';
import MoveAccountAction from './MoveAccountAction';
import UnbindAdminAction from './UnbindAdminAction';
import { useFocusRequest, useFocusTargets } from './actionFocus';

/**
 * D260 — what a branch hit says about the account's KYC, access and Lab, as
 * the branch sent it. Read-only: acting on any of the three is the branch
 * admin's, on its own Admin Console, and HQ draws no control for it.
 *
 * A branch on a build from before D260 sends none of the three fields, and
 * `null` is returned for it so the row says the branch did not send them —
 * never "not started", which would be a claim about the account. A KYC state
 * the branch holds as NULL reads "not recorded" for the same reason. Access is
 * named only when it is `limited`: the column holds that or nothing, and
 * nothing means access follows KYC, which the first state already says.
 */
const KYC_STATE = {
  not_started: 'KYC not started', pending: 'KYC pending', approved: 'KYC approved', rejected: 'KYC rejected',
};
export function branchHitStates(hit) {
  if (!hit || !('kyc_status' in hit)) return null;
  const out = [hit.kyc_status == null ? 'KYC not recorded' : (KYC_STATE[hit.kyc_status] || `KYC ${hit.kyc_status}`)];
  if (hit.access_level === 'limited') out.push('limited access');
  if (Number(hit.spinout_lab_active) === 1) out.push('in the Lab');
  else if (Number(hit.spinout_lab_admitted) === 1) out.push('admitted to the Lab');
  return out;
}

/** One account a branch answered with, and the actions HQ may take on it. */
export function MoveHit({ hit, from, destinations, onMoved, onUnbound, viewAs }) {
  const [panel, setPanel] = useState(null); // 'support' | 'move' | 'unbind' | null
  const [done, setDone] = useState(null);
  const [unbound, setUnbound] = useState(false);
  const active = Number(hit.is_active) === 1;
  const canSupport = !viewAs && Number(hit.is_active) === 1;
  // D262 — AN ADMINISTRATOR IS UNBOUND, NOT MOVED.
  const isAdminHit = String(hit.role || '').toLowerCase() === 'admin';
  const canMove = destinations.length > 0 && active && !isAdminHit;
  const canUnbind = !viewAs && isAdminHit && Number(hit.is_active) === 1;
  const states = branchHitStates(hit);
  const toggle = (name) => setPanel((p) => (p === name ? null : name));
  // D5045: Escape returns focus to the button that opened the panel; an unbind or a move moves it to
  // the line that replaces the hit.
  const refs = { support: useRef(null), move: useRef(null), unbind: useRef(null), outcome: useRef(null) };
  const [focusReq, askFocus] = useFocusRequest();
  useFocusTargets(focusReq, refs);
  const close = (name) => () => { setPanel(null); askFocus(name); };

  if (unbound) {
    return (
      <li className="py-1.5 text-[12px] text-axal-muted" data-testid="hq-team-unbound" ref={refs.outcome} tabIndex={-1}>
        {hit.name || hit.email} is no longer an administrator of {from}: the role is removed and the account deactivated there.
      </li>
    );
  }
  // D5043 — once the source has closed the account, the hit shows the move's outcome and never
  // the Move control again: the two legs, the records note, and Retry invitation while the second
  // leg is open. A refresh finds the same move under Moves to finish (`AccountMoveRecovery.jsx`).
  if (done) {
    return (
      <li className="py-1.5" data-testid="hq-team-moved" ref={refs.outcome} tabIndex={-1}>
        <MoveOutcome view={moveView(done)} />
      </li>
    );
  }
  return (
    <li className="py-1.5 text-[12px]">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-axal-ink dark:text-white">{hit.name || hit.email}</span>
          <span className="block truncate text-[11px] text-axal-faint" data-testid="hq-team-hit-states">
            {states ? states.join(' · ') : 'KYC, access and Lab state not sent by this branch’s build'}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[11.5px] text-axal-faint">
          <span>{hit.role} · {active ? 'active' : 'deactivated'}</span>
          {canSupport && (
            <button type="button" className="font-bold text-axal-violet dark:text-violet-300" ref={refs.support} data-testid="hq-team-support-toggle" aria-expanded={panel === 'support'} onClick={() => toggle('support')}>
              Support
            </button>
          )}
          {canMove && (
            <button type="button" className="font-bold text-axal-violet dark:text-violet-300" ref={refs.move} data-testid="hq-team-move-toggle" aria-expanded={panel === 'move'} onClick={() => toggle('move')}>
              Move
            </button>
          )}
          {canUnbind && (
            <button type="button" className="font-bold text-rose-700 dark:text-rose-300" ref={refs.unbind} data-testid="hq-team-unbind-toggle" aria-expanded={panel === 'unbind'} onClick={() => toggle('unbind')}>
              Unbind
            </button>
          )}
        </span>
      </div>
      {canSupport && panel === 'support' && <SupportSessionAction hit={hit} from={from} onCancel={close('support')} />}
      {canUnbind && panel === 'unbind' && (
        <UnbindAdminAction hit={hit} from={from} onCancel={close('unbind')} onUnbound={(res) => { setUnbound(true); askFocus('outcome'); onUnbound?.(res); }} />
      )}
      {canMove && panel === 'move' && (
        <MoveAccountAction hit={hit} from={from} destinations={destinations} onCancel={close('move')} onMoved={(res) => { setDone(res); askFocus('outcome'); onMoved?.(res); }} />
      )}
    </li>
  );
}

/** Every branch's group: its state, its refusal or silence, and its hits for the query asked now. */
export default function BranchAccountSearch({ data, current, hideHits, viewAs, onRetry, onMoved, onUnbound }) {
  const branches = Array.isArray(data.branches) ? data.branches : [];
  return branches.map((b) => (
    <div
      key={b.code}
      className={`mt-4 border-t border-axal-hairline pt-3 ${current ? '' : 'opacity-60'}`}
      aria-busy={!current}
      data-testid="hq-team-group-branch"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-extrabold uppercase tracking-[.08em] text-axal-ink">{b.code}</span>
        <span className="text-[11.5px] text-axal-faint" data-testid={`hq-team-branch-state-${b.code}`}>
          {hideHits ? 'Updating…' : branchStateText(b)}
        </span>
      </div>
      {b.status === 'unreadable' && (
        <Unreadable what={`Branch ${b.code}`} claim={b.reason || 'It did not answer, which is not the same as it being down.'} onRetry={onRetry} />
      )}
      {b.status === 'not_deployed' && (
        <p className="mt-1 text-[12px] text-axal-faint">{b.reason}</p>
      )}
      {(b.status === 'not_asked' || (b.status === 'ok' && !data.searched)) && (
        <p className="mt-1 text-[12px] text-axal-faint" data-testid="hq-team-branch-idle">
          Type at least two characters to ask this branch. Its accounts live on its own
          database, so HQ cannot list them from here.
        </p>
      )}
      {current && b.status === 'ok' && data.searched && (b.data?.results || []).length === 0 && (
        <p className="mt-1 text-[12px] text-axal-faint">Nothing on this branch matched.</p>
      )}
      {!hideHits && b.status === 'ok' && (b.data?.results || []).length > 0 && (
        <ul className="mt-1 divide-y divide-axal-hairline">
          {(b.data.results || []).map((hit) => (
            <MoveHit
              key={hit.id}
              hit={hit}
              from={b.code}
              destinations={branches.map((x) => x.code).filter((code) => code && code !== b.code)}
              onMoved={onMoved}
              onUnbound={onUnbound}
              viewAs={viewAs}
            />
          ))}
        </ul>
      )}
    </div>
  ));
}
