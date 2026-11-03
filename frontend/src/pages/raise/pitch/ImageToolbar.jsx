import React, { useState } from 'react';
import { FIELD, GHOST, INK, MUTED } from './AssistParts';
import { ALT_HELP, FIT_OPTIONS, placedLine } from './imageModel';
import { COMING_LATER, CROP_WORDS as CROP_LINES, FILTERS, FILTER_WORDS, ZOOM_MIN_W, panTo, rectOf, zoomTo } from './imageLook';

const CROPS = [[0, 0], [50, 0], [100, 0], [0, 50], [50, 50], [100, 50], [0, 100], [50, 100], [100, 100]];
const CROP_WORDS = ['Top left', 'Top', 'Top right', 'Left', 'Centre', 'Right', 'Bottom left', 'Bottom', 'Bottom right'];

/**
 * D903 (#2682, part 9 of #2434) — PD12d: the toolbar of a placed image, in
 * place of the AI bar: Replace, Upload, Regenerate (with its cost, in the
 * lightbox), Crop, Fit, Alt text and Remove. Under it, the image's model, day
 * and cost, or that it was uploaded, and its alt text, which travels with
 * every export. Every change is the editor's until Save.
 *
 * `image` is the store's record of this block's image (`GET /api/decks/:id/images`),
 * or null when the block holds a link from before D903.
 *
 * D1534 (#3778, pd27): Crop also zooms and pans a window locked to the block's
 * aspect; Filters picks one of eight presets; an upload the image screen
 * flagged says so; Erase, Expand, Vary, Remove background and Upscale are
 * listed greyed under "Coming later". Every renderer reads the same rule
 * (`imageLook.js`).
 */
