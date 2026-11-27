import React, { useState } from 'react';
import CoverDrawPress from '../../ui/CoverDrawPress';
import EventCoverVariants from './EventCoverVariants';
import * as recommendations from './recommendationsAdapter';
import {
  ALT_MAX, ALT_REQUIRED, COVER_OVERLAYS, COVER_RATIOS, COVER_RULE, COVER_STYLES, SAVE_FIRST,
  canSendUpload, checkCoverFile, coverPrompt, cropsFromFocal,
} from './eventCoverModel';

/**
 * D3724 (#3724 Part E, NE2): the cover, two equal ways.
 *
 * **Upload** (#5309, D5309, §gaps 8 and 11) checks the file here (JPG or PNG,
 * at least 1200 × 675), takes alt text and a focal point, derives NE2's three
 * crops from that point and the image's own aspect, and sends all of it as one
 * multipart press. The Worker checks the bytes again — the browser's numbers
 * decide nothing — stores the image in R2 and answers a URL, the alt text, the
 * focal point and the crops. Nothing is written until the member's own Save.
 *
 * **Generate with Eadwyn** writes a prompt from the event's own fields with a
 * style and overlay, then offers both presses: #3935's single draw, and
 * #5309's four variants (§gaps 9 and 10, priced once, the venture's brand
 * colours in the prompt).
 *
 * Alt text is required on an upload: §gap 11 exists because nothing read a
 * cover aloud. The image link stays: it is what Save writes.
 */
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-200';
const inputCls = 'mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500';
const MUTED = 'text-xs text-gray-500 dark:text-gray-400';
const CHIP = (on) => `inline-flex min-h-[36px] items-center rounded-full border px-3 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${on
  ? 'border-violet-600 bg-violet-50 text-gray-900 dark:border-violet-400 dark:bg-violet-950/40 dark:text-gray-100'
  : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`;

function readSize(file) {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
      img.onerror = () => { resolve({ width: 0, height: 0 }); URL.revokeObjectURL(url); };
      img.src = url;
    } catch { resolve({ width: 0, height: 0 }); }
  });
}

