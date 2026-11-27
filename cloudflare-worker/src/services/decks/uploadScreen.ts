/**
 * D1534 (#3778 phase 1, deck v2 B2) — an uploaded or imported image is
 * SCREENED, and the screen FLAGS; it never blocks. The question is #3756's
 * image screen (`postDraw.ts` `SCREEN_QUESTION`), asked once of the stored
 * picture through `run()` on the deck's image page, charged to the member who
 * uploaded it (the upload is their press).
 *
 *   flagged: true    the screen answered yes: the image is kept, and the page
 *                    says it was flagged so the founder looks again
 *   flagged: false   the screen answered no
 *   flagged: null    the screen did not answer (a refusal, a budget stop, an
 *                    unreadable reply): "Not screened", never "passed"
 *
 * The result is written to `deck_images.qa_json` as `{ screen, screened: 'upload' }`.
 * Nothing here logs the image, its name or its alt text.
 */
import type { Env } from '../../types';
import { run as aiRun, type RailContext, type RunOptions, type RunResult } from '../aiRouter';
import { AI_SURFACE } from '../aiSurfaces';
import { SCREEN_QUESTION } from '../ai/postDraw';

export const FLAGGED_LINE = 'The image screen flagged this upload. It was kept; look at it again before you share the deck.';
export const NOT_SCREENED_LINE = 'This upload could not be screened.';

export const UPLOAD_SCREEN_DEPS: { run: (env: Env, o: RunOptions) => Promise<RunResult> } = { run: aiRun };

const toDataUri = (mime: string, bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
};

/** Yes, no, or null when the reply is neither. */
export function screenAnswer(r: Pick<RunResult, 'ok' | 'output'>): boolean | null {
  if (!r.ok) return null;
  const w = String(r.output ?? '').trim().toLowerCase();
  return w.startsWith('yes') ? true : w.startsWith('no') ? false : null;
}

/** Screen one stored upload and record the answer on its row. Never throws. */
export async function screenUpload(env: Env, o: { userId: number; rail: RailContext; imageUid: string; mime: string; bytes: Uint8Array }): Promise<boolean | null> {
  let flagged: boolean | null = null;
  try {
    const r = await UPLOAD_SCREEN_DEPS.run(env, {
      task: 'image_screen' as RunOptions['task'], userId: o.userId, surface: AI_SURFACE.raisePitch, rail: o.rail,
      text: SCREEN_QUESTION, images: [toDataUri(o.mime, o.bytes)], maxTokens: 8,
    } as RunOptions);
    flagged = screenAnswer(r);
  } catch { flagged = null; }
  try {
    await env.DB.prepare('UPDATE deck_images SET qa_json = ? WHERE uid = ?').bind(JSON.stringify({ screen: flagged, screened: 'upload' }), o.imageUid).run();
  } catch { console.warn('[deck-images] upload screen not recorded'); }
  return flagged;
}

/** The screen's words for a stored row's `qa_json`; null for a row no upload screen read. */
export function screenOf(qaJson: unknown): { flagged: boolean | null; line: string | null } | null {
  let qa: any = null;
  try { qa = typeof qaJson === 'string' && qaJson ? JSON.parse(qaJson) : null; } catch { qa = null; }
  if (!qa || qa.screened !== 'upload') return null;
  const flagged = qa.screen === true ? true : qa.screen === false ? false : null;
  return { flagged, line: flagged === true ? FLAGGED_LINE : flagged === null ? NOT_SCREENED_LINE : null };
}
