import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Lightbox } from '../../../ui';
import { deckAssistApi } from '../../../lib/api/deckAssist';
import { deckImagesApi } from '../../../lib/api/deckImages';
import { railPrefsApi } from '../../../lib/api/railPrefs';
import { railPressHeaders } from '../../../lib/railPage';
import { reportError } from '../../../lib/log';
import { useRailOption } from '../../../ui/railCrumbs';
import { aiTokens, refusalOf } from './newDeckModel';
import { ELEMENT_GROUPS, LATER, PEND, elementOnMain } from './deckV2Model';
import { SURFACES, areasGenerate } from './deckV2Adapter';
import { SourceChip } from './SourcesBoards';
import { CONSENT_LINE } from './imageModel';
import AreaResults from './AreaResults';
import {
  HEADLINE_WHY, NO_MODEL, RAIL_PAGE, SEQUENCE_LINE, TEXT_ELEMENTS, VARIANTS,
  batchMode, cardFigures, changesFor, charged, defaultElement, holdLine, holdOf, imageBlock, metricBlock, modelChip, rowLabel, rowPlan, runSequence, runnable, validLine, variantWhy,
} from './areaLightboxModel';
import { COST, EYE, FIELD, GHOST, INK, MUTED, PRIMARY, RefusalLine } from './AssistParts';

const CHIP = 'inline-flex items-center gap-1 rounded-full border border-axal-hairline bg-axal-ground px-2 py-0.5 font-mono text-[10.5px] text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400';
const SEG_ON = 'min-h-[30px] rounded-[7px] bg-white px-2.5 text-[12px] font-bold text-axal-ink shadow-sm dark:bg-gray-800 dark:text-gray-100';
const SEG_OFF = 'min-h-[30px] rounded-[7px] px-2.5 text-[12px] font-semibold text-axal-muted hover:text-axal-ink disabled:cursor-not-allowed dark:text-gray-400 dark:hover:text-gray-100';
const ROW = 'flex flex-col gap-2 rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-700 dark:bg-gray-900';

const ELEMENT_LABEL = Object.fromEntries(ELEMENT_GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label])));

/**
 * D1604 (#3716, pd4, pd14, pd31 inset, pd9k sheet) — "Generate into N areas",
 * opened by the selection's Ask on The Grid.
 *
 * One row per selected area: its label and coordinates, the element picker
 * (pd4 PICK's eight groups; an element whose route is not on main is greyed
 * "Coming later", titled with the adapter's reason, and three carry "(pending
 * owner)"), where it comes from (a source chip), and the model chip, read-only
 * text from the AIRail's own read: "[Model] · [price] per variant · set in
 * the AIRail", or "No model · free". The model is picked in the AIRail only.
 *
 * What runs on main (`areaLightboxModel.rowPlan`): a filled text area's words
 * (`deck_assist`, rewrite, shorten, expand, and a Title's headline; tone and
 * language are typed in the instruction box); a chart, table
 * or timeline from the records (`deck_assist`); a generated photo or
 * illustration (`deck_images`); a recorded figure as a bound tile and an
 * uploaded image, both free. Video, audio, a link, a founder's quote and the
 * team grid open the editor's own dialogs. Words for an empty area, variants
 * 2 and 3, and the elements of later issues answer through `deckV2Adapter.js`.
 *
 * Every run is quoted first: one area shows its hold; several areas run one
 * after another on main, each its own charge, so the footer shows their sum
 * "across N runs", and a refusal stops the rest. When #3764 / #3766 merge,
 * `batchMode` turns to the one batch with one hold, and nothing here changes.
 * What comes back are proposals (`AreaResults.jsx`): nothing is on the card
 * until Accept. With AI paused while it is open, only the free rows run.
 *
 * Keyboard: the element picker is a listbox with a roving tabindex (the
 * arrows move between the elements that can be picked, Home and End jump,
 * Enter or Space picks, Escape closes, and focus returns to the row's
 * element button); the variant count is a radiogroup the arrows move along.
 *
 * `instruction` is the phone's sheet (pd9k): the instruction box, drawn at
 * the bottom of the same sheet.
 */
