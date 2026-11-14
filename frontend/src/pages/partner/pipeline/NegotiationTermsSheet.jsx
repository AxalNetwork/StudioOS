import React, { useEffect, useState } from 'react';
import Sheet from '../../../ui/Sheet.jsx';
import { usePhoneWidth } from '../../../ui/phone/usePhoneWidth.js';
import {
  Unrecorded, Pill, Field, SaveNote, inputClass, buttonClass, ghostButtonClass, moneyDollars,
} from '../kit';

/**
 * Pipeline · Negotiations — the terms sheet, board PP05b of `Pipeline v2`
 * (D5938, #5938, part of #4838).
 *
 * ONE NEGOTIATION, ITS TERMS SIDE BY SIDE. The canvas compares "We proposed",
 * "They proposed" and "Current position" for every clause, and marks a clause
 * the two sides differ on with "≠". The mark is a glyph and a word for a
 * screen reader, not a colour: a reader who cannot tell amber from ink still
 * sees which clauses are apart.
 *
 * WHAT "DIFFER" MEANS HERE. Both positions are recorded and they are not the
 * same text (ignoring case and spacing). A clause with one side unrecorded is
 * not marked: nothing says the other side disagrees, only that nobody wrote
 * it down, and the cell says "Not recorded".
 *
 * The writes are the zone's own and unchanged: `PUT /negotiations/:quoteId`
 * for stage, ball and the open question, and the negotiation-terms routes
 * for a clause. The sheet holds no state the server does not.
 */

export const STAGES = [
  ['scoping', 'Scoping'],
  ['terms', 'Terms'],
  ['legal', 'Legal'],
  ['ready_to_sign', 'Ready to sign'],
  ['closed', 'Closed'],
];
export const STAGE_LABEL = Object.fromEntries(STAGES);

const TERM_STATES = [
  ['open', 'Open'],
  ['agreed', 'Agreed'],
  ['conceded', 'Conceded'],
  ['refused', 'Refused'],
];
const TERM_STATE_LABEL = Object.fromEntries(TERM_STATES);
// `Pill` names its tones semantically and falls back to neutral WITHOUT
// warning, so the map is written in the component's own vocabulary.
const TERM_TONE = { open: 'warn', agreed: 'ok', conceded: 'neutral', refused: 'danger' };

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** True only when BOTH sides are recorded and they are not the same position. */
export function termsDiffer(term) {
  const ours = norm(term?.our_position);
  const theirs = norm(term?.their_position);
  return Boolean(ours && theirs && ours !== theirs);
}

/** "Who" on a card and on the sheet: the client, else the need, else said plainly. */
export function whoOf(row) {
  return row?.founder_name || row?.need_title || null;
}

/**
 * "How long it has waited": days since the last RECORDED move (`days_stalled`,
 * which the Worker computes from `last_moved_at`). Null is a negotiation with
 * no recorded move, and reads "Not recorded" with that reason — never 0.
 */
export function waitedText(days) {
  if (days === null || days === undefined || !Number.isFinite(Number(days))) return null;
  const d = Number(days);
  if (d <= 0) return 'Moved today';
  return d === 1 ? '1 day' : `${d} days`;
}

/** The ball, in words and a shape, never only a colour. */
export function BallMark({ ball, prefix = '' }) {
  const us = ball === 'us';
  return (
    <span className={`inline-flex items-center gap-1 font-extrabold ${us ? 'text-amber-800 dark:text-amber-300' : 'text-axal-ink dark:text-gray-200'}`}>
      <span aria-hidden="true">{us ? '●' : '○'}</span>
      {prefix}{us ? 'Us' : 'Client'}
    </span>
  );
}

/** The third column: where the clause stands now, in words. */
function CurrentPosition({ term }) {
  const label = TERM_STATE_LABEL[term.state] || term.state;
  if (term.landing) {
    return <span>{term.landing} · <span className="font-semibold">{String(label).toLowerCase()}</span></span>;
  }
  return <span className="font-extrabold">{label}</span>;
}

function TermName({ term }) {
  const apart = termsDiffer(term);
  return (
    <span className={apart ? 'font-extrabold' : 'font-semibold'} data-differ={apart ? 'yes' : 'no'}>
      {apart && (
        <>
          <span aria-hidden="true" className="mr-1 text-amber-700 dark:text-amber-400">≠</span>
          <span className="sr-only">Sides differ: </span>
        </>
      )}
      {term.label}
    </span>
  );
}

