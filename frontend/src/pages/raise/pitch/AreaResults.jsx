import React, { useRef, useState } from 'react';
import { railProposalsApi } from '../../../lib/api/railProposals';
import { deckImagesApi } from '../../../lib/api/deckImages';
import { reportError } from '../../../lib/log';
import { ACCEPT, ACCEPT_ALL, CHARGED_LINE, DISCARD } from './deckV2Model';
import { RESULTS_LINE, chargedLine, placeResult } from './areaLightboxModel';
import { aiTokens, refusalOf } from './newDeckModel';
import { NOT_RECORDED, cardUid } from './editorModel';
import { EYE, GHOST, INK, LAV, MUTED, PRIMARY, RefusalLine } from './AssistParts';
import { SourceChip } from './SourcesBoards';
import { chipOf } from './sourcesModel';

const PILL = 'inline-flex items-center rounded-full border border-axal-lavender-edge bg-white px-2 py-0.5 font-mono text-[10px] font-bold text-axal-violet dark:border-violet-800 dark:bg-violet-950/60 dark:text-violet-300';

/** What each kind was checked for before it reached the founder (the Worker refuses the rest). */
const CHECKS = {
  text: 'Checked: no figure added to your words.',
  block: 'Checked: every series is bound to its record; no value was written by a model.',
  image: 'Checked: no real person and no figures in the picture.',
  metric: 'The value is the record’s, with its source and grade.',
};

/**
 * D1604 (#3716, pd15, pd9n) — what "Generate into N areas" proposed, one card
 * per area, each decided with Accept or Discard (the one set of verbs, §0
 * row 5), and Accept all for the batch.
 *
 *   Accept       places the proposal in its area on the card as it stands
 *                now (`placeResult`), records the decision (the rail
 *                proposal, or the image's keep), and only then shows it on
 *                the card. Nothing is a version until Save.
 *   Discard      releases it (the proposal discarded, the image discarded).
 *   Accept all   accepts each still waiting, in order; the first that cannot
 *                be placed stops the rest and says why.
 *
 * A refused area shows the Worker's sentence; one that did not run because an
 * area before it was refused says so, uncharged. The line under the cards is
 * what the runs charged and that what they did not use was released.
 *
 * A proposed figure carries its source and grade (`SourceChip`, from the
 * deck's sources `items`); a value, a grade or a source that is not recorded
 * says so, never a zero.
 */