export default function ImageToolbar({ block, image, onPatch, onReplace, onUpload, onRegenerate, onRemove }) {
  const [tool, setTool] = useState(null);
  const toggle = (t) => setTool((x) => (x === t ? null : t));
  const crop = block.crop || { x: 50, y: 50 };
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-axal-hairline bg-white p-2.5 dark:border-gray-700 dark:bg-gray-900" data-testid="pitch-image-toolbar">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-axal-ground px-2 py-0.5 text-[10.5px] font-semibold text-axal-muted dark:bg-gray-800 dark:text-gray-400" data-testid="pitch-image-tag">
          {block.tag === 'photo' ? 'Photo' : 'Illustration'}
        </span>
        <button type="button" className={GHOST} onClick={onReplace} data-testid="pitch-image-replace">Replace</button>
        <button type="button" className={GHOST} onClick={onUpload} data-testid="pitch-image-upload-tool">Upload</button>
        {image?.source === 'generated' ? <button type="button" className={GHOST} onClick={onRegenerate} data-testid="pitch-image-regenerate">Regenerate</button> : null}
        <button type="button" className={GHOST} aria-expanded={tool === 'crop'} onClick={() => toggle('crop')} data-testid="pitch-image-crop">Crop</button>
        <button type="button" className={GHOST} aria-expanded={tool === 'fit'} onClick={() => toggle('fit')} data-testid="pitch-image-fit">Fit ▾</button>
        <button type="button" className={GHOST} aria-expanded={tool === 'filters'} onClick={() => toggle('filters')} data-testid="pitch-image-filters">Filters</button>
        <button type="button" className={GHOST} aria-expanded={tool === 'alt'} onClick={() => toggle('alt')} data-testid="pitch-image-alt">Alt text</button>
        <button type="button" className={`${GHOST} text-axal-destructive dark:text-red-400`} onClick={onRemove} data-testid="pitch-image-remove">Remove</button>
      </div>
      {tool === 'crop' ? (
        <div className="flex flex-col gap-1.5" data-testid="pitch-image-crop-grid">
          <span className={MUTED}>The part of the image that stays in view.</span>
          <div className="grid w-[120px] grid-cols-3 gap-1" role="radiogroup" aria-label="Crop">
            {CROPS.map(([x, y], i) => (
              <button key={CROP_WORDS[i]} type="button" role="radio" aria-checked={crop.x === x && crop.y === y} aria-label={CROP_WORDS[i]}
                className={`h-8 rounded-[6px] border ${crop.x === x && crop.y === y ? 'border-axal-violet bg-axal-lavender dark:bg-violet-950/40' : 'border-axal-hairline dark:border-gray-700'}`}
                onClick={() => onPatch({ crop: { x, y } })} />
            ))}
          </div>
          {block.fit === 'contain' ? <span className={MUTED}>Shown whole: zooming needs the image to cover its range (Fit).</span> : (
            <div className="flex flex-col gap-1" data-testid="pitch-image-zoom">
              <label className={`flex items-center gap-2 ${MUTED}`}>
                Zoom
                <input type="range" min={0} max={100 - ZOOM_MIN_W} step={1} value={100 - (rectOf(crop.rect)?.w ?? 100)} aria-label="Zoom"
                  onChange={(e) => onPatch({ crop: zoomTo(crop, 100 - Number(e.target.value)) })} data-testid="pitch-image-zoom-range" />
              </label>
              {rectOf(crop.rect) ? (
                <span className="flex flex-wrap gap-1" role="group" aria-label="Move the crop">
                  {[['←', -5, 0], ['→', 5, 0], ['↑', 0, -5], ['↓', 0, 5]].map(([t, dx, dy]) => (
                    <button key={t} type="button" className={GHOST} aria-label={`Move ${t}`} onClick={() => onPatch({ crop: panTo(crop, dx, dy) })} data-testid={`pitch-image-pan-${t}`}>{t}</button>
                  ))}
                </span>
              ) : null}
              <span className={MUTED} data-testid="pitch-image-aspect">{CROP_LINES.aspect.replace('16:9', aspectWord(block))} · {CROP_LINES.replaceKeeps}</span>
            </div>
          )}
        </div>
      ) : null}
      {tool === 'filters' ? (
        <div className="flex flex-col gap-1.5" data-testid="pitch-image-filter-list">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filter">
            {FILTERS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={(block.filter || 'original') === k} className={GHOST}
                onClick={() => onPatch({ filter: k === 'original' ? undefined : k })} data-testid={`pitch-image-filter-${k}`}>{FILTER_WORDS[k]}</button>
            ))}
          </div>
          <span className={`text-[10.5px] font-extrabold uppercase tracking-[.07em] ${MUTED}`}>{CROP_LINES.comingLater}</span>
          <span className="flex flex-wrap gap-1.5" data-testid="pitch-image-coming-later">
            {COMING_LATER.map((t) => <button key={t} type="button" className={`${GHOST} opacity-50`} disabled aria-disabled="true">{t}</button>)}
          </span>
        </div>
      ) : null}
      {tool === 'fit' ? (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Fit">
          {FIT_OPTIONS.map(([k, t]) => (
            <button key={k} type="button" role="radio" aria-checked={(block.fit || 'cover') === k} className={GHOST} onClick={() => onPatch({ fit: k })} data-testid={`pitch-image-fit-${k}`}>{t}</button>
          ))}
        </div>
      ) : null}
      {tool === 'alt' ? (
        <label className="flex flex-col gap-1">
          <span className={MUTED}>{ALT_HELP}</span>
          <input className={FIELD} value={block.alt || ''} maxLength={200} onChange={(e) => onPatch({ alt: e.target.value })} aria-label="Alt text" data-testid="pitch-image-alt-input" />
        </label>
      ) : null}
      <div className={`flex flex-wrap gap-x-3 gap-y-1 text-[12px] ${MUTED}`} data-testid="pitch-image-placed">
        {image ? <span className="font-mono text-[11.5px]">{placedLine(image)}</span> : null}
        {image?.screen?.line ? <span className="font-semibold text-axal-amber-deep dark:text-amber-300" data-testid="pitch-image-screen">{image.screen.line}</span> : null}
        <span>Alt text: <b className={`font-semibold ${INK}`}>{block.alt || 'None yet: add one so the image is described in every export.'}</b></span>
      </div>
    </div>
  );
}

/** The block's own aspect, from its grid range on a 16:9 card of 12 columns and 6 rows, for "Aspect locked · W:H". */
export function aspectWord(block) {
  const g = block?.grid;
  if (!g) return '16:9';
  const w = (g.c2 - g.c1 + 1) * 8, h = (g.r2 - g.r1 + 1) * 9;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const d = gcd(w, h) || 1;
  return `${w / d}:${h / d}`;
}