export default function AreaLightbox({
  deckId, cardIndex, card, areas, model, items = [], aiOn = true,
  onPlace, onProposals, onClose, onDialog, onImageOptions, instruction = null,
}) {
  const [rows, setRows] = useState(() => (areas || []).map((a) => ({ key: a.id, area: a, element: defaultElement(a), choice: {} })));
  const [picker, setPicker] = useState(null);
  const [quotes, setQuotes] = useState({});
  const [rails, setRails] = useState({});
  const [variants, setVariants] = useState(1);
  const [busy, setBusy] = useState(null);
  const [results, setResults] = useState(null);
  const mode = batchMode();

  const plans = useMemo(() => rows.map((r) => ({ ...r, plan: rowPlan({ area: r.area, element: r.element, card, cardIndex, items, choice: r.choice }) })),
    [rows, card, cardIndex, items]);
  // The run in flight names its own option to the rail (each area's, one after another).
  useRailOption(busy ? ({
    rewrite: 'deck:rewrite', shorten: 'deck:shorten', expand: 'deck:expand', headline: 'deck:rewrite',
    chart: 'deck:chart', table: 'deck:table', timeline: 'deck:timeline', image: 'deck:image',
  })[busy.action] ?? null : null, 'Generate');

  // Each charged row is quoted as its plan settles; a quote runs nothing and charges nothing.
  const quoteKeys = plans.filter((r) => charged(r.plan)).map((r) => `${r.key}|${r.plan.run}|${JSON.stringify(r.plan.body)}`).join('\n');
  useEffect(() => {
    if (!aiOn) return undefined;
    let live = true;
    for (const r of plans) {
      if (!charged(r.plan)) continue;
      const sig = `${r.plan.run}|${JSON.stringify(r.plan.body)}`;
      setQuotes((q) => ({ ...q, [r.key]: { sig, status: 'loading' } }));
      const ask = r.plan.run === 'image' ? deckImagesApi.quote(deckId, r.plan.body) : deckAssistApi.quote(deckId, cardIndex, r.plan.body);
      ask.then(
        (data) => { if (live) setQuotes((q) => ({ ...q, [r.key]: { sig, status: 'ok', data } })); },
        (e) => { if (live) setQuotes((q) => ({ ...q, [r.key]: { sig, status: 'error', refusal: refusalOf(e) } })); },
      );
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKeys, aiOn, deckId, cardIndex]);

  // The model chip reads the AIRail's own row for each option in use, once.
  // A read in flight is the dialog's, not the effect run's: when the options
  // change before it answers, its answer still lands (only unmount drops it).
  const options = [...new Set(plans.filter((r) => charged(r.plan)).map((r) => r.plan.option))].sort().join(',');
  const asked = useRef(new Set());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    for (const option of options ? options.split(',') : []) {
      if (asked.current.has(option)) continue;
      asked.current.add(option);
      setRails((m) => ({ ...m, [option]: { status: 'loading' } }));
      railPrefsApi.page(RAIL_PAGE, option).then(
        (data) => { if (mounted.current) setRails((m) => ({ ...m, [option]: { status: 'ok', data } })); },
        () => { if (mounted.current) setRails((m) => ({ ...m, [option]: { status: 'error' } })); },
      );
    }
  }, [options]);

  const set = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const choose = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, choice: { ...r.choice, ...patch } } : r)));

  // AI paused while the dialog is open: the free rows (a recorded figure, an upload) still run.
  const ready = plans.filter((r) => runnable(r.plan) && (aiOn || !charged(r.plan)));
  const held = aiOn ? [] : plans.filter((r) => runnable(r.plan) && charged(r.plan));
  const paid = ready.filter((r) => charged(r.plan));
  const quoteOf = (r) => {
    const q = quotes[r.key];
    return q && q.sig === `${r.plan.run}|${JSON.stringify(r.plan.body)}` ? q : null;
  };
  const paidQuotes = paid.map((r) => quoteOf(r));
  const quoteRefusal = paidQuotes.find((q) => q?.status === 'error')?.refusal
    || paidQuotes.map((q) => q?.data).find((d) => d?.ai === false) || null;
  const blocked = paid.length > 0 && paidQuotes.some((q) => q?.status !== 'ok' || holdOf(q.data) == null);
  const hold = paid.length ? holdLine(paidQuotes.map((q) => q?.data)) : null;
  const valid = validLine(paidQuotes.map((q) => q?.data));
  const modelName = (option) => {
    const m = rails[option]?.status === 'ok' ? rails[option].data : null;
    const models = Array.isArray(m?.models) ? m.models : [];
    return (models.find((x) => x.id === m?.pick) || models[0])?.name || null;
  };

  const runOne = async ({ plan, choice }) => {
    setBusy({ action: plan.run === 'image' ? 'image' : plan.action || plan.run });
    if (plan.run === 'assist') {
      const r = await deckAssistApi.run(deckId, cardIndex, plan.body, railPressHeaders(plan.option));
      if (!r?.proposal?.uid) throw new Error('Eadwyn returned nothing to place. Nothing was placed.');
      const base = { uid: r.proposal.uid, charged: r.cost?.charged_microusd ?? null, charges: true, modelName: modelName(plan.option) };
      if (r.block) return { ...base, kind: 'block', block: r.block, title: r.title || null };
      return { ...base, kind: 'text', before: String(r.before ?? plan.body.text ?? ''), after: String(r.after ?? '') };
    }
    if (plan.run === 'image') {
      const r = await deckImagesApi.generate(deckId, plan.body, railPressHeaders(plan.option));
      const image = (r?.images || [])[0];
      if (!image?.uid) throw new Error('Eadwyn could not draw the image. Nothing was placed.');
      return { kind: 'image', imageUid: image.uid, image, block: imageBlock(image), charged: image.charged_microusd ?? null, charges: true, modelName: image.model_label || modelName(plan.option) };
    }
    if (plan.run === 'metric') return { kind: 'block', block: metricBlock(plan.item), local: true };
    // An upload is stored as the venture's image at once; the card takes it only on Accept.
    const r = await deckImagesApi.upload(deckId, plan.file, { use: 'content', card: cardIndex, alt: choice.alt || '', ...(choice.person ? { shows_person: true, consent: true } : {}) });
    if (!r?.image?.uid) throw new Error('The image could not be stored. Nothing was placed.');
    return { kind: 'image', imageUid: r.image.uid, image: r.image, block: imageBlock(r.image, 'photo'), local: true };
  };

  const generate = async () => {
    const list = ready.map((r) => ({ ...r }));
    let out;
    if (mode === 'batch') {
      // #3764 / #3766: one quote and one hold for every area. The adapter answers unavailable on main.
      const a = await areasGenerate({ deckId, card: cardIndex, areas: list.map((r) => ({ id: r.key, grid: r.area.grid, element: r.element })), variants });
      out = a?.available ? { results: a.value?.results || [], refusal: null } : await runSequence(list, runOne);
    } else {
      out = await runSequence(list, runOne);
    }
    setBusy(null);
    const byKey = new Map(list.map((r) => [r.key, r]));
    setResults(out.results.map((res) => {
      const r = byKey.get(res.key);
      const i = rows.findIndex((x) => x.key === res.key);
      return { ...res, area: r.area, label: rowLabel(r.area, i), elementLabel: ELEMENT_LABEL[r.element] || null };
    }));
    if (out.refusal) reportError('pitch-areas:run', out.refusal.error);
    if (list.some((r) => charged(r.plan))) onProposals?.();
  };

  const n = rows.length;
  const title = `Generate into ${n} area${n === 1 ? '' : 's'}`;
  const footer = results ? (
    <div className="flex justify-end"><button type="button" className={GHOST} onClick={onClose} data-testid="pitch-areas-close">Close</button></div>
  ) : (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className={`${COST} mr-auto`} data-testid="pitch-areas-hold">
        {held.length ? (ready.length ? 'AI assistance is off on this page. Free elements still place; the rest wait until it is back on.' : 'AI assistance is off on this page. Nothing here runs until it is back on.')
          : !paid.length ? (ready.length ? NO_MODEL : 'Nothing here runs yet.')
            : hold || (quoteRefusal ? (quoteRefusal.message || 'Eadwyn cannot run this now.') : 'Reading the cost…')}
        {hold && valid ? ` · ${valid}` : ''}
      </span>
      <button type="button" className={GHOST} onClick={onClose} disabled={Boolean(busy)}>Cancel</button>
      <button type="button" className={PRIMARY} onClick={generate} disabled={Boolean(busy) || !ready.length || blocked} data-testid="pitch-areas-generate">
        {busy ? 'Generating…' : 'Generate'}
      </button>
    </div>
  );

  return (
    <Lightbox label={title} title={title} width={680} onClose={() => !busy && onClose()} testId="pitch-areas" footer={footer}>
      {results ? (
        <AreaResults results={results} card={card} model={model} items={items} onPlace={onPlace} onProposals={onProposals} />
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={EYE}>Variants per area</span>
            <Segmented label="Variants per area" value={variants} onPick={setVariants} testId="pitch-areas-variants"
              options={VARIANTS.map((v) => { const why = variantWhy(v, mode); return { id: v, label: `${v}${why ? ` · ${LATER}` : ''}`, why }; })} />
          </div>
          {ready.length > 1 && mode === 'sequence' ? <span className={MUTED} data-testid="pitch-areas-sequence">{SEQUENCE_LINE}</span> : null}
          {quoteRefusal?.topUp ? <RefusalLine refusal={quoteRefusal} testId="pitch-areas-refusal" /> : null}
          {plans.map((r, i) => (
            <AreaRow key={r.key} row={r} index={i} items={items} card={card} quote={quoteOf(r)} several={rows.length > 1} canDialog={Boolean(onDialog)}
              chip={charged(r.plan) ? modelChip(rails[r.plan.option]?.status === 'ok' ? rails[r.plan.option].data : null) : NO_MODEL}
              open={picker === r.key} onPicker={(o) => setPicker(o ? r.key : null)}
              onElement={(element) => { set(r.key, { element }); setPicker(null); }}
              onChoice={(patch) => choose(r.key, patch)}
              onDialog={() => onDialog?.(r.plan, r.area)}
              onImageOptions={onImageOptions ? () => onImageOptions(r.area) : null} />
          ))}
          {instruction}
        </div>
      )}
    </Lightbox>
  );
}

