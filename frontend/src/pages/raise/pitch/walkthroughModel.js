/**
 * D4599 part 2 (#4599, D1590 F11) — the recorded walkthrough's words and
 * derivations: pd36 (Present › Record) and pd35's Walkthrough column. Pure: no
 * network, no React. The Worker keeps the takes (`routes/deck_recordings.ts`);
 * this file only says what the screens draw from its answers.
 *
 * A take belongs to one card of the version, numbered as the Worker numbers
 * it: the card's place in the version's `slides`, hidden cards included
 * (`slideNumbers`). Present shows only the cards that are not hidden, so each
 * shown card carries its Worker number.
 */
import { presentHref } from './presentExportModel.js';
import { aiTokens, refusalOf } from './newDeckModel.js';
import { clock } from './rehearseModel.js';
import { NOT_RECORDED } from '../../../lib/absence.js';

export { clock };

export const RECORD = 'Record';
export const RECORD_TITLE = 'Record a pitch';
/** pd36's line under Attach. Owner decision W = A: a take is kept until its maker deletes it. */
export const STORED = 'Stored with your deck; delete it any time.';
// The one definition (absence_helpers_single_definition): imported, never re-declared.
export { NOT_RECORDED };
export const RECORDING = 'Recording';
export const READING = 'Reading your walkthrough…';
export const UNREADABLE = 'Your walkthrough could not be read.';
export const TRY_AGAIN = 'Try again';
export const CAPTIONS_NOT_RECORDED = 'Captions not recorded for this take.';
export const PLAY_FAILED = 'This take could not be played. Try again, or record it again.';
export const DELETE_TITLE = 'Delete this take?';
export const DELETE_BODY = 'The take and its file are removed for good. Investor links stop playing it.';
export const DELETE_FAILED = 'The take could not be deleted. Try again.';
export const SENDING = 'Sending…';
export const SHORT = 'Too short to keep: a take is at least one second.';
export const TOO_LARGE = 'The take is larger than 40 MB. Record a shorter take.';
/** An upload that never reached the Worker, or never came back: the take is kept here to send again. */
export const INTERRUPTED = 'The upload was interrupted. The take is still here: send it again.';
export const SEND_AGAIN = 'Send again';
export const NO_LINKS = 'No live investor link on this version yet. Create one in Share, then attach the walkthrough to it.';
export const LINKS_UNREAD = 'Your investor links could not be read.';
export const ATTACH_NEEDS_TAKE = 'Record at least one card before attaching the walkthrough.';
export const DEVICES_LATER = 'The camera and microphone are asked for when you start.';
export const ONE_TAKE_A_CARD = 'One take a card, up to three minutes each. A retake replaces that card\'s take.';

/** getUserMedia's refusals, in words the founder can act on. */
export const PERMISSION_DENIED = 'Camera and microphone access was refused. Allow both for this site in your browser\'s settings, then try again.';
export const NO_DEVICE = 'No camera or microphone was found. Connect one, then try again.';
export const DEVICE_BUSY = 'The camera or microphone is in use by another app. Close it there, then try again.';
export const NO_RECORDER = 'This browser cannot record video here. Open the deck in a current Chrome, Edge, Firefox or Safari.';

/** The Worker's limits (`services/decks/recordings.ts`): one second to three minutes, 40 MB; the sound captioned at most 5 MB. */
export const MIN_TAKE_MS = 1_000;
export const MAX_TAKE_MS = 180_000;
export const MAX_MEDIA_BYTES = 40 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
/** The take's own sound, sent beside it for the captions; the Worker counts minutes at 32 kbps. */
export const AUDIO_BITS_PER_SECOND = 32_000;

/** Each shown (not hidden) card's number as the Worker counts it: its 1-based place in `slides`. */
export function slideNumbers(deck) {
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  const out = [];
  slides.forEach((s, k) => { if (!(s && typeof s === 'object' && s.hidden === true)) out.push(k + 1); });
  return out;
}

/** The walkthrough read as the screens use it: each Worker card's newest take (or null), how many, and the attached links. */
export function walkthroughOf(value) {
  const cards = Array.isArray(value?.cards) ? value.cards : [];
  const links = Array.isArray(value?.links) ? value.links.map(Number).filter(Number.isFinite) : [];
  return { cards, recorded: Number.isFinite(Number(value?.recorded)) ? Number(value.recorded) : cards.filter(Boolean).length, links };
}

/** A card's take by its Worker number, or null. */
export const takeFor = (walk, slideNo) => walk?.cards?.[slideNo - 1] || null;

/**
 * pd36's chip for one shown card: "Slide 1 · Take 2 ✓", "Slide 2 · Recording", "Slide 3 · Not recorded", or the
 * state of its upload. `pending` is the card's upload, if one is under way or failed.
 */