export default function EventCoverStep({ id, form, set, coverQuote, coverDraw, onCoverDrawn, upload = recommendations.uploadCover }) {
  const [way, setWay] = useState('upload');
  const [file, setFile] = useState(null);
  const [fileErr, setFileErr] = useState(null);
  const [crop, setCrop] = useState('card');
  const [focal, setFocal] = useState({ x: 0.5, y: 0.5 });
  const [alt, setAlt] = useState('');
  const [sent, setSent] = useState(null);
  const [style, setStyle] = useState('photo');
  const [overlay, setOverlay] = useState('none');
  const [seed, setSeed] = useState({ n: 0, prompt: '' });

  const choose = async (f) => {
    setSent(null); setFile(null); setFileErr(null); setFocal({ x: 0.5, y: 0.5 });
    if (!f) return;
    const size = await readSize(f);
    const c = checkCoverFile({ type: f.type, ...size });
    if (!c.ok) { setFileErr(c.error); return; }
    setFile({ name: f.name, ...size, raw: f });
  };
  // #5309: the three crops come from the focal point and the image's own
  // aspect, so one press records all three. A file whose size could not be read
  // has no aspect, and then no crops are claimed at all.
  const ratio = file && file.height > 0 ? file.width / file.height : null;
  const crops = ratio ? cropsFromFocal(ratio, focal) : null;
  const ready = canSendUpload({ file, alt });
  const send = async () => {
    if (!ready.ok) { setSent({ available: false, reason: ready.error }); return; }
    const r = await upload(id, { file: file?.raw, alt: alt.trim(), focal, crops });
    setSent(r);
    if (r?.available && r.value?.url) {
      set('cover_url', r.value.url);
      set('cover_alt', r.value.alt ?? alt.trim());
      set('cover_source', 'uploaded');
      set('cover_focal', r.value.focal ?? focal);
      set('cover_crops', r.value.crops ?? crops);
    }
  };
  const drawn = (url, drawnAlt) => {
    set('cover_source', 'generated');
    if (drawnAlt) set('cover_alt', drawnAlt);
    onCoverDrawn?.(url, drawnAlt);
  };
  const tab = (key, label) => (
    <button type="button" role="tab" aria-selected={way === key} aria-controls={`event-cover-${key}`} id={`event-cover-tab-${key}`}
      className={`min-h-[40px] flex-1 border-b-2 px-3 text-sm font-semibold ${way === key ? 'border-violet-600 text-gray-900 dark:border-violet-400 dark:text-gray-100' : 'border-transparent text-gray-500 dark:text-gray-400'}`}
      onClick={() => setWay(key)} data-testid={`event-cover-tab-${key}`}>{label}</button>
  );
  return (
    <div className="space-y-2" data-testid="event-cover-step">
      <label className={labelCls} htmlFor="event-cover-url">Cover image URL</label>
      <input id="event-cover-url" className={inputCls} value={form.cover_url} onChange={(e) => set('cover_url', e.target.value)} placeholder="https://…" />
      <div role="tablist" aria-label="Cover image" className="mt-2 flex border-b border-gray-200 dark:border-gray-700">
        {tab('upload', 'Upload')}
        {tab('generate', 'Generate with Eadwyn')}
      </div>
      {way === 'upload' ? (
        <div role="tabpanel" id="event-cover-upload" aria-labelledby="event-cover-tab-upload" className="space-y-2 pt-1">
          <label className="flex min-h-[72px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 p-3 text-center text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300"
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); choose(e.dataTransfer?.files?.[0]); }}>
            <span>Drop an image here, or browse</span>
            <span className={MUTED}>JPG or PNG, at least 1200 × 675</span>
            <input type="file" accept="image/jpeg,image/png" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} data-testid="event-cover-file" />
          </label>
          {fileErr ? <p className="text-xs text-rose-700 dark:text-rose-300" role="alert" data-testid="event-cover-file-error">{fileErr}</p> : null}
          {file ? <p className={MUTED}>{file.name} · {file.width} × {file.height}</p> : null}
          <fieldset className="m-0 border-0 p-0"><legend className="mb-1 text-xs font-semibold text-gray-700 dark:text-gray-200">Crop</legend>
            <div className="flex flex-wrap gap-1.5">{COVER_RATIOS.map((r) => <button key={r.key} type="button" className={CHIP(crop === r.key)} aria-pressed={crop === r.key} onClick={() => setCrop(r.key)}>{r.label}</button>)}</div>
            {/* All three crops are recorded on every upload; the chips choose which one this line describes. */}
            <p className={MUTED} data-testid="event-cover-crop-line">{crops
              ? `All three crops are recorded. ${COVER_RATIOS.find((r) => r.key === crop)?.label}: ${Math.round(crops[crop].w * 100)}% × ${Math.round(crops[crop].h * 100)}% of the image.`
              : 'Crops are recorded once the image’s size is read.'}</p>
          </fieldset>
          {/* #5309 (§gap 8): the focal point every crop keeps in frame, as two fractions. */}
          <fieldset className="m-0 border-0 p-0"><legend className="mb-1 text-xs font-semibold text-gray-700 dark:text-gray-200">Focal point</legend>
            <div className="flex flex-wrap gap-2">
              <label className="text-xs text-gray-600 dark:text-gray-300">Across
                <input type="range" min="0" max="100" value={Math.round(focal.x * 100)} data-testid="event-cover-focal-x"
                  onChange={(e) => setFocal((f) => ({ ...f, x: Number(e.target.value) / 100 }))} className="ml-2 align-middle" /></label>
              <label className="text-xs text-gray-600 dark:text-gray-300">Down
                <input type="range" min="0" max="100" value={Math.round(focal.y * 100)} data-testid="event-cover-focal-y"
                  onChange={(e) => setFocal((f) => ({ ...f, y: Number(e.target.value) / 100 }))} className="ml-2 align-middle" /></label>
            </div>
          </fieldset>
          <label className="block"><span className="text-xs font-semibold text-gray-700 dark:text-gray-200">Alt text</span>
            <input className={inputCls} value={alt} maxLength={ALT_MAX} required aria-required="true" onChange={(e) => setAlt(e.target.value)} placeholder="What the image shows" /></label>
          <p className={MUTED}>{ALT_REQUIRED}</p>
          <button type="button" className="min-h-[44px] rounded-md border border-slate-300 px-3 text-sm dark:border-slate-600 dark:text-slate-100" disabled={!ready.ok} onClick={send} data-testid="event-cover-upload">Use this image</button>
          {sent && !sent.available ? <p className={MUTED} role="status" data-testid="event-cover-upload-off">{sent.reason}</p> : null}
          {sent?.available ? <p className={MUTED} role="status" data-testid="event-cover-uploaded">Uploaded. Save the event to keep it.</p> : null}
        </div>
      ) : (
        <div role="tabpanel" id="event-cover-generate" aria-labelledby="event-cover-tab-generate" className="space-y-2 pt-1">
          <fieldset className="m-0 border-0 p-0"><legend className="mb-1 text-xs font-semibold text-gray-700 dark:text-gray-200">Style</legend>
            <div className="flex flex-wrap gap-1.5">{COVER_STYLES.map((s) => <button key={s.key} type="button" className={CHIP(style === s.key)} aria-pressed={style === s.key} onClick={() => setStyle(s.key)}>{s.label}</button>)}</div>
          </fieldset>
          <fieldset className="m-0 border-0 p-0"><legend className="mb-1 text-xs font-semibold text-gray-700 dark:text-gray-200">Text on the image</legend>
            <div className="flex flex-wrap gap-1.5">{COVER_OVERLAYS.map((o) => <button key={o.key} type="button" className={CHIP(overlay === o.key)} aria-pressed={overlay === o.key} onClick={() => setOverlay(o.key)}>{o.label}</button>)}</div>
          </fieldset>
          <p className={MUTED}>{COVER_RULE}</p>
          {id ? (
            <>
              <button type="button" className="min-h-[40px] rounded-md border border-slate-300 px-3 text-sm dark:border-slate-600 dark:text-slate-100"
                onClick={() => setSeed((s) => ({ n: s.n + 1, prompt: coverPrompt(form, { style, overlay }) }))} data-testid="event-cover-write-prompt">Write the prompt from this event</button>
              {/* #3935 (EV2): a saved event can have its cover drawn; the URL fills this field, and Save writes it. */}
              <CoverDrawPress key={seed.n} initialPrompt={seed.prompt} testid="event-cover-draw" quote={coverQuote} draw={coverDraw} onDrawn={drawn} />
              <p className={MUTED}>One draw makes one image. Four variants in one press are priced together below.</p>
              {/* #5309 (§gaps 9 and 10): four variants on one quote, in the venture's brand colours. */}
              <EventCoverVariants id={id} prompt={seed.prompt || coverPrompt(form, { style, overlay })} onChoose={drawn} />
            </>
          ) : <p className={MUTED} data-testid="event-cover-save-first">{SAVE_FIRST}</p>}
        </div>
      )}
    </div>
  );
}
