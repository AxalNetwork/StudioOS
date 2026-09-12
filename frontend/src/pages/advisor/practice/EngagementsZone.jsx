import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import {
  Field, NothingYet, Pill, SaveNote, StatedLimit, Unrecorded, ZoneBody, ZoneHeading,
  buttonClass, dollarsToCents, ghostButtonClass, inputClass, money,
} from '../expertise/kit';
import {
  BOARD_LANES, LANE_LABEL, OUTCOME_LABEL, OUTCOME_TONE, SHAPE_LABEL, SIGNED_LANES,
  boardLaneOf, canDecideRenewal, clientNote, dueLine, laneMoves, shapeNote,
} from './engagementBoard';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import { advisorZoneActions } from '../../../workspaces/advisorZoneActions';
import { advisorZoneFilters } from '../../../workspaces/advisorZoneFilters';

/**
 * Practice · Engagements — canvas PR2, `/practice/engagements`.
 *
 * WHAT REPLACED WHAT. This route rendered the legacy five-tab Advisory
 * workspace `embedded`: a flat list of BOOKINGS with Upcoming/Past/All chips
 * and a slide-over carrying three lifecycle buttons. It was a session list
 * keyed on `advisor_bookings.status`. The artboard is a CONTRACT board with
 * renewal cycles and written scope. The two share five fields — a client, a
 * date, a state, a note, a topic — and nothing else, which is why this is a new
 * page over a new store rather than a rewrite of that one.
 *
 * ONE RECORD, THREE PROJECTIONS, and the canvas states it outright: "ONE
 * engagement record: the board, renewal history and scope all derive from it."
 * So there is ONE fetch. The board groups it by lane, the renewal history
 * filters it on `cycles > 0`, and the scope card takes the active ones. Three
 * fetches would let the three views disagree with each other.
 *
 * THE BOARD ADVANCES BY CONTROL, NOT BY DRAG, and the divergence is recorded
 * rather than passed over. The canvas labels the board "By contract state · drag
 * to advance". A per-card control is keyboard-reachable with no drag-and-drop
 * implementation to make accessible, and the state it writes is identical.
 *
 * A SIGNED ENGAGEMENT IS NEVER OFFERED "Move to Ended". Ending a signed
 * contract IS the renewal decision that went the wrong way; the worker answers
 * 409 there and names the renewal route, because routing it through the lane
 * verb would drop a lost renewal out of the rate's denominator — "a rate that
 * excludes its failures is not a rate". So the lane control offers what the
 * worker accepts (`laneMoves`) and the renewal decision has its own form. D71.
 *
 * WHAT THE ARTBOARD DRAWS THAT THIS DOES NOT: no AI band. `class="prop"`
 * appears on PR1 and PR3 of this canvas and not here, so a draft panel on this
 * page would be an instrument the artboard does not specify.
 */

const SHAPES = ['retainer', 'sprint', 'equity', 'per_call'];

