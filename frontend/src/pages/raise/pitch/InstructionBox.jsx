import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { deckAssistApi } from '../../../lib/api/deckAssist';
import { railProposalsApi } from '../../../lib/api/railProposals';
import { railPressHeaders } from '../../../lib/railPage';
import { reportError } from '../../../lib/log';
import { useRailOption } from '../../../ui/railCrumbs';
import { aiTokens, refusalOf } from './newDeckModel';
import { deckInstructApi } from '../../../lib/api/deckInstruct';
import { deckAreasApi } from '../../../lib/api/deckAreas';
import AreaResults from './AreaResults';
import { areaRunResults } from './areaRunResults';
import { areaLabel } from './deckV2Model';
import { areaKind } from './gridSelection';
import { updateBlock } from './editorModel';
import { INSTRUCTION_MAX, textBody } from './deckAssistModel';
import { COST, EYE, GHOST, MUTED, PRIMARY, RefusalLine, TextProposal } from './AssistParts';
import {
  FIGURE_REFUSAL, INSTRUCTION_OFF, ONE_UNDO, RETRY, SEVERAL_RUNNING, SEVERAL_STILL, TYPED_OPTIONS, VARIANT_CHOICES,
  instructionField, instructionPlan, labelResults, severalBody, severalHold, severalRefusals, stillRunning, typedChange,
} from './instructionModel';

