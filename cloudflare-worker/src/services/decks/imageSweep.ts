/**
 * D1508 (#3759, deck v2 A15) — deck images nothing references leave R2.
 *
 * Once a day (the 03:00 cleanup, `models/jobs.ts` `Jobs.cleanup`), `sweepDeckImages` removes:
 *   · a discarded image 24 hours after Discard (`discarded_at`);
 *   · a proposal nobody kept, 14 days after it was made (`created_at`).
 * A kept image is never removed here, and neither is one HQ took down (#4375):
 * its row is the record, and the file route answers the placeholder from it.
 *
 * NOTHING THAT IS NAMED GOES. Before an object is deleted, the view
 * `deck_images_named` (migration 722, the one copy of the rule) looks for
 * the image's uid in every store of its venture that can hold a
 * card: every saved version (`pitch_decks.slides` and `theme_json`), every
 * card draft (`pitch_deck_cards.json`), every proposed deck
 * (`pitch_deck_proposals.slides`) and every derivative
 * (`deck_derivatives.slides`). A slide names an image by its file URL
 * (`/api/decks/images/<uid>/file`) or its `image_id`; both hold the uid. When
 * that check cannot be read, the image stays. The claim below repeats the rule
 * inside its own statements, so a save in between still keeps the image.
 *
 * For each image removed, one batch writes its tombstone (`deck_r2_tombstones`,
 * migration 722) and deletes its row, both only while the row is still in the
 * state this run read; then the R2 object is deleted. A Keep pressed in the
 * meantime finds no row to keep, never a row whose file is gone. The row is
 * what any measure of the venture's stored bytes reads, so deleting it is the
 * credit back. An R2 delete that fails is counted; its tombstone names the
 * key for an operator.
 *
 * At most `MAX_DELETES` objects per run, oldest first; a run scans at most
 * `MAX_SCANNED` candidates, so images that stay referenced cannot starve the
 * rest. Logs carry counts only.
 */
import type { Env } from '../../types';

export const DISCARDED_AFTER_HOURS = 24;
export const PROPOSAL_AFTER_DAYS = 14;
export const MAX_DELETES = 500;
export const MAX_SCANNED = 2000;

type Candidate = { id: number; uid: string; project_id: number; r2_key: string; size_bytes: number | null; state: 'discarded' | 'proposed' };

/** SQLite's own timestamp form, `YYYY-MM-DD HH:MM:SS`, for `now`. */
const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

/** Whether any version, draft, proposal or derivative of the image's venture names it. Unreadable reads as named. */
export async function imageReferenced(env: Pick<Env, 'DB'>, imageId: number): Promise<boolean> {
  try {
    const row = await env.DB.prepare('SELECT EXISTS (SELECT 1 FROM deck_images_named WHERE id = ?) AS named').bind(imageId).first<{ named: number }>();
    return !row || Number(row.named) !== 0;
  } catch {
    return true;
  }
}

/** The images past their time, oldest first. */
async function candidates(env: Pick<Env, 'DB'>, now: Date): Promise<Candidate[]> {
  const at = sqlTime(now);
  const rows = await env.DB.prepare(
    `SELECT id, uid, project_id, r2_key, size_bytes, state FROM deck_images
      WHERE ((state = 'discarded' AND discarded_at IS NOT NULL AND discarded_at <= datetime(?, ?))
         OR (state = 'proposed' AND created_at <= datetime(?, ?)))
        -- #4375: a row HQ took down stays: it is the record of the takedown, and the file route
        -- answers the placeholder from it for every card that still names the image.
        AND taken_down_at IS NULL
      ORDER BY COALESCE(discarded_at, created_at), id LIMIT ?`,
  ).bind(at, `-${DISCARDED_AFTER_HOURS} hours`, at, `-${PROPOSAL_AFTER_DAYS} days`, MAX_SCANNED).all<Candidate>();
  return (rows.results || []) as Candidate[];
}

export type SweepResult = { scanned: number; deleted: number; kept_named: number; failed: number; bytes: number };

/** One day's sweep. Never throws for one image; an unreadable candidate list answers zero. */
export async function sweepDeckImages(env: Env, now: Date = new Date()): Promise<SweepResult> {
  const out: SweepResult = { scanned: 0, deleted: 0, kept_named: 0, failed: 0, bytes: 0 };
  if (!env.FILES) return out;
  let list: Candidate[];
  try { list = await candidates(env, now); } catch { console.error('[deck-image-sweep] candidates unreadable'); return out; }
  for (const img of list) {
    if (out.deleted >= MAX_DELETES) break;
    out.scanned++;
    if (await imageReferenced(env, img.id)) { out.kept_named++; continue; }
    // The row is the claim: the tombstone and the delete land only while the row is still what this run read,
    // so a proposal kept in the meantime stays whole. Only then does the object leave R2.
    const reason = img.state === 'discarded' ? 'discarded' : 'unkept_proposal';
    let claimed = false;
    try {
      const [, del] = await env.DB.batch([
        env.DB.prepare(`INSERT OR IGNORE INTO deck_r2_tombstones (key, project_id, bytes, reason, deleted_at)
          SELECT r2_key, project_id, size_bytes, ?, ? FROM deck_images WHERE id = ? AND state = ?
            AND NOT EXISTS (SELECT 1 FROM deck_images_named n WHERE n.id = deck_images.id)`).bind(reason, sqlTime(now), img.id, img.state),
        env.DB.prepare(`DELETE FROM deck_images WHERE id = ? AND state = ?
          AND NOT EXISTS (SELECT 1 FROM deck_images_named n WHERE n.id = deck_images.id)`).bind(img.id, img.state),
      ]);
      claimed = Number((del as any)?.meta?.changes ?? 0) === 1;
    } catch { out.failed++; continue; }
    if (!claimed) continue;
    try { await env.FILES.delete(img.r2_key); } catch { out.failed++; continue; }
    out.deleted++;
    out.bytes += img.size_bytes == null ? 0 : Number(img.size_bytes);
  }
  console.info(`[deck-image-sweep] scanned=${out.scanned} deleted=${out.deleted} named=${out.kept_named} failed=${out.failed}`);
  return out;
}
