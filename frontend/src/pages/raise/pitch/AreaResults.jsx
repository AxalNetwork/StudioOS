import React, { useRef, useState } from 'react';
import { railProposalsApi } from '../../../lib/api/railProposals';
import { DECK_REPORT_NOTE_MAX, DECK_REPORT_REASONS, deckReportsApi } from '../../../lib/api/deckReports';
import { deckImagesApi } from '../../../lib/api/deckImages';
import { reportError } from '../../../lib/log';
import { ACCEPT, ACCEPT_ALL, CHARGED_LINE, DISCARD } from './deckV2Model';
import { RESULTS_LINE, chargedLine, placeResult } from './areaLightboxModel';
import { aiTokens, refusalOf } from './newDeckModel';
import { NOT_RECORDED, cardUid } from './editorModel';
import { EYE, GHOST, INK, LAV, MUTED, PRIMARY, RefusalLine } from './AssistParts';
import { SourceChip } from './SourcesBoards';
import { chipOf } from './sourcesModel';
import { judge as judgeArea } from './deckV2Adapter';
import { rankedOf, rankGroups } from './areaRankModel';
import { diagramLayout } from './diagramLayout';
import DiagramView from './DiagramView';

const PILL = 'inline-flex items-center rounded-full border border-axal-lavender-edge bg-white px-2 py-0.5 font-mono text-[10px] font-bold text-axal-violet dark:border-violet-800 dark:bg-violet-950/60 dark:text-violet-300';