/** How often, and for how long, the box reads a several-area run until every area has settled. */
const POLL_MS = 1500;
const POLL_FOR_MS = 3 * 60_000;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * D1604 (#3716, pd19, pd20) — the instruction box, version 2: the one place a
 * founder types to Eadwyn, anchored to the selection on The Grid (the
 * owner's rule: typed instructions live only in the deck editor, scoped to
 * the selection; nothing on New deck, in the header's Ask or in the rail).
 *
 *   chips    one per selected area, "c1–7 × r2–6 · Body", each removable
 *   field    "Tell Eadwyn what to change in this area" (at most 300
 *            characters); "warmer" or "in French" replace v1's Change tone
 *            and Translate buttons: words that are only a tone or a
 *            language run the Worker's `tone` or `translate` under
 *            deck:tone or deck:translate (`typedChange`)
 *   Send     one filled text area: the quote first (`deck_assist`, action
 *            `ask`, rail option deck:rewrite), "Holds up to $x · you pay what
 *            it uses", then Run; what comes back is a proposal, placed only
 *            on Accept, held until Save, one undo step (D1515: undoing it
 *            says the run is still charged). Enter is Send, and neither
 *            sends again while a quote is read or a run is in flight
 *            several areas (D1527, #3795, pd19 task 1): one quote for the
 *            selection (`deckInstructApi.quote`, D1521) with its hold and
 *            1–3 variants, then Run (`deckInstructApi.run`, keyed once per
 *            press); the box reads the batch until every area settles and
 *            draws one proposal per area with before and after, the
 *            model's label and each variant (`AreaResults`). Accept places
 *            one; Accept all places one per area as ONE undo step (D1515's
 *            group); Retry sends the words again for a new quote
 *   figures  an instruction that names a figure is refused before any quote
 *            ("Nothing was charged"); the Worker refuses it too
 *
 * `sheet` draws it inside the phone's Ask sheet (pd9k): pinned to the
 * sheet's bottom, full width, 44 px targets, above the safe area.
 */
export default function InstructionBox({
  deckId, cardIndex, card, areas = [], items = [], aiOn = true, readOnly = false, sheet = false, model = null,
  onRemove, onPlace, onProposals, onTokens = null, cards = null, sleep = pause,
}) {
  const [text, setText] = useState('');
  const [step, setStep] = useState(null); // { kind: 'quote'|'running'|'refused'|'later', … }
  const [proposal, setProposal] = useState(null);
  const [deciding, setDeciding] = useState(false);
  const [placeError, setPlaceError] = useState(null);
  const [variants, setVariants] = useState(1);
  const [results, setResults] = useState(null); // D1527: the several-area run's proposals, as AreaResults draws them
  const plan = instructionPlan(areas, { aiOn, items });
  // The run in flight names its own option: an instruction, a tone or a language (`TYPED_OPTIONS`).
  useRailOption(step?.kind === 'running' ? ({ ask: 'deck:rewrite', tone: 'deck:tone', translate: 'deck:translate' })[step.change.action] ?? null
    : step?.kind === 'several-running' ? 'deck:rewrite' : null, 'Send');
  const ids = areas.map((a) => a.id).join('|');
  useEffect(() => { setStep(null); setProposal(null); setPlaceError(null); setResults(null); }, [ids]);

  if (readOnly || !areas.length) return null;
  const body = (change) => textBody(change.action, { id: plan.block.id, kind: plan.block.kind, text: plan.block.text }, { ...change, instruction: text });
  // A quote being read, a run in flight, or a decision being recorded: Send (and Enter) waits.
  const waiting = step?.kind === 'quote' || step?.kind === 'running' || step?.kind === 'several-quote' || step?.kind === 'several-running' || deciding;

  const send = () => {
    const words = text.trim();
    if (!words || waiting || plan.kind === 'off' || plan.kind === 'refused') return;
    setProposal(null); setPlaceError(null);
    // A figure is refused here, before anything is quoted or held.
    if (instructionField(words).figure) { setStep({ kind: 'refused', refusal: { message: FIGURE_REFUSAL } }); return; }
    if (plan.kind === 'several') {
      // D1527: one quote for the whole selection; nothing runs until Run.
      const sent = severalBody({ cardIndex, areas, instruction: words, variants });
      setResults(null);
      setStep({ kind: 'several-quote', quote: null, body: sent });
      deckInstructApi.quote(deckId, sent).then(
        (q) => setStep((s) => (s?.kind === 'several-quote' && s.body === sent ? { ...s, quote: q } : s)),
        (e) => {
          const refusal = refusalOf(e);
          if (refusal?.topUp) onTokens?.();
          setStep((s) => (s?.kind === 'several-quote' && s.body === sent ? { kind: 'refused', refusal } : s));
        },
      );
      return;
    }
    const change = typedChange(words);
    const sent = body(change);
    setStep({ kind: 'quote', quote: null, change, body: sent });
    deckAssistApi.quote(deckId, cardIndex, sent).then(
      (q) => setStep((s) => (s?.kind === 'quote' && s.body === sent ? { ...s, quote: q } : s)),
      (e) => {
        const refusal = refusalOf(e);
        if (refusal?.topUp) onTokens?.();
        setStep((s) => (s?.kind === 'quote' && s.body === sent ? { kind: 'refused', refusal } : s));
      },
    );
  };

  /** D1527: Run the quoted selection, then read the batch until every area has settled (or the box stops waiting). */
  const runSeveral = async () => {
    if (step?.kind !== 'several-quote' || !step.quote?.quote_uid) return;
    const sent = { ...step.body, quote_uid: step.quote.quote_uid };
    setStep({ kind: 'several-running' });
    try {
      const started = await deckInstructApi.run(deckId, sent);
      let run = { proposals: started?.proposals ?? [], refused: started?.refused ?? [] };
      const end = Date.now() + POLL_FOR_MS;
      while (started?.batch_uid && stillRunning(run.proposals) && Date.now() < end) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(POLL_MS);
        // eslint-disable-next-line no-await-in-loop
        const read = await deckAreasApi.proposals(deckId, started.batch_uid);
        run = { ...run, proposals: read?.proposals ?? run.proposals };
      }
      const { results: shaped } = areaRunResults(deckId, run);
      setResults({ list: labelResults(shaped, areas, areaKind), still: stillRunning(run.proposals) });
      setStep(null);
      onProposals?.();
    } catch (e) {
      const refusal = refusalOf(e);
      if (refusal?.topUp) onTokens?.();
      setStep({ kind: 'refused', refusal }); reportError('pitch-instruction:several', e);
    }
  };

  const run = () => {
    if (step?.kind !== 'quote' || !step.quote) return;
    const { change, body: sent } = step;
    setStep({ kind: 'running', change });
    deckAssistApi.run(deckId, cardIndex, sent, railPressHeaders(TYPED_OPTIONS[change.action])).then(
      (r) => {
        if (!r?.proposal?.uid) { setStep({ kind: 'refused', refusal: { message: 'Eadwyn returned nothing to place. Nothing was placed.' } }); return; }
        setStep(null);
        setProposal({ uid: r.proposal.uid, blockId: plan.block.id, before: String(r.before ?? plan.block.text ?? ''), after: String(r.after ?? ''), cost: r.cost?.charged_microusd == null ? null : aiTokens(r.cost.charged_microusd) });
        onProposals?.();
      },
      (e) => {
        const refusal = refusalOf(e);
        if (refusal?.topUp) onTokens?.();
        setStep({ kind: 'refused', refusal }); reportError('pitch-instruction:run', e);
      },
    );
  };

  const decide = (decision) => {
    if (decision === 'accept') {
      const now = (card?.blocks || []).find((b) => String(b.id) === String(proposal.blockId));
      if (!now || String(now.text ?? '') !== proposal.before) {
        setPlaceError({ message: 'This area changed since Eadwyn proposed this. Discard it and send again.' });
        return;
      }
    }
    setDeciding(true); setPlaceError(null);
    railProposalsApi.decide(proposal.uid, decision).then(
      () => {
        setDeciding(false);
        // D1515: one undo step, marked charged, so undoing it says "Still charged".
        if (decision === 'accept') onPlace?.(updateBlock(card, proposal.blockId, { text: proposal.after }), { charged: true, label: 'Accept' });
        setProposal(null); setText('');
        onProposals?.();
      },
      (e) => {
        setDeciding(false);
        if (decision === 'discard') { setProposal(null); onProposals?.(); return; }
        setPlaceError(refusalOf(e));
        reportError('pitch-instruction:decide', e);
      },
    );
  };

  const quote = step?.kind === 'quote' ? step.quote : null;
  const hold = quote?.ai ? aiTokens(quote.hold_microusd) : null;
  const disabled = plan.kind === 'off' || plan.kind === 'refused';
  const wrap = sheet
    ? 'sticky bottom-0 z-10 flex flex-col gap-2 border-t border-axal-hairline bg-white p-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,.08)] dark:border-gray-700 dark:bg-gray-900'
    : 'flex flex-col gap-2 rounded-[12px] border border-axal-lavender-edge bg-white p-3 dark:border-violet-800 dark:bg-gray-900';
  const tap = sheet ? 'min-h-[44px]' : '';
  return (
    <div className={wrap} role="group" aria-label="Instruction to Eadwyn" data-testid={sheet ? 'pitch-instruction-sheet' : 'pitch-instruction'}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={EYE}>Tell Eadwyn</span>
        {areas.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1 rounded-full border border-axal-lavender-edge bg-axal-lavender px-2 py-0.5 font-mono text-[10.5px] font-bold text-axal-violet dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300" data-testid={`pitch-instruction-chip-${a.id}`}>
            {[areaLabel(a.grid), areaKind(a)].filter(Boolean).join(' · ')}
            {onRemove ? (
              <button type="button" className={`${tap} inline-flex items-center`} aria-label={`Take ${areaLabel(a.grid) || 'this area'} out of the instruction`} onClick={() => onRemove(a.id)} data-testid={`pitch-instruction-chip-${a.id}-remove`}>
                <X size={11} aria-hidden="true" />
              </button>
            ) : null}
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input className={`w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 ${tap}`}
          value={text} maxLength={INSTRUCTION_MAX} placeholder={plan.placeholder} aria-label={plan.placeholder} disabled={disabled}
          onChange={(e) => { setText(e.target.value); if (step?.kind !== 'running') setStep(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault?.(); send(); } }}
          data-testid="pitch-instruction-field" />
        {plan.kind === 'several' ? (
          <select className={`${GHOST} ${tap}`} aria-label="Variants per area" value={variants} disabled={waiting}
            onChange={(e) => { setVariants(Number(e.target.value)); if (step?.kind === 'several-quote') setStep(null); }} data-testid="pitch-instruction-variants">
            {VARIANT_CHOICES.map((n) => <option key={n} value={n}>{n === 1 ? '1 variant' : `${n} variants`}</option>)}
          </select>
        ) : null}
        <button type="button" className={`${PRIMARY} ${tap}`} disabled={disabled || !text.trim() || waiting} onClick={send} data-testid="pitch-instruction-send">Send</button>
      </div>
      {plan.kind === 'off' ? <span className={MUTED} data-testid="pitch-instruction-off">{INSTRUCTION_OFF}</span> : null}
      {plan.kind === 'refused' ? <span className={MUTED} data-testid="pitch-instruction-why">{plan.why}</span> : null}
      {step?.kind === 'quote' ? (
        <span className="flex flex-wrap items-center gap-2" data-testid="pitch-instruction-quote">
          <span className={COST} data-testid="pitch-instruction-hold">
            {!quote ? 'Reading the cost…' : quote.ai === false ? (quote.message || 'Eadwyn cannot run this now.') : hold ? `Holds up to ${hold} · you pay what it uses` : 'Paid in AI tokens, charged to you when it runs.'}
          </span>
          <button type="button" className={`${PRIMARY} ${tap}`} disabled={!quote || quote.ai === false} onClick={run} data-testid="pitch-instruction-run">Run</button>
          <button type="button" className={`${GHOST} ${tap}`} onClick={() => setStep(null)}>Cancel</button>
        </span>
      ) : null}
      {step?.kind === 'running' ? <span className={MUTED} role="status">Eadwyn is changing the words…</span> : null}
      {step?.kind === 'several-quote' ? (
        <div className="flex flex-col gap-1.5" data-testid="pitch-instruction-several-quote">
          <span className="flex flex-wrap items-center gap-2">
            <span className={COST} data-testid="pitch-instruction-hold">{severalHold(step.quote, aiTokens)}</span>
            <button type="button" className={`${PRIMARY} ${tap}`} disabled={!step.quote?.quote_uid || severalHold(step.quote, aiTokens).startsWith('None')} onClick={runSeveral} data-testid="pitch-instruction-run">Run</button>
            <button type="button" className={`${GHOST} ${tap}`} onClick={() => setStep(null)}>Cancel</button>
          </span>
          {severalRefusals(step.quote, areas).map((r) => (
            <span key={r.key} className={MUTED} data-testid={`pitch-instruction-area-refused-${r.key}`}>{r.label}: {r.message}</span>
          ))}
        </div>
      ) : null}
      {step?.kind === 'several-running' ? <span className={MUTED} role="status" data-testid="pitch-instruction-several-running">{SEVERAL_RUNNING}</span> : null}
      {step?.kind === 'refused' ? <RefusalLine refusal={step.refusal} testId="pitch-instruction-refused" /> : null}
      {results ? (
        <div className="flex flex-col gap-2" data-testid="pitch-instruction-results">
          <AreaResults results={results.list} card={card} cards={cards} model={model} items={items} onPlace={onPlace} onProposals={onProposals} testId="pitch-instruction-areas" />
          {results.still ? <span className={MUTED} data-testid="pitch-instruction-still">{SEVERAL_STILL}</span> : null}
          <span className="flex flex-wrap items-center gap-2">
            <span className={`${MUTED} text-[11.5px]`}>{ONE_UNDO}</span>
            <button type="button" className={`${GHOST} ${tap}`} disabled={waiting} onClick={send} data-testid="pitch-instruction-retry">{RETRY}</button>
          </span>
        </div>
      ) : null}
      {proposal ? (
        <>
          <TextProposal proposal={proposal} busy={deciding} onAccept={() => decide('accept')} onDiscard={() => decide('discard')} testId="pitch-instruction-proposal" />
          <RefusalLine refusal={placeError} testId="pitch-instruction-place-error" />
        </>
      ) : null}
      {!sheet ? <span className={`${MUTED} text-[11.5px]`}>Typed instructions change only the selected area. Figures come from your records.</span> : null}
    </div>
  );
}
