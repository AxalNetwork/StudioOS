import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { investorZoneActions } from '../../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../../workspaces/investorZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { Eyebrow, Instrument, NotRecorded } from '../../../workspaces/canvasKit';
import { ZoneBody, NothingYet, StatedLimit } from '../../advisor/expertise/kit';

/**
 * Deals · Commit — canvas **ID3**, `/deals/commit`. LEDGER.
 *
 * WHAT WAS HERE: three fields off the deal row — status, total committed,
 * target — under a heading that said "Commit room". Accurate about the deal
 * and silent about the committee, because the IC record was never read. The
 * artboard's Commit room is a VOTE LEDGER; a deal's funding columns are a
 * different object entirely.
 *
 * THE OPS ROW CARRIED A FALSE REASON, one zone after ID2 found two of them.
 * `Close vote` was marked unbuilt because "no vote is opened here, so none can
 * be closed". Both halves are served today:
 *
 *   opening — `POST /api/ic/:uid/vote` moves a decision `draft` → `voting` on
 *   the first vote cast.
 *   closing — `PUT /api/ic/:uid` with a `decision` forces `decided` and stamps
 *   `decided_at`.
 *
 * What is missing is a SCREEN, and the corrected row says exactly that, in the
 * same shape the LP row three entries down already used.
 *
 * RECUSAL IS THE LINE THIS PAGE WILL NOT CROSS. The artboard's instrument note
 * is entirely about it: one partner recused, excluded from the denominator, so
 * the tally reads cast-of-eligible rather than cast-of-everyone. `ic_votes`
 * has `yes | no | abstain` and nothing else. An abstention is a vote CAST —
 * the voter was counted and declined. A recusal is a declared conflict that
 * leaves the denominator. Rendering one as the other would put a false
 * statement about a conflict of interest on a fund's screen, so no vote here
 * is drawn as recused and no denominator is reduced.
 *
 * THE RATIONALE TILE IS A CLAIM BEING CHECKED, NOT DECORATION. The artboard
 * says `Rationale required`. `ic_votes.rationale` is nullable and the vote
 * endpoint accepts a vote without one, so the tile counts how many votes
 * actually carry a reason and says the requirement is not enforced. That is
 * the difference between a record a fund can defend and a tally it cannot.
 */

const UNAVAILABLE = Symbol('unavailable');

