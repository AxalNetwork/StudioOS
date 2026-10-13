import React from 'react';
import { parseConversation } from './recordSetup.js';

/**
 * The helpers Validate › Record a session shared (D660, #1473), kept after the
 * side sheet that drew them was replaced by the lightbox (D685, #1587;
 * `RecordLightbox.jsx`, `recordSetup.js`). The sheet is gone; the session
 * page still draws its models with `ModelList` and tests AUDIO.
 *
 * CONSENT IS THE WORKER'S GATE (D657): on an audio channel nothing starts
 * until consent is `given`, and the Worker refuses `start` with 409
 * `consent_not_recorded` whatever a screen shows.
 *
 * THE MODELS ARE READ, NEVER WRITTEN HERE. Both lists come from
 * `GET /sessions/models`, with the Worker's prices; a model it marks
 * unchoosable (no published price) is shown and cannot be picked.
 */

export const AUDIO = new Set(['in_person', 'video', 'phone']);
export const CONSENT_METHODS = [
  ['verbal', 'Said yes, out loud'],
  ['written', 'In writing'],
  ['in_app', 'In the app'],
  ['pre_agreed', 'Agreed beforehand'],
];

/** May a session start? Audio needs consent given, and a method for it. */
export function canStart(channel, consent) {
  if (!channel) return false;
  if (!AUDIO.has(channel)) return true;
  return consent?.status === 'given' && CONSENT_METHODS.some(([m]) => m === consent.method);
}

/** One definition of "Name: words" → messages, in `recordSetup.js`. */
export { parseConversation };

/** Dollars a minute, as the rail prints it. A missing price is not $0. */
export function perMinute(usd) {
  if (!Number.isFinite(usd)) return 'Not priced';
  return `$${usd.toFixed(4)}/min`;
}

/** One model list. `choosable: false` is listed, disabled, and says why. */
export function ModelList({ kind, models, value, onChange, allowOff }) {
  if (models === null) return <p className="text-[12px] text-axal-faint" data-testid={`models-${kind}-unreadable`}>Unreadable: the model list could not be read.</p>;
  if (!models) return <p className="text-[12px] text-axal-faint">Reading models…</p>;
  return (
    <ul className="space-y-1" data-testid={`models-${kind}`}>
      {models.map((m) => (
        <li key={m.model}>
          <label className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-[12px] ${m.choosable ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900' : 'opacity-60'}`}>
            <input type="radio" name={`model-${kind}`} value={m.model} checked={value === m.model} disabled={!m.choosable} onChange={() => onChange(m.model)} />
            <span className="min-w-0 flex-1">
              <span className="font-semibold text-gray-900 dark:text-gray-100">{m.label}</span>
              {(m.tags || []).map((t) => <span key={t} className="ml-1.5 rounded bg-gray-100 px-1 text-[10px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300">{t}</span>)}
              {m.good_at ? <span className="block text-axal-faint">{m.good_at}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums text-axal-muted">{m.choosable ? perMinute(m.price_usd_per_minute) : 'Not offered'}</span>
          </label>
        </li>
      ))}
      {allowOff && (
        <li>
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] hover:bg-gray-50 dark:hover:bg-gray-900">
            <input type="radio" name={`model-${kind}`} value="" checked={value === null} onChange={() => onChange(null)} />
            <span className="font-semibold text-gray-900 dark:text-gray-100">Off</span>
            <span className="text-axal-faint">The transcript appears when you stop.</span>
          </label>
        </li>
      )}
    </ul>
  );
}
