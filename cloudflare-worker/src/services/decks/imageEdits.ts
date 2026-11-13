/**
 * D1544 (#3784, deck builder v2 B8) — an edit of a deck image is a child image.
 *
 * Four edits, each made from one parent row of `deck_images` and stored as a
 * new proposed row with `parent_uid` and `edit_op` (migration 735). The parent
 * row is never changed, so reverting is discarding the child and placing the
 * parent again (`POST /api/decks/images/:uid/revert`).
 *
 *   vary    the same subject and style, a new composition
 *   edit    the founder's instruction applied, everything else kept
 *   erase   what the mask marks in white removed and filled to match
 *   expand  the scene continued outward to a wider (or taller) frame
 *
 * WHICH MODEL. Every edit is D1478's DK5 job ("Edit this image or restyle it
 * to the brand"): FLUX.2 Klein 4B by default, the member's pick when DK5 lists
 * it, and no fallback (`drawChoice` answers `press_hidden` when the partner
 * switch is off or the plan locks it). One exception: a vary of a drawn image
 * whose DK5 cannot run redraws the parent's own description on DK4 (the deck's
 * image job, FLUX.1 Schnell) with a new seed, which needs no reference.
 *
 * THE PARENT AS A REFERENCE. FLUX.2 takes reference images each smaller than
 * 512 by 512 (`REFERENCE_MAX_SIDE_PX`). A deck image is larger, so the Worker
 * resizes it through Cloudflare Images (`env.IMAGES`, the owner's choice on
 * #3784, 2026-11-02) before the quote, so the hold prices the input it sends.
 * No binding, no edit: 503 `resize_unavailable`, nothing run.
 *
 * NEVER A PERSON. Eadwyn never draws a real person (#2434 owner question 7, A),
 * so an edit of an image that shows one (`shows_person`, an upload with the
 * person's agreement recorded) is refused before anything is quoted: the
 * agreement covers the photo, not a drawn change to it. The child is checked
 * like every draw (`postDrawCheck`: a face, the content screen, the alt text)
 * and refused when it shows a face.
 */
import type { Env } from '../../types';
import type { RunOptions } from '../aiRouter';
import { ASPECTS, MAX_REFERENCE_BYTES, REFERENCE_MAX_SIDE_PX, type Aspect, type DrawReference } from '../ai/shapes';
import { imageSize, type ImageMime } from './imageBytes';
import { NOT_ILLUSTRATIVE_MESSAGE, REAL_PERSON_MESSAGE, asksForChart, personIn } from './images';
import { figureRefusal } from './newDeck';
import type { ArtDirection } from './artDirection';

export const EDIT_OPS = ['vary', 'edit', 'erase', 'expand'] as const;
export type EditOp = typeof EDIT_OPS[number];
export const INSTRUCTION_MAX = 400;
/** The words every edit ends with: the guard D903 gives every deck image. */
export const EDIT_GUARD = 'No identifiable people, no faces, no text, no letters, no numbers, no charts or graphs.';
export const PERSON_EDIT_MESSAGE = 'This image shows a person. Eadwyn does not change a photo of a real person; upload a new one instead.';
export const RESIZE_UNAVAILABLE_MESSAGE = 'Images cannot be resized here yet, so this edit cannot be sent. Nothing was run and nothing was charged.';

