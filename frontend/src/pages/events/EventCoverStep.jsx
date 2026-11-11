import React, { useState } from 'react';
import CoverDrawPress from '../../ui/CoverDrawPress';
import * as recommendations from './recommendationsAdapter';
import {
  COVER_OVERLAYS, COVER_RATIOS, COVER_RULE, COVER_STYLES, SAVE_FIRST, checkCoverFile, coverPrompt,
} from './eventCoverModel';

/**
 * D3724 (#3724 Part E, NE2): the cover, two equal ways. **Upload** checks the
 * file here (JPG or PNG, at least 1200 × 675), takes a crop and alt text, and
 * sends it through the adapter, which answers "not switched on yet" until the
 * upload route lands. **Generate with Eadwyn** writes a prompt from the
 * event's own fields with a style and overlay, then hands it to #3935's
 * press (price first, then draw). The image link stays: it is what Save writes.
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
  const [alt, setAlt] = useState('');
  const [sent, setSent] = useState(null);
  const [style, setStyle] = useState('photo');
  const [overlay, setOverlay] = useState('none');
  const [seed, setSeed] = useState({ n: 0, prompt: '' });

  const choose = async (f) => {
    setSent(null); setFile(null); setFileErr(null);
    if (!f) return;
    const size = await readSize(f);
    const c = checkCoverFile({ type: f.type, ...size });
    if (!c.ok) { setFileErr(c.error); return; }
    setFile({ name: f.name, ...size, raw: f });
  };
  const send = async () => {
    const r = await upload(id, { file: file?.raw, crop, alt });
    setSent(r);
    if (r?.available && r.value?.url) set('cover_url', r.value.url);
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
          </fieldset>
          <label className="block"><span className="text-xs font-semibold text-gray-700 dark:text-gray-200">Alt text</span>
            <input className={inputCls} value={alt} maxLength={200} onChange={(e) => setAlt(e.target.value)} placeholder="What the image shows" /></label>
          <button type="button" className="min-h-[44px] rounded-md border border-slate-300 px-3 text-sm dark:border-slate-600 dark:text-slate-100" disabled={!file} onClick={send} data-testid="event-cover-upload">Use this image</button>
          {sent && !sent.available ? <p className={MUTED} role="status" data-testid="event-cover-upload-off">{sent.reason}</p> : null}
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
              <CoverDrawPress key={seed.n} initialPrompt={seed.prompt} testid="event-cover-draw" quote={coverQuote} draw={coverDraw} onDrawn={onCoverDrawn} />
              <p className={MUTED}>Each draw makes one image. Four variants at once aren’t switched on yet.</p>
            </>
          ) : <p className={MUTED} data-testid="event-cover-save-first">{SAVE_FIRST}</p>}
        </div>
      )}
    </div>
  );
}
