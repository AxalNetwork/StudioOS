import { centsToInput } from '../../../lib/moneyInput.js';
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import {
  // D4842: no tile strip, no profile table and no "who we are not for" card.
  // OF-04 is the rank note and one rules table.
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Unrecorded, Pill,
  Field, NoPartnerProfile, isNoPartnerProfile,
  inputClass, buttonClass, ghostButtonClass, moneyCents, dollarsToCents,
} from '../kit';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import Sheet from '../../../ui/Sheet.jsx';
import { useGuardedWrite, scopedNote, zoneNote, WriteNote } from './useGuardedWrite';
import { fitView } from '../../../lib/fitRuleView.js';
import { FIT_KINDS, FIT_STRENGTHS, fitRuleRow, fitSheetCopy } from './fitRules.js';

/**
 * Offers · Audience fit — `/offers/audience-fit`.
 *
 * THE WORKING HALF OF THIS ZONE IS WHO THE FIRM IS NOT FOR. A stated budget
 * floor, sectors declined, capabilities honestly absent. That is what lets
 * Pipeline pass a lead with a named reason instead of silence — and a pass with
 * a reason and a pass without one are very different things to receive. Passing
 * quietly costs the founder a week; passing with "we start at $25k, and Kestrel
 * do this well below that" costs them nothing and may still help.
 *
 * SO `statement` IS THE FIELD THAT MATTERS, not the threshold. A rule with a
 * floor and no sentence produces exactly the silence the zone exists to
 * replace, so the count of unstated rules is on the stat strip rather than left
 * for the reader to notice row by row.
 *
 * `referred_to` IS PART OF THE RULE, not a note on it. A rule that cannot carry
 * the alternative cannot produce the sentence above.
 *
 * PIPELINE READS THESE, AND DECLINES NOTHING. `Pipeline · Leads` reads the
 * active rules to score a lead (a budget floor, a best-fit profile and its
 * signal), and a lead that matches a declined sector or an absent capability is
 * marked excluded there: it carries the firm's sentence and no number, and it
 * is left out of the AI ranking. The worker says so in its own response
 * (`enforcement: 'score_and_rank'`, `auto_decline: false`) rather than leaving
 * the page to imply whatever it likes. Scoring and ranking are not rejection:
 * an excluded lead stays on Leads and passing on it is still the firm's click
 * (#4696).
 */

const KINDS = [
  ['budget_floor', 'Budget floor', 'The smallest engagement worth starting.'],
  ['sector_declined', 'Sector declined', 'Work the firm turns down on principle or on fit.'],
  ['capability_absent', 'Capability absent', 'Something the firm does not do, said plainly.'],
  ['best_fit', 'Best fit', 'Who the firm is actually for.'],
];
const KIND_LABEL = Object.fromEntries(KINDS.map(([v, l]) => [v, l]));
const KIND_TONE = {
  best_fit: 'ok', budget_floor: 'info', sector_declined: 'neutral', capability_absent: 'neutral',
};

/**
 * How strong a fit a PROFILE is (migration 229), in the firm's own words.
 *
 * NOT A SCORE ABOUT ANYBODY HERE. This file computes no number against a
 * founder's need; Pipeline does that, and reads `best_fit` and `weak_intent`
 * as receipts on the score while `qualified` is a note the firm keeps. A firm
 * writing "pre-product founders with a deck — weak
 * intent" is writing a sentence about a KIND of client, which is the same act
 * as writing the reason beside it.
 *
 * `Weak intent` IS NOT A DECLINE, and the artboard's instNote is the argument:
 * "the honest answer is 'not yet' — and a match engine that cannot say 'not
 * yet' ends up saying 'no' to the same founder twice." So a weak profile stays
 * a profile and never joins the exclusions below it.
 */
const SIGNALS = [
  ['best_fit', 'Best fit'],
  ['qualified', 'Qualified'],
  ['weak_intent', 'Weak intent'],
];
const SIGNAL_LABEL = Object.fromEntries(SIGNALS);