export default function AreaResults({ results, card, cards = null, model, items = [], onPlace, onProposals, testId = 'pitch-area-results' }) {
  const [state, setState] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // D1500: the card these results were made for, by uid, read from the deck as
  // it is now. A reorder or a new selection mid-run never sends them elsewhere.
  const forUid = useRef(cardUid(card));
  const live = forUid.current && Array.isArray(cards) ? (cards.find((c) => cardUid(c) === forUid.current) ?? null) : card;
  // The card as this batch last left it: Accept all's next placement sees the one before.
  const working = useRef(live);
  const placedLast = useRef(null);
  if (live !== placedLast.current) working.current = live;

  const open = (results || []).filter((r) => r.status === 'proposed' && !state[r.key]);

  const accept = async (r) => {
    const placed = placeResult(working.current, r, model);
    if (placed.error) return { error: { message: placed.error } };
    try {
      if (r.uid) await railProposalsApi.decide(r.uid, 'accept');
      else if (r.kind === 'image' && !r.local) await deckImagesApi.keep(r.imageUid, { use: 'content', alt: r.image?.alt || '' });
    } catch (e) {
      reportError('pitch-areas:accept', e);
      return { error: refusalOf(e) };
    }
    working.current = placed.card;
    placedLast.current = placed.card;
    setState((s) => ({ ...s, [r.key]: 'accepted' }));
    onPlace(placed.card);
    return { ok: true };
  };

  const one = async (r) => {
    setBusy(true); setError(null);
    const out = await accept(r);
    setBusy(false);
    if (out.error) setError({ key: r.key, ...out.error });
    if (r.uid) onProposals?.();
  };

  const all = async () => {
    setBusy(true); setError(null);
    for (const r of open) {
      // eslint-disable-next-line no-await-in-loop
      const out = await accept(r);
      if (out.error) { setError({ key: r.key, ...out.error }); break; }
    }
    setBusy(false);
    onProposals?.();
  };

  const discard = async (r) => {
    setBusy(true); setError(null);
    try {
      if (r.uid) await railProposalsApi.decide(r.uid, 'discard');
      else if (r.kind === 'image' && !r.local) await deckImagesApi.discard(r.imageUid);
    } catch (e) {
      // A discard that could not be recorded is still not placed; the header's Ask still lists it.
      reportError('pitch-areas:discard', e);
    }
    setState((s) => ({ ...s, [r.key]: 'discarded' }));
    setBusy(false);
    if (r.uid) onProposals?.();
  };

  const money = chargedLine(results);
  return (
    <div className="flex flex-col gap-2.5" data-testid={testId}>
      <span className={MUTED}>{RESULTS_LINE}</span>
      {(results || []).map((r) => {
        const decided = state[r.key];
        const id = `pitch-area-result-${r.key}`;
        return (
          <div key={r.key} className={`${LAV} flex flex-col gap-2 p-3`} data-testid={id} data-state={decided || r.status}>
            <span className="flex flex-wrap items-center gap-2">
              <span className={EYE}>{r.label}{r.elementLabel ? ` · ${r.elementLabel}` : ''}</span>
              {r.status === 'proposed' && !decided ? (
                <span className={PILL} data-testid={`${id}-pill`}>
                  {['Proposed', r.modelName || (r.charges ? null : 'No model'), r.charges ? aiTokens(r.charged) : 'free'].filter(Boolean).join(' · ')}
                </span>
              ) : null}
            </span>
            {r.status === 'refused' ? <RefusalLine refusal={refusalOf(r.error)} testId={`${id}-refused`} /> : null}
            {r.status === 'not_run' ? <span className={MUTED} data-testid={`${id}-not-run`}>{r.line}</span> : null}
            {r.status === 'proposed' ? <Body result={r} id={id} items={items} /> : null}
            {r.status === 'proposed' && !decided ? (
              <>
                <span className={MUTED}>{r.kind === 'block' && r.local ? CHECKS.metric : CHECKS[r.kind]}</span>
                <div className="flex gap-2">
                  <button type="button" className={PRIMARY} disabled={busy} onClick={() => one(r)} data-testid={`${id}-accept`}>{ACCEPT}</button>
                  <button type="button" className={GHOST} disabled={busy} onClick={() => discard(r)} data-testid={`${id}-discard`}>{DISCARD}</button>
                </div>
              </>
            ) : null}
            {decided ? <span className={`text-[12.5px] font-bold ${INK}`} data-testid={`${id}-decided`}>{decided === 'accepted' ? 'Placed on the card. Save writes the version.' : 'Discarded. Nothing was placed.'}</span> : null}
            {error?.key === r.key ? <RefusalLine refusal={error} testId={`${id}-error`} /> : null}
          </div>
        );
      })}
      {open.length > 1 ? (
        <button type="button" className={`${PRIMARY} self-start`} disabled={busy} onClick={all} data-testid={`${testId}-accept-all`}>{ACCEPT_ALL}</button>
      ) : null}
      {money ? <span className={MUTED} data-testid={`${testId}-charged`}>{money} {CHARGED_LINE}</span> : null}
    </div>
  );
}

function Body({ result: r, id, items }) {
  if (r.kind === 'text') {
    return (
      <span className="flex flex-col gap-1">
        <del className="text-[12.5px] text-axal-muted line-through dark:text-gray-400" data-testid={`${id}-before`}>{r.before}</del>
        <span className={`rounded-[8px] bg-white/70 px-2 py-1.5 text-[13px] ${INK} dark:bg-violet-950/60`} data-testid={`${id}-after`}>{r.after}</span>
      </span>
    );
  }
  if (r.kind === 'image') {
    return <img src={r.image?.url} alt={r.image?.alt || ''} className="max-h-[140px] w-auto self-start rounded-[8px] object-cover" data-testid={`${id}-image`} />;
  }
  const b = r.block || {};
  if (b.kind === 'metric') {
    const item = (items || []).find((i) => i.source_key && i.source_key === b.binding?.source_key) || null;
    return (
      <span className="flex flex-col gap-1">
        <span className={`text-[13px] ${INK}`} data-testid={`${id}-body`}>{b.label} · {b.value ?? NOT_RECORDED} · {b.binding?.grade || NOT_RECORDED}</span>
        {chipOf(item) ? <SourceChip item={item} /> : <span className={`${MUTED} font-mono text-[10.5px]`} data-testid={`${id}-source`}>Source: {NOT_RECORDED}</span>}
      </span>
    );
  }
  const series = (b.series || []).map((s) => s.label).filter(Boolean).join(', ');
  return (
    <span className={`text-[13px] ${INK}`} data-testid={`${id}-body`}>
      {r.title ? `${r.title}: ` : ''}a {String(b.chart_type || 'chart').replace(/_/g, ' ')} of {series || 'your recorded figures'}.
    </span>
  );
}
