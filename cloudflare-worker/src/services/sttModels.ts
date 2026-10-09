/**
 * D657 — the speech-to-text models the recording rail lists, and their prices.
 *
 * ONE TABLE THE WORKER READS. The price of each model comes from the router's
 * own tables (`PRICE_USD_PER_AUDIO_MINUTE` for batch, `…_WEBSOCKET` for live),
 * the same numbers a run is reserved and settled against, so the rate a
 * founder reads and the rate they are charged cannot differ. The page never
 * carries a price of its own.
 *
 * A model is choosable only when it is not retired and it has a price. A
 * retired model stays in the list so a past session can still name what
 * transcribed it.
 */
import { PRICE_USD_PER_AUDIO_MINUTE, PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET, ROUTE } from './aiRouter';
import { FLUX, NOVA_3, WHISPER, WHISPER_TINY_EN, WHISPER_TURBO } from './sttFormats';

export type SttKind = 'live' | 'final';
export type SttTag = 'Real-time' | 'Batch' | 'Default' | 'Beta' | 'Retired';

export interface SttModel {
  model: string;
  kind: SttKind;
  label: string;
  good_at: string;
  tags: SttTag[];
  retired?: boolean;
}

export const STT_MODELS: readonly SttModel[] = [
  { model: NOVA_3, kind: 'live', label: 'Nova-3 (live)', tags: ['Real-time', 'Default'],
    good_at: 'Live captions while you talk, with each speaker labelled.' },
  { model: FLUX, kind: 'live', label: 'Flux', tags: ['Real-time'],
    good_at: 'Live captions that close each turn when the speaker stops.' },
  { model: WHISPER_TURBO, kind: 'final', label: 'Whisper Large v3 Turbo', tags: ['Batch', 'Default'],
    good_at: 'The full transcript after the session, in many languages, with the language detected.' },
  { model: NOVA_3, kind: 'final', label: 'Nova-3 (batch)', tags: ['Batch'],
    good_at: 'The full transcript with "Me" and the interviewee labelled.' },
  { model: WHISPER, kind: 'final', label: 'Whisper', tags: ['Batch'],
    good_at: 'A plain transcript at the lowest price.' },
  { model: WHISPER_TINY_EN, kind: 'final', label: 'Whisper Tiny EN', tags: ['Batch', 'Beta'],
    good_at: 'English only. Cloudflare publishes no price for it yet, so it cannot be chosen.' },
];

export const DEFAULT_LIVE_MODEL = NOVA_3;
export const DEFAULT_FINAL_MODEL = WHISPER_TURBO;

/** USD per minute of audio, from the router's tables, or null when unpublished. */
export function pricePerMinute(model: string, kind: SttKind): number | null {
  const table = kind === 'live' ? PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET : PRICE_USD_PER_AUDIO_MINUTE;
  const p = table[model];
  return typeof p === 'number' && Number.isFinite(p) ? p : null;
}

/**
 * Choosable: listed for this kind and not retired. A final model must also be
 * one of the router's `transcribe` alternates, which only ever lists priced
 * models; every live model listed is priced, which a test pins.
 */
export function isChoosable(model: string, kind: SttKind): boolean {
  const entry = STT_MODELS.find((m) => m.model === model && m.kind === kind);
  if (!entry || entry.retired || entry.tags.includes('Retired')) return false;
  if (kind === 'final') return (ROUTE.transcribe?.alternates ?? []).includes(model);
  return true;
}

/** What `GET /sessions/models` returns. */
export function listSttModels() {
  const row = (m: SttModel) => ({
    model: m.model,
    label: m.label,
    good_at: m.good_at,
    tags: m.retired && !m.tags.includes('Retired') ? [...m.tags, 'Retired'] : m.tags,
    price_usd_per_minute: pricePerMinute(m.model, m.kind),
    choosable: isChoosable(m.model, m.kind),
  });
  return {
    live: STT_MODELS.filter((m) => m.kind === 'live').map(row),
    final: STT_MODELS.filter((m) => m.kind === 'final').map(row),
    defaults: { live: DEFAULT_LIVE_MODEL, final: DEFAULT_FINAL_MODEL },
  };
}
