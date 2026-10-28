import React, { useEffect, useMemo, useState } from 'react';
import Lightbox from '../../../ui/Lightbox';
import { deckImagesApi } from '../../../lib/api/deckImages';
import { railPressHeaders } from '../../../lib/railPage';
import { reportError } from '../../../lib/log';
import useAssistMode from '../../../hooks/useAssistMode';
import { useRailOption } from '../../../ui/railCrumbs';
import { aiTokens, refusalOf } from './newDeckModel';
import {
  ALT_HELP, ASPECT_OPTIONS, CONSENT_LINE, COUNT_OPTIONS, FIGURES_LINE, NO_REFERENCES, OVERLAY_OPTIONS, PALETTE_OPTIONS, REAL_PERSON,
  STYLE_OPTIONS, USE_LINES, USE_OPTIONS, askBody, contrastLine, costLine, defaultDescription, imageTag, keepLabel, overlayStyle, placeImage,
} from './imageModel';
import { COST, EYE, FIELD, GHOST, INK, LAV, MUTED, PRIMARY, RefusalLine } from './AssistParts';

const SEG_ON = 'rounded-[7px] bg-white px-2.5 py-1 text-[12px] font-bold text-axal-ink shadow-sm dark:bg-gray-800 dark:text-gray-100';
const SEG_OFF = 'rounded-[7px] px-2.5 py-1 text-[12px] font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100';
const AREAS = [['validate', 'Validate'], ['build', 'Build'], ['grow', 'Grow'], ['raise', 'Raise']];
const AI_OFF = 'AI assistance is off on this page. You can still upload an image.';

function Segments({ label, options, value, onChange, testId }) {
  return (
    <div className="flex flex-wrap gap-[3px] rounded-[9px] bg-axal-ground p-[3px] dark:bg-gray-900" role="radiogroup" aria-label={label}>
      {options.map(([k, t]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? SEG_ON : SEG_OFF}
          onClick={() => onChange(k)} data-testid={`${testId}-${k}`}>{t}</button>
      ))}
    </div>
  );
}

/**
 * D903 (#2682, part 9 of #2434) — the image lightbox (PD12, PD12b, PD12c,
 * PD12e), opened from the Add menu's Image (a content image) and Background
 * (a card background).
 *
 * The essentials: Use as, the description (prefilled from the card), style,
 * palette, aspect, count, the cost line (the model, the price per image and
 * the AI token balance, read before anything runs) and Generate. Options
 * (PD12e) opens the data points, grouped by Validate, Build, Grow and Raise:
 * a text point's label shapes the description; image points need a model
 * that takes references, which FLUX.1 Schnell does not, so they are greyed;
 * figures never go into an image. The model column names the one model with
 * its price per image.
 *
 * Each proposal has Keep and Discard. A background (PD12b, PD12c) draws the
 * card behind it with the overlay in the brand ink, and "Keep as background"
 * waits until the contrast check reads 4.5:1. A request for a real person is
 * refused before anything runs, in the canvas's words; a photo of a person is
 * an upload with their agreement recorded. Keep places the image (Save writes
 * the version); nothing else changes the deck.
 */
