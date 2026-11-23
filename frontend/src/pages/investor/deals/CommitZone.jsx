import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { SHARE_BUTTON } from '../proofOfFundsModel';
import { api } from '../../../lib/api';
import { exportView } from '../../../lib/csvExport';
import { parseStamp } from '../../../ui/parseStamp';
import { useAuth } from '../../../hooks/useAuthSync';
import { investorZoneActions } from '../../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../../workspaces/investorZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { Eyebrow, NotRecorded } from '../../../workspaces/canvasKit';
import { ZoneBody, StatedLimit } from '../../advisor/expertise/kit';
import { ICDecisionsList, OpenDecisionSheet } from '../../ICDecisionsPage';
import {ballotOf, tallyText as tallyWords} from '../../icDecisionModel';
import Sheet from '../../../ui/Sheet';
import { YourVote } from './commit/VoteDialogs';
import { rosterLine, refusalWords } from './commit/commitVoteModel';
export {ballotOf} from '../../icDecisionModel';
import FromMercury from '../FromMercury';
import { CommitPhone, CommitRefused } from './CommitPhone';

/**
 * Deals · Commit — the Investment committee page, `/deals/commit`.
 *
 * D4815 (#4815) canvas DX7, boards DE07 (a decision open) and DE07b (none
 * open), built by #5910. WAS canvas ID3's LEDGER: a strip of five record-wide
 * counts, a three-column vote ledger, and the method written under every
 * instrument. The page now reads as the committee's desk for the decision in
 * front of it:
 *
 *   · the strip — Current decision, Votes cast, Open conditions, Rationales,
 *     Meeting;
 *   · the decision card — eligible voters, voted and recused, then one row
 *     per vote: Partner, Vote, Rationale, Recorded;
 *   · Conditions (Condition, Status, Owner, Decision, Recorded), an open one
 *     marked as blocking Closing, beside the Minutes or the sentence that
 *     says none are recorded;
 *   · the method under "How this works".
 *
 * THE CURRENT DECISION IS THE NEWEST ONE NOT YET DECIDED. `commit-room`
 * returns its decisions newest-touched first and calls the first one
 * `current`, decided or not. The canvas asks whether a decision is OPEN, so
 * the page takes the first row whose status is not `decided`; with none it
 * says "No investment decision is open." (DE07b). The meeting and minutes the
 * route returns follow its own `current`, so they are drawn on the card only
 * when that is the same decision.
 *
 * ELIGIBLE VOTERS COME FROM THE DECISION'S OWN ROSTER (D6143). When its
 * author has set none, the card says Not recorded where the canvas draws
 * "6 eligible", and Votes cast has no denominator. The meeting's attendee
 * list is an invitation, not an entitlement to vote: nothing here counts the
 * invitees as voters.
 *
 * RECUSAL IS NOT ABSTENTION (D461). An abstention is a vote cast and stays
 * in the tally; a recusal is a declared conflict, written as the vote's
 * rationale, and is counted beside the tally. The two differ in words
 * (`VOTE_WORDS`) and in shape — a recusal's mark is dashed with ⊘, its row is
 * muted — never in colour alone.
 *
 * A CONDITION'S OWNER (D6156, #6156) is `owner_label` or the owner user's
 * name. `commit-room` carries `owner_user_id` and `owner_label` but not the
 * name, so the page also reads `GET /api/ic/conditions`, which joins it (and
 * who recorded and resolved each condition), by condition uid. A condition
 * with neither says Not recorded; one whose owner is a user the second read
 * could not name says Unreadable.
 *
 * D6144 (#6144, Deals v2 addendum B, D6142): everything an investor does on a
 * decision happens here. Open a decision, Cast or change my vote, Recuse
 * yourself, Close the vote and Add condition are in-product dialogs (the shared
 * `Sheet`: focus trapped, returned to the opener), and a refused write stays
 * in its dialog in the Worker's own words. The vote dialogs live in
 * `commit/VoteDialogs.jsx`. `/deals/commit?decision=<uid>` forwards to the
 * decision record at `/deals/commit/<uid>` (D6154), where the admin's Record
 * position action stays.
 *
 * ON A PHONE (D6151 part 3, board DE27) the decision is drawn by
 * `CommitPhone.jsx` below 768px, from the same read, with a sticky Vote; the
 * strip, the decision card and the conditions table are the desktop view, from
 * 768px up. A refused read (403) is said as a refusal, not a failure (DE27 E).
 */

/**
 * The Rationales tile's note, from what the commit room reports. `enforced` is
 * the rule new votes meet; the count is what was written, so a shortfall under
 * an enforced rule is older votes, and the note says so.
 */
export function rationaleNote(rationale) {
  if (!rationale) return 'unreadable';
  if (rationale.enforced === true) {
    return rationale.recorded < rationale.total
      ? 'required for every new vote — the votes without one were cast before the rule'
      : 'required for every vote';
  }
  if (rationale.enforced === false) return 'the column is nullable — a reason is recorded, not required';
  return 'unreadable';
}

export const UNAVAILABLE = Symbol('unavailable');
/** A 403 from the committee read: this account may not use the committee (DE27 E). */
export const REFUSED = Symbol('refused');

/** The newest decision the committee has not decided, or null (DE07b). */
export function openDecisionOf(room) {
  const rows = room?.decisions?.available ? room.decisions.rows || [] : [];
  return rows.find((row) => row.status !== 'decided') ?? null;
}

/**
 * Who has voted on a decision, counted from its votes. A recusal is a vote
 * row but not a vote cast, so it is counted apart. `eligible` is null:
 * no voting roster is stored.
 */

/** What each stored vote value reads as. Recused and Abstain never share words. */
export const VOTE_WORDS = {
  yes: { label: 'Yes', note: 'Counted in the tally' },
  no: { label: 'No', note: 'Counted in the tally' },
  abstain: { label: 'Abstain', note: 'A vote cast · counted in the tally' },
  recused: { label: 'Recused', note: 'Conflict declared · not counted in the tally' },
};