/** What each kind was checked for before it reached the founder (the Worker refuses the rest). */
const CHECKS = {
  text: 'Checked: no figure added to your words.',
  notes: 'Speaker notes · checked: no figure that is not on the card.',
  block: 'Checked: every series is bound to its record; no value was written by a model.',
  image: 'Checked: no real person and no figures in the picture.',
  metric: 'The value is the record’s, with its source and grade.',
  // D1542 (#3780): a generated diagram (the `grid_diagram` job).
  diagram: 'Checked: every number removed; drawn and fitted to its area in code.',
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
 *
 * D1525 (#3783, pd15): an area with two or three variants can be ranked.
 * "Rank the variants" reads the judge's quote (its model, of another family
 * than the writer's, and what it holds: input tokens only); Rank runs it, and
 * each variant then reads "Ranked n of m" with whether the checks agree.
 * Ranking never accepts: Accept stays the founder's. The judge's model is the
 * rail's (Vision and checks); there is no model control here.
 *
 * D1540 (#3791): a result Eadwyn proposed (one with a rail proposal uid) can
 * be reported, before or after it is decided: Report opens a reason and an
 * optional short note in place, and Send records it for HQ. A report refunds
 * nothing and changes nothing on the card.
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
  // D1525: each area's ranking, by its proposal: { step, quote?, value?, message? }.
  const [ranks, setRanks] = useState({});
  const groups = rankGroups(results);
  const setRank = (uid, next) => setRanks((s) => ({ ...s, [uid]: { ...(s[uid] || {}), ...next } }));
  const quoteRank = async (uid) => {
    setRank(uid, { step: 'quoting', message: null });
    const a = await judgeArea(uid);
    if (!a.available) return setRank(uid, { step: a.unreadable ? 'refused' : 'later', message: a.unreadable ? a.reason : null });
    if (!a.value?.ai) return setRank(uid, { step: 'refused', message: a.value?.message || 'The variants cannot be ranked.' });
    return setRank(uid, { step: 'quoted', quote: a.value });
  };
  const runRank = async (uid) => {
    setRank(uid, { step: 'ranking', message: null });
    const a = await judgeArea(uid, { run: true });
    if (!a.available) return setRank(uid, { step: a.unreadable ? 'refused' : 'later', message: a.unreadable ? a.reason : null });
    if (!a.value?.ranked) return setRank(uid, { step: 'refused', message: a.value?.message || 'The variants were not ranked.', value: a.value });
    return setRank(uid, { step: 'ranked', value: a.value });
  };
  // D1512: the area proposals already accepted here, so Accept all places one variant per area.
  const taken = useRef(new Set());

  // D1515: a placement is one undo step; Accept all's placements share one `group`, so they are one step together,
  // and a step that placed a charged run is marked so undoing it says "Still charged".
  const accept = async (r, group = null) => {
    const placed = placeResult(working.current, r, model);
    if (placed.error) return { error: { message: placed.error } };
    try {
      // D1512 (#3764): a variant of an area run decides itself through the area routes (its images too).
      if (r.decide) await r.decide('accept');
      else if (r.uid) await railProposalsApi.decide(r.uid, 'accept');
      else if (r.kind === 'image' && !r.local) await deckImagesApi.keep(r.imageUid, { use: 'content', alt: r.image?.alt || '' });
    } catch (e) {
      reportError('pitch-areas:accept', e);
      return { error: refusalOf(e) };
    }
    working.current = placed.card;
    placedLast.current = placed.card;
    // D1512: Accept is by the area, so the area's other variants are superseded.
    const siblings = r.proposalUid ? (results || []).filter((x) => x.proposalUid === r.proposalUid && x.key !== r.key).map((x) => x.key) : [];
    setState((s) => ({ ...s, ...Object.fromEntries(siblings.map((k) => [k, s[k] || 'superseded'])), [r.key]: 'accepted' }));
    taken.current.add(r.proposalUid);
    onPlace(placed.card, { charged: Boolean(r.charges), group, label: ACCEPT });
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
    const group = `accept-all:${Date.now()}`;
    for (const r of open) {
      // D1512: Accept all places one variant per area, the first still open.
      if (r.proposalUid && taken.current.has(r.proposalUid)) continue;
      // eslint-disable-next-line no-await-in-loop
      const out = await accept(r, group);
      if (out.error) { setError({ key: r.key, ...out.error }); break; }
    }
    setBusy(false);
    onProposals?.();
  };

  const discard = async (r) => {
    setBusy(true); setError(null);
    try {
      // D1512: discarding a variant discards the area's proposal only with its last open variant.
      const left = r.proposalUid ? open.filter((x) => x.proposalUid === r.proposalUid && x.key !== r.key) : [];
      if (r.decide) { if (!left.length) await r.decide('discard'); }
      else if (r.uid) await railProposalsApi.decide(r.uid, 'discard');
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
            {r.proposalUid && groups[r.proposalUid] && r.status === 'proposed' ? (
              <RankedLine line={rankedOf(ranks[r.proposalUid], r.variant, groups[r.proposalUid].of)} id={id} />
            ) : null}
            {r.status === 'refused' ? <RefusalLine refusal={refusalOf(r.error)} testId={`${id}-refused`} /> : null}
            {r.status === 'not_run' ? <span className={MUTED} data-testid={`${id}-not-run`}>{r.line}</span> : null}
            {r.status === 'proposed' ? <Body result={r} id={id} items={items} /> : null}
            {r.status === 'proposed' && !decided ? (
              <>
                <span className={MUTED}>{r.kind === 'block' && r.local ? CHECKS.metric : r.kind === 'block' && r.block?.kind === 'graphic' ? CHECKS.diagram : CHECKS[r.kind]}</span>
                <div className="flex gap-2">
                  <button type="button" className={PRIMARY} disabled={busy} onClick={() => one(r)} data-testid={`${id}-accept`}>{ACCEPT}</button>
                  <button type="button" className={GHOST} disabled={busy} onClick={() => discard(r)} data-testid={`${id}-discard`}>{DISCARD}</button>
                </div>
              </>
            ) : null}
            {decided ? <span className={`text-[12.5px] font-bold ${INK}`} data-testid={`${id}-decided`}>{decided === 'accepted' ? 'Placed on the card. Save writes the version.' : decided === 'superseded' ? 'Another variant was placed in this area.' : 'Discarded. Nothing was placed.'}</span> : null}
            {error?.key === r.key ? <RefusalLine refusal={error} testId={`${id}-error`} /> : null}
            {r.uid && (r.status === 'proposed' || decided) ? <ReportControl uid={r.uid} id={id} /> : null}
            {r.proposalUid && groups[r.proposalUid]?.lastKey === r.key ? (
              <RankControl uid={r.proposalUid} rank={ranks[r.proposalUid]} onQuote={quoteRank} onRank={runRank} onCancel={(uid) => setRank(uid, { step: null, quote: null })} id={`pitch-area-rank-${r.areaKey}`} />
            ) : null}
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

/** pd15's line under a variant: "Ranked 1 of 3" once ranked, greyed until then. */
function RankedLine({ line, id }) {
  return (
    <span className={`font-mono text-[10.5px] ${line.ranked ? `font-bold ${INK}` : 'text-axal-muted dark:text-gray-400'}`} data-testid={`${id}-ranked`} data-ranked={line.ranked ? 'true' : 'false'}>
      {line.text}
    </span>
  );
}

/** D1525: Rank the variants → the judge's quote → Rank. Never Accept. */
function RankControl({ uid, rank, onQuote, onRank, onCancel, id }) {
  const step = rank?.step ?? null;
  if (step === 'later') return <span className={MUTED} data-testid={`${id}-later`}>Ranking · Coming later</span>;
  if (step === 'ranked') {
    const v = rank.value;
    return (
      <span className={MUTED} data-testid={`${id}-done`}>
        Ranked by {v.model_label || 'the judge'}, blind. {v.panel?.line}{' '}
        {v.charged_microusd == null ? `Charged: ${NOT_RECORDED}.` : `Charged ${aiTokens(v.charged_microusd)}.`} Accept stays yours.
      </span>
    );
  }
  if (step === 'quoted') {
    const q = rank.quote;
    return (
      <span className="flex flex-wrap items-center gap-2" data-testid={`${id}-quote`}>
        <span className={MUTED}>{`Rank ${q.of} variants with ${q.model_label}, of another family than the writer's. Holds ${aiTokens(q.hold_microusd)}.`}</span>
        <button type="button" className={PRIMARY} onClick={() => onRank(uid)} data-testid={`${id}-run`}>Rank</button>
        <button type="button" className={GHOST} onClick={() => onCancel(uid)} data-testid={`${id}-cancel`}>Cancel</button>
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-1">
      <button type="button" className={`${GHOST} self-start`} disabled={step === 'quoting' || step === 'ranking'} onClick={() => onQuote(uid)} data-testid={`${id}-open`}>
        {step === 'ranking' ? 'Ranking…' : 'Rank the variants'}
      </button>
      {step === 'refused' && rank?.message ? <RefusalLine refusal={{ message: rank.message }} testId={`${id}-refused`} /> : null}
    </span>
  );
}

function Body({ result: r, id, items }) {
  if (r.kind === 'text' || r.kind === 'notes') {
    return (
      <span className="flex flex-col gap-1">
        {r.kind === 'notes' && !r.before ? null : <del className="text-[12.5px] text-axal-muted line-through dark:text-gray-400" data-testid={`${id}-before`}>{r.before}</del>}
        <span className={`rounded-[8px] bg-white/70 px-2 py-1.5 text-[13px] ${INK} dark:bg-violet-950/60`} data-testid={`${id}-after`}>{r.after}</span>
      </span>
    );
  }
  if (r.kind === 'image') {
    return <img src={r.image?.url} alt={r.image?.alt || ''} className="max-h-[140px] w-auto self-start rounded-[8px] object-cover" data-testid={`${id}-image`} />;
  }
  const b = r.block || {};
  // D1542 (#3780): a proposed diagram is drawn as it would sit on the card; nothing is placed until Accept.
  if (b.kind === 'graphic') {
    const layout = diagramLayout(b.diagram);
    if (!layout) return <span className={MUTED} data-testid={`${id}-body`}>This diagram cannot be drawn. Discard it.</span>;
    return (
      <span className="block h-[140px] w-full max-w-[320px] rounded-[8px] bg-white/70 p-1.5 dark:bg-violet-950/60" data-testid={`${id}-diagram`}>
        <DiagramView layout={layout} colours={{}} blockId={`${id}-d`} />
      </span>
    );
  }
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

/** D1540: the small Report control on one proposed result: a reason, an optional note, Send. */
export function ReportControl({ uid, id }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  if (sent) return <span className={MUTED} data-testid={`${id}-reported`}>Reported. HQ will look at it; nothing on the card changed.</span>;
  if (!open) {
    return <button type="button" className={`${MUTED} self-start underline`} onClick={() => setOpen(true)} data-testid={`${id}-report`}>Report this result</button>;
  }
  const send = async () => {
    setBusy(true); setError(null);
    try {
      await deckReportsApi.report(uid, { reason, note: note.trim() || undefined });
      setSent(true);
    } catch (e) {
      // Already reported is still reported.
      if (refusalOf(e)?.code === 'already_reported') setSent(true);
      else { reportError('pitch-areas:report', e); setError(refusalOf(e)); }
    } finally { setBusy(false); }
  };
  return (
    <span className="flex flex-col gap-1.5" data-testid={`${id}-report-form`}>
      <label className={MUTED}>
        What is wrong?{' '}
        <select value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} data-testid={`${id}-report-reason`}
          className="rounded-[6px] border border-axal-hairline bg-white px-1.5 py-0.5 text-[12.5px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
          <option value="">Pick a reason</option>
          {DECK_REPORT_REASONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </label>
      <input type="text" value={note} maxLength={DECK_REPORT_NOTE_MAX} onChange={(e) => setNote(e.target.value)} disabled={busy}
        placeholder="A short note (optional)" aria-label="A short note (optional)" data-testid={`${id}-report-note`}
        className="rounded-[6px] border border-axal-hairline bg-white px-2 py-1 text-[12.5px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
      <span className="flex gap-2">
        <button type="button" className={GHOST} disabled={busy || !reason} onClick={send} data-testid={`${id}-report-send`}>Send report</button>
        <button type="button" className={GHOST} disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      </span>
      {error ? <RefusalLine refusal={error} testId={`${id}-report-error`} /> : null}
    </span>
  );
}