export function chipOf({ index, take, recording = false, pending = null }) {
  const head = `Slide ${index + 1}`;
  if (recording) return { line: `${head} · ${RECORDING}`, state: 'recording' };
  if (pending?.status === 'sending') return { line: `${head} · ${SENDING}`, state: 'sending' };
  if (pending && pending.status !== 'sending') return { line: `${head} · Not sent`, state: pending.status };
  if (take) return { line: `${head} · Take ${take.take} ✓`, state: 'recorded' };
  return { line: `${head} · ${NOT_RECORDED}`, state: 'empty' };
}

/** pd36's top line while recording: "Recording · 0:42 · Slide 2 of 3 · use ← → to move". */
export const recordingLine = (ms, i, n) => `${RECORDING} · ${clock(ms)} · Slide ${i + 1} of ${n} · use ← → to move`;

/** The captions' price before a take, from the quote: null until it is read. */
export function captionHoldLine(quote) {
  const hold = aiTokens(quote?.hold_microusd);
  return hold ? `Captions · Holds up to ${hold} a take · you pay what it uses` : null;
}

/** The caption cue at `ms` into the take, or null between cues. */
export function cueAt(captions, ms) {
  if (!Array.isArray(captions)) return null;
  const hit = captions.find((c) => Number(c?.start_ms) <= ms && ms < Number(c?.end_ms));
  return hit ? String(hit.text || '').trim() || null : null;
}

/** What the browser can record a take as, in the Worker's formats, or null when it cannot record at all. */
export function pickVideoMime(MR) {
  if (typeof MR !== 'function') return null;
  const ok = (m) => (typeof MR.isTypeSupported === 'function' ? MR.isTypeSupported(m) : false);
  return ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(ok) || '';
}
export function pickAudioMime(MR) {
  if (typeof MR !== 'function') return null;
  const ok = (m) => (typeof MR.isTypeSupported === 'function' ? MR.isTypeSupported(m) : false);
  return ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'].find(ok) || '';
}
/** The type the Worker is told: the recorder's own, without its codecs. */
export const baseMime = (type, fallback) => String(type || fallback || '').split(';')[0].trim().toLowerCase();

/** A refused getUserMedia, by the browser's own error name. */
export function permissionProblem(e) {
  const name = String(e?.name || '');
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return { kind: 'permission', message: PERMISSION_DENIED };
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return { kind: 'device', message: NO_DEVICE };
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return { kind: 'busy', message: DEVICE_BUSY };
  return { kind: 'permission', message: PERMISSION_DENIED };
}

/** True when the upload never got a Worker answer: the network dropped, or the request ran out of time. */
export const interrupted = (e) => e?.code === 'timeout' || !Number.isFinite(Number(e?.status)) || Number(e?.status) === 0;

/**
 * A failed upload: `interrupted` (sent again as it is), or the Worker's refusal in its own words (a full plan, a
 * budget stop with its top-up link). Either way the take stays in the browser until it is sent or recorded again.
 */
export function uploadProblem(e) {
  if (interrupted(e)) return { status: 'interrupted', message: INTERRUPTED, topUp: null, link: null };
  const r = refusalOf(e) || {};
  return { status: 'failed', message: r.message || 'The take could not be sent. Nothing was stored.', topUp: r.topUp || null, link: r.link || null, code: r.code || null };
}

/** Before a take is sent: a reason it cannot be, or null. */
export function takeProblem({ durationMs, size }) {
  if (!(durationMs >= MIN_TAKE_MS)) return { status: 'short', message: SHORT };
  if (size > MAX_MEDIA_BYTES) return { status: 'too_large', message: TOO_LARGE };
  return null;
}

/** Present, opened on Record for this version. */
export function recordHref(projectId, deckId) {
  const href = presentHref(projectId, deckId);
  return `${href}${href.includes('?') ? '&' : '?'}view=record`;
}

/** pd35's Walkthrough cell for one link: "Attached · 3 slides", Attach, or "Record ›". */
export function walkthroughCell(walk, row) {
  const id = Number(row?.id);
  const n = walk?.recorded || 0;
  const slides = `${n} ${n === 1 ? 'slide' : 'slides'}`;
  if (walk?.links?.includes(id)) return { kind: 'attached', line: `Attached · ${slides}` };
  if (row?.status !== 'live') return { kind: 'none', line: 'Not attached' };
  if (!n) return { kind: 'record', line: 'Record ›' };
  return { kind: 'attach', line: `Attach · ${slides}` };
}

/** A live link's name in pd36's "Attach to [Fund]'s link". */
export function linkName(row) {
  const fund = row?.investor?.fund;
  const label = row?.investor?.label;
  return String(fund || label || 'this investor').trim();
}