/**
 * A condition's owner (D6156): the user's name, the named party, or both.
 * `more` is the condition's row from `GET /api/ic/conditions` (it carries
 * `owner_name`); `UNAVAILABLE` when that read failed.
 */
export function conditionOwner(cond, more) {
  const extra = more && more !== UNAVAILABLE ? more : null;
  const name = cond?.owner_name || extra?.owner_name || null;
  const label = cond?.owner_label || extra?.owner_label || null;
  if (name || label) return { text: name || label, sub: name && label && name !== label ? label : null };
  if (cond?.owner_user_id != null && more === UNAVAILABLE) return { unreadable: true };
  return { notRecorded: true };
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
});

/** A stored time as the page prints it, or null when there is none. UTC, as D1 writes it. */
export function stamp(value, { time = false } = {}) {
  const ms = parseStamp(value);
  if (ms == null) return null;
  return (time ? DATE_TIME : DATE).format(new Date(ms));
}

const day = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : null);

/** The strip tile, in the anatomy every artboard shares. */
function CommitTile({ label, value, note, tone = '', testid }) {
  return (
    <div className="rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900" data-testid={testid}>
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1.5 min-w-0">
        {value === null
          ? <NotRecorded />
          : <span className={`block truncate text-[14px] font-extrabold tracking-tight ${tone || 'text-axal-ink dark:text-gray-100'}`}>{value}</span>}
      </div>
      <div className="mt-1 text-[10.5px] leading-snug text-gray-600 dark:text-gray-400">{note}</div>
    </div>
  );
}

/**
 * A record table that is a grid of columns from 768px and a stack of labelled
 * cells below it, so no table is wider than a phone.
 */
