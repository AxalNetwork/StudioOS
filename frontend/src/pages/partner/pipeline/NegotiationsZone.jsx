import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Unrecorded, Pill,
  StatCard, Section, Field, SaveNote, NotComputable, NoPartnerProfile,
  isNoPartnerProfile, inputClass, buttonClass, ghostButtonClass, moneyDollars,
} from '../kit';

/**
 * Pipeline · Negotiations — `/pipeline/negotiations`.
 *
 * THE ZONE THAT USED TO SAY THERE WAS NOTHING TO READ. Its card was accurate
 * for as long as it stood: a quote was either sent or decided, and the
 * conversation between those two states had no store. Migration 208 gave it
 * two — `quote_negotiations` (stage, whose move it is, the one open question)
 * and `quote_terms` (a clause with three positions rather than one value).
 * This file is what reads them.
 *
 * WHY A TERM CARRIES THREE POSITIONS. Collapsing "we asked 90 days, they asked
 * 30, it lands at 45" to a current value of 45 loses the two halves that
 * explain the third — which is the half a person needs when the same clause
 * comes back on the next deal. So the table shows all three and the landing
 * can be empty without the row being incomplete.
 *
 * WHAT MOVES THE STALLED CLOCK, AND WHAT DOES NOT. `last_moved_at` advances on
 * a stage or ball change, or on an explicit "Log a move" — never on rewording
 * the open question. That is a worker rule rather than a page one, and it is
 * deliberate: if typing reset the clock, the stalled count could be cleared by
 * editing rather than by moving.
 *
 * WHAT THIS ZONE CANNOT ANSWER. Every figure the canvas asks for that is not
 * here is named on the page, with its reason. The largest is a probability:
 * nothing records why a past negotiation was won or lost, so there is nothing
 * to weight a live one against. A percentage drawn from stage alone would be
 * the stage relabelled as a forecast.
 */

const STAGES = [
  ['scoping', 'Scoping'],
  ['terms', 'Terms'],
  ['legal', 'Legal'],
  ['ready_to_sign', 'Ready to sign'],
  ['closed', 'Closed'],
];
const STAGE_LABEL = Object.fromEntries(STAGES);

const TERM_STATES = [
  ['open', 'Open'],
  ['agreed', 'Agreed'],
  ['conceded', 'Conceded'],
  ['refused', 'Refused'],
];
const TERM_STATE_LABEL = Object.fromEntries(TERM_STATES);
// `Pill` names its tones semantically — neutral / ok / warn / danger / info —
// and falls back to neutral for anything else WITHOUT warning. A colour name
// here (`amber`, `rose`) therefore renders grey and looks like a styling miss
// rather than a wrong prop, so the map is written in the component's own
// vocabulary.
const TERM_TONE = {
  open: 'warn', agreed: 'ok', conceded: 'neutral', refused: 'danger',
};

/** Days stalled, in the words the canvas uses, or the absence said plainly. */
function StalledFor({ days }) {
  if (days === null || days === undefined) return <Unrecorded>Not moved yet</Unrecorded>;
  if (days <= 0) return <span className="text-axal-ink-2">Moved today</span>;
  const tone = days >= 7 ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-axal-ink-2';
  return <span className={tone}>{days}d since it moved</span>;
}

