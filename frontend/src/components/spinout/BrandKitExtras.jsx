// D583 (#1210) — the Brand page's "Brand voice · 3 max" chips and its dark logo.
// Both save with the brand (PUT /brand/landing/by-project/:pid); the dark logo
// uploads through the same /brand/logo/upload checks as the light one (3A), and
// a published page uses it on its dark templates.
import React, { useState } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';
import { VOICE_MAX, addVoiceTag, removeVoiceTag } from '../../lib/brand/brandKitExtras';

const LBL = 'text-[10.5px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';

export function VoiceChips({ tags = [], onChange }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const add = () => {
    const r = addVoiceTag(tags, text);
    setErr(r.error || '');
    if (!r.error) { setText(''); if (r.tags !== tags) onChange(r.tags); }
  };
  const full = tags.length >= VOICE_MAX;
  return (
    <div data-testid="brand-voice">
      <div className={`${LBL} mt-4 mb-1.5`}>Brand voice · {VOICE_MAX} max</div>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {tags.length === 0 && <span className="text-[11px] text-gray-400" data-testid="brand-voice-empty">No voice tags yet.</span>}
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 text-[11px] font-semibold" data-testid="brand-voice-chip">
            {t}
            <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(removeVoiceTag(tags, t))}><X size={10} /></button>
          </span>
        ))}
      </div>
      {!full && (
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          onBlur={add}
          placeholder="Add a tone, e.g. Plainspoken"
          aria-label="Add a voice tag"
          className="w-full h-8 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[12.5px] text-gray-900 dark:text-gray-100"
          data-testid="input-brand-voice"
        />
      )}
      {err && <p role="alert" className="mt-1 text-[11px] text-red-700 dark:text-red-300">{err}</p>}
    </div>
  );
}

export function DarkLogoField({ url, svg, busy, onPick, onClear }) {
  const inputRef = React.useRef(null);
  return (
    <div data-testid="brand-dark-logo">
      <div className={`${LBL} mt-4 mb-1.5`}>Logo on dark</div>
      {/* dark-mode-exempt: this tile previews the logo on a dark ground in both themes. */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-full h-16 rounded-xl border-2 border-dashed border-gray-700 bg-gray-900 flex items-center justify-center text-gray-400 overflow-hidden"
        data-testid="button-dark-logo-drop"
      >
        {busy ? <Loader2 size={16} className="animate-spin" />
          : url ? <img src={url} alt="logo on dark" className="h-full object-contain" />
            : svg ? <img src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} alt="logo on dark" className="h-full object-contain" />
              : <span className="inline-flex items-center gap-1.5 text-[11.5px]"><Upload size={13} /> Upload a dark-background logo</span>}
      </button>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onPick(f); }} />
      {(url || svg) && (
        <button type="button" onClick={onClear} className="mt-1 text-[11px] text-gray-500 hover:underline" data-testid="button-dark-logo-clear">Remove the dark logo</button>
      )}
      <p className="mt-1 text-[10.5px] text-gray-400">Used on the dark templates; the light logo is used everywhere else.</p>
    </div>
  );
}
