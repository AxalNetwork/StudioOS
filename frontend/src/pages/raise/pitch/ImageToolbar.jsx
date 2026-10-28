import React, { useState } from 'react';
import { FIELD, GHOST, INK, MUTED } from './AssistParts';
import { ALT_HELP, FIT_OPTIONS, placedLine } from './imageModel';

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
        <span>Alt text: <b className={`font-semibold ${INK}`}>{block.alt || 'None yet: add one so the image is described in every export.'}</b></span>
      </div>
    </div>
  );
}
