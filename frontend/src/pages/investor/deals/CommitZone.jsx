import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { exportView } from '../../../lib/csvExport';
import { useAuth } from '../../../hooks/useAuthSync';
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
 * RECUSAL IS BUILT, AND THE DISTINCTION IT DEPENDS ON SURVIVES IT. The
 * artboard's instrument note is entirely about it: one partner recused,
 * excluded from the denominator, so the tally reads cast-of-eligible rather
 * than cast-of-everyone. `ic_votes.vote` carries no CHECK, so `recused` joins
 * the vocabulary at the vote endpoint — with the declaration required as its
 * rationale, because a recusal with no conflict written down is an
 * unattributed change to the denominator. An abstention is still a vote CAST
 * and stays in the tally; a recusal is counted beside it. Rendering one as
 * the other would put a false statement about a conflict of interest on a
 * fund's screen, which is why they are different values with different
 * arithmetic (D461).
 *
 * CONDITIONS AND MINUTES ARE BUILT TOO (migration 334). A condition is its
 * own row on the decision — open, met or waived — and an open one is what the
 * Closing zone's Blocking chip reads. Minutes live on the meeting linked to
 * the deal, written by its organiser after the room rather than before it.
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
/** The four the column accepts, and how a tally reads them. */
const VOTE_TONE = { yes: 'ok', no: 'danger', abstain: 'neutral', recused: 'warn' };
/** A condition's state, as migration 334 CHECKs it. */
const CONDITION_TONE = { open: 'warn', met: 'ok', waived: 'neutral' };