export class EditRefusal extends Error {
  status: 400 | 422 | 503;
  code: string;
  constructor(status: 400 | 422 | 503, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

export type EditAsk = { op: EditOp; instruction: string | null; mask: DrawReference | null; aspect: Aspect | null };

const MASK_PREFIX = 'data:image/png;base64,';

/** A mask brush's strokes as the editor sends them: a PNG data URI, white where the area goes, at most 512 by 512. */
export function maskOf(v: unknown): DrawReference | EditRefusal {
  if (typeof v !== 'string' || !v.startsWith(MASK_PREFIX)) return new EditRefusal(400, 'invalid_mask', 'Brush over the area to erase first.');
  let bytes: Uint8Array;
  try {
    const bin = atob(v.slice(MASK_PREFIX.length));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  } catch { return new EditRefusal(400, 'invalid_mask', 'The mask could not be read.'); }
  if (!bytes.byteLength || bytes.byteLength > MAX_REFERENCE_BYTES) return new EditRefusal(400, 'invalid_mask', 'The mask is at most 1 MB.');
  const size = imageSize(bytes, 'image/png');
  if (!size) return new EditRefusal(400, 'invalid_mask', 'The mask is a PNG image.');
  if (size.width > REFERENCE_MAX_SIDE_PX || size.height > REFERENCE_MAX_SIDE_PX) {
    return new EditRefusal(400, 'invalid_mask', `The mask is at most ${REFERENCE_MAX_SIDE_PX} by ${REFERENCE_MAX_SIDE_PX} pixels.`);
  }
  return { bytes, mime: 'image/png', width: size.width, height: size.height };
}

/** The checked edit a request asks for, or the refusal. Nothing is read from storage or quoted here. */
export function editAskOf(body: any): EditAsk | EditRefusal {
  const op = body?.op;
  if (!(EDIT_OPS as readonly string[]).includes(op)) return new EditRefusal(400, 'unknown_edit', 'Choose vary, edit, erase or expand.');
  const raw = typeof body?.instruction === 'string' ? body.instruction.replace(/\s+/g, ' ').trim() : '';
  if (raw.length > INSTRUCTION_MAX) return new EditRefusal(400, 'invalid_input', `The instruction is at most ${INSTRUCTION_MAX} characters.`);
  if (op === 'edit' && !raw) return new EditRefusal(400, 'invalid_input', 'Say what to change first.');
  let mask: DrawReference | null = null;
  if (op === 'erase') {
    const m = maskOf(body?.mask);
    if (m instanceof EditRefusal) return m;
    mask = m;
  }
  let aspect: Aspect | null = null;
  if (op === 'expand') {
    if (!(ASPECTS as readonly string[]).includes(body?.aspect)) return new EditRefusal(400, 'invalid_input', `Expand to one of ${ASPECTS.join(', ')}.`);
    aspect = body.aspect as Aspect;
  }
  return { op, instruction: raw || null, mask, aspect };
}

/**
 * What an edit is refused for before anything is quoted: a parent that shows a
 * person, a parent that is not the venture's to change, and an instruction that
 * asks for a person, a figure or a chart. Null when it may go on.
 */
export function editRefusal(parent: { shows_person?: number | null; state?: string | null }, ask: EditAsk, projectId: number, venture: readonly string[]): EditRefusal | null {
  if (Number(parent.shows_person) === 1) return new EditRefusal(422, 'person_edit_refused', PERSON_EDIT_MESSAGE);
  if (parent.state === 'discarded') return new EditRefusal(422, 'image_discarded', 'That image was discarded. Bring it back or pick another one first.');
  const text = ask.instruction ?? '';
  if (text) {
    if (personIn(text, venture)) return new EditRefusal(422, 'real_person', REAL_PERSON_MESSAGE);
    const fig = figureRefusal(text, projectId, 'an image edit');
    if (fig) return new EditRefusal(422, fig.code, fig.message);
    if (asksForChart(text)) return new EditRefusal(422, 'not_illustrative', NOT_ILLUSTRATIVE_MESSAGE);
  }
  return null;
}

/** The words an edit sends the model. The parent is always the first reference image. */
export function editPrompt(ask: EditAsk, art: ArtDirection = {}): string {
  const direction = art.note ? ` Art direction: ${art.note}.` : '';
  const body = ask.op === 'vary'
    ? 'A variation of the first image: the same subject, style and palette, in a new composition.'
    : ask.op === 'edit'
      ? `${ask.instruction}. Keep everything else in the first image as it is.`
      : ask.op === 'erase'
        ? 'Remove from the first image what the second image marks in white, and fill that area so it matches its surroundings. Change nothing else.'
        : `Extend the first image outward to fill a ${ask.aspect} frame, continuing the scene naturally. Keep the original image unchanged at its centre.`;
  return `${body}${direction} ${EDIT_GUARD}`;
}

/** The words a vary sends when it redraws a drawn parent's own description on DK4 (no reference). */
export const redrawPrompt = (parentPrompt: string, art: ArtDirection = {}): string =>
  `${parentPrompt}.${art.note ? ` Art direction: ${art.note}.` : ''} A new composition. ${EDIT_GUARD}`;

const READ_MAX = 10 * 1024 * 1024;

/**
 * An image as a reference a FLUX.2 model takes: kept as it is when it already
 * fits (each side at most 512, at most 1 MB), else resized through Cloudflare
 * Images to fit inside 512 by 512 and sent as JPEG.
 */
export async function asReference(env: Env, bytes: Uint8Array, mime: ImageMime): Promise<DrawReference> {
  const size = imageSize(bytes, mime);
  if (size && size.width <= REFERENCE_MAX_SIDE_PX && size.height <= REFERENCE_MAX_SIDE_PX && bytes.byteLength <= MAX_REFERENCE_BYTES) {
    return { bytes, mime, width: size.width, height: size.height };
  }
  if (!env.IMAGES) throw new EditRefusal(503, 'resize_unavailable', RESIZE_UNAVAILABLE_MESSAGE);
  let out: Uint8Array;
  try {
    const result = await env.IMAGES.input(new Blob([bytes]).stream())
      .transform({ width: REFERENCE_MAX_SIDE_PX, height: REFERENCE_MAX_SIDE_PX, fit: 'scale-down' })
      .output({ format: 'image/jpeg', quality: 85 });
    out = new Uint8Array(await result.response().arrayBuffer());
  } catch {
    throw new EditRefusal(503, 'resize_failed', 'The image could not be resized for the edit. Nothing was run and nothing was charged.');
  }
  const got = imageSize(out, 'image/jpeg');
  if (!got || got.width > REFERENCE_MAX_SIDE_PX || got.height > REFERENCE_MAX_SIDE_PX || !out.byteLength || out.byteLength > Math.min(MAX_REFERENCE_BYTES, READ_MAX)) {
    throw new EditRefusal(503, 'resize_failed', 'The image could not be resized for the edit. Nothing was run and nothing was charged.');
  }
  return { bytes: out, mime: 'image/jpeg', width: got.width, height: got.height };
}

/** The references an edit sends: the parent, then the mask for an erase. */
export const editReferences = (parent: DrawReference, ask: EditAsk): DrawReference[] => (ask.mask ? [parent, ask.mask] : [parent]);

/** The one run an edit makes, so the quote and the run read the same input. */
export function editRunOptions(base: Pick<RunOptions, 'userId' | 'surface' | 'rail'>, ask: EditAsk, references: DrawReference[], art: ArtDirection, seed?: number): RunOptions {
  return {
    ...base, task: 'deck_image', drawJob: 'DK5', text: editPrompt(ask, art).slice(0, 2048),
    draw: { references, ...(ask.aspect ? { aspect: ask.aspect } : {}), ...(seed != null ? { seed } : {}) },
  };
}

/** A vary's redraw of a drawn parent on DK4, when DK5 cannot run. */
export function redrawRunOptions(base: Pick<RunOptions, 'userId' | 'surface' | 'rail'>, parentPrompt: string, aspect: Aspect | null, art: ArtDirection, seed: number): RunOptions {
  return {
    ...base, task: 'deck_image', drawJob: 'DK4', text: redrawPrompt(parentPrompt, art).slice(0, 2048),
    draw: { seed, ...(aspect ? { aspect } : {}) },
  };
}