function TermEditor({ draft, setDraft }) {
  return (
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
      <Field label="We proposed">
        <input className={inputClass} value={draft.our_position || ''} maxLength={600}
          onChange={(e) => setDraft({ ...draft, our_position: e.target.value })} />
      </Field>
      <Field label="They proposed">
        <input className={inputClass} value={draft.their_position || ''} maxLength={600}
          onChange={(e) => setDraft({ ...draft, their_position: e.target.value })} />
      </Field>
      <Field label="Current position" hint="Leave empty while it is still open: an empty landing is a real state, not a missing field.">
        <input className={inputClass} value={draft.landing || ''} maxLength={600}
          onChange={(e) => setDraft({ ...draft, landing: e.target.value })} />
      </Field>
    </div>
  );
}

/** One clause: read as a row (desktop) or a block (phone), or edited in place. */
function TermRow({ term, onSave, onDelete, busy, phone }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(term);
  // By VALUE, not identity: a background refresh hands every term a new object,
  // and resetting on that would discard a draft someone is still typing.
  const termKey = JSON.stringify(term);
  useEffect(() => { setDraft(term); }, [termKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const editButton = (
    <button type="button" className={ghostButtonClass} aria-label={`Edit ${term.label}`}
      onClick={() => setEdit(true)}>Edit</button>
  );
  const cell = (v) => v || <Unrecorded />;

  if (edit) {
    const form = (
      <div className="rounded-lg border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700 dark:bg-gray-900">
        <TermEditor draft={draft} setDraft={setDraft} />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={busy}
            onClick={async () => { if (await onSave(draft)) setEdit(false); }}>Save term</button>
          <button type="button" className={ghostButtonClass} onClick={() => { setDraft(term); setEdit(false); }}>Cancel</button>
          <button type="button" className={`${ghostButtonClass} ml-auto text-red-700 dark:text-red-300`}
            disabled={busy} onClick={() => onDelete(term)}>Remove</button>
        </div>
      </div>
    );
    return phone ? <li className="py-2">{form}</li> : <tr><td colSpan={5} className="py-2">{form}</td></tr>;
  }

  if (phone) {
    return (
      <li className="border-b border-axal-hairline py-3 dark:border-gray-800" data-term-row={term.id}>
        <div className="flex items-start justify-between gap-2">
          <TermName term={term} />
          <Pill tone={TERM_TONE[term.state]}>{TERM_STATE_LABEL[term.state] || term.state}</Pill>
        </div>
        <dl className="mt-1.5 grid grid-cols-[112px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[12.5px]">
          <dt className="text-axal-muted dark:text-gray-400">We proposed</dt><dd>{cell(term.our_position)}</dd>
          <dt className="text-axal-muted dark:text-gray-400">They proposed</dt><dd>{cell(term.their_position)}</dd>
          <dt className="text-axal-muted dark:text-gray-400">Current position</dt><dd><CurrentPosition term={term} /></dd>
        </dl>
        <div className="mt-2">{editButton}</div>
      </li>
    );
  }

  return (
    <tr className="border-b border-axal-hairline align-top dark:border-gray-800" data-term-row={term.id}>
      <td className="px-2.5 py-2"><TermName term={term} /></td>
      <td className="px-2.5 py-2">{cell(term.our_position)}</td>
      <td className="px-2.5 py-2">{cell(term.their_position)}</td>
      <td className="px-2.5 py-2"><CurrentPosition term={term} /></td>
      <td className="py-2 pl-2 text-right">{editButton}</td>
    </tr>
  );
}

const BLANK_TERM = { label: '', our_position: '', their_position: '', landing: '', state: 'open' };

/**
 * The sheet. `row` is one item of `GET /negotiations`; a quote nobody is
 * tracking yet has `negotiation: null`, and Save starts tracking it (the PUT
 * is an upsert).
 */
export default function NegotiationTermsSheet({
  row, onClose, busy, note, onSaveNegotiation, onAddTerm, onSaveTerm, onDeleteTerm,
}) {
  const phone = usePhoneWidth();
  const n = row.negotiation;
  const stage = n?.stage || 'scoping';
  const ball = n?.ball || 'them';
  const [draftStage, setDraftStage] = useState(stage);
  const [draftBall, setDraftBall] = useState(ball);
  const [question, setQuestion] = useState(n?.open_question || '');
  useEffect(() => { setDraftStage(stage); setDraftBall(ball); }, [stage, ball]);
  useEffect(() => { setQuestion(n?.open_question || ''); }, [n?.open_question]);
  const [adding, setAdding] = useState(false);
  const [newTerm, setNewTerm] = useState(BLANK_TERM);

  const who = whoOf(row) || 'Client not recorded';
  const amount = row.price != null ? moneyDollars(row.price) : 'amount not recorded';
  const waited = waitedText(n?.days_stalled);
  const terms = row.terms || [];
  const apart = terms.filter(termsDiffer).length;
  const ownNote = note?.scope === row.quote_id ? note : null;

  const sub = n ? (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <BallMark ball={n.ball} prefix="Ball: " />
      <span>
        {waited ? (waited === 'Moved today' ? 'Moved today' : `Waiting ${waited}`) : 'Waiting: not recorded (no move logged)'}
        {' · '}
        {n.open_question ? `open question: ${n.open_question}` : 'no open question named'}
      </span>
    </span>
  ) : 'Not tracked yet. Saving a stage below starts tracking it.';

  return (
    <Sheet
      eyebrow="Negotiation · Terms"
      title={`${who} · ${amount}`}
      sub={sub}
      width={640}
      testId="negotiation-terms-sheet"
      onClose={onClose}
    >
      <div className="space-y-5 px-5 py-4">
        <section aria-labelledby={`terms-h-${row.quote_id}`}>
          <div className="flex items-center justify-between gap-3">
            <h3 id={`terms-h-${row.quote_id}`} className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
              Terms
            </h3>
            <button type="button" className={ghostButtonClass} onClick={() => setAdding((v) => !v)}>
              {adding ? 'Cancel' : 'Add a term'}
            </button>
          </div>

          {terms.length === 0 && !adding && (
            <p className="mt-2 text-[12px] leading-relaxed text-axal-faint">
              No clause is tracked on this one yet. A term is what is being
              negotiated, such as payment days, a scope cap or exclusivity, with
              what each side proposed beside it.
            </p>
          )}

          {terms.length > 0 && (phone ? (
            <ul className="mt-2">
              {terms.map((t) => (
                <TermRow key={t.id} term={t} busy={busy} phone
                  onSave={(d) => onSaveTerm(t, d)} onDelete={onDeleteTerm} />
              ))}
            </ul>
          ) : (
            <table className="mt-2 w-full border-collapse text-left text-[12.5px]" data-testid="terms-compare">
              <thead>
                <tr className="bg-axal-ground text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:bg-gray-900 dark:text-gray-400">
                  <th scope="col" className="px-2.5 py-2">Term</th>
                  <th scope="col" className="px-2.5 py-2">We proposed</th>
                  <th scope="col" className="px-2.5 py-2">They proposed</th>
                  <th scope="col" className="px-2.5 py-2">Current position</th>
                  <th scope="col" className="py-2"><span className="sr-only">Edit</span></th>
                </tr>
              </thead>
              <tbody>
                {terms.map((t) => (
                  <TermRow key={t.id} term={t} busy={busy}
                    onSave={(d) => onSaveTerm(t, d)} onDelete={onDeleteTerm} />
                ))}
              </tbody>
            </table>
          ))}
          {terms.length > 0 && (
            <p className="mt-2 text-[11.5px] text-axal-faint">
              ≠ marks a term the two sides differ on
              {apart ? ` (${apart} of ${terms.length})` : ' (none here)'}. A term with one side not recorded is not marked.
            </p>
          )}

          {adding && (
            <div className="mt-2 rounded-lg border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700 dark:bg-gray-900">
              <TermEditor draft={newTerm} setDraft={setNewTerm} />
              <button
                type="button" className={`${buttonClass} mt-3`} disabled={busy || !newTerm.label.trim()}
                onClick={async () => {
                  // Cleared and closed only once the server took it.
                  if (!(await onAddTerm(row, newTerm))) return;
                  setNewTerm(BLANK_TERM);
                  setAdding(false);
                }}
              >
                Add term
              </button>
            </div>
          )}
        </section>

        <section aria-labelledby={`stage-h-${row.quote_id}`} className="rounded-lg border border-axal-hairline p-3 dark:border-gray-700">
          <h3 id={`stage-h-${row.quote_id}`} className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            Stage and ball
          </h3>
          <div className="mt-2 grid gap-3 md:grid-cols-3">
            <Field label="Stage">
              <select className={inputClass} value={draftStage} onChange={(e) => setDraftStage(e.target.value)}>
                {STAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Ball">
              <select className={inputClass} value={draftBall} onChange={(e) => setDraftBall(e.target.value)}>
                <option value="them">Client</option>
                <option value="us">Us</option>
              </select>
            </Field>
            <Field label="Open question" hint="Editing this does not reset the waiting clock: rewording is not a move.">
              <input className={inputClass} value={question} maxLength={600}
                onChange={(e) => setQuestion(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={buttonClass} disabled={busy}
              onClick={() => onSaveNegotiation(row, { stage: draftStage, ball: draftBall, open_question: question })}>
              {n ? 'Save' : 'Start tracking'}
            </button>
            {n && (
              <button type="button" className={ghostButtonClass} disabled={busy}
                title="Records that it moved today without changing stage or ball."
                onClick={() => onSaveNegotiation(row, { touch: true })}>
                Log a move
              </button>
            )}
          </div>
        </section>
        {/* Only this negotiation's own result. */}
        <SaveNote note={ownNote} />
      </div>
    </Sheet>
  );
}