export default function InvestorCommitZone() {
  const navigate = useNavigate();
  const { user } = useAuth() || {};
  const [room, setRoom] = useState(null);
  const [view, setView] = useState('current');
  const [closing, setClosing] = useState(null);
  const [closeError, setCloseError] = useState('');
  const [condForm, setCondForm] = useState(null);
  const [condActionError, setCondActionError] = useState('');
  const [minutesForm, setMinutesForm] = useState(null);

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
   * votes. `abstain` is counted and stays in the denominator; `recused` is
   * counted beside it, because a recusal is a declared conflict and an
   * abstention is a vote cast. The two are different values with different
   * arithmetic, which is the whole point of the artboard's note.
   */
  const tallyText = useMemo(() => {
    if (!current) return null;
    const t = current.tally || {};
    const base = `${t.yes || 0} yes · ${t.no || 0} no · ${t.abstain || 0} abstain`;
    return t.recused ? `${base} · ${t.recused} recused (out of the tally)` : base;
  }, [current]);

  const decisionRows = useMemo(() => (decisions?.available ? decisions.rows : []), [decisions]);

  /**
   * CLOSE VOTE — the screen the registry's reason said was missing.
   *
   * `PUT /api/ic/:uid` with a `decision` of invest | pass | defer forces the
   * status to `decided` and stamps `decided_at`. Both were already served; only
   * this form was absent, which is exactly what the row said.
   *
   * WHO MAY: the route admits the decision's AUTHOR and an admin, and refuses a
   * colleague with a 403. So the op is supplied as a tuple rather than a bare
   * click, and a partner who cannot close this one reads the reason on hover
   * instead of discovering it by being refused. `created_by` travels on the
   * commit-room summary for this.
   *
   * AND ONLY A DECISION THAT IS OPEN. A `decided` row has nothing to close, and
   * offering the control over one would invite a second decision overwriting the
   * first — the route would accept it, since it takes whatever `decision` it is
   * given. Re-opening a closed vote is a governance act, not a button.
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
    return { onClick: () => { setCloseError(''); setClosing(current.uid); }, busy: closing === current.uid };
  }, [current, mine, closing]);

  async function recordDecision(decision) {
    if (!closing) return;
    setCloseError('');
    try {
      await api.icUpdate(closing, { decision });
      setClosing(null);
      load();
    } catch (cause) {
      setCloseError(cause?.message || 'The decision could not be recorded.');
    }
  }

  /**
   * CONDITIONS (migration 334). Every condition on the record, from the
   * commit-room payload; an open one is what the Closing zone's Blocking chip
   * reads. Anyone who may see the decision may propose one; resolving sits
   * with the decision's author or an admin — the same rule as closing the
   * vote, because resolving a condition is what unblocks the wire.
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
      setCondForm({ ...condForm, busy: false, error: cause?.message || 'The condition could not be recorded.' });
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

  const addCondition = !current
    ? { onClick: () => {}, disabled: true, title: 'No decision is open, so there is nothing to attach a condition to.' }
    : { onClick: () => { setCondActionError(''); setCondForm({ body: '', busy: false, error: '' }); } };

  /**
   * MINUTES (migration 334). The meeting linked to the current decision's
   * deal carries them; the organiser or an admin writes them. The export is
   * the minutes as the room recorded them — disabled with the reason when
   * there are none, never an empty file.
   */
  const minutesBlock = ready ? room.minutes : null;
  const exportMinutes = useMemo(() => {
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
        header: ['Meeting', 'Recorded', 'Recorded by', 'Minutes'],
        rows: [minutesBlock],
        cells: (m) => [m.meeting_title || '', day(m.recorded_at) || '', m.recorded_by || '', m.minutes || ''],
      }),
    };
  }, [minutesBlock]);

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

  const rowActions = investorZoneActions('deals/commit', {
    handlers: { closeVote, addCondition, exportMinutes },
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
        filters={investorZoneFilters('deals/commit', {
          value: view,
          onChange: setView,
          // The open count, not the total: a met or waived condition no longer
          // blocks anything, and a chip counting it would overstate the gate.
          counts: { conditions: openConditions.length },
        })}
        actions={rowActions}
      />
      {/* THREE BUTTONS, NOT A FREE FIELD, because the store admits exactly
          three outcomes — `invest`, `pass`, `defer` — and the route silently
          coerces anything else to null, which would close nothing and look like
          a save. The tally is restated here so the outcome is recorded beside
          the votes it is meant to reflect rather than from memory. */}
      {closing && (
        <div className="rounded-[10px] border border-amber-300 bg-amber-50/70 p-3 mb-3 dark:border-amber-900 dark:bg-amber-950/25" data-testid="panel-close-vote">
          <p className="text-[11px] font-bold text-gray-900 dark:text-gray-100">
            Record the outcome of “{current?.title || closing}”
          </p>
          <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">
            {tallyText ? `${tallyText}. ` : ''}This closes the vote and stamps the time. It is not reversible from this page.
          </p>
          {closeError && (
            <p className="mt-2 text-[11px] text-red-700 dark:text-red-400" role="alert" data-testid="status-close-vote-error">{closeError}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {['invest', 'pass', 'defer'].map((decision) => (
              <button
                key={decision}
                type="button"
                data-testid={`button-close-vote-${decision}`}
                onClick={() => recordDecision(decision)}
                className="rounded-[7px] border border-gray-300 bg-white px-[11px] py-1.5 text-[11px] font-bold text-gray-800 hover:border-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              >
                {decision === 'invest' ? 'Invest' : decision === 'pass' ? 'Pass' : 'Defer'}
              </button>
            ))}
            <button
              type="button"
              data-testid="button-close-vote-cancel"
              onClick={() => { setClosing(null); setCloseError(''); }}
              className="rounded-[7px] px-[11px] py-1.5 text-[11px] font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {/* ADD CONDITION — one sentence a later stage can check, attached to the
          decision the first chip shows. Open on arrival; the Closing zone's
          Blocking chip reads it from there. */}
      {condForm && current && (
        <div className="rounded-[10px] border border-amber-300 bg-amber-50/70 p-3 mb-3 dark:border-amber-900 dark:bg-amber-950/25" data-testid="panel-add-condition">
          <p className="text-[11px] font-bold text-gray-900 dark:text-gray-100">
            Add a condition to “{current.title}”
          </p>
          <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">
            It opens as <strong>open</strong> and an open condition is what blocks the wire at closing. The decision’s author or an admin marks it met or waived.
          </p>
          <textarea
            rows={3}
            value={condForm.body}
            onChange={(e) => setCondForm({ ...condForm, body: e.target.value })}
            aria-label="Condition"
            data-testid="input-condition"
            className="mt-2 w-full rounded-[8px] border border-gray-200 bg-white p-2.5 text-[12px] leading-relaxed text-axal-ink focus-visible:outline focus-visible:outline-2 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            placeholder="The sentence a later stage checks — e.g. the evidence a transfer waits on."
            maxLength={2000}
          />
          {condForm.error && (
            <p className="mt-2 text-[11px] text-red-700 dark:text-red-400" role="alert" data-testid="status-condition-form-error">{condForm.error}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="button-submit-condition"
              onClick={submitCondition}
              disabled={condForm.busy}
              className="rounded-[7px] border border-gray-300 bg-white px-[11px] py-1.5 text-[11px] font-bold text-gray-800 hover:border-gray-400 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            >
              {condForm.busy ? 'Recording…' : 'Record the condition'}
            </button>
            <button
              type="button"
              data-testid="button-cancel-condition"
              onClick={() => setCondForm(null)}
              className="rounded-[7px] px-[11px] py-1.5 text-[11px] font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
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
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="commit-strip">
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
              label="Conditions"
              value={ready ? String(openConditions.length) : null}
              note={ready
                ? (openConditions.length
                  ? `${current?.conditions?.open || 0} on the current decision · an open one blocks the wire at closing`
                  : 'none open across the record')
                : 'unreadable'}
              tone={ready && openConditions.length ? 'text-amber-700 dark:text-amber-300' : ''}
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
                  + 'absence is a real state and not a rendering gap. A RECUSED vote renders as recused, '
                  + 'with the declaration its author wrote beside it — the endpoint refuses one without — '
                  + 'and is counted beside the tally, never in it: an abstention is a vote cast, a recusal '
                  + 'is a conflict declared.'
                }
              />
            ) : (
              <p className="text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400" data-testid="commit-no-current">
                <NotRecorded /> — no decision is open, so there is no ledger to show. That is not a claim
                that the committee has never met.
              </p>
            )
          )}

          {/* ══ THE CONDITIONS VIEW — the store the Closing zone blocks on ══ */}
          {view === 'conditions' && (
            <>
              {condActionError && (
                <p className="text-[11px] text-red-700 dark:text-red-400" role="alert" data-testid="status-condition-error">{condActionError}</p>
              )}
              <Instrument
                testid="commit-conditions"
                title="Conditions"
                meta="An open condition is what the Closing zone’s Blocking chip reads"
                cols="2.2fr .7fr 1.3fr 1fr"
                head={['Condition', 'State', 'Decision', 'Recorded']}
                rows={conditions.map((cond) => ({
                  key: cond.uid,
                  cells: [
                    { text: cond.body },
                    { text: '', pill: cond.status, pillTone: CONDITION_TONE[cond.status] || 'neutral' },
                    { text: cond.decision_title || cond.decision_uid },
                    {
                      text: day(cond.created_at) || '',
                      sub: cond.resolved_at
                        ? `${cond.status} ${day(cond.resolved_at)}${cond.resolved_by_name ? ` by ${cond.resolved_by_name}` : ''}`
                        : (cond.created_by_name ? `by ${cond.created_by_name}` : undefined),
                      node: cond.status === 'open' && mayResolve(cond) ? (
                        <span className="inline-flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => resolveCondition(cond, 'met')}
                            data-testid={`button-condition-met-${cond.uid}`}
                            className="text-[10.5px] font-semibold text-emerald-700 underline underline-offset-2 hover:text-emerald-800 dark:text-emerald-400"
                          >
                            Mark met
                          </button>
                          <button
                            type="button"
                            onClick={() => resolveCondition(cond, 'waived')}
                            data-testid={`button-condition-waived-${cond.uid}`}
                            className="text-[10.5px] font-semibold text-gray-600 underline underline-offset-2 hover:text-gray-800 dark:text-gray-400"
                          >
                            Waive
                          </button>
                        </span>
                      ) : undefined,
                    },
                  ],
                }))}
                note={
                  'A condition is the sentence a later stage checks — proposed in the room by anyone the '
                  + 'decision is scoped to, and resolved by the decision’s author or an admin, because '
                  + 'resolving one is what unblocks the wire. Met and waived conditions stay on the record: '
                  + 'a waived condition is a decision someone made, not a row that vanished.'
                }
              />
            </>
          )}

          {/* ══ THE MINUTES VIEW — what the room concluded, written after it ══ */}
          {view === 'minutes' && (
            !minutesBlock?.available ? (
              <p className="text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400" data-testid="commit-no-minutes">
                <NotRecorded /> — {minutesBlock?.reason || 'the committee record could not be read.'}
              </p>
            ) : (
              <section className="rounded-[10px] border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="commit-minutes">
                <Eyebrow>Minutes · {minutesBlock.meeting_title || 'the linked meeting'}</Eyebrow>
                {minutesBlock.recorded ? (
                  <>
                    <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300">{minutesBlock.minutes}</p>
                    <p className="mt-2 text-[10.5px] text-gray-500 dark:text-gray-400">
                      Recorded {day(minutesBlock.recorded_at) || 'at an unrecorded time'}{minutesBlock.recorded_by ? ` by ${minutesBlock.recorded_by}` : ''}.
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400">
                    No minutes are recorded for this meeting yet. The votes and their rationales are the record
                    of what the room concluded until they are.
                  </p>
                )}
                {minutesBlock.may_record && (
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
                          className="rounded-[7px] border border-gray-300 bg-white px-[11px] py-1.5 text-[11px] font-bold text-gray-800 hover:border-gray-400 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                        >
                          {minutesForm.busy ? 'Recording…' : 'Record minutes'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setMinutesForm(null)}
                          className="rounded-[7px] px-[11px] py-1.5 text-[11px] font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-400"
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
                      className="mt-3 rounded-[7px] border border-gray-300 bg-white px-[11px] py-1.5 text-[11px] font-bold text-gray-800 hover:border-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                    >
                      {minutesBlock.recorded ? 'Revise the minutes' : 'Record the minutes'}
                    </button>
                  )
                )}
              </section>
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

          <StatedLimit title="What this room records — and the one thing it still cannot">
            <p>
              <strong>A recusal is a declared conflict, recorded as one.</strong>{' '}
              <code>ic_votes.vote</code> is <code>yes</code>, <code>no</code>,{' '}
              <code>abstain</code> or <code>recused</code>. An abstention is a
              vote cast — the voter was counted and declined, and stays in the
              tally. A recusal leaves the denominator, and the endpoint refuses
              one without the declaration written as its rationale. The two are
              never rendered as each other.
            </p>
            <p className="mt-2">
              <strong>A condition is a stored record</strong> — its own row on
              the decision, open, met or waived, with who set it and who
              resolved it. An open one is what the Closing zone&rsquo;s{' '}
              <em>Blocking</em> chip reads, which is the hand-off the Closing
              artboard means when it says its blocking item &ldquo;arrived from
              the Commit vote&rdquo;.
            </p>
            <p className="mt-2">
              <strong>Minutes live on the meeting.</strong>{' '}
              <code>ic_meetings</code> still carries the agenda — written before
              the room — and now carries the minutes too, recorded by the
              organiser or an admin after it. <em>Export minutes</em> writes
              what was recorded and is disabled, with the reason, when nothing
              has been.
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