export default function ImageLightbox({ deckId, cardIndex, card, theme, model, items = [], colours = {}, initialUse = 'content', onPlace, onClose }) {
  const [on] = useAssistMode('raise');
  const [use, setUse] = useState(initialUse);
  const [description, setDescription] = useState(() => defaultDescription(card));
  const [style, setStyle] = useState('flat');
  const [palette, setPalette] = useState('brand');
  const [aspect, setAspect] = useState(initialUse === 'content' ? '4:3' : '16:9');
  const [count, setCount] = useState(2);
  const [points, setPoints] = useState([]);
  const [options, setOptions] = useState(false);
  const [overlay, setOverlay] = useState('light');
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [results, setResults] = useState([]);
  const [stopped, setStopped] = useState(null);
  const [upload, setUpload] = useState({ file: null, person: false, consent: false, alt: '' });

  useRailOption(busy === 'generate' ? 'deck:image' : null, 'Generate');
  const ink = colours.ink || colours.accent || undefined;
  const brand = [colours.bg, colours.ink, colours.accent].filter((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c));
  const body = useMemo(() => askBody({ use, description, style, palette, aspect, count, card: use === 'deck' ? null : cardIndex, points, colours: brand }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [use, description, style, palette, aspect, count, cardIndex, points, brand.join()]);
  const contrast = contrastLine(use, overlay, ink);

  // The cost line is read as the request settles, never before there is something to price.
  useEffect(() => {
    if (!on || body.description.length < 3) { setQuote(null); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      deckImagesApi.quote(deckId, body).then((q) => { if (live) { setQuote(q); setRefusal(null); } },
        (e) => { if (live) { setQuote(null); setRefusal(refusalOf(e)); } });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [on, deckId, body]);

  const generate = () => {
    setBusy('generate'); setRefusal(null); setStopped(null);
    deckImagesApi.generate(deckId, body, railPressHeaders('deck:image')).then(
      (r) => { setBusy(null); setResults((rs) => [...(r.images || []), ...rs]); setStopped(r.stopped || null); },
      (e) => { setBusy(null); setRefusal(refusalOf(e)); reportError('pitch-images:generate', e); },
    );
  };

  const keep = (image) => {
    setBusy(`keep:${image.uid}`); setRefusal(null);
    deckImagesApi.keep(image.uid, { use, overlay: use === 'content' ? undefined : overlay, ink, alt: image.alt || description.slice(0, 200) }).then(
      (r) => {
        setBusy(null);
        const placed = placeImage({ card, theme, model }, r.image, use);
        if (placed.error) { setRefusal({ message: placed.error }); return; }
        onPlace(placed);
      },
      (e) => { setBusy(null); setRefusal(refusalOf(e)); reportError('pitch-images:keep', e); },
    );
  };
  const discard = (image) => {
    deckImagesApi.discard(image.uid).catch(() => {});
    setResults((rs) => rs.filter((x) => x.uid !== image.uid));
  };

  const sendUpload = () => {
    setBusy('upload'); setRefusal(null);
    deckImagesApi.upload(deckId, upload.file, { use, card: use === 'deck' ? null : cardIndex, alt: upload.alt, shows_person: upload.person, consent: upload.consent }).then(
      (r) => {
        setBusy(null);
        if (use === 'content') {
          const placed = placeImage({ card, theme, model }, r.image, use);
          if (placed.error) { setRefusal({ message: placed.error }); return; }
          onPlace(placed);
        } else setResults((rs) => [r.image, ...rs]);
      },
      (e) => { setBusy(null); setRefusal(refusalOf(e)); reportError('pitch-images:upload', e); },
    );
  };

  const people = refusal?.code === 'real_person';
  const blocked = !on || !quote || quote.ai === false || quote.balance?.ok === false || body.description.length < 3 || Boolean(busy);
  const grouped = AREAS.map(([k, t]) => [t, items.filter((i) => i.area === k && i.label)]).filter(([, list]) => list.length);
  const togglePoint = (label) => setPoints((p) => (p.includes(label) ? p.filter((x) => x !== label) : p.length >= 4 ? p : [...p, label]));

  return (
    <Lightbox label="Image" title={use === 'content' ? 'Add an image' : use === 'card' ? 'Card background' : 'Deck background'} width={options ? 960 : 720} onClose={onClose} testId="pitch-image-lightbox"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className={`${COST} mr-auto`} data-testid="pitch-image-cost">{on ? costLine(quote) : AI_OFF}</span>
          {quote?.balance?.ok === false ? <span className="text-[12px] font-semibold text-axal-destructive dark:text-red-400" role="alert" data-testid="pitch-image-balance">{quote.balance.message}</span> : null}
          <button type="button" className={GHOST} onClick={onClose}>Close</button>
          <button type="button" className={PRIMARY} disabled={blocked} onClick={generate} data-testid="pitch-image-generate">{busy === 'generate' ? 'Generating…' : 'Generate'}</button>
        </div>
      )}>
      <div className={`grid gap-4 ${options ? 'md:grid-cols-[minmax(0,1fr)_220px_200px]' : ''}`}>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className={EYE}>Use as</span>
            <Segments label="Use as" options={USE_OPTIONS} value={use} onChange={(u) => { setUse(u); setAspect(u === 'content' ? '4:3' : '16:9'); }} testId="pitch-image-use" />
            <span className={MUTED} data-testid="pitch-image-use-line">{USE_LINES[use]}</span>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className={EYE}>Description</span>
            <textarea className={`${FIELD} min-h-[64px]`} value={description} maxLength={400} onChange={(e) => setDescription(e.target.value)} aria-label="Description" data-testid="pitch-image-description" />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className={EYE}>Style</span>
            <Segments label="Style" options={STYLE_OPTIONS} value={style} onChange={setStyle} testId="pitch-image-style" />
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <label className="flex flex-col gap-1"><span className="text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">Palette</span>
              <select className={FIELD} value={palette} onChange={(e) => setPalette(e.target.value)} aria-label="Palette">{PALETTE_OPTIONS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
            <label className="flex flex-col gap-1"><span className="text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">Aspect</span>
              <select className={FIELD} value={aspect} onChange={(e) => setAspect(e.target.value)} aria-label="Aspect">{ASPECT_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
            <label className="flex flex-col gap-1"><span className="text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">Count</span>
              <select className={FIELD} value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Count">{COUNT_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          </div>
          {use !== 'content' ? (
            <div className="flex flex-col gap-1.5" data-testid="pitch-image-overlay">
              <span className="flex items-center justify-between gap-2"><span className="text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">Overlay in your brand ink</span>
                <Segments label="Overlay" options={OVERLAY_OPTIONS} value={overlay} onChange={setOverlay} testId="pitch-image-overlay" /></span>
              <span className={`text-[12px] font-semibold ${contrast.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`} role="status" data-testid="pitch-image-contrast">
                Contrast {contrast.figure} · {contrast.text}
              </span>
            </div>
          ) : null}
          <button type="button" className="self-start text-[12px] font-bold text-axal-violet hover:underline dark:text-violet-300" aria-expanded={options} onClick={() => setOptions((o) => !o)} data-testid="pitch-image-options">
            {options ? 'Hide options' : `Options › Model ${quote?.model_label || 'FLUX.1 Schnell'} · ${points.length} data point${points.length === 1 ? '' : 's'}`}
          </button>
          {people ? <div className="rounded-[10px] bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="alert" data-testid="pitch-image-people">{REAL_PERSON}</div> : null}
          {!people ? <RefusalLine refusal={refusal} testId="pitch-image-refusal" /> : null}
          {stopped ? <span className={MUTED} role="status" data-testid="pitch-image-stopped">{stopped.message}</span> : null}

          {results.length ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="pitch-image-results">
              {results.map((image) => {
                const keepOff = Boolean(busy) || (use !== 'content' && !contrast.ok);
                return (
                  <div key={image.uid} className={`${LAV} flex flex-col gap-2 p-2`} data-testid={`pitch-image-result-${image.uid}`}>
                    <div className="relative overflow-hidden rounded-[8px]" style={{ aspectRatio: use !== 'content' ? '16 / 9' : aspect.replace(':', ' / ') }}>
                      <img src={image.url} alt={image.alt || description} className="h-full w-full object-cover" />
                      {use !== 'content' ? <span className="absolute inset-0" style={{ background: overlayStyle(overlay, ink) || 'transparent' }} aria-hidden="true" /> : null}
                      {use !== 'content' ? <span className="absolute bottom-2 left-3 right-3 text-[13px] font-extrabold" style={{ color: '#fbfaf7' }}>{card?.title || 'Your card’s title'}</span> : null}
                      <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10.5px] font-semibold text-axal-ink dark:bg-gray-900/90 dark:text-gray-100">{image.source === 'upload' ? 'Uploaded' : imageTag(use)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button type="button" className={PRIMARY} disabled={keepOff} title={use !== 'content' && !contrast.ok ? contrast.text : undefined}
                        onClick={() => keep(image)} data-testid={`pitch-image-keep-${image.uid}`}>{keepLabel(use)}</button>
                      <button type="button" className={GHOST} disabled={Boolean(busy)} onClick={() => discard(image)} data-testid={`pitch-image-discard-${image.uid}`}>Discard</button>
                      {image.charged_microusd != null ? <span className={COST}>· {aiTokens(image.charged_microusd)}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          <details className="rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700" data-testid="pitch-image-upload">
            <summary className={`cursor-pointer text-[12.5px] font-bold ${INK}`}>Upload an image instead</summary>
            <div className="mt-2 flex flex-col gap-2">
              <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Image file"
                onChange={(e) => setUpload((u) => ({ ...u, file: e.target.files?.[0] || null }))} data-testid="pitch-image-file" />
              <input className={FIELD} placeholder="Alt text: what the image shows" maxLength={200} value={upload.alt} onChange={(e) => setUpload((u) => ({ ...u, alt: e.target.value }))} aria-label="Alt text" />
              <label className={`flex items-center gap-2 text-[12.5px] ${INK}`}>
                <input type="checkbox" checked={upload.person} onChange={(e) => setUpload((u) => ({ ...u, person: e.target.checked, consent: e.target.checked && u.consent }))} data-testid="pitch-image-person" />
                The photo shows a person
              </label>
              {upload.person ? (
                <label className={`flex items-center gap-2 text-[12.5px] ${INK}`}>
                  <input type="checkbox" checked={upload.consent} onChange={(e) => setUpload((u) => ({ ...u, consent: e.target.checked }))} data-testid="pitch-image-consent" />
                  {CONSENT_LINE}
                </label>
              ) : null}
              <span className={MUTED}>{ALT_HELP}</span>
              <button type="button" className={`${GHOST} self-start`} disabled={!upload.file || (upload.person && !upload.consent) || Boolean(busy)} onClick={sendUpload} data-testid="pitch-image-upload-run">
                {busy === 'upload' ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </details>
        </div>

        {options ? (
          <div className="flex flex-col gap-2" data-testid="pitch-image-points">
            <span className={EYE}>Data points</span>
            <span className={MUTED}>{FIGURES_LINE}</span>
            {grouped.length ? grouped.map(([area, list]) => (
              <fieldset key={area} className="m-0 flex flex-col gap-1 border-0 p-0">
                <legend className="text-[11.5px] font-bold text-axal-muted dark:text-gray-400">{area}</legend>
                {list.slice(0, 8).map((i) => (
                  <label key={i.source_key} className={`flex items-center gap-2 text-[12px] ${INK}`}>
                    <input type="checkbox" checked={points.includes(i.label)} onChange={() => togglePoint(i.label)} /> {i.label}
                  </label>
                ))}
              </fieldset>
            )) : <span className={MUTED}>No data points are recorded yet.</span>}
            <span className={`${MUTED} opacity-70`} data-testid="pitch-image-no-references">{NO_REFERENCES}</span>
          </div>
        ) : null}
        {options ? (
          <div className="flex flex-col gap-2" data-testid="pitch-image-models">
            <span className={EYE}>Model</span>
            {(quote?.models || [{ id: 'flux', label: 'FLUX.1 Schnell', per_image_microusd: null }]).map((m) => (
              <span key={m.id} className={`flex items-center justify-between gap-2 rounded-[9px] border border-axal-violet px-2.5 py-2 text-[12px] ${INK}`}>
                {m.label} <span className={COST}>{m.per_image_microusd == null ? 'Price not read' : `${aiTokens(m.per_image_microusd)} per image`}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Lightbox>
  );
}
