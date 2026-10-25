/**
 * D898 (#2676) — migration 539's four `pitch_decks` columns, added where it
 * has not run. D1 has no `ADD COLUMN IF NOT EXISTS`, so the table is probed
 * first. Every runtime `CREATE TABLE pitch_decks` awaits this right after
 * (`routes/decks.ts` `ensureSchema`, and the advisor's deck-draft seed in
 * `services/advisor/writeRouter.ts`), so whichever bootstrap wins, the
 * columns exist.
 *
 * Its own file, importing nothing at run time, so the advisor's write router
 * does not pull the deck's source adapters in behind it.
 */
import type { Env } from '../../types';

export async function ensureDeckVersionColumns(env: Env): Promise<void> {
  try {
    const cols = await env.DB.prepare('PRAGMA table_info(pitch_decks)').all<any>();
    const have = new Set(((cols.results || []) as any[]).map((r) => String(r.name)));
    const add539: Array<[string, string]> = [
      ['audience', `ALTER TABLE pitch_decks ADD COLUMN audience TEXT CHECK (audience IS NULL OR audience IN ('angel', 'pre_seed_fund', 'seed_fund', 'series_a_fund', 'strategic', 'grant', 'other'))`],
      ['round_ref', 'ALTER TABLE pitch_decks ADD COLUMN round_ref TEXT'],
      ['theme_json', 'ALTER TABLE pitch_decks ADD COLUMN theme_json TEXT'],
      ['content_hash', `ALTER TABLE pitch_decks ADD COLUMN content_hash TEXT CHECK (content_hash IS NULL OR (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'))`],
    ];
    for (const [col, ddl] of add539) {
      if (!have.has(col)) {
        try { await env.DB.prepare(ddl).run(); } catch {}
      }
    }
  } catch {}
}

/**
 * D897 (#2677) — migration 542's two `pitch_deck_proposals` columns, added
 * where it has not run: a New deck's outline and the cards the founder kept.
 * `routes/decks.ts` `ensureSchema` awaits it right after the table exists.
 */
export async function ensureProposalOutlineColumns(env: Env): Promise<void> {
  try {
    const cols = await env.DB.prepare('PRAGMA table_info(pitch_deck_proposals)').all<any>();
    const have = new Set(((cols.results || []) as any[]).map((r) => String(r.name)));
    const add542: Array<[string, string]> = [
      ['outline_json', 'ALTER TABLE pitch_deck_proposals ADD COLUMN outline_json TEXT'],
      ['kept_slides_json', 'ALTER TABLE pitch_deck_proposals ADD COLUMN kept_slides_json TEXT'],
    ];
    for (const [col, ddl] of add542) {
      if (!have.has(col)) {
        try { await env.DB.prepare(ddl).run(); } catch {}
      }
    }
  } catch {}
}
