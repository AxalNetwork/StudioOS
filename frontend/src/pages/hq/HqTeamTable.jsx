import React, { useEffect } from 'react';
import { Users, Search, Loader2 } from 'lucide-react';
import { Card, Unreadable } from '../../ui';
import { useViewAsBranch } from '../../contexts/ViewAsBranchContext';
import { TEAM_SEARCH_MAX, searchStatus } from './teamSearchPolicy';
import { branchCoverageLine, registryUnreadable, wholeTeamEstablished } from './hqTeamBranchModel';
import OpenAccountMoves from './AccountMoveRecovery';
import { useHqTeamRoster } from './team/useHqTeamRoster';
import HqAdminRoster, { rosterRows } from './team/HqAdminRoster';
import BranchAccountSearch from './team/BranchAccountSearch';

// The parts other screens and tests import from here, where they have always been.
export { MoveHit, branchHitStates } from './team/BranchAccountSearch';
export { supportNoticeOutcome, SupportNoticeOutcome } from './team/SupportSessionAction';

/**
 * HQ · Team — the first screen whose SUBJECT is the administrators (H9, D138).
 *
 * Every administrator and where each stands, on one screen (D138's history is in DECISIONS.md).
 *
 * THE GROUPS ARE H9'S OWN MODEL, and its copy states why: "There is no global
 * accounts table. HQ asks each branch over its private link and groups what
 * comes back … and when one branch does not answer, its group says so instead
 * of showing zero." So the HQ-held group is complete and always present, and
 * the search box is what HQ ASKS THE BRANCHES. With no branch provisioned there
 * is one group, every administrator is HQ-held, and that is a fact about where
 * the row lives rather than a placeholder.
 *
 * THE FILTER NARROWS A COMPLETE LIST, WHICH IS THE WHOLE POINT. The roster
 * comes from a query with a predicate and no LIMIT, so narrowing it in the
 * browser hides nothing. Filtering a complete list narrows it; filtering a page hides rows.
 *
 * D5044 — ONE FILE PER CONCERN. This file composes; the parts live in `team/`:
 *   `useHqTeamRoster.js`      the page's one supervision read (`GET /api/admin/hq/admins`), race-safe
 *   `HqAdminRoster.jsx`       the HQ-held table, and Sign out (`SignOutAccountAction.jsx`)
 *   `BranchAccountSearch.jsx` each branch's answer and a hit's Support, Move and Unbind
 *                             (`SupportSessionAction.jsx`, `MoveAccountAction.jsx`, `UnbindAdminAction.jsx`)
 *   `governedAction.js`       the one state model every destructive action shares
 *   `teamInvalidation.js`     which of the page's reads each act invalidates
 * Each act reports itself through `onChanged(act)`, and the page re-reads what that act changed.
 * Focus around each action form is `team/actionFocus.js` (D5045).
 */