function RecordTable({ head, cols, rows, testid, empty }) {
  return (
    <div role="table" className="text-[12.5px]" data-testid={testid}>
      <div role="row" className="hidden gap-3 border-b border-axal-hairline pb-2 dark:border-gray-700 md:grid md:[grid-template-columns:var(--cols)]" style={{ '--cols': cols }}>
        {head.map((h) => (
          <span key={h} role="columnheader" className="text-[10px] font-extrabold uppercase tracking-[.07em] text-gray-500 dark:text-gray-400">{h}</span>
        ))}
      </div>
      {rows.length === 0 && empty ? <p className="py-3 text-[12px] text-gray-600 dark:text-gray-400">{empty}</p> : null}
      {rows.map((row) => (
        <div
          key={row.key}
          role="row"
          data-testid={row.testid}
          className={`grid gap-1.5 border-b border-axal-hairline py-2.5 last:border-0 dark:border-gray-800 md:items-start md:gap-3 md:[grid-template-columns:var(--cols)] ${row.className || ''}`}
          style={{ '--cols': cols }}
        >
          {row.cells.map((cell, i) => (
            <div key={head[i]} role="cell" className="min-w-0">
              <span className="mr-2 text-[10px] font-extrabold uppercase tracking-[.07em] text-gray-500 dark:text-gray-400 md:hidden">{head[i]}</span>
              {cell}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * A stored vote, drawn so that recusal and abstention differ in words and in
 * shape. Yes, No and Abstain are solid marks; Recused is a dashed mark with ⊘.
 */
export function VoteMark({ vote }) {
  const words = VOTE_WORDS[vote];
  if (!words) return <NotRecorded>{String(vote || 'Not recorded')}</NotRecorded>;
  if (vote === 'recused') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-400 bg-transparent px-2 py-0.5 text-[11px] font-bold italic text-gray-600 dark:border-gray-500 dark:text-gray-300" data-testid="vote-recused">
        <span aria-hidden="true">⊘</span> {words.label}
      </span>
    );
  }
  const tone = vote === 'yes'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
    : vote === 'no'
    ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
    : 'border-gray-300 bg-gray-100 text-gray-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${tone}`} data-testid={`vote-${vote}`}>
      {words.label}
    </span>
  );
}

/** The method, out of the way of the record (DE07's "How this works", DE07b's "How voting works"). */
export function HowThisWorks({ label = 'How this works' }) {
  return (
    <details className="group rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900" data-testid="commit-how">
      <summary className="flex min-h-[44px] cursor-pointer items-center gap-1.5 text-[12px] font-semibold text-axal-violet-deep dark:text-violet-300">
        {label} <span aria-hidden="true" className="transition-transform group-open:rotate-180">▾</span>
      </summary>
      <StatedLimit title="What the committee records — and what it cannot">
        <p>
          <strong>A recusal is a declared conflict, recorded as one.</strong>{' '}
          A vote is yes, no, abstain or recused. An abstention is a vote cast:
          the voter was counted and declined, and stays in the tally. A recusal
          leaves the tally, and the vote is refused without the declaration
          written as its rationale. The page never draws one as the other.
        </p>
        <p className="mt-2">
          <strong>Every vote carries its reason.</strong> A vote is refused
          without a rationale; votes cast before that rule may have none, and
          they read Not recorded rather than blank. Changing your vote replaces
          the earlier one; a recusal is final.
        </p>
        <p className="mt-2">
          <strong>A decision opens on its first vote and closes when an outcome is
          recorded</strong> — invest, pass or defer — by the partner who opened it
          or an admin. It is not re-opened from this page.
        </p>
        <p className="mt-2">
          <strong>A condition is a stored record</strong> on the decision: open,
          met or waived, with who set it, who owns it and who resolved it. An
          open condition blocks Closing, and Closing reads it from here. Met and
          waived conditions stay on the record.
        </p>
        <p className="mt-2">
          <strong>Minutes live on the meeting</strong> linked to the decision’s
          deal, written by its organiser or an admin after the room. Export
          minutes writes what was recorded, and is disabled when nothing has been.
        </p>
        <p className="mt-2">
          <strong>Who may vote is the decision’s own roster,</strong> set by the
          person who opened it or an Admin; with none set, eligible voters read
          Not recorded. No quorum is stored, so no tally is called met or unmet.
          The meeting’s attendees are an invitation, not an entitlement to vote.
        </p>
      </StatedLimit>
    </details>
  );
}

/** DE07b, and the store that holds no decision at all. */
export function NoOpenDecision({ decided = 0, onShowAll, onOpen }) {
  return (
    <section className="rounded-[10px] border border-axal-hairline bg-white p-6 dark:border-gray-800 dark:bg-gray-900 md:p-9" data-testid="commit-no-open">
      <h2 className="text-[20px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">No investment decision is open.</h2>
      <p className="mt-2 text-[13px] text-gray-600 dark:text-gray-400">Decisions appear here when a deal reaches IC.</p>
      {onOpen ? <OpenDecisionButton onOpen={onOpen} className="mt-3" /> : null}
      {decided > 0 && onShowAll ? (
        <p className="mt-2 text-[12.5px] text-gray-600 dark:text-gray-400">
          {decided === 1 ? '1 decided decision is' : `${decided} decided decisions are`} under{' '}
          <button type="button" onClick={onShowAll} className="font-semibold text-axal-violet-deep underline underline-offset-2 dark:text-violet-300" data-testid="commit-show-all">
            All decisions
          </button>.
        </p>
      ) : null}
      <div className="mt-3"><HowThisWorks label="How voting works" /></div>
    </section>
  );
}

/** A figure whose read failed: Unavailable, never Not recorded and never 0 (D5129). */
function Unavailable() {
  return <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">Unavailable</span>;
}

/** + Open a decision (DE19): opens the shared dialog over the page. */
export function OpenDecisionButton({ onOpen, className = '' }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="button-open-decision"
      className={`min-h-[44px] rounded-[7px] border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-bold text-gray-800 hover:border-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 ${className}`}
    >
      + Open a decision
    </button>
  );
}

/** The decision card: eligible, voted and recused, then one row per vote. */
export function DecisionCard({ decision }) {
  const ballot = ballotOf(decision);
  const roster = rosterLine(decision);
  const votes = decision.votes ?? [];
  return (
    <section className="rounded-[10px] border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="commit-decision">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>Decision</Eyebrow>
          <h2 className="mt-1 text-[18px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">
            <Link to={`/deals/commit/${encodeURIComponent(decision.uid)}`} className="hover:underline">{decision.title || decision.uid}</Link>
          </h2>
          <p className="mt-0.5 text-[11.5px] text-gray-600 dark:text-gray-400">
            Invest, pass or defer · {decision.status === 'draft' ? 'no vote cast yet' : 'voting'}
            {decision.project_name ? ` · ${decision.project_name}` : ''}
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-gray-600 dark:text-gray-400" data-testid="commit-ballot">
          <div className="flex items-center gap-1.5"><dt>Eligible voters</dt><dd className="font-bold text-axal-ink dark:text-gray-100">{roster.unreadable ? <Unavailable /> : roster.eligible === null ? <NotRecorded /> : roster.eligible}</dd></div>
          {roster.eligible !== null && !roster.unreadable ? (
            <div className="flex items-center gap-1.5"><dt>To vote</dt><dd className="font-bold text-axal-ink dark:text-gray-100">{roster.toVote === null ? <NotRecorded /> : roster.toVote}</dd></div>
          ) : null}
          <div className="flex items-center gap-1.5"><dt>Voted</dt><dd className="font-bold text-axal-ink dark:text-gray-100">{ballot.voted}</dd></div>
          <div className="flex items-center gap-1.5"><dt>Recused</dt><dd className="font-bold text-axal-ink dark:text-gray-100"><span aria-hidden="true">⊘ </span>{ballot.recused} <span className="font-normal">· beside the tally</span></dd></div>
        </dl>
      </div>
      <RecordTable
        testid="commit-votes"
        head={['Partner', 'Vote', 'Rationale', 'Recorded']}
        cols="1fr .8fr 2.2fr .9fr"
        empty="Nobody has voted on this decision yet."
        rows={votes.map((v) => ({
          key: `${v.user_id}-${v.created_at}`,
          testid: `commit-vote-${v.vote}`,
          className: v.vote === 'recused' ? 'bg-gray-50 dark:bg-gray-800/40' : '',
          cells: [
            v.user_name ? <span className="font-semibold text-axal-ink dark:text-gray-100">{v.user_name}</span> : <NotRecorded />,
            <VoteMark vote={v.vote} />,
            <span className="block">
              {v.rationale ? <span className="text-gray-700 dark:text-gray-300">{v.rationale}</span> : <NotRecorded />}
              {VOTE_WORDS[v.vote] && v.vote !== 'yes' && v.vote !== 'no'
                ? <span className="mt-0.5 block text-[10.5px] text-gray-500 dark:text-gray-400">{VOTE_WORDS[v.vote].note}</span>
                : null}
            </span>,
            stamp(v.created_at, { time: true }) ? <span className="font-mono text-[11.5px] text-gray-700 dark:text-gray-300">{stamp(v.created_at, { time: true })}</span> : <NotRecorded />,
          ],
        }))}
      />
    </section>
  );
}

const CONDITION_WORDS = { open: 'Open', met: 'Met', waived: 'Waived' };

/**
 * Conditions: Condition, Status, Owner, Decision, Recorded. Open blocks Closing.
 * `across` is the Conditions view's list over every decision this account may see: an open condition there blocks its
 * own deal's Closing, not the one on the card, so the chip says whose (review on #6876).
 */
export function ConditionsCard({ conditions, more = {}, control, error, across = false }) {
  const open = conditions.filter((cond) => cond.status === 'open').length;
  return (
    <section className="rounded-[10px] border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="commit-conditions">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Conditions</h2>
        {open > 0 ? (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300" data-testid="commit-conditions-blocking">
            {across ? `${open} open across your decisions · each blocks its own deal’s Closing` : `${open} open · blocking Closing`}
          </span>
        ) : (
          <span className="text-[11px] text-gray-600 dark:text-gray-400">{across ? 'None open across your decisions' : 'None open · nothing here blocks Closing'}</span>
        )}
      </div>
      {error ? <p className="mb-2 text-[11px] text-red-700 dark:text-red-400" role="alert" data-testid="status-condition-error">{error}</p> : null}
      <RecordTable
        testid="commit-conditions-table"
        head={['Condition', 'Status', 'Owner', 'Decision', 'Recorded']}
        cols="2fr 1fr 1fr 1.2fr .9fr"
        empty="No condition is recorded on a decision you can see."
        rows={conditions.map((cond) => {
          const extra = more === UNAVAILABLE ? UNAVAILABLE : more[cond.uid];
          const owner = conditionOwner(cond, extra);
          const row = extra && extra !== UNAVAILABLE ? extra : {};
          const by = row.created_by_name;
          const resolvedBy = row.resolved_by_name;
          return {
            key: cond.uid,
            testid: `commit-condition-${cond.status}`,
            cells: [
              <span className="text-gray-800 dark:text-gray-200">{cond.body}</span>,
              <span className="block">
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${cond.status === 'open'
                  ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                  : 'border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
                  {CONDITION_WORDS[cond.status] || cond.status}
                </span>
                {cond.status === 'open'
                  ? <span className="mt-0.5 block text-[10.5px] font-semibold text-amber-800 dark:text-amber-300">Blocks Closing</span>
                  : cond.resolved_at
                  ? <span className="mt-0.5 block text-[10.5px] text-gray-500 dark:text-gray-400">{stamp(cond.resolved_at)}{resolvedBy ? ` by ${resolvedBy}` : ''}</span>
                  : null}
                {control ? control(cond) : null}
              </span>,
              owner.text
                ? <span className="block text-gray-800 dark:text-gray-200">{owner.text}{owner.sub ? <span className="block text-[10.5px] text-gray-500 dark:text-gray-400">{owner.sub}</span> : null}</span>
                : owner.unreadable
                ? <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">Unreadable</span>
                : <NotRecorded />,
              <span className="text-gray-700 dark:text-gray-300">{cond.decision_title || cond.decision_uid}</span>,
              <span className="block">
                {stamp(cond.created_at) ? <span className="font-mono text-[11.5px] text-gray-700 dark:text-gray-300">{stamp(cond.created_at)}</span> : <NotRecorded />}
                {by ? <span className="block text-[10.5px] text-gray-500 dark:text-gray-400">by {by}</span> : null}
              </span>,
            ],
          };
        })}
      />
    </section>
  );
}

/**
 * Minutes, or the sentence that says none are recorded. `forDecision` is
 * false when the meeting the route read belongs to another decision than the
 * one on the card.
 */
export function MinutesCard({ minutes, forDecision = true, decisionLabel = '', children }) {
  let body;
  if (!forDecision) {
    body = (
      <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400" data-testid="commit-no-minutes">
        <NotRecorded /> <span className="mt-1 block">The committee read carries the meeting of the most recently changed decision, not this one.</span>
      </p>
    );
  } else if (!minutes?.available) {
    body = (
      <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400" data-testid="commit-no-minutes">
        <NotRecorded /> <span className="mt-1 block">{minutes?.reason || 'No IC meeting is linked to this decision’s deal, so there are no minutes to read.'}</span>
      </p>
    );
  } else if (!minutes.recorded) {
    body = (
      <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400" data-testid="commit-no-minutes">
        <NotRecorded /> <span className="mt-1 block">Minutes for {minutes.meeting_title || 'the linked meeting'} haven’t been recorded yet.</span>
      </p>
    );
  } else {
    body = (
      <>
        <Eyebrow>{minutes.meeting_title || 'The linked meeting'}</Eyebrow>
        <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300">{minutes.minutes}</p>
        <p className="mt-2 text-[10.5px] text-gray-500 dark:text-gray-400">
          Recorded {stamp(minutes.recorded_at, { time: true }) || 'at an unrecorded time'}{minutes.recorded_by ? ` by ${minutes.recorded_by}` : ''}.
        </p>
      </>
    );
  }
  return (
    <section className="rounded-[10px] border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="commit-minutes">
      <h2 className="mb-2 text-[14px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Minutes</h2>
      {/* The committee read's minutes follow its most recently changed decision, which need not be the one on the card:
          say which decision this meeting belongs to (review on #6876). */}
      {forDecision && decisionLabel ? (
        <p className="mb-2 text-[11px] text-gray-600 dark:text-gray-400" data-testid="commit-minutes-decision">For the decision {decisionLabel}</p>
      ) : null}
      {body}
      {forDecision ? children : null}
    </section>
  );
}

/** The five tiles over the decision on the card (DE07). */
export function CommitStrip({ room, decision }) {
  const ballot = ballotOf(decision);
  // The tile sits under "Current decision": only this decision's conditions block its Closing (review on #6876).
  const conditions = room.conditions?.available ? room.conditions.rows.filter((cond) => cond.decision_uid === decision.uid) : [];
  const open = conditions.filter((cond) => cond.status === 'open').length;
  const sameMeeting = room.current?.uid === decision.uid;
  const meeting = sameMeeting && room.room?.available ? room.room : null;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="commit-strip">
      <CommitTile
        testid="commit-tile-decision"
        label="Current decision"
        value={decision.title || decision.uid}
        note={decision.status === 'draft' ? 'opened · no vote cast yet' : 'voting'}
      />
      <CommitTile
        testid="commit-tile-votes"
        label="Votes cast"
        value={String(ballot.voted)}
        note={`${ballot.recused} recused, beside the tally · ${rosterLine(decision).eligible != null ? `${rosterLine(decision).eligible} eligible` : 'eligible voters not recorded'}`}
      />
      <CommitTile
        testid="commit-tile-conditions"
        label="Open conditions"
        value={room.conditions?.available ? String(open) : null}
        note={room.conditions?.available ? (open ? 'blocking Closing' : 'nothing blocks Closing') : 'unreadable'}
        tone={open ? 'text-amber-700 dark:text-amber-300' : ''}
      />
      <CommitTile
        testid="commit-tile-rationales"
        label="Rationales"
        value={`${ballot.rationales} of ${ballot.voted}`}
        note={ballot.voted
          ? rationaleNote({ recorded: ballot.rationales, total: ballot.voted, enforced: room.rationale?.enforced })
          : 'nobody has voted yet'}
        tone={ballot.rationales < ballot.voted ? 'text-amber-700 dark:text-amber-300' : ''}
      />
      <CommitTile
        testid="commit-tile-meeting"
        label="Meeting"
        value={meeting ? (stamp(meeting.starts_at) || meeting.meeting_title || null) : null}
        note={meeting
          ? `${meeting.meeting_title ? `${meeting.meeting_title} · ` : ''}${meeting.invited} invited, not entitled to vote`
          : sameMeeting
          ? 'no IC meeting is linked to this decision’s deal'
          : 'the meeting read follows another decision'}
      />
    </div>
  );
}

/**
 * The route to the money, which this page deliberately does not restate.
 *
 * The panel ID3 replaced showed `Total committed to deal` and `Target` off the
 * deal row. Those are the DEAL's figures, not the committee's, and the deal
 * room already draws both against each other with a percentage
 * (`DealRoomPage.jsx`). Reprinting them under a vote ledger would be a second
 * copy of a number that can drift from the first, so the row links to the one
 * place that owns it instead.
 */
function OpenDeal({ id, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(`/deals/${id}`)}
      className="text-[10.5px] font-semibold text-axal-violet-deep underline underline-offset-2 hover:text-axal-violet dark:text-violet-300"
    >
      Open deal room
    </button>
  );
}

/**
 * D1424 (#3700, PH3): "Show Axal you can fund this ›" on a decision row that
 * names its deal. It is a link to the deal room's Commitment tab, where the
 * Mercury proof door (D752, `ProofDoor`) and its sheet already live: nothing
 * is shared from here. A row with no `deal_id` draws no link, and a row the
 * committee passed on draws none either.
 */
export function ShowProofLink({ dealId }) {
  if (!dealId) return null;
  return (
    <Link
      to={`/deals/${dealId}/commitment`}
      className="text-[10.5px] font-semibold text-indigo-700 underline underline-offset-2 hover:text-indigo-600 dark:text-indigo-300"
      data-testid="commit-show-proof"
    >
      {SHARE_BUTTON} ›
    </Link>
  );
}

/** `GET /api/ic/conditions`' rows by uid: the owner's name and who recorded and resolved each. */
function byUid(items) {
  const out = {};
  for (const row of (items || [])) if (row?.uid) out[row.uid] = row;
  return out;
}

export default function InvestorCommitZone() {
  const navigate = useNavigate();
  const { user } = useAuth() || {};
  const [room, setRoom] = useState(null);
  const [more, setMore] = useState({});
  const location = useLocation();
  const [view, setView] = useState(() => new URLSearchParams(location.search).get('view') === 'decisions' ? 'decisions' : 'current');
  useEffect(() => { if(new URLSearchParams(location.search).get('view') === 'decisions') setView('decisions'); }, [location.search]);
  const [closing, setClosing] = useState(null);
  const [closeChoice, setCloseChoice] = useState(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState('');
  const [opening, setOpening] = useState(false);
  const [condForm, setCondForm] = useState(null);
  const [condActionError, setCondActionError] = useState('');
  const [minutesForm, setMinutesForm] = useState(null);

  const load = useCallback(() => {
    setRoom(null);
    api.icCommitRoom().then(setRoom, (cause) => setRoom(cause?.status === 403 ? REFUSED : UNAVAILABLE));
    api.icConditions().then((r) => setMore(byUid(r?.items)), () => setMore(UNAVAILABLE));
  }, []);
  useEffect(() => { load(); }, [load]);

  const ready = room && room !== UNAVAILABLE && room !== REFUSED;
  const decisions = ready ? room.decisions : null;
  /** The decision on the card: the newest one not yet decided (DE07), or none (DE07b). */
  const current = useMemo(() => (ready ? openDecisionOf(room) : null), [ready, room]);

  /**
   * How the tally reads, restated in the close-vote dialog. `abstain` is
   * counted and stays in the denominator; `recused` is counted beside it. A
   * count the read did not carry is Not recorded, never 0 (`tallyWords`).
   */
  const tallyText = current ? tallyWords(current.tally) : null;

  const decisionRows = useMemo(() => (decisions?.available ? decisions.rows : []), [decisions]);
  const decided = decisionRows.filter((row) => row.status === 'decided').length;

  /**
   * CLOSE VOTE. `PUT /api/ic/:uid` with a `decision` of invest | pass | defer
   * forces `decided` and stamps `decided_at`. The route admits the decision's
   * author and an admin and refuses a colleague with a 403, so a partner who
   * cannot close this one reads the reason on hover. Only an open decision
   * offers it: re-opening a closed vote is a governance act, not a button.
   */
  const mine = current != null && user?.id != null
    && (Number(current.created_by) === Number(user.id) || user.role === 'admin');
  const closeVote = useMemo(() => {
    if (!current) {
      return { onClick: () => {}, disabled: true, title: 'No decision is open, so there is nothing to close.' };
    }
    if (current.status === 'decided') {
      return {
        onClick: () => {},
        disabled: true,
        title: `This decision was already closed as “${current.decision || 'decided'}”. Re-opening one is not a control on this page.`,
      };
    }
    if (!mine) {
      return {
        onClick: () => {},
        disabled: true,
        title: 'Only the partner who opened this decision, or an admin, may record its outcome.',
      };
    }
    return { onClick: () => { setCloseError(''); setCloseChoice(null); setClosing(current.uid); }, busy: closing === current.uid };
  }, [current, mine, closing]);

  async function recordDecision(decision) {
    if (!closing || !decision || closeBusy) return;
    setCloseError('');
    setCloseBusy(true);
    try {
      await api.icUpdate(closing, { decision });
      setClosing(null);
      load();
    } catch (cause) {
      // A refusal stays in the dialog, in the Worker's own words.
      setCloseError(refusalWords(cause, 'The decision could not be recorded.'));
    } finally {
      setCloseBusy(false);
    }
  }

  /**
   * CONDITIONS (migration 334). Every condition on the record; an open one
   * blocks Closing. Anyone who may see the decision may propose one;
   * resolving sits with the decision's author or an admin.
   */
  const conditions = useMemo(() => (ready && room.conditions?.available ? room.conditions.rows : []), [ready, room]);
  const openConditions = useMemo(() => conditions.filter((cond) => cond.status === 'open'), [conditions]);
  const mayResolve = (cond) => {
    const dec = decisionRows.find((row) => row.uid === cond.decision_uid);
    return Boolean(dec) && (Number(dec.created_by) === Number(user?.id) || user?.role === 'admin');
  };

  async function submitCondition() {
    if (!current || !condForm) return;
    const body = String(condForm.body || '').trim();
    if (!body) {
      setCondForm({ ...condForm, error: 'Write the condition — the sentence a later stage checks.' });
      return;
    }
    setCondForm({ ...condForm, busy: true, error: '' });
    try {
      await api.icAddCondition(current.uid, { body });
      setCondForm(null);
      load();
    } catch (cause) {
      setCondForm({ ...condForm, busy: false, error: refusalWords(cause, 'The condition could not be recorded.') });
    }
  }

  async function resolveCondition(cond, status) {
    setCondActionError('');
    try {
      await api.icResolveCondition(cond.uid, status);
      load();
    } catch (cause) {
      setCondActionError(cause?.message || 'The condition could not be updated.');
    }
  }

  const resolveControl = (cond) => (cond.status === 'open' && mayResolve(cond) ? (
    <span className="mt-1 flex flex-wrap gap-x-3">
      <button
        type="button"
        onClick={() => resolveCondition(cond, 'met')}
        data-testid={`button-condition-met-${cond.uid}`}
        className="min-h-[44px] md:min-h-[32px] text-[10.5px] font-semibold text-emerald-700 underline underline-offset-2 hover:text-emerald-800 dark:text-emerald-400"
      >
        Mark met
      </button>
      <button
        type="button"
        onClick={() => resolveCondition(cond, 'waived')}
        data-testid={`button-condition-waived-${cond.uid}`}
        className="min-h-[44px] md:min-h-[32px] text-[10.5px] font-semibold text-gray-600 underline underline-offset-2 hover:text-gray-800 dark:text-gray-400"
      >
        Waive
      </button>
    </span>
  ) : null);

  const addCondition = !current
    ? { onClick: () => {}, disabled: true, title: 'No decision is open, so there is nothing to attach a condition to.' }
    : { onClick: () => { setCondActionError(''); setCondForm({ body: '', busy: false, error: '' }); } };

  /**
   * MINUTES (migration 334). The meeting linked to the route's current
   * decision's deal carries them; the organiser or an admin writes them. The
   * export is disabled with the reason when there are none.
   */
  const minutesBlock = ready ? room.minutes : null;
  const sameMeeting = Boolean(current) && room?.current?.uid === current.uid;
  // Whose meeting the minutes are: the committee read's `current`, the most recently changed decision.
  const minutesDecision = ready ? (room.current?.title || room.current?.uid || '') : '';
  const exportMinutes = useMemo(() => {
    if (view === 'current' && current && !sameMeeting) {
      return { onClick: () => {}, disabled: true, title: 'The minutes the committee read carries belong to another decision than the one on the card.' };
    }
    if (!minutesBlock?.available) {
      return { onClick: () => {}, disabled: true, title: minutesBlock?.reason || 'No IC meeting is linked to this decision’s deal.' };
    }
    if (!minutesBlock.recorded) {
      return { onClick: () => {}, disabled: true, title: 'No minutes are recorded for the linked meeting yet.' };
    }
    return {
      onClick: () => exportView({
        scope: 'deals',
        zone: 'commit-minutes',
        header: ['Decision', 'Meeting', 'Recorded', 'Recorded by', 'Minutes'],
        rows: [minutesBlock],
        cells: (m) => [minutesDecision, m.meeting_title || '', day(m.recorded_at) || '', m.recorded_by || '', m.minutes || ''],
      }),
    };
  }, [minutesBlock, minutesDecision, view, current, sameMeeting]);

  async function submitMinutes() {
    if (!minutesBlock?.meeting_uid || !minutesForm) return;
    setMinutesForm({ ...minutesForm, busy: true, error: '' });
    try {
      await api.icRecordMinutes(minutesBlock.meeting_uid, minutesForm.text);
      setMinutesForm(null);
      load();
    } catch (cause) {
      setMinutesForm({ ...minutesForm, busy: false, error: cause?.message || 'The minutes could not be recorded.' });
    }
  }

  const minutesControl = minutesBlock?.available && minutesBlock.may_record && (
    minutesForm ? (
      <div className="mt-3">
        <textarea
          rows={5}
          value={minutesForm.text}
          onChange={(e) => setMinutesForm({ ...minutesForm, text: e.target.value })}
          aria-label="Minutes"
          data-testid="input-minutes"
          className="w-full rounded-[8px] border border-gray-200 bg-white p-2.5 text-[12px] leading-relaxed text-axal-ink focus-visible:outline focus-visible:outline-2 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          placeholder="What the room concluded — decisions, conditions, and who declared what."
        />
        {minutesForm.error && (
          <p className="mt-2 text-[11px] text-red-700 dark:text-red-400" role="alert" data-testid="status-minutes-error">{minutesForm.error}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={submitMinutes}
            disabled={minutesForm.busy}
            data-testid="button-save-minutes"
            className="min-h-[44px] md:min-h-[36px] rounded-[7px] border border-gray-300 bg-white px-[11px] py-1.5 text-[11px] font-bold text-gray-800 hover:border-gray-400 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          >
            {minutesForm.busy ? 'Recording…' : 'Record minutes'}
          </button>
          <button
            type="button"
            onClick={() => setMinutesForm(null)}
            className="min-h-[44px] md:min-h-[36px] rounded-[7px] px-[11px] py-1.5 text-[11px] font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-400"
          >
            Cancel
          </button>
        </div>
      </div>
    ) : (
      <button
        type="button"
        onClick={() => setMinutesForm({ text: minutesBlock.minutes || '', busy: false, error: '' })}
        data-testid="button-write-minutes"
        className="mt-3 min-h-[44px] md:min-h-[36px] rounded-[7px] border border-gray-300 bg-white px-[11px] py-1.5 text-[11px] font-bold text-gray-800 hover:border-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
      >
        {minutesBlock.recorded ? 'Revise the minutes' : 'Record the minutes'}
      </button>
    )
  );

  const rowActions = investorZoneActions('deals/commit', {
    handlers: { closeVote, addCondition, exportMinutes },
    view: {
      header: ['Decision', 'Stage', 'Votes', 'Rationales', 'Outcome'],
      rows: decisionRows,
      // Rationales count as the card counts them (ballotOf): a recusal is not a vote cast nor its declaration a rationale.
      cells: (r) => [
        r.title || r.uid,
        r.status || '',
        `${r.tally?.yes || 0}/${r.tally?.no || 0}/${r.tally?.abstain || 0}`,
        `${ballotOf(r).rationales} of ${ballotOf(r).voted}`,
        r.decision || '',
      ],
    },
  });

  // `?decision=<uid>` (#6144's address) is the decision record's: D6154 put one decision at `/deals/commit/<uid>`.
  const decisionParam = new URLSearchParams(location.search).get('decision');
  if (decisionParam) return <Navigate to={`/deals/commit/${encodeURIComponent(decisionParam)}`} replace />;

  return (
    <>
      <ZoneToolbar
        className="mb-3"
        role="investor"
        filters={investorZoneFilters('deals/commit', {
          value: view,
          onChange: setView,
          // The open count, not the total: a met or waived condition no longer
          // blocks anything, and a chip counting it would overstate the gate.
          counts: { conditions: openConditions.length },
        })}
        actions={rowActions}
      />
      {/* CLOSE THE VOTE (DE22). THREE CHOICES, NOT A FREE FIELD, because the
          store admits exactly three outcomes — `invest`, `pass`, `defer` — and
          the route silently coerces anything else to null, which would close
          nothing and look like a save. The tally is restated so the outcome is
          recorded beside the votes it is meant to reflect, and nothing is
          written until Close vote confirms the choice. */}
      {closing && (
        <Sheet
          title="Close the vote"
          eyebrow={current?.title || closing}
          width={520}
          testId="panel-close-vote"
          onClose={() => { if (!closeBusy) { setClosing(null); setCloseError(''); } }}
        >
          <div className="space-y-4 p-4">
            <div>
              <Eyebrow>Tally</Eyebrow>
              <p className="mt-1 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100" data-testid="close-vote-tally">{tallyText}</p>
              <p className="mt-0.5 text-[11px] text-gray-600 dark:text-gray-400">Recused is a declared conflict, beside the tally and never in it.</p>
            </div>
            <fieldset>
              <legend className="text-[12px] font-bold text-gray-900 dark:text-gray-100">Decision <span className="font-normal text-gray-500">· required</span></legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {['invest', 'pass', 'defer'].map((decision) => (
                  <button
                    key={decision}
                    type="button"
                    aria-pressed={closeChoice === decision}
                    data-testid={`button-close-vote-${decision}`}
                    onClick={() => setCloseChoice(decision)}
                    className={`min-h-[44px] rounded-[7px] border px-3 py-1.5 text-[12px] font-bold ${closeChoice === decision
                      ? 'border-axal-violet-deep bg-violet-50 text-violet-900 dark:border-violet-400 dark:bg-violet-950 dark:text-violet-200'
                      : 'border-gray-300 bg-white text-gray-800 hover:border-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'}`}
                  >
                    {decision === 'invest' ? 'Invest' : decision === 'pass' ? 'Pass' : 'Defer'}
                  </button>
                ))}
              </div>
            </fieldset>
            {current && openConditions.some((cond) => cond.decision_uid === current.uid) ? (
              <p className="rounded-[8px] border border-amber-300 bg-amber-50 p-2.5 text-[11.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="close-vote-open-conditions">
                {(() => { const n = openConditions.filter((cond) => cond.decision_uid === current.uid).length; return n === 1 ? '1 open condition stays' : `${n} open conditions stay`; })()} open after closing, and no transfer is recorded on the deal until each is met or waived.
              </p>
            ) : null}
            <p className="text-[11.5px] text-gray-600 dark:text-gray-400">This closes the vote and records the time. It is not reversible from this page.</p>
            {closeError && (
              <div className="rounded-[8px] border border-red-200 bg-red-50 p-2.5 text-[12px] text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert" data-testid="status-close-vote-error">
                <strong>Not saved.</strong> {closeError}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="button-close-vote-confirm"
                disabled={!closeChoice || closeBusy}
                onClick={() => recordDecision(closeChoice)}
                className="min-h-[44px] rounded-[7px] bg-axal-violet-deep px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50 dark:bg-violet-600"
              >
                {closeBusy ? 'Closing…' : 'Close vote'}
              </button>
              <button
                type="button"
                data-testid="button-close-vote-cancel"
                disabled={closeBusy}
                onClick={() => { setClosing(null); setCloseError(''); }}
                className="min-h-[44px] rounded-[7px] border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-bold text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </Sheet>
      )}
      {/* ADD CONDITION (DE23) — one sentence a later stage can check, attached
          to the decision on the card. Open on arrival; Closing blocks on it. */}
      {condForm && current && (
        <Sheet
          title="Add condition"
          eyebrow={current.title || current.uid}
          width={480}
          testId="panel-add-condition"
          onClose={() => { if (!condForm.busy) setCondForm(null); }}
        >
          <div className="space-y-3 p-4">
            <label className="block text-[12px] font-bold text-gray-900 dark:text-gray-100">
              Condition <span className="font-normal text-gray-500">· required</span>
              <textarea
                rows={3}
                value={condForm.body}
                onChange={(e) => setCondForm({ ...condForm, body: e.target.value })}
                aria-label="Condition"
                data-testid="input-condition"
                className="mt-1 w-full rounded-[8px] border border-gray-300 bg-white p-2.5 text-[12.5px] leading-relaxed text-axal-ink focus-visible:outline focus-visible:outline-2 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                placeholder="The sentence a later stage checks — e.g. the evidence a transfer waits on."
                maxLength={2000}
              />
            </label>
            <p className="text-[11.5px] text-gray-600 dark:text-gray-400">
              It opens as <strong>open</strong> and blocks Closing until it is met or waived. The decision’s author or an admin marks it met or waived.
            </p>
            {condForm.error && (
              <div className="rounded-[8px] border border-red-200 bg-red-50 p-2.5 text-[12px] text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert" data-testid="status-condition-form-error">
                <strong>Not saved.</strong> {condForm.error}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="button-submit-condition"
                onClick={submitCondition}
                disabled={condForm.busy}
                className="min-h-[44px] rounded-[7px] bg-axal-violet-deep px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50 dark:bg-violet-600"
              >
                {condForm.busy ? 'Recording…' : 'Add condition'}
              </button>
              <button
                type="button"
                data-testid="button-cancel-condition"
                disabled={condForm.busy}
                onClick={() => setCondForm(null)}
                className="min-h-[44px] rounded-[7px] border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-bold text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </Sheet>
      )}
      {/* OPEN A DECISION (DE19/DE20), the same dialog All decisions uses. From
          the current view the page stays here: the new Draft is the newest
          decision not yet decided, so it is the one the card shows. */}
      {opening && (
        <OpenDecisionSheet onClose={() => setOpening(false)} onOpened={() => { setOpening(false); setView('current'); load(); }} />
      )}
      {room === REFUSED ? <CommitRefused /> : (
      <ZoneBody
        loading={room === null}
        error={room === UNAVAILABLE ? 'The committee record could not be read.' : ''}
        onRetry={load}
        isEmpty={Boolean(ready) && decisions?.available && decisions.total === 0}
        empty={<NoOpenDecision onOpen={() => setOpening(true)} />}
      >
        <div className="space-y-4">
          {current && view !== 'decisions' ? (
            // The strip is the desktop view on the Current view; the phone draws the tally instead (DE27).
            <div className={view === 'current' ? 'hidden md:block' : ''} data-testid="commit-strip-wrap">
              <CommitStrip room={room} decision={current} />
            </div>
          ) : null}

          {/* ══ DE07: the decision, its conditions and its minutes ══ */}
          {view === 'current' && (
            current ? (
              <>
                <div className="flex justify-end"><OpenDecisionButton onOpen={() => setOpening(true)} /></div>
                {/* ══ DE27: the same decision on a phone, below 768px ══ */}
                <CommitPhone
                  decision={current}
                  user={user}
                  conditions={conditions.filter((cond) => cond.decision_uid === current.uid)}
                  control={resolveControl}
                  conditionError={condActionError}
                  // Closing admits admins and investors (App.jsx); a partner enters Commit only (D6154).
                  closingTo={user?.role === 'partner' ? null : current.deal_id ? `/deals/closing?deal=${encodeURIComponent(current.deal_id)}` : '/deals/closing'}
                  minutes={<MinutesCard minutes={minutesBlock} forDecision={sameMeeting} decisionLabel={minutesDecision}>{minutesControl}</MinutesCard>}
                  onVoted={load}
                />
                <div className="hidden space-y-4 md:block" data-testid="commit-desktop">
                  <DecisionCard decision={current} />
                  <YourVote decision={current} user={user} onSaved={load} renderMark={(vote) => <VoteMark vote={vote} />} />
                  <div className="grid gap-4 lg:grid-cols-12">
                    <div className="min-w-0 lg:col-span-8">
                      <ConditionsCard conditions={conditions.filter((cond) => cond.decision_uid === current.uid)} more={more} control={resolveControl} error={condActionError} />
                    </div>
                    <div className="min-w-0 lg:col-span-4">
                      <MinutesCard minutes={minutesBlock} forDecision={sameMeeting} decisionLabel={minutesDecision}>{minutesControl}</MinutesCard>
                    </div>
                  </div>
                </div>
                <HowThisWorks />
              </>
            ) : (
              <NoOpenDecision decided={decided} onShowAll={() => setView('decisions')} onOpen={() => setOpening(true)} />
            )
          )}

          {view === 'conditions' && (
            <ConditionsCard conditions={conditions} more={more} control={resolveControl} error={condActionError} across />
          )}

          {view === 'minutes' && (
            <MinutesCard minutes={minutesBlock} decisionLabel={minutesDecision}>{minutesControl}</MinutesCard>
          )}

          {/* ══ EVERY DECISION ══ */}
          {view === 'decisions' && (
            <ICDecisionsList
              items={decisionRows}
              onReload={load}
              // D1424: a row that names its deal links its deal room and, unless
              // the committee passed, the Commitment tab's proof door. Partners
              // enter Commit only (D6154), so they get no link into a deal room.
              dealLinks={(r) => (user?.role === 'partner' ? null : r.deal_id ? (
                <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                  <OpenDeal id={r.deal_id} onOpen={navigate} />
                  {r.decision !== 'pass' ? <ShowProofLink dealId={r.deal_id} /> : null}
                </span>
              ) : null)}
            />
          )}

          <ZoneDraft
            surface="deals/commit"
            railOption="draft:ic-memo"
            label="Proposal · IC memo from the pipeline"
            accept="Open the memo"
            run="Draft the memo"
            foot="Every figure traced to the row it came from."
            empty="A memo assembled from the screening score, the votes and their rationales — stating where the record is silent instead of filling the gap."
            nothingToDraft="No decision is open, so there is nothing to write a memo against."
          />
        </div>
        {/* D840 (#2349): capacity from the investor's own Mercury, on this page only. */}
        <FromMercury section="commit" />
      </ZoneBody>
      )}
    </>
  );
}
