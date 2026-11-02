/**
 * D1508 (#3759, deck v2 A15) — deck images nothing references leave R2.
 *
 * Once a day (the 03:00 cleanup, `index.ts`), `sweepDeckImages` removes:
 *   · a discarded image 24 hours after Discard (`discarded_at`);
 *   · a proposal nobody kept, 14 days after it was made (`created_at`).
 * A kept image is never removed here.
 *
 * NOTHING THAT IS NAMED GOES. Before an object is deleted, the rule `NAMED`
 * looks for the image's uid in every store of its venture that can hold a
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

/**
 * The one reference rule, as SQL over the row `deck_images` it sits in: some
 * version, card draft, proposed deck or derivative of the image's venture
 * holds its uid. The claim repeats it, so a save that names the image after
 * the check still keeps it.
 */
const NAMED = `(
     EXISTS (SELECT 1 FROM pitch_decks d WHERE d.project_id = deck_images.project_id
             AND (instr(COALESCE(d.slides, ''), deck_images.uid) > 0 OR instr(COALESCE(d.theme_json, ''), deck_images.uid) > 0))
  OR EXISTS (SELECT 1 FROM pitch_deck_cards c JOIN pitch_decks d ON d.id = c.deck_id
             WHERE d.project_id = deck_images.project_id AND instr(c.json, deck_images.uid) > 0)
  OR EXISTS (SELECT 1 FROM pitch_deck_proposals p WHERE p.project_id = deck_images.project_id AND instr(COALESCE(p.slides, ''), deck_images.uid) > 0)
  OR EXISTS (SELECT 1 FROM deck_derivatives v WHERE v.project_id = deck_images.project_id AND instr(COALESCE(v.slides, ''), deck_images.uid) > 0))`;

/** Whether any version, draft, proposal or derivative of the image's venture names it. Unreadable reads as named. */
export async function imageReferenced(env: Pick<Env, 'DB'>, imageId: number): Promise<boolean> {
  try {
    const row = await env.DB.prepare(`SELECT ${NAMED} AS named FROM deck_images WHERE id = ?`).bind(imageId).first<{ named: number }>();
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
      WHERE (state = 'discarded' AND discarded_at IS NOT NULL AND discarded_at <= datetime(?, ?))
         OR (state = 'proposed' AND created_at <= datetime(?, ?))
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
          SELECT r2_key, project_id, size_bytes, ?, ? FROM deck_images WHERE id = ? AND state = ? AND NOT ${NAMED}`).bind(reason, sqlTime(now), img.id, img.state),
        env.DB.prepare(`DELETE FROM deck_images WHERE id = ? AND state = ? AND NOT ${NAMED}`).bind(img.id, img.state),
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