/** The strip tile, in the anatomy every artboard shares. */
function CommitTile({ label, value, note, tone = '' }) {
  return (
    <div className="rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1.5">
        {value === null
          ? <NotRecorded />
          : <span className={`font-mono text-[16px] font-extrabold tracking-tight ${tone || 'text-axal-ink dark:text-gray-100'}`}>{value}</span>}
      </div>
      <div className="mt-1 text-[10px] leading-snug text-gray-600 dark:text-gray-400">{note}</div>
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

const day = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : null);

/** The stage a decision is at, as the store spells it. */
const STAGE_TONE = { draft: 'neutral', voting: 'info', decided: 'ok' };
/** The three the column accepts, and how a tally reads them. */
const VOTE_TONE = { yes: 'ok', no: 'danger', abstain: 'neutral' };

export default function InvestorCommitZone() {
  const navigate = useNavigate();
  const [room, setRoom] = useState(null);
  const [view, setView] = useState('current');

  const load = useCallback(() => {
    setRoom(null);
    api.icCommitRoom().then(setRoom, () => setRoom(UNAVAILABLE));
  }, []);
  useEffect(() => { load(); }, [load]);

  const ready = room && room !== UNAVAILABLE;
  const decisions = ready ? room.decisions : null;
  const current = ready ? room.current : null;

  /** Every vote on the decision the first chip shows, oldest first. */
  const votes = useMemo(() => (current?.votes ?? []), [current]);

  /**
   * How the tally reads, from the votes themselves rather than from a stored
   * summary — so a decision whose tally row drifted from its votes shows the
   * votes. `abstain` is counted and NOT removed from the denominator, which is
   * the whole point: the store cannot tell an abstention from a recusal, so
   * this page counts both as cast and says so.
   */
  const tallyText = useMemo(() => {
    if (!current) return null;
    const t = current.tally || {};
    return `${t.yes || 0} yes · ${t.no || 0} no · ${t.abstain || 0} abstain`;
  }, [current]);

  const decisionRows = useMemo(() => (decisions?.available ? decisions.rows : []), [decisions]);

  const rowActions = investorZoneActions('deals/commit', {
    view: {
      header: ['Decision', 'Stage', 'Votes', 'Rationales', 'Outcome'],
      rows: decisionRows,
      cells: (r) => [
        r.title || r.uid,
        r.status || '',
        `${r.tally?.yes || 0}/${r.tally?.no || 0}/${r.tally?.abstain || 0}`,
        `${r.rationales} of ${r.votes_cast}`,
        r.decision || '',
      ],
    },
  });

  return (
    <>
      <ZoneToolbar
        className="mb-3"
        role="investor"
        filters={investorZoneFilters('deals/commit', { value: view, onChange: setView })}
        actions={rowActions}
      />
      <ZoneBody
        loading={room === null}
        error={room === UNAVAILABLE ? 'The committee record could not be read.' : ''}
        onRetry={load}
        isEmpty={Boolean(ready) && decisions?.available && decisions.total === 0}
        empty={(
          <NothingYet
            title="No decision has reached the committee"
            body={
              'A decision appears here once one is opened against a deal, and its '
              + 'ledger fills as partners vote. The store is readable and empty, '
              + 'which is a different fact from a committee whose record could not '
              + 'be read.'
            }
          />
        )}
      >
        <div className="space-y-6">
          {/* ══ THE ID3 STRIP ═══════════════════════════════════════════════ */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="commit-strip">
            <CommitTile
              label="Decisions"
              value={decisions?.available ? String(decisions.total) : null}
              note={decisions?.available
                ? `${decisions.by_status.voting} voting · ${decisions.by_status.decided} decided`
                : 'the committee record could not be read'}
            />
            <CommitTile
              label="Votes cast"
              value={current ? String(current.votes_cast) : null}
              note={current
                ? `${tallyText} · on ${current.title}`
                : 'no decision is open, so nothing has been voted on'}
            />
            <CommitTile
              label="Rationales"
              value={ready ? `${room.rationale.recorded} of ${room.rationale.total}` : null}
              note={ready && room.rationale.enforced === false
                ? 'the column is nullable — a reason is recorded, not required'
                : 'unreadable'}
              tone={ready && room.rationale.recorded < room.rationale.total
                ? 'text-amber-700 dark:text-amber-300'
                : ''}
            />
            <CommitTile
              label="In the room"
              value={ready && room.room.available ? String(room.room.invited) : null}
              note={ready && room.room.available
                ? `${Object.entries(room.room.by_rsvp).map(([k, n]) => `${n} ${k}`).join(' · ')} · invited, not entitled to vote`
                : (ready ? room.room.reason : 'unreadable')}
            />
          </div>

          {/* ══ THE VOTE LEDGER — the artboard's instrument ══════════════════ */}
          {view === 'current' && (
            current ? (
              <Instrument
                testid="commit-ledger"
                title="Vote ledger"
                meta={`${current.title} · ${current.status}${current.decision ? ` · ${current.decision}` : ''}`}
                cols="1fr 1.1fr 2.2fr"
                head={['Partner', 'Vote', 'Rationale']}
                rows={votes.map((v) => ({
                  key: v.user_id,
                  cells: [
                    v.user_name
                      ? { text: v.user_name, sub: day(v.created_at) || undefined }
                      : { nr: true, sub: day(v.created_at) || undefined },
                    { text: '', pill: v.vote, pillTone: VOTE_TONE[v.vote] || 'neutral' },
                    v.rationale ? { text: v.rationale } : { nr: true },
                  ],
                }))}
                note={
                  'Every vote is shown with the reason its author wrote, because a tally without reasons is '
                  + 'not a record a fund can defend. A vote with no reason renders as unrecorded rather than '
                  + 'as a blank — the column is nullable and the vote endpoint accepts one without, so the '
                  + 'absence is a real state and not a rendering gap. NO VOTE IS SHOWN AS RECUSED: the store '
                  + 'holds yes, no and abstain, and an abstention is a vote cast rather than a conflict '
                  + 'declared, so the denominator here is everyone who voted and nobody has been removed '
                  + 'from it.'
                }
              />
            ) : (
              <p className="text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400" data-testid="commit-no-current">
                <NotRecorded /> — no decision is open, so there is no ledger to show. That is not a claim
                that the committee has never met.
              </p>
            )
          )}

          {/* ══ EVERY DECISION, WHICH IS WHAT MAKES THIS A LEDGER ════════════ */}
          {view === 'decisions' && (
            <Instrument
              testid="commit-decisions"
              title="All decisions"
              meta="Newest first · scoped to the decisions this account may see"
              cols="1.6fr .8fr 1.1fr .9fr .9fr"
              head={['Decision', 'Stage', 'Tally', 'Rationales', 'Outcome']}
              rows={decisionRows.map((r) => ({
                key: r.uid,
                cells: [
                  {
                    text: r.title || r.uid,
                    sub: r.project_name || undefined,
                    node: r.deal_id ? <OpenDeal id={r.deal_id} onOpen={navigate} /> : undefined,
                  },
                  { text: '', pill: r.status, pillTone: STAGE_TONE[r.status] || 'neutral' },
                  r.votes_cast
                    ? { text: `${r.tally.yes} · ${r.tally.no} · ${r.tally.abstain}`, sub: 'yes · no · abstain' }
                    : { nr: true, sub: 'nobody has voted' },
                  r.votes_cast
                    ? { text: `${r.rationales} of ${r.votes_cast}` }
                    : { nr: true },
                  r.decision
                    ? { text: '', pill: r.decision, pillTone: r.decision === 'invest' ? 'ok' : 'neutral', sub: day(r.decided_at) || undefined }
                    : { nr: true, sub: 'not closed' },
                ],
              }))}
              note={
                'A decision moves from draft to voting when the first vote lands, and to decided when a '
                + 'decision is set against it. Both transitions are stored and both are served by the API; '
                + 'what no screen offers yet is the form that closes one, which is why Close vote is still '
                + 'marked unbuilt — for that reason rather than the one it used to give.'
              }
            />
          )}

          <ZoneDraft
            surface="deals/commit"
            label="Proposal · IC memo from the pipeline"
            accept="Open the memo"
            run="Draft the memo"
            foot="Every figure traced to the row it came from."
            empty="A memo assembled from the screening score, the votes and their rationales — stating where the record is silent instead of filling the gap."
            nothingToDraft="No decision is open, so there is nothing to write a memo against."
          />

          <StatedLimit title="What this room cannot record">
            <p>
              <strong>Nothing stores a recusal.</strong> <code>ic_votes.vote</code>{' '}
              is <code>yes</code>, <code>no</code> or <code>abstain</code>. An
              abstention is a vote cast — the voter was counted and declined. A
              recusal is a declared conflict that leaves the denominator, and
              the artboard&rsquo;s tally depends on that difference. No vote is
              drawn as recused and no denominator is reduced, because either
              would be a claim about a conflict of interest that the record
              does not make.
            </p>
            <p className="mt-2">
              <strong>Nothing stores a condition,</strong> so there is no{' '}
              <em>Conditions</em> list and no <em>Add condition</em>. The
              decision carries a free-text memo and a terms blob; neither is an
              object a later stage could block on, which is exactly what the
              Closing artboard assumes when it says its blocking item
              &ldquo;arrived from the Commit vote&rdquo;.
            </p>
            <p className="mt-2">
              <strong>Nothing stores minutes.</strong>{' '}
              <code>ic_meetings</code> carries an <em>agenda</em> — written
              before the room rather than after it — so <em>Export minutes</em>
              {' '}has nothing to export. The votes and their rationales are
              the only record of what the room concluded.
            </p>
            <p className="mt-2">
              <strong>No quorum is stored,</strong> so no tally is called met
              or unmet. The IC charter template states one in prose, but a
              document body is not a number the product can check against.
              Likewise the attendee count above is an invitation to the
              meeting, not an entitlement to vote — there is no voting roster.
            </p>
          </StatedLimit>
        </div>
      </ZoneBody>
    </>
  );
}