function AreaRow({ row, index, items, card, quote, several, canDialog, chip, open, onPicker, onElement, onChoice, onDialog, onImageOptions }) {
  const trigger = useRef(null);
  const { key, area, element, choice, plan } = row;
  const id = `pitch-areas-row-${key}`;
  const recorded = items.filter((i) => i.state === 'recorded');
  const figure = recorded.find((i) => i.source_key === choice.figure) || null;
  const source = plan.run === 'metric' ? (figure ? <SourceChip item={figure} /> : '▤ From your recorded figures')
    : TEXT_ELEMENTS.includes(element) ? '▤ From this area’s words'
      : plan.run === 'image' ? '▤ From this card’s words'
        : plan.run === 'upload' ? '▤ From your files'
          : plan.run === 'assist' ? '▤ From your records' : null;
  return (
    <div className={ROW} data-testid={id}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${EYE} text-axal-violet dark:text-violet-300`}>{rowLabel(area, index)}</span>
        <span className="relative">
          <button ref={trigger} type="button" className={`${GHOST} min-h-[30px]`} aria-haspopup="listbox" aria-expanded={open}
            aria-label={`Element for area ${index + 1}: ${ELEMENT_LABEL[element] || element}`} onClick={() => onPicker(!open)}
            onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault?.(); onPicker(true); } }}
            data-testid={`${id}-element`}>
            {ELEMENT_LABEL[element] || element} <ChevronDown size={13} aria-hidden="true" />
          </button>
          {open ? (
            <ElementPicker value={element} id={id}
              onPick={(el) => { onElement(el); trigger.current?.focus?.(); }}
              onClose={() => { onPicker(false); trigger.current?.focus?.(); }} />
          ) : null}
        </span>
        <span className={CHIP} data-testid={`${id}-model`}>{chip}</span>
      </div>
      {source ? <span className={`${MUTED} font-mono text-[11px]`} data-testid={`${id}-source`}>{source}</span> : null}

      {plan.run === 'assist' && TEXT_ELEMENTS.includes(element) ? (
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="How Eadwyn changes the words" value={plan.action} onPick={(change) => onChoice({ change })} testId={`${id}-change`}
            options={changesFor(element).map((c) => ({ id: c.action, label: c.label, why: c.action === 'headline' && !cardFigures(card, items).length ? HEADLINE_WHY : null }))} />
          <span className={`${MUTED} text-[11.5px]`}>Another tone or language: type it in the instruction box (“warmer”, “in French”).</span>
        </div>
      ) : null}
      {plan.run === 'metric' ? (
        <select className={FIELD} aria-label="Figure" value={choice.figure || ''} onChange={(e) => onChoice({ figure: e.target.value })} data-testid={`${id}-figure`}>
          <option value="">Pick a recorded figure</option>
          {recorded.map((i) => <option key={i.source_key} value={i.source_key}>{i.label} · {i.value ?? 'Not recorded'} · {i.grade || 'grade not recorded'}</option>)}
        </select>
      ) : null}
      {plan.run === 'upload' ? (
        <div className="flex flex-col gap-1.5">
          <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Image file" className={`text-[12.5px] ${INK}`}
            onChange={(e) => onChoice({ file: e.target.files?.[0] || null })} data-testid={`${id}-file`} />
          <input className={FIELD} placeholder="Alt text: what the image shows" aria-label="Alt text" value={choice.alt || ''} onChange={(e) => onChoice({ alt: e.target.value })} />
          <label className={`flex items-center gap-2 text-[12.5px] ${INK}`}>
            <input type="checkbox" checked={Boolean(choice.person)} onChange={(e) => onChoice({ person: e.target.checked })} data-testid={`${id}-person`} /> {CONSENT_LINE}
          </label>
        </div>
      ) : null}
      {plan.run === 'image' && onImageOptions ? (
        <button type="button" className="self-start text-[12px] font-bold text-axal-violet underline dark:text-violet-300" onClick={onImageOptions} data-testid={`${id}-image-options`}>
          More image options (style, palette, background) ›
        </button>
      ) : null}
      {plan.run === 'dialog' ? (
        <span className="flex flex-wrap items-center gap-2">
          <span className={MUTED}>{area.kind === 'block' ? 'No model · free. You place it yourself, in place of what this area holds.' : 'No model · free. You place it yourself.'}</span>
          {canDialog ? <button type="button" className={GHOST} onClick={onDialog} data-testid={`${id}-dialog`}>Add it here ›</button> : null}
        </span>
      ) : null}
      {plan.run === 'later' ? (
        <span className={MUTED} title={plan.why} data-testid={`${id}-later`}>{`${LATER}: ${plan.what || SURFACES[plan.adapter]?.what}. Not switched on yet.`}</span>
      ) : null}
      {plan.run === 'refused' || ((plan.run === 'metric' || plan.run === 'upload') && plan.why) ? (
        <span className={MUTED} role="status" data-testid={`${id}-why`}>{plan.why}</span>
      ) : null}
      {several && charged(plan) && quote?.status === 'ok' && holdOf(quote.data) != null ? (
        <span className={COST} data-testid={`${id}-hold`}>Holds up to {aiTokens(holdOf(quote.data))}</span>
      ) : null}
    </div>
  );
}

/**
 * A segmented radiogroup (variants, the text change): one tab stop on the
 * checked option, and the arrows move along the options that can be picked.
 */
function Segmented({ label, options, value, onPick, testId }) {
  const refs = useRef({});
  const on = options.filter((o) => !o.why);
  const key = (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step || !on.length) return;
    e.preventDefault?.();
    const at = on.findIndex((o) => o.id === value);
    const next = on[(at + step + on.length) % on.length];
    onPick(next.id);
    refs.current[next.id]?.focus?.();
  };
  return (
    <span className="flex flex-wrap gap-[3px] rounded-[9px] bg-axal-ground p-[3px] dark:bg-gray-900" role="radiogroup" aria-label={label} onKeyDown={key}>
      {options.map((o) => (
        <button key={o.id} ref={(n) => { refs.current[o.id] = n; }} type="button" role="radio" aria-checked={value === o.id}
          aria-disabled={o.why ? true : undefined} title={o.why || undefined} tabIndex={value === o.id ? 0 : -1}
          className={value === o.id ? SEG_ON : SEG_OFF} onClick={() => { if (!o.why) onPick(o.id); }} data-testid={`${testId}-${o.id}`}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

/**
 * pd4 PICK: the eight groups as a listbox; an element whose route is not on
 * main is greyed, titled why, and skipped by the arrows. One tab stop: the
 * selected element (else the first that can be picked) takes focus on open.
 */
function ElementPicker({ value, onPick, onClose, id }) {
  const refs = useRef({});
  const enabled = ELEMENT_GROUPS.flatMap((g) => g.items).filter(elementOnMain).map((el) => el.id);
  const [active, setActive] = useState(() => (enabled.includes(value) ? value : enabled[0] ?? null));
  useEffect(() => { if (active) refs.current[active]?.focus?.(); }, [active]);
  const key = (e) => {
    const at = enabled.indexOf(active);
    const move = (i) => { e.preventDefault?.(); setActive(enabled[(i + enabled.length) % enabled.length]); };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(enabled.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault?.(); if (active) onPick(active); }
    else if (e.key === 'Escape') { e.preventDefault?.(); e.stopPropagation?.(); onClose(); }
    else if (e.key === 'Tab') onClose();
  };
  return (
    <div role="listbox" aria-label="Elements" aria-activedescendant={active ? `${id}-opt-${active}` : undefined} onKeyDown={key}
      className="absolute left-0 top-[34px] z-30 flex max-h-[320px] w-[300px] flex-col gap-1 overflow-auto rounded-[10px] border border-axal-hairline bg-white p-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-900" data-testid={`${id}-picker`}>
      {ELEMENT_GROUPS.map((g) => (
        <div key={g.id} role="group" aria-label={g.label} className="flex flex-col">
          <span className={`${EYE} px-1.5 pt-1`}>{g.label}</span>
          {g.items.map((el) => {
            const on = elementOnMain(el);
            const why = on ? null : (SURFACES[el.adapter] ? `${SURFACES[el.adapter].what}. Not switched on yet.` : LATER);
            return (
              <button key={el.id} id={`${id}-opt-${el.id}`} ref={(n) => { refs.current[el.id] = n; }} type="button" role="option"
                aria-selected={value === el.id} aria-disabled={on ? undefined : true} title={why || undefined} tabIndex={el.id === active ? 0 : -1}
                className={`flex min-h-[32px] items-center justify-between gap-2 rounded-[7px] px-2 text-left text-[12.5px] ${on ? `${INK} hover:bg-axal-ground focus:bg-axal-ground dark:hover:bg-gray-800 dark:focus:bg-gray-800` : 'cursor-not-allowed text-axal-muted dark:text-gray-500'} ${value === el.id ? 'bg-axal-lavender dark:bg-violet-950/40' : ''}`}
                onClick={() => { if (on) onPick(el.id); }} data-testid={`${id}-pick-${el.id}`}>
                <span>{el.label}{el.pending ? ` ${PEND}` : ''}</span>
                <span className="font-mono text-[10px] text-axal-muted dark:text-gray-400">{on ? (el.free ? 'Free' : '') : LATER}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