export default function EngagementsZone() {
  // 'all', not the first chip — same call as Opportunities. Every instrument on
  // this page reads the whole record; a narrowed default would open the renewal
  // history, which is the artboard's headline, already filtered.
  const [filter, setFilter] = useState('all');
  const [state, setState] = useState({ loading: true, error: '', items: [], totals: null });
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState(null);
  const [deciding, setDeciding] = useState(null);
  const [decision, setDecision] = useState({ decision: 'renewed', note: '', term_ends_at: '' });
  const [adding, setAdding] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [draft, setDraft] = useState({
    client_name: '', shape: 'retainer', scope_label: '', scope_includes: '',
    scope_excludes: '', amount: '', term_ends_at: '',
  });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const data = await api.listMyAdvisorEngagements();
      // WHO THIS ADVISOR MAY LINK, as a TOLERATED SECOND SOURCE. The candidates
      // are the people who have booked them — the relationship the worker checks
      // — and an advisor whose bookings will not load still has a contract
      // board, so this never takes the page down with it.
      const held = await api.listMyAdvisorBookings().catch(() => null);
      const seen = new Map();
      for (const b of held?.items || []) {
        if (b.client_user_id && !seen.has(b.client_user_id)) {
          seen.set(b.client_user_id, {
            id: b.client_user_id,
            name: b.client_name || b.founder_name || b.client_email || `Member #${b.client_user_id}`,
          });
        }
      }
      setCandidates([...seen.values()].sort((a, b) => a.name.localeCompare(b.name)));
      setState({ loading: false, error: '', items: data?.items || [], totals: data?.totals || null });
    } catch (error) {
      setState({
        loading: false,
        error: error?.message || 'The engagement record could not be read.',
        items: [], totals: null,
      });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const { items } = state;
  // `by_client` REORDERS, it does not narrow. The chip is "By client", and a
  // filter that dropped rows under that name would be lying about what it did.
  const byClient = filter === 'by_client';
  const ordered = useMemo(() => {
    const rows = [...items];
    return byClient
      ? rows.sort((a, b) => String(a.client_name || '').localeCompare(String(b.client_name || '')))
      : rows;
  }, [items, byClient]);
  const visible = useMemo(() => {
    if (filter === 'signed') return ordered.filter((e) => SIGNED_LANES.has(e.lane));
    if (filter === 'renewal_due') return ordered.filter((e) => e.lane === 'renewal_due');
    if (filter === 'ended') return ordered.filter((e) => e.lane === 'ended');
    return ordered;
  }, [ordered, filter]);

  const totals = state.totals || {};
  const renewalDue = useMemo(() => ordered.filter((e) => e.lane === 'renewal_due'), [ordered]);
  const endedRows = useMemo(() => ordered.filter((e) => e.lane === 'ended'), [ordered]);
  // "Only here · the number that judges a practice". `cycles > 0` is every
  // engagement that was ever signed — an unsent draft is the one thing it leaves
  // out, and 0 is what leaves it out.
  const renewals = useMemo(() => ordered.filter((e) => Number(e.cycles || 0) > 0), [ordered]);
  // The canvas takes the first three ACTIVE engagements, not the first three
  // rows: a draft has no scope on file, it has a proposal.
  const scopes = useMemo(() => visible.filter((e) => SIGNED_LANES.has(e.lane)).slice(0, 3), [visible]);

  const act = async (id, fn, failure) => {
    setBusy(id); setNote(null);
    try {
      await fn();
      await load();
    } catch (error) {
      setNote({ ok: false, text: error?.message || failure });
    } finally { setBusy(''); }
  };

  const advance = (e, lane) => act(e.id, () => api.advanceMyAdvisorEngagement(e.id, lane),
    'That lane could not be recorded.');

  /**
   * Linking the client's Axal account to the contract — PR3c, and the piece that
   * made the rest of this store reachable.
   *
   * WHAT THE LINK BUYS, in one sentence on the card: a work product can only be
   * SENT to a linked client, and only a linked client can record that they opened
   * it. Migration 238 keeps the client as a NAME on purpose — a retainer may
   * predate the company joining — so this stays optional and a card without it
   * still works as a contract.
   *
   * THE OPTIONS ARE THE PEOPLE WHO HAVE BOOKED THIS ADVISOR, because that is the
   * relationship the worker checks. Offering a free-text id or address would be
   * a control that teaches the wrong model: most values would be refused, and
   * the ones accepted would let an advisor attach a stranger. `DocumentShares`
   * on the founder side settled this shape first.
   */
  const linkClient = (e, value) => act(e.id,
    () => api.updateMyAdvisorEngagement(e.id, { founder_user_id: value === '' ? null : Number(value) }),
    'That client account could not be linked.');

  const recordRenewal = (e) => act(e.id, async () => {
    await api.recordMyAdvisorEngagementRenewal(e.id, {
      decision: decision.decision,
      note: decision.note.trim() || null,
      term_ends_at: decision.term_ends_at || null,
    });
    setDeciding(null);
    setDecision({ decision: 'renewed', note: '', term_ends_at: '' });
  }, 'That renewal decision could not be recorded.');

  const create = async () => {
    const parsed = dollarsToCents(draft.amount);
    if (parsed.error) { setNote({ ok: false, text: parsed.error }); return; }
    await act('new', async () => {
      await api.createMyAdvisorEngagement({
        client_name: draft.client_name.trim(),
        shape: draft.shape,
        scope_label: draft.scope_label.trim() || null,
        scope_includes: draft.scope_includes.trim() || null,
        scope_excludes: draft.scope_excludes.trim() || null,
        amount_cents: parsed.cents,
        term_ends_at: draft.term_ends_at || null,
      });
      setAdding(false);
      setDraft({
        client_name: '', shape: 'retainer', scope_label: '', scope_includes: '',
        scope_excludes: '', amount: '', term_ends_at: '',
      });
    }, 'That engagement could not be created.');
  };

  return (
    <ZoneBody
      loading={state.loading}
      error={state.error}
      isEmpty={!state.loading && !state.error && items.length === 0}
      onRetry={load}
      empty={<NothingYet
        title="No engagement is on file"
        body="This board fills as you record the contracts behind your sessions — who the client is, what the scope says, and whether each term renewed. It is empty because nothing has been recorded, not because anything was lost."
        action={<button type="button" className={buttonClass} onClick={() => setAdding(true)}>Record an engagement</button>}
      />}
    >
      <ZoneToolbar
        className="mb-3"
        role="advisor"
        filters={advisorZoneFilters('practice/engagements', { value: filter, onChange: setFilter })}
        actions={advisorZoneActions('practice/engagements', {
          view: {
            header: ['Client', 'State', 'Shape', 'Scope', 'Not in scope', 'Cycles', 'Outcome', 'Term ends', 'Per cycle', 'Note'],
            rows: visible,
            cells: (e) => [
              e.client_name, LANE_LABEL[e.lane] || e.lane, SHAPE_LABEL[e.shape] || e.shape,
              e.scope_includes, e.scope_excludes, e.cycles,
              e.outcome ? OUTCOME_LABEL[e.outcome] : '', e.term_ends_at,
              e.amount_cents == null ? '' : money(e.amount_cents), e.renewal_note,
            ],
          },
        })}
      />

      <SaveNote note={note} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* ACTIVE COUNTS LANES, NOT OUTCOMES, and the canvas is explicit about
            why: "A draft that was never sent and a proposal awaiting an answer
            are not engagements." A renewed contract is the most active thing on
            the board and its outcome is 'renewed', so an outcome filter here
            would under-report by exactly the clients doing best. */}
        <Stat label="Active" value={totals.active ?? 0}
          note={shapeNote(totals.by_shape) || 'Nothing is under contract'} />
        <Stat label="Renewal due" value={totals.renewal_due ?? 0}
          note={clientNote(renewalDue, 'ends') || 'No term is up for a decision'} />
        {/* NULL, NEVER 0%. A practice that has not reached its first renewal has
            not failed to renew, and the endpoint returns null rather than a
            zero for exactly that reason (D56/D68). */}
        <Stat
          label="Renewal rate"
          value={totals.renewal_rate == null ? <Unrecorded>Not recorded</Unrecorded> : `${totals.renewal_rate}%`}
          note={totals.decided
            ? `${totals.renewed} renewed of ${totals.decided} decided`
            : 'No term has reached a decision yet'} />
        <Stat label="Ended" value={totals.ended_lane ?? 0}
          note={clientNote(endedRows, 'ended') || 'Nothing has ended'} />
      </div>

      <Card padding="md" className="mt-3">
        <ZoneHeading
          title="Board"
          blurb="By contract state. A term that is up for a decision stays in Signed and is marked amber — it is a state, not a fifth lane."
          action={<button type="button" className={ghostButtonClass} onClick={() => setAdding((v) => !v)}>
            {adding ? 'Close' : 'New engagement'}
          </button>}
        />
        {adding && (
          <div className="mb-3 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Client">
                <input className={inputClass} value={draft.client_name} placeholder="Meridian Labs"
                  onChange={(e) => setDraft({ ...draft, client_name: e.target.value })} />
              </Field>
              <Field label="Shape" hint="What the engagement bills as. Equity and per-call clients carry no cycle amount, and Earnings leaves them out of a cash gross for that reason.">
                <select className={inputClass} value={draft.shape}
                  onChange={(e) => setDraft({ ...draft, shape: e.target.value })}>
                  {SHAPES.map((s) => <option key={s} value={s}>{SHAPE_LABEL[s]}</option>)}
                </select>
              </Field>
              <Field label="Scope, in a line" hint="What the board card shows: “2 sessions/mo”, “Sprint, 6 weeks”.">
                <input className={inputClass} value={draft.scope_label}
                  onChange={(e) => setDraft({ ...draft, scope_label: e.target.value })} />
              </Field>
              <Field label="Term ends" hint="Left blank until there is a date. A blank is not today.">
                <input className={inputClass} type="date" value={draft.term_ends_at}
                  onChange={(e) => setDraft({ ...draft, term_ends_at: e.target.value })} />
              </Field>
              <Field label="In scope">
                <textarea className={inputClass} rows={2} value={draft.scope_includes}
                  placeholder="Two sessions a month, one written review per cycle."
                  onChange={(e) => setDraft({ ...draft, scope_includes: e.target.value })} />
              </Field>
              <Field label="Not in scope" hint="Stored as its own text, not as an absence. This is the sentence that prevents the conversation.">
                <textarea className={inputClass} rows={2} value={draft.scope_excludes}
                  placeholder="Not in scope: fundraising introductions, board attendance."
                  onChange={(e) => setDraft({ ...draft, scope_excludes: e.target.value })} />
              </Field>
              <Field label="Per cycle" hint="Leave blank if there is no cash amount — an equity engagement is the ordinary case. Blank means unrecorded, not free.">
                <input className={inputClass} value={draft.amount} placeholder="4500"
                  onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
              </Field>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-axal-ink-3">
              A new engagement opens in <strong>Drafting</strong>. Signing it is a move on the board,
              because that is what starts the first term and gives the row a renewal to decide.
            </p>
            <button type="button" className={`${buttonClass} mt-2`}
              disabled={busy === 'new' || !draft.client_name.trim()} onClick={create}>
              Add to Drafting
            </button>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {BOARD_LANES.map((lane) => {
            const cards = visible.filter((e) => boardLaneOf(e.lane) === lane.key);
            return (
              <div key={lane.key} data-testid={`lane-pr2-${lane.key}`}
                className="rounded-[11px] border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700 dark:bg-gray-900/40">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">{lane.label}</span>
                  <span className="text-[10.5px] font-bold tabular-nums text-axal-ink-3">{cards.length}</span>
                </div>
                <div className="mt-2.5 grid gap-2">
                  {cards.length === 0
                    /* EVERY LANE NEEDS THIS and the canvas fixture never shows
                       one, because its own data fills all four. A lane with no
                       cards and no sentence reads as a rendering failure. */
                    ? <p className="py-2 text-[10.5px] leading-relaxed text-axal-ink-3">Nothing here.</p>
                    : cards.map((e) => <BoardCard key={e.id} e={e} busy={busy === e.id}
                      onAdvance={advance} candidates={candidates} onLink={linkClient} />)}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.15fr_1fr]">
        <Card padding="md">
          <ZoneHeading
            title="Renewal history"
            blurb="Only here — the number that judges a practice. Every engagement that has run at least one term, including the ones that ended."
          />
          {renewals.length === 0
            ? <p className="text-[12.5px] leading-relaxed text-axal-ink-2">
              No engagement has run a term yet. A row appears here when one is signed — its first term
              counts as a cycle, and the outcome fills in when you record a renewal decision.
            </p>
            : <div className="overflow-x-auto"><table className="w-full min-w-[460px] text-[12px]">
              <thead><tr className="text-left text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-ink-3">
                <th className="pb-2">Client</th><th className="pb-2">Cycles</th><th className="pb-2">Outcome</th><th className="pb-2">Note</th>
              </tr></thead>
              <tbody>{renewals.map((e) => (
                <tr key={e.id} data-testid={`row-pr2-renewal-${e.id}`} className="border-t border-axal-hairline dark:border-gray-700">
                  <td className="py-2 pr-3 font-semibold">{e.client_name}</td>
                  <td className="py-2 pr-3 tabular-nums">{e.cycles}</td>
                  <td className="py-2 pr-3">{e.outcome
                    ? <Pill tone={OUTCOME_TONE[e.outcome]}>{OUTCOME_LABEL[e.outcome]}</Pill>
                    : <Unrecorded>No decision</Unrecorded>}</td>
                  <td className="py-2 text-axal-ink-2">{e.renewal_note || <Unrecorded>No note recorded</Unrecorded>}</td>
                </tr>
              ))}</tbody>
            </table></div>}
          {totals.decided > 0 && (
            <p className="mt-3 text-[11.5px] leading-relaxed text-axal-ink-3">
              The renewal rate is {totals.renewed} of {totals.decided} terms that reached a decision.
              The {totals.ended === 1 ? 'one that ended is' : `${totals.ended} that ended are`} counted,
              because a rate that excludes its failures is not a rate.
            </p>
          )}
        </Card>

        <Card padding="md">
          <ZoneHeading title="Scope on file" blurb="What each contract actually says." />
          {scopes.length === 0
            ? <p className="text-[12.5px] leading-relaxed text-axal-ink-2">
              No engagement is under contract, so there is no scope on file. A draft carries a proposal,
              which is not the same thing as terms both sides hold.
            </p>
            : <div className="grid gap-2.5">{scopes.map((e) => (
              <div key={e.id} data-testid={`row-pr2-scope-${e.id}`}
                className="rounded-[9px] border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700 dark:bg-gray-900/40">
                <div className="text-[12px] font-extrabold tracking-tight">{e.client_name}</div>
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-axal-ink-2">
                  {e.scope_includes || <Unrecorded>No inclusions recorded</Unrecorded>}
                </p>
                {/* AMBER, AND ITS OWN LINE. The canvas gives exclusions their
                    own colour because they are the half that does the work.
                    An absent exclusion says "not recorded" — the fixture draws
                    an em-dash there and this page may not (D56/D68). */}
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-amber-700 dark:text-amber-300">
                  {e.scope_excludes || <Unrecorded>No exclusion recorded</Unrecorded>}
                </p>
              </div>
            ))}</div>}
          <p className="mt-3 text-[11px] leading-relaxed text-axal-ink-3">
            Exclusions are stored as first-class text, not as an absence. &ldquo;Not in scope: fundraising
            introductions&rdquo; is the sentence that prevents the conversation.
          </p>
        </Card>
      </div>

      {/* THE RENEWAL DECISION, kept apart from the lane control on purpose —
          see the docblock and D71. Only a signed engagement has one to make. */}
      <Card padding="md" className="mt-3">
        <ZoneHeading
          title="Record a renewal decision"
          blurb="The one write that moves a cycle and an outcome. A renewal starts a term and adds a cycle; ending records the loss and closes the lane."
        />
        {ordered.filter((e) => canDecideRenewal(e.lane)).length === 0
          ? <p className="text-[12.5px] leading-relaxed text-axal-ink-2">
            Nothing is under contract, so there is no renewal to decide. A draft or a proposal has no term
            behind it — the worker refuses a decision on one rather than inventing an outcome for it.
          </p>
          : <ul className="space-y-2">{ordered.filter((e) => canDecideRenewal(e.lane)).map((e) => (
            <li key={e.id} data-testid={`row-pr2-decide-${e.id}`}
              className="rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-[13px] font-extrabold tracking-tight">{e.client_name}</strong>
                    <Pill tone={e.lane === 'renewal_due' ? 'warn' : 'neutral'}>{LANE_LABEL[e.lane]}</Pill>
                    <Pill tone="neutral">{SHAPE_LABEL[e.shape] || e.shape}</Pill>
                  </div>
                  <p className="mt-1 text-[11px] text-axal-ink-3">
                    {e.cycles === 1 ? 'First term' : `${e.cycles} terms`} · {dueLine(e)}
                    {e.amount_cents == null
                      ? <> · <Unrecorded>amount not recorded</Unrecorded></>
                      : ` · ${money(e.amount_cents)} per cycle`}
                  </p>
                </div>
                <button type="button" className={ghostButtonClass} disabled={busy === e.id}
                  onClick={() => {
                    setDeciding(deciding === e.id ? null : e.id);
                    setDecision({ decision: 'renewed', note: '', term_ends_at: '' });
                  }}>
                  {deciding === e.id ? 'Cancel' : 'Decide'}
                </button>
              </div>
              {deciding === e.id && (
                <div className="mt-3 grid gap-3 border-t border-axal-hairline pt-3 sm:grid-cols-3 dark:border-gray-700">
                  <Field label="Decision">
                    <select className={inputClass} value={decision.decision}
                      onChange={(ev) => setDecision({ ...decision, decision: ev.target.value })}>
                      <option value="renewed">Renewed</option>
                      <option value="ended">Ended</option>
                    </select>
                  </Field>
                  <Field label="New term ends"
                    hint={decision.decision === 'ended' ? 'Not used when a contract ends.' : 'When the term you have just started runs out.'}>
                    <input className={inputClass} type="date" value={decision.term_ends_at}
                      disabled={decision.decision === 'ended'}
                      onChange={(ev) => setDecision({ ...decision, term_ends_at: ev.target.value })} />
                  </Field>
                  <Field label="Note" hint="What the renewal history shows. Why it ended goes here too.">
                    <input className={inputClass} value={decision.note}
                      placeholder="Two cycles, then they hired in-house."
                      onChange={(ev) => setDecision({ ...decision, note: ev.target.value })} />
                  </Field>
                  <div className="sm:col-span-3">
                    <button type="button" className={buttonClass} disabled={busy === e.id}
                      onClick={() => recordRenewal(e)}>
                      {decision.decision === 'renewed' ? 'Record the renewal' : 'Record the ending'}
                    </button>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-axal-ink-3">
                      Either answer counts toward the renewal rate. Ending here is how a lost renewal
                      reaches the denominator — the board&rsquo;s lane control deliberately will not do it.
                    </p>
                  </div>
                </div>
              )}
            </li>
          ))}</ul>}
      </Card>

      <StatedLimit title="What this board cannot say">
        <p>
          <strong>Nothing sends a renewal notice.</strong> The artboard&rsquo;s header offers one in bulk;
          no notice pipeline exists for an advisor, so the control says so rather than looping over a
          send that is not there. Recording the decision is what this page does.
        </p>
        <p className="mt-2">
          <strong>A client is a name here, and a platform account only sometimes.</strong> An engagement
          may predate its client joining, so the record keeps the name and links the account when there
          is one. Until a client is linked, nothing joins this contract to the sessions booked under it.
        </p>
        <p className="mt-2">
          <strong>The board advances by control, not by drag.</strong> The canvas says &ldquo;drag to
          advance&rdquo;; a per-card control reaches the same state and is keyboard-reachable without a
          drag-and-drop layer to make accessible. And a signed engagement is never offered
          <em> Move to Ended</em> — that ending is a renewal decision, and it is recorded as one.
        </p>
      </StatedLimit>
    </ZoneBody>
  );
}

/**
 * One card, and its lane control.
 *
 * The control offers `laneMoves(e.lane)` and nothing else, so every option on it
 * is one the worker will accept. An ended engagement gets no control at all
 * rather than a disabled one: there is no move to make, and a greyed button
 * implies there is.
 */
function BoardCard({ e, busy, onAdvance, candidates, onLink }) {
  const due = e.lane === 'renewal_due';
  const moves = laneMoves(e.lane);
  // The linked account may not be among the candidates any more — a booking can
  // be removed after the link was made — so its own option is added rather than
  // letting the select fall back to "not linked" and read as though it were.
  const options = e.founder_user_id && !(candidates || []).some((p) => p.id === e.founder_user_id)
    ? [...(candidates || []), { id: e.founder_user_id, name: `Member #${e.founder_user_id}` }]
    : (candidates || []);
  return (
    <div data-testid={`card-pr2-${e.id}`}
      className={`rounded-[9px] border p-2.5 ${due
        ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20'
        : 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900'}`}>
      <div className="text-[12px] font-bold tracking-tight">{e.client_name}</div>
      <div className="mt-1 text-[10.5px] leading-relaxed text-axal-ink-3">
        {e.scope_label || SHAPE_LABEL[e.shape] || 'No scope line recorded'}
      </div>
      <div className={`mt-1.5 text-[10px] font-semibold tabular-nums ${due ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink-3'}`}>
        {dueLine(e)}
      </div>
      {moves.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {moves.map((lane) => (
            <button key={lane} type="button" disabled={busy}
              data-testid={`move-pr2-${e.id}-${lane}`}
              onClick={() => onAdvance(e, lane)}
              className="rounded-md border border-axal-hairline px-1.5 py-1 text-[10px] font-semibold hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800">
              {LANE_LABEL[lane]}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 border-t border-axal-hairline pt-2 dark:border-gray-700">
        <label className="block text-[9.5px] font-extrabold uppercase tracking-[.07em] text-axal-ink-3"
          htmlFor={`link-pr2-${e.id}`}>Client account</label>
        <select id={`link-pr2-${e.id}`} data-testid={`link-pr2-${e.id}`} disabled={busy}
          value={e.founder_user_id || ''} onChange={(ev) => onLink(e, ev.target.value)}
          className="mt-1 w-full rounded-md border border-axal-hairline bg-white px-1.5 py-1 text-[10.5px] disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900">
          <option value="">Not linked — a name only</option>
          {options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <p className="mt-1 text-[9.5px] leading-relaxed text-axal-ink-3">
          {e.founder_user_id
            ? 'Linked. Work products can be sent to them, and they can record having opened one.'
            : options.length === 0
              ? 'Nobody has booked you yet, so there is no account to link. The contract works either way.'
              : 'Only a linked client can be sent a work product, or record that they opened one.'}
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, note }) {
  return (
    <Card padding="md">
      <div className="text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-ink-3">{label}</div>
      <div className="mt-1.5 text-[22px] font-extrabold leading-none tracking-tight tabular-nums">{value}</div>
      <div className="mt-1.5 text-[11px] leading-relaxed text-axal-ink-3">{note}</div>
    </Card>
  );
}