export default function HqTeamTable({ reloadKey = 0, onLoaded, onChanged }) {
  // D153 / H12 frame 2 — the same scope the shell bar names. Under it the
  // route reads ONE branch and does not read HQ's roster at all, so the
  // HQ-held half below is absent rather than filtered away: a narrowed HQ
  // table is exactly what H12 says the overlay is not.
  const { branch: viewAs } = useViewAsBranch();
  const { data, error, typed, setTyped, asked, answeredFor, pending, load } = useHqTeamRoster({ reloadKey, viewAs });

  // D221 — the page's rail reports what THIS table read rather than asking the
  // server a second time: two reads of one roster can disagree, and a rail that
  // says "4 administrators" beside a table showing 3 is the tile-vs-table
  // defect D128 ended. Loading is not reported; unreadable is, as `null`.
  useEffect(() => {
    if (data !== undefined && typeof onLoaded === 'function') onLoaded(data);
  }, [data, onLoaded]);

  if (data === undefined) {
    return (
      <Card className="p-5" data-testid="hq-team">
        <p className="text-[12px] text-axal-faint"><Loader2 size={13} className="inline animate-spin" /> Loading the team…</p>
      </Card>
    );
  }

  if (data === null) {
    return (
      <Card className="p-5" data-testid="hq-team">
        <Unreadable
          what="The administrator roster"
          claim={`This is not a claim that there are none — it is a read that failed. ${error || ''}`.trim()}
          onRetry={load}
        />
      </Card>
    );
  }

  const ladderReadable = data.ladder_readable !== false;
  const licencesReadable = data.licences_available !== false;
  const needle = typed.trim().toLowerCase();
  const rows = rosterRows(data.items, needle);

  const branches = Array.isArray(data.branches) ? data.branches : [];
  // D5042 — the branch groups below answer `answeredFor`. They are CURRENT only while that is the query
  // asked now; otherwise the last committed answer stays on screen, marked, until the newer one lands.
  // When the search was cleared, the old hits are not shown at all: they answer a question nobody is asking.
  const current = answeredFor === asked;
  const hideHits = !current && asked === '';
  const status = searchStatus({
    typed,
    sent: asked,
    pending,
    answeredFor,
    hits: current ? branches.reduce((n, b) => n + (b.status === 'ok' ? (b.data?.results || []).length : 0), 0) : 0,
    failed: current ? branches.filter((b) => b.status === 'unreadable').length : 0,
  });

  return (
    <Card className="p-5" data-testid="hq-team">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <Users size={13} /> Team
          </div>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            Every administrator, the licence each holds, and where each stands on the compliance
            ladder. Grouped by branch: there is no global accounts table, so HQ holds its own and
            asks each branch over its private link.
          </p>
        </div>
        <label className="flex items-center gap-1.5 rounded-md border border-axal-hairline px-2 py-1.5">
          <Search size={13} className="text-axal-faint" />
          <input
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Filter admins · ask branches"
            aria-label="Filter administrators and search branches"
            aria-describedby="hq-team-search-status"
            maxLength={TEAM_SEARCH_MAX}
            data-testid="hq-team-search"
            className="w-56 bg-transparent text-[12.5px] text-axal-ink outline-none"
          />
        </label>
      </div>

      {/* One polite status region for the branch search (D5042): the hint under the minimum, the search in
          flight, and what the branches answered. Visible for the hint, announced for the rest. */}
      <p
        id="hq-team-search-status"
        role="status"
        aria-live="polite"
        className={status.kind === 'hint' ? 'mt-1 text-right text-[11.5px] text-axal-faint' : 'sr-only'}
        data-testid="hq-team-search-status"
      >
        {status.text}
      </p>

      {viewAs && (
        <p className="mt-3 text-[12px] leading-relaxed text-axal-muted" data-testid="hq-team-scoped-note">
          Reading {viewAs} alone. HQ&rsquo;s own administrator roster is not narrowed here — it is not
          read: this is one branch&rsquo;s answer to one question, not an HQ table with a filter over it.
          Nothing here can be acted on, which is why no move, reassign or suspend control is drawn —
          an action that cannot run from this view is not drawn in it.
        </p>
      )}

      {!viewAs && <OpenAccountMoves />}

      {!ladderReadable && !viewAs && (
        <p className="mt-3" data-testid="hq-team-ladder-unreadable">
          <Unreadable what="The compliance ladder" claim={data.ladder_reason || 'No rung is shown for any administrator.'} onRetry={load} />
        </p>
      )}

      {!viewAs && (
      <div className="mt-4 flex items-baseline gap-2" data-testid="hq-team-group-hq">
        <span className="text-[11px] font-extrabold uppercase tracking-[.08em] text-axal-ink">Axal VC HQ</span>
        <span className="text-[11.5px] text-axal-faint">
          HQ-held · {data.total} {Number(data.total) === 1 ? 'administrator' : 'administrators'}
          {typeof data.active === 'number' ? `, ${data.active} active` : ''}
          {needle ? ` · showing ${rows.length}` : ''}
        </span>
      </div>
      )}

      {viewAs ? null : rows.length === 0 ? (
        <p className="mt-2 text-[12px] text-axal-faint">
          {needle
            ? 'No administrator here matches that.'
            : 'No account on this database holds the admin role.'}
        </p>
      ) : (
        <HqAdminRoster
          rows={rows}
          ladderReadable={ladderReadable}
          licencesReadable={licencesReadable}
          onSignedOut={() => onChanged?.('hq_sign_out')}
        />
      )}

      {registryUnreadable(data) && (
        <div className="mt-4 border-t border-axal-hairline pt-3" data-testid="hq-team-registry-unreadable">
          <Unreadable
            what="HQ's deployment registry"
            claim="So the set of provisioned branches is not established. This is not a claim that no branch exists, and the administrators above are HQ's own, not necessarily the whole team."
            onRetry={load}
          />
        </div>
      )}

      {!current && asked !== '' && (
        <p className="mt-4 text-[12px] text-axal-faint" data-testid="hq-team-search-stale">
          Showing the last answer ({answeredFor ? `for “${answeredFor}”` : 'no search'}) while the branches answer for “{asked}”.
        </p>
      )}

      <BranchAccountSearch
        data={data}
        current={current}
        hideHits={hideHits}
        viewAs={viewAs}
        onRetry={load}
        onMoved={() => onChanged?.('branch_move')}
        onUnbound={() => onChanged?.('branch_unbind')}
      />

      <p className="mt-4 text-[11px] leading-relaxed text-axal-faint">
        {viewAs && (
          <>
            {/* The column H9 draws that has no source, stated rather than
                drawn empty: trust is HQ's own service over HQ's own accounts
                and is not computed per branch, so a branch hit carries no
                trust field to put in one. D129's precedent on S2 governs the
                other one — a hit carries `role`, not a licence type, so the
                heading beside it says Role. */}
            A branch hit carries a role, an active state and its KYC, access and Lab state, read-only; it
            carries no trust score, because trust is computed over HQ&rsquo;s own accounts and is not a
            per-branch figure.
            {' '}
          </>
        )}
        {wholeTeamEstablished(data)
          ? 'No branch is provisioned, so every account on the platform is HQ-held and this is the whole team.'
          : (branchCoverageLine(data) ? `${branchCoverageLine(data)}.` : null)}
        {' '}
        Moving an account between branches closes it where it lives and re-invites it where it is
        going — records stay put. Move appears on a branch hit only when another branch code exists.
        It needs a step-up and TOTP; a refusal names the reason. HQ-held rows have no source branch,
        so they are not movable from this table. When the invitation on the destination does not land,
        the move stays under Moves to finish with Retry invitation, which invites the address the source
        recorded and nothing typed here. Support opens a session on an active branch account,
        on that branch&rsquo;s own site, with the same step-up and a reason; the branch sends the person a
        security notice when the session is authorised, and the Support form shows whether it was stored.
        An administrator&rsquo;s hit shows Unbind instead of Move: an administrator is unbound, not moved,
        and Unbind removes the role and deactivates the account on that branch, with the same step-up and a reason.
      </p>
    </Card>
  );
}