function TermRow({ term, onSave, onDelete, busy }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(term);
  useEffect(() => { setDraft(term); }, [term]);

  if (!edit) {
    return (
      <tr className="border-t border-axal-hairline align-top">
        <td className="py-2 pr-3 font-semibold">{term.label}</td>
        <td className="py-2 pr-3 text-axal-ink-2">{term.our_position || <Unrecorded />}</td>
        <td className="py-2 pr-3 text-axal-ink-2">{term.their_position || <Unrecorded />}</td>
        <td className="py-2 pr-3 text-axal-ink-2">{term.landing || <Unrecorded>Not landed</Unrecorded>}</td>
        <td className="py-2 pr-3"><Pill tone={TERM_TONE[term.state]}>{TERM_STATE_LABEL[term.state] || term.state}</Pill></td>
        <td className="py-2 text-right">
          <button type="button" className={ghostButtonClass} onClick={() => setEdit(true)}>Edit</button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-axal-hairline align-top">
      <td className="py-2 pr-3" colSpan={6}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Term">
            <input className={inputClass} value={draft.label || ''} maxLength={160}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          </Field>
          <Field label="State">
            <select className={inputClass} value={draft.state}
              onChange={(e) => setDraft({ ...draft, state: e.target.value })}>
              {TERM_STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="What we asked">
            <input className={inputClass} value={draft.our_position || ''} maxLength={600}
              onChange={(e) => setDraft({ ...draft, our_position: e.target.value })} />
          </Field>
          <Field label="What they asked">
            <input className={inputClass} value={draft.their_position || ''} maxLength={600}
              onChange={(e) => setDraft({ ...draft, their_position: e.target.value })} />
          </Field>
          <Field label="Where it lands" hint="Leave empty while it is still open — an empty landing is a real state, not a missing field.">
            <input className={inputClass} value={draft.landing || ''} maxLength={600}
              onChange={(e) => setDraft({ ...draft, landing: e.target.value })} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={busy}
            onClick={async () => { await onSave(draft); setEdit(false); }}>Save term</button>
          <button type="button" className={ghostButtonClass} onClick={() => { setDraft(term); setEdit(false); }}>Cancel</button>
          <button type="button" className={`${ghostButtonClass} ml-auto text-red-700 dark:text-red-300`}
            disabled={busy} onClick={() => onDelete(term)}>Remove</button>
        </div>
      </td>
    </tr>
  );
}

function NegotiationCard({ row, onSaveNegotiation, onAddTerm, onSaveTerm, onDeleteTerm, busy, note }) {
  const n = row.negotiation;
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState(n?.open_question || '');
  const [adding, setAdding] = useState(false);
  const [newTerm, setNewTerm] = useState({ label: '', our_position: '', their_position: '', landing: '', state: 'open' });
  useEffect(() => { setQuestion(n?.open_question || ''); }, [n?.open_question]);

  const stage = n?.stage || 'scoping';
  const ball = n?.ball || 'them';
  // Controlled, not read back off the DOM at click time. A `getElementById`
  // here would work until the same card rendered twice (two quotes on one
  // need) and then silently save the other card's stage.
  const [draftStage, setDraftStage] = useState(stage);
  const [draftBall, setDraftBall] = useState(ball);
  useEffect(() => { setDraftStage(stage); setDraftBall(ball); }, [stage, ball]);

  return (
    <div className="rounded-xl border border-axal-hairline p-4 dark:border-gray-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-extrabold tracking-tight">
            {row.need_title || <Unrecorded>Untitled need</Unrecorded>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px] text-axal-ink-3">
            <span>{row.quote_uid}</span>
            {row.need_category && <span>· {row.need_category}</span>}
            <span>· quote {row.quote_status}</span>
            {row.price != null && <span>· {moneyDollars(row.price)}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {n
            ? <Pill tone={stage === 'closed' ? 'neutral' : 'info'}>{STAGE_LABEL[stage] || stage}</Pill>
            : <Pill tone="neutral">Not tracked</Pill>}
          <button type="button" className={ghostButtonClass} onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : n ? 'Update' : 'Start tracking'}
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        <span className="text-axal-ink-3">
          Ball with <span className="font-semibold text-axal-ink-1">{ball === 'us' ? 'us' : 'them'}</span>
        </span>
        <StalledFor days={n?.days_stalled ?? null} />
      </div>

      <p className="mt-2 text-[12.5px] leading-relaxed text-axal-ink-2">
        {n?.open_question
          ? <><span className="font-semibold">Blocking: </span>{n.open_question}</>
          : (
            <NotComputable why="A negotiation with no named blocker is one nobody is running — this is the field that says what it is waiting on.">
              No open question
            </NotComputable>
          )}
      </p>

      {open && (
        <div className="mt-3 rounded-lg border border-axal-hairline bg-axal-surface-2 p-3 dark:border-gray-700">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Stage">
              <select className={inputClass} value={draftStage}
                onChange={(e) => setDraftStage(e.target.value)}>
                {STAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Ball in court">
              <select className={inputClass} value={draftBall}
                onChange={(e) => setDraftBall(e.target.value)}>
                <option value="them">Them</option>
                <option value="us">Us</option>
              </select>
            </Field>
            <Field
              label="Open question"
              hint="Editing this does not reset the stalled clock — rewording is not a move."
            >
              <input className={inputClass} value={question} maxLength={600}
                onChange={(e) => setQuestion(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button" className={buttonClass} disabled={busy}
              onClick={() => onSaveNegotiation(row, {
                stage: draftStage, ball: draftBall, open_question: question,
              })}
            >
              Save
            </button>
            {n && (
              <button
                type="button" className={ghostButtonClass} disabled={busy}
                title="Records that it moved today without changing stage or court."
                onClick={() => onSaveNegotiation(row, { touch: true })}
              >
                Log a move
              </button>
            )}
          </div>
          {/* Only this card's own result — see `run`'s docblock. */}
          <SaveNote note={note?.scope === row.quote_id ? note : null} />
        </div>
      )}

      <div className="mt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
            Terms on the table
          </div>
          <button type="button" className={ghostButtonClass} onClick={() => setAdding((v) => !v)}>
            {adding ? 'Cancel' : 'Add a term'}
          </button>
        </div>

        {row.terms.length === 0 && !adding && (
          <p className="mt-2 text-[12px] leading-relaxed text-axal-ink-3">
            No clause is tracked on this one yet. A term is what is being
            negotiated — payment days, scope cap, exclusivity — with what each
            side asked beside it.
          </p>
        )}

        {row.terms.length > 0 && (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
                <tr>
                  <th className="pb-1 pr-3">Term</th>
                  <th className="pb-1 pr-3">We asked</th>
                  <th className="pb-1 pr-3">They asked</th>
                  <th className="pb-1 pr-3">Lands at</th>
                  <th className="pb-1 pr-3">State</th>
                  <th className="pb-1" />
                </tr>
              </thead>
              <tbody>
                {row.terms.map((t) => (
                  <TermRow key={t.id} term={t} busy={busy}
                    onSave={(d) => onSaveTerm(t, d)} onDelete={onDeleteTerm} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {adding && (
          <div className="mt-2 rounded-lg border border-axal-hairline bg-axal-surface-2 p-3 dark:border-gray-700">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Term">
                <input className={inputClass} value={newTerm.label} maxLength={160}
                  onChange={(e) => setNewTerm({ ...newTerm, label: e.target.value })} />
              </Field>
              <Field label="State">
                <select className={inputClass} value={newTerm.state}
                  onChange={(e) => setNewTerm({ ...newTerm, state: e.target.value })}>
                  {TERM_STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="What we asked">
                <input className={inputClass} value={newTerm.our_position} maxLength={600}
                  onChange={(e) => setNewTerm({ ...newTerm, our_position: e.target.value })} />
              </Field>
              <Field label="What they asked">
                <input className={inputClass} value={newTerm.their_position} maxLength={600}
                  onChange={(e) => setNewTerm({ ...newTerm, their_position: e.target.value })} />
              </Field>
            </div>
            <button
              type="button" className={`${buttonClass} mt-3`} disabled={busy || !newTerm.label.trim()}
              onClick={async () => {
                await onAddTerm(row, newTerm);
                setNewTerm({ label: '', our_position: '', their_position: '', landing: '', state: 'open' });
                setAdding(false);
              }}
            >
              Add term
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PartnerNegotiationsZone() {
  const [state, setState] = useState({ loading: true, error: '', items: null });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.listPartnerNegotiations();
      // A bare array, a missing key or an object are all survivable here: the
      // page renders an empty list rather than throwing on `.map` of undefined.
      setState({ loading: false, error: '', items: Array.isArray(r?.items) ? r.items : [] });
    } catch (e) {
      setState({
        loading: false,
        error: e?.message || 'The negotiation record did not load.',
        items: null,
      });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  /**
   * One write, with its result reported ON THE CARD THAT MADE IT.
   *
   * `scope` is why this takes a third argument. A single `note` in this
   * component is rendered by every open card, so saving a stage on one deal
   * would print "Saved." under every other deal a person had expanded — each
   * of them a claim about a write that did not happen there. The card compares
   * `note.scope` to its own quote id and shows nothing otherwise.
   */
  const run = useCallback(async (fn, ok, scope) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      setNote({ ok: true, text: ok, scope });
      await load();
    } catch (e) {
      setNote({ ok: false, text: e?.message || 'That did not save.', scope });
    } finally {
      setBusy(false);
    }
  }, [load]);

  const items = state.items || [];
  const tracked = useMemo(() => items.filter((r) => r.negotiation), [items]);
  const stalled = useMemo(
    () => tracked.filter((r) => (r.negotiation.days_stalled ?? 0) >= 7 && r.negotiation.stage !== 'closed'),
    [tracked],
  );
  const ourCourt = useMemo(
    () => tracked.filter((r) => r.negotiation.ball === 'us' && r.negotiation.stage !== 'closed'),
    [tracked],
  );

  if (isNoPartnerProfile(state.error)) {
    return (
      <>
        <ZoneHeading title="Negotiations" />
        <NoPartnerProfile />
      </>
    );
  }

  return (
    <ZoneBody
      loading={state.loading}
      error={state.error}
      onRetry={load}
      isEmpty={items.length === 0}
      empty={(
        <NothingYet
          title="No quote is out yet"
          body={
            'A negotiation hangs off a quote this firm has sent. Quote a founder '
            + 'need and it appears here, ready to track — stage, whose move it is, '
            + 'and the one question blocking it.'
          }
          action={<Link to="/pipeline/leads" className="text-[12.5px] font-semibold text-amber-700 underline">Open leads</Link>}
        />
      )}
    >
      <div className="space-y-6">
        <ZoneHeading
          title="Live deals at terms"
          blurb={
            'Every quote this firm has out, with the conversation on top of it: '
            + 'what each side asked, where it lands, whose move it is, and how '
            + 'long since it last moved.'
          }
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Quotes out" value={items.length} hint={`${tracked.length} being tracked here`} />
          <StatCard
            label="Our move"
            value={ourCourt.length}
            hint={tracked.length ? 'open negotiations waiting on us' : 'nothing tracked yet'}
          />
          <StatCard
            label="Stalled 7d+"
            value={stalled.length}
            hint={tracked.length ? 'no recorded move in a week' : 'nothing tracked yet'}
          />
          <StatCard
            label="Close probability"
            value="—"
            hint="not computable — see below"
          />
        </div>

        <Section title="Negotiations">
          <div className="space-y-3">
            {items.map((row) => (
              <NegotiationCard
                key={row.quote_id}
                row={row}
                busy={busy}
                note={note}
                onSaveNegotiation={(r, patch) => run(
                  () => api.savePartnerNegotiation(r.quote_id, patch),
                  'Saved.', r.quote_id,
                )}
                onAddTerm={(r, t) => run(
                  () => api.createPartnerNegotiationTerm(r.quote_id, t),
                  'Term added.', r.quote_id,
                )}
                onSaveTerm={(t, d) => run(
                  () => api.updatePartnerNegotiationTerm(t.id, d),
                  'Term saved.', row.quote_id,
                )}
                onDeleteTerm={(t) => run(
                  () => api.deletePartnerNegotiationTerm(t.id),
                  'Term removed.', row.quote_id,
                )}
              />
            ))}
          </div>
        </Section>

        <StatedLimit title="What this zone does not claim">
          <p>
            <strong>No close probability.</strong> The canvas puts a percentage
            beside each deal. Nothing records why a past negotiation was won or
            lost — <code>quotes</code> carries a status and the date it was
            decided and nothing about the decision — so there is no history to
            weight a live deal against. A number drawn from stage alone would be
            the stage relabelled as a forecast, which is why the stat above is
            an em-dash rather than a figure.
          </p>
          <p className="mt-2">
            <strong>Stalled means no recorded move</strong>, not silence. The
            clock advances on a stage or court change, or on an explicit “Log a
            move”; it does not advance when the open question is reworded. An
            email nobody logged here does not move it either — so a deal can be
            alive and read as stalled. That is the honest failure direction:
            the count over-reports rather than reassuring.
          </p>
        </StatedLimit>
      </div>
    </ZoneBody>
  );
}