/**
 * D4842 — THE FIT RULE SHEET (OF04b), one for adding and editing. It asks the
 * canvas's business questions in order: who, how strong, what to say, and
 * where to point them. The rule's kind defaults to a great-fit profile and the
 * other three kinds sit under "Advanced rule types", disclosed rather than
 * leading. A kind is chosen there, and the questions follow it.
 *
 * ONE RULE PER SAVE. The canvas puts a minimum engagement beside a sector in
 * one sheet; the store keeps a budget floor as its own rule, so the minimum is
 * the "Below a minimum engagement" kind under Advanced, and one Save writes one
 * row. Delete sits on the left, away from Save (OF-10).
 */
export function FitRuleSheet({ initial, onSubmit, onDelete, onClose, busy, note, scope }) {
  const [kind, setKind] = useState(initial?.kind || 'best_fit');
  const [advanced, setAdvanced] = useState(Boolean(initial?.kind && initial.kind !== 'best_fit'));
  const [floor, setFloor] = useState(centsToInput(initial?.floor_cents));
  const [value, setValue] = useState(initial?.value || '');
  const [statement, setStatement] = useState(initial?.statement || '');
  const [referredTo, setReferredTo] = useState(initial?.referred_to || '');
  const [signal, setSignal] = useState(initial?.signal || '');
  const [floorError, setFloorError] = useState('');

  const isFloor = kind === 'budget_floor';
  // A strength belongs to a PROFILE. An exclusion has no strength — a declined
  // sector is declined — and the route refuses one sent on any other kind, so
  // the control is not drawn where it would be rejected.
  const isProfile = kind === 'best_fit';
  const copy = fitSheetCopy(kind);

  function submit() {
    const parsed = dollarsToCents(floor);
    if (isFloor && parsed.error) { setFloorError(parsed.error); return; }
    if (isFloor && parsed.cents === null) { setFloorError('A minimum engagement needs an amount'); return; }
    setFloorError('');
    onSubmit({
      kind,
      floor_cents: isFloor ? parsed.cents : null,
      value: isFloor ? (value.trim() || null) : value.trim(),
      statement: statement.trim() || null,
      referred_to: referredTo.trim() || null,
      signal: isProfile ? (signal || null) : null,
    });
  }

  return (
    <Sheet
      title={copy.title}
      eyebrow={initial ? 'Audience fit · edit rule' : 'Audience fit · new rule'}
      onClose={onClose}
      width={560}
      phone="sheet"
      testId="fit-rule-sheet"
      footer={(
        <div className="flex flex-wrap items-center gap-2">
          {onDelete && (
            <button type="button" className={`${ghostButtonClass} text-red-700 dark:text-red-300`} disabled={busy} onClick={onDelete}>
              Delete rule
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" className={`${ghostButtonClass} min-h-[44px] md:min-h-0`} onClick={onClose}>Cancel</button>
            <button type="button" className={`${buttonClass} min-h-[44px] md:min-h-0`} disabled={busy} onClick={submit}>Save rule</button>
          </div>
        </div>
      )}
    >
      <div className="flex flex-col gap-4" data-testid="rule-editor">
        {isFloor ? (
          <Field label={copy.who} hint={floorError || 'Leads below this rank lower, with your reason.'}>
            <input className={inputClass} value={floor} inputMode="decimal" placeholder="e.g. 25000"
              aria-invalid={floorError ? 'true' : undefined}
              onChange={(e) => setFloor(e.target.value)} />
          </Field>
        ) : (
          <Field label={copy.who}>
            <input className={inputClass} value={value} maxLength={200}
              onChange={(e) => setValue(e.target.value)} />
          </Field>
        )}
        {isProfile && (
          <fieldset>
            <legend className="mb-1 text-[12px] font-semibold text-axal-ink dark:text-gray-100">How strong is this fit?</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Fit strength">
              {FIT_STRENGTHS.map(([v, l]) => (
                <button
                  key={v} type="button" role="radio" aria-checked={signal === v}
                  className={`min-h-[44px] flex-1 rounded-lg border px-3 text-[13px] font-semibold md:min-h-[36px] ${signal === v
                    ? 'border-axal-ink bg-axal-ink text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
                    : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}
                  onClick={() => setSignal(signal === v ? '' : v)}
                >
                  {l}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11.5px] text-axal-faint">
              Weak intent means “not yet”, which is not a decline. Pipeline reads Best fit and Weak intent when it scores a lead; Qualified is a note you keep. Leave it unset if you have not judged it.
            </p>
          </fieldset>
        )}
        <hr className="border-axal-hairline dark:border-gray-700" />
        <Field label={copy.says} hint={copy.saysHint}>
          <textarea className={inputClass} rows={3} value={statement} maxLength={1000}
            onChange={(e) => setStatement(e.target.value)} />
        </Field>
        <Field label="Can we point them somewhere else? (optional)" hint="A firm or person better suited, named in the reply.">
          <input className={inputClass} value={referredTo} maxLength={300}
            onChange={(e) => setReferredTo(e.target.value)} />
        </Field>
        <button
          type="button" className="w-fit text-[12.5px] font-semibold text-axal-muted underline dark:text-gray-300"
          aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}
        >
          Advanced rule types {advanced ? '▴' : '▾'}
        </button>
        {advanced && (
          <Field label="Rule type" hint={FIT_KINDS.find(([k]) => k === kind)?.[2]}>
            <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
              {FIT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        )}
        <WriteNote note={scopedNote(note, scope)} busy={busy} />
      </div>
    </Sheet>
  );
}

/**
 * D4842 — THE RULES TABLE (OF-04): Rule, Who, Strength, What we say, Point them
 * to. One row set: the rows the chip selects, which are also the export. A rule
 * with no reply carries the primary "Add reply"; every other row is Edit. On a
 * phone the same rows stack as cards, so no table is wider than the screen.
 */
function FitRulesTable({ rows, onEdit }) {
  const who = (v) => v.who || <Unrecorded>Not named</Unrecorded>;
  const says = (v) => (v.says
    ? <span>“{v.says}”</span>
    : <span className="font-bold text-amber-700 dark:text-amber-400">No reply yet</span>);
  const action = ({ r, v }) => (
    <button
      type="button"
      className={`${v.needsReply ? buttonClass : ghostButtonClass} min-h-[44px] md:min-h-0`}
      onClick={() => onEdit(r)}
    >
      {v.needsReply ? 'Add reply' : 'Edit'}
    </button>
  );
  const ruleCell = (v) => (
    <>
      <b className="text-axal-ink dark:text-gray-100">{v.rule}</b>
      {v.kind && <div className="text-[11.5px] text-axal-faint">{v.kind}</div>}
      {!v.inUse && <div className="text-[11.5px] text-axal-faint">Not in use</div>}
    </>
  );
  return (
    <div className="overflow-hidden rounded-xl border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900" data-testid="fit-rules">
      <table className="hidden w-full text-left text-[13.5px] md:table">
        <thead className="text-[11px] uppercase tracking-[.08em] text-axal-faint">
          <tr className="border-b border-axal-hairline dark:border-gray-700">
            {['Rule', 'Who', 'Strength', 'What we say', 'Point them to'].map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-extrabold">{h}</th>
            ))}
            <th scope="col" className="px-4 py-2.5"><span className="sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ r, v }) => (
            <tr key={r.id} className="border-b border-axal-hairline align-top last:border-b-0 dark:border-gray-800" data-testid="fit-rule-row">
              <td className="px-4 py-3">{ruleCell(v)}</td>
              <td className="px-4 py-3">{who(v)}</td>
              <td className="px-4 py-3">{v.strength || <span className="text-axal-faint">—</span>}</td>
              <td className="px-4 py-3 text-[13px]">{says(v)}</td>
              <td className="px-4 py-3">{v.pointTo || <span className="text-axal-faint">—</span>}</td>
              <td className="px-4 py-3 text-right">{action({ r, v })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-axal-hairline md:hidden dark:divide-gray-800">
        {rows.map(({ r, v }) => (
          <li key={r.id} className="flex flex-col gap-1.5 p-4 text-[13.5px]">
            <div>{ruleCell(v)}</div>
            <div>{who(v)}{v.strength && <span className="text-axal-faint"> · {v.strength}</span>}</div>
            <div className="text-[13px]">{says(v)}</div>
            {v.pointTo && <div className="text-[12.5px] text-axal-muted dark:text-gray-300">Point them to {v.pointTo}</div>}
            <div>{action({ r, v })}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * `Pass reasons`, the artboard's second op.
 *
 * ITS REASON WAS WRONG ABOUT ITS OWN STORE. It read "a pass reason is not a
 * stored field on a fit rule" — and `statement` is exactly that field: the form
 * labels it "The sentence a pass quotes" and the docblock at the top of this
 * file calls it the field that matters. Every exclusion the firm has written
 * already carries the sentence, and `referred_to` carries the alternative.
 *
 * SO THIS COMPOSES RATHER THAN GENERATES. Nothing here writes a reason; it
 * assembles the ones the firm wrote into the text a person would paste, and a
 * rule with no sentence says so instead of getting one invented for it.
 */
function PassReasons({ rules, onClose }) {
  const [copied, setCopied] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Pass reasons</h3>
          <button type="button" className={ghostButtonClass} onClick={onClose}>Close</button>
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-axal-muted">
          The sentence each exclusion would be passed with, assembled from what you wrote.
          Nothing sends these — a pass is still yours to make and yours to word.
        </p>
        {rules.length === 0 ? (
          <p className="mt-3 text-[12.5px] leading-relaxed text-axal-muted">
            No exclusion is written yet, so a pass has nothing to quote. That is the silence
            this zone exists to replace.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {rules.map((r) => {
              const subject = r.kind === 'budget_floor'
                ? (r.floor_cents != null ? moneyCents(r.floor_cents) : 'the floor')
                : r.value;
              const text = r.statement
                ? `${r.statement}${r.referred_to ? ` We would point you to ${r.referred_to}.` : ''}`
                : null;
              return (
                <div key={r.id} className="rounded-md border border-axal-hairline p-3 dark:border-gray-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={KIND_TONE[r.kind] || 'neutral'}>{KIND_LABEL[r.kind] || r.kind}</Pill>
                    <span className="text-[12.5px] font-semibold">{subject}</span>
                  </div>
                  {text ? (
                    <>
                      <p className="mt-2 text-[12.5px] leading-relaxed text-axal-muted">{text}</p>
                      <button
                        type="button" className={`${ghostButtonClass} mt-2`}
                        onClick={() => {
                          navigator.clipboard?.writeText(text)
                            .then(() => { setCopied(r.id); setTimeout(() => setCopied(''), 1500); })
                            .catch(() => {});
                        }}
                      >
                        {copied === r.id ? 'Copied' : 'Copy'}
                      </button>
                    </>
                  ) : (
                    <p className="mt-2 text-[12.5px] leading-relaxed text-amber-700 dark:text-amber-400">
                      No sentence written. A pass citing this rule would have nothing to say — which
                      is the one thing this zone asks you not to send.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PartnerAudienceFitZone() {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  // D4842: one sheet for adding and editing. `null` is closed, `{}` is a new
  // rule, `{ rule }` edits that rule.
  const [sheet, setSheet] = useState(null);
  const [showingPasses, setShowingPasses] = useState(false);
  const [view, setView] = useState('all');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.listPartnerFitRules();
      setState({ loading: false, error: '', data: r || {} });
      return true;
    } catch (e) {
      setState({ loading: false, error: e?.message || 'The fit rules did not load.', data: null });
      return false;
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // #4688: one write mechanism, shared with Visibility and Proof. See
  // `useGuardedWrite.jsx` for what "saved" means and what Retry repeats.
  const { busy, note, save, reload, clearNote } = useGuardedWrite(load);
  const run = useCallback(
    (write, saved, scope, onSaved) => save(write, { saved, scope, onSaved }),
    [save],
  );
  const openSheet = (next) => { clearNote(); setSheet(next); };

  const d = state.data;
  const items = Array.isArray(d?.items) ? d.items : [];
  const { profiles, ruleRows: visible } = fitView(items, view);

  // Hoisted so the gate branch below and the live row draw the SAME row.
  // With nothing loaded the export renders disabled and says so itself,
  // which is what makes a header row over an unreadable store honest.
  const handlers = {
    passReasons: () => { clearNote(); setShowingPasses(true); },
  };
  const rowActions = partnerZoneActions('offers/audience-fit', { handlers, view: { header: ['Profile or exclusion', 'Kind', 'Signal', 'Why', 'Referred to', 'In use'], rows: visible, cells: (r) => [r.kind === 'budget_floor' && r.floor_cents != null ? moneyCents(r.floor_cents) : r.value, r.kind, r.signal, r.statement, r.referred_to, r.is_active] } });

  // NOT AN EARLY RETURN ANY MORE. This was
  //   `if (isNoPartnerProfile(state.error)) return <UnlinkedZone … />;`
  // which drew a card INSTEAD of the zone — on twelve zones, so an admin
  // reading this workspace saw twelve copies of one card and never a page.
  // `ZoneBody` takes the line as a `notice` above its states, and the zone
  // renders underneath in its own empty state, which is also the state that
  // says what this zone holds. The gate itself is untouched: the read still
  // 400s, so `isEmpty` is forced rather than inferred from rows that never
  // arrived, and `error` is cleared so the shared "This did not load" card —
  // the exact confusion `isNoPartnerProfile` exists to prevent — cannot fire.
  const unlinked = isNoPartnerProfile(state.error);

  return (
    <>
      {/* Hoisted out of `ZoneBody`, and the export takes `visible`, the rows the chip selects: a file that
          did not match the chip on screen would be its own small untruth. */}
      {/* ACTIONS YES, FILTERS NO, when the account cannot read the store.
          An action states what the zone DOES and an export over nothing
          loaded renders disabled and says so; a filter chip is a claim about
          ROWS, and a selectable `Published` over a store this account cannot
          read is the "an empty set reads as an answer" failure
          `zoneFilterBuilder.js` exists to prevent, reached from a new
          direction. `profile_zone_actions.test.mjs` asserts both halves. */}
      <ZoneToolbar
        className="mb-3"
        role="partner"
        filters={unlinked ? [] : partnerZoneFilters('offers/audience-fit', { value: view, onChange: setView })}
        actions={rowActions}
      />
      {/* THE EDITOR IS NOT A CHILD OF `ZoneBody` (#4688): with no rows `ZoneBody`
          draws only its empty state, so a form among its children never
          mounted for the first rule. Mounted by `sheet` alone, it also
          survives a refresh and an unreadable list. */}
      {sheet && (
        <FitRuleSheet
          key={sheet?.rule?.id ?? 'new'}
          initial={sheet?.rule || null}
          busy={busy}
          note={note}
          scope={sheet?.rule ? `rule:${sheet?.rule.id}` : 'new'}
          onClose={() => setSheet(null)}
          onSubmit={(data) => (sheet?.rule
            ? run(() => api.updatePartnerFitRule(sheet?.rule.id, data), 'Saved.', `rule:${sheet?.rule.id}`, () => setSheet(null))
            : run(() => api.createPartnerFitRule(data), 'Rule added.', 'new', () => setSheet(null)))}
          onDelete={sheet?.rule
            ? () => run(() => api.deletePartnerFitRule(sheet?.rule.id), 'Rule deleted.', `rule:${sheet?.rule.id}`, () => setSheet(null))
            : null}
        />
      )}
      <WriteNote note={zoneNote(note)} busy={busy} onReload={reload} />
      <ZoneBody
        loading={state.loading}
        error={unlinked ? null : state.error}
        onRetry={reload}
        notice={unlinked ? <NoPartnerProfile /> : null}
        isEmpty={unlinked || (items.length === 0)}
        empty={(
          /* OF-10: an empty state names the commercial outcome and offers one action. */
          <NothingYet
            title="Tell Pipeline who your firm is for"
            body={
              'Fit rules rank your leads and give a founder who isn’t a fit a reason '
              + 'and somewhere to go. Nothing is declined for you.'
            }
            action={(
              <button type="button" className={buttonClass} onClick={() => openSheet({})}>
                Add your first fit rule
              </button>
            )}
          />
        )}
      >
        <div className="space-y-6">
          <ZoneHeading
            title="Audience fit"
            blurb="Who your firm is for, and what to say when someone isn’t."
            action={(
              <button type="button" className={buttonClass} onClick={() => openSheet({})}>
                + Add fit rule
              </button>
            )}
          />

          {/* OF-04's note: what the rules do downstream, and what they do not.
              The longer account opens from "How rules affect ranking" rather
              than being printed on the page (OF-10). */}
          <div className="flex flex-wrap items-start gap-3 rounded-[10px] border border-cyan-200 bg-cyan-50/50 p-3 text-[13px] leading-relaxed text-gray-700 dark:border-cyan-900 dark:bg-cyan-950/20 dark:text-gray-300" data-testid="fit-rank-note">
            <span aria-hidden="true" className="font-extrabold text-cyan-700 dark:text-cyan-300">i</span>
            <div className="min-w-0 flex-1">
              Pipeline uses these rules to rank and explain your leads. They never reject a founder on their own.
              <details className="mt-1">
                <summary className="cursor-pointer text-[12.5px] font-semibold text-cyan-800 dark:text-cyan-300">How rules affect ranking</summary>
                <p className="mt-1 text-[12.5px]">
                  {d?.enforcement_note
                    || 'Pipeline reads your active rules to score leads and to leave a lead that matches a declined sector or an absent capability out of its ranking. Nothing is auto-declined: an excluded lead stays on Leads, and passing on it is still your click.'}
                </p>
              </details>
            </div>
          </div>

          {items.length > 0 && visible.length === 0 && (
            <p className="text-[12px] text-axal-muted">
              No profile is graded {SIGNAL_LABEL[view]?.toLowerCase() || view}.{' '}
              {items.length} rule{items.length === 1 ? '' : 's'} recorded in total,{' '}
              {profiles.length} of them profiles.
            </p>
          )}
          {visible.length > 0 && (
            <FitRulesTable rows={visible.map((r) => ({ r, v: fitRuleRow(r, moneyCents) }))} onEdit={(rule) => openSheet({ rule })} />
          )}

          <ZoneDraft
            surface="offers/audience-fit"
            railOption="draft:pass-reasons"
            label="Draft · pass reasons"
            accept="Accept drafts"
            run="Draft the passes"
            foot="Reasons read from the fit rules."
            empty="A short pass note per stated exclusion — the reason, and where you named one, the firm better suited."
            nothingToDraft="No exclusion is written yet, so there is no reason to draft from."
          />

          {(d?.unstated_count ?? 0) > 0 && (
            <p className="text-[12.5px] leading-relaxed text-amber-700 dark:text-amber-400">
              {d.unstated_count} rule{d.unstated_count === 1 ? '' : 's'} carr
              {d.unstated_count === 1 ? 'ies' : 'y'} no sentence. A rule without one
              still describes the firm, but it cannot be quoted — so a pass citing
              it lands as the silence this zone exists to replace.
            </p>
          )}

          {/* NO FIT SCORE, AND NO PARAGRAPH ABOUT ITS ABSENCE. The canvas
                puts a percentage beside each lead. Scoring a founder’s need
                against these rules would need the need to carry a budget and a
                sector in a comparable shape, and `founder_needs` carries
                free-text budget bounds and a single category that does not line
                up with the sectors a firm would name — a number over those
                inputs would be a guess wearing a decimal point. Not drawing it
                was right; explaining the canvas underneath was not. */}
          {showingPasses && (
            <PassReasons rules={items.filter((r) => r.is_active && r.kind !== 'best_fit')}
              onClose={() => setShowingPasses(false)} />
          )}

          <StatedLimit title="What these rules are used for, and what they are not">
            <p>
              <strong>Pipeline scores and ranks leads with these rules; it never declines one for you.</strong>{' '}
              {d?.enforcement_note
                || 'Pipeline reads your active rules to score leads and to leave a lead that matches a declined sector or an absent capability out of its ranking. Nothing is auto-declined: an excluded lead stays on Leads, and passing on it is still your click.'}{' '}
              A lead below your floor, or one that matches a declined sector, still appears on{' '}
              <Link to="/pipeline/leads" className="text-amber-700 underline">Leads</Link>{' '}
              and it is still your click that passes on it — which is what the
              workspace rail promises, and this zone does not quietly break.
            </p>
            {Array.isArray(d?.used_for) && d.used_for.length > 0 && (
              <ul className="mt-2 list-disc pl-5">
                {d.used_for.map((line) => <li key={line}>{line}</li>)}
              </ul>
            )}
            {Array.isArray(d?.not_used_for) && d.not_used_for.length > 0 && (
              <ul className="mt-2 list-disc pl-5">
                {d.not_used_for.map((line) => <li key={line}>{line}</li>)}
              </ul>
            )}
          </StatedLimit>
        </div>
      </ZoneBody>
    </>
  );
}
