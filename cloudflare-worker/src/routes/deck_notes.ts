/**
 * D905 (#2684, part 11 of #2434) — notes on a venture's pitch deck.
 *
 *   GET  /api/decks/:id/notes   the venture's thread, every version, oldest first
 *   POST /api/decks/:id/notes   { body, card_index? } posts one note on that version
 *
 * The owner's answer A to question 6: founders write the deck; Admin and Super
 * Admin read it and leave notes; investors and partners see it only through a
 * link. So:
 *   - an Admin on this deployment, or the Super Admin on HQ, reads and posts;
 *   - the venture's founders (its owner, an accepted owner or cofounder member)
 *     read and answer;
 *   - nobody else: an investor, an advisor member and an Operating Partner are
 *     not found, as they are on the studio itself (PD22).
 *
 * A note is the founder's to read. No share, export or public read selects
 * `deck_notes` (migration 538), and the deck's own reads do not include it.
 * Every post writes one `raise.pitch-deck` activity row (D691 decision 12) in
 * the same batch, naming the card and version, never the note's words.
 *
 * Mounted before `routes/decks.ts`; its paths are two segments, so they never
 * shadow `GET /api/decks/:id`.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { hydrateSuperAdmin, isSuperAdmin, requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { logCycleWriteStatement } from '../services/cycleActivity';

const deckNotes = new Hono<{ Bindings: Env }>();

export const NOTE_MAX = 2000;
export const NOTE_LIST_MAX = 500;

type Kind = 'admin' | 'super_admin' | 'founder';
type DeckRow = { id: number; project_id: number; version: number; slides: string | null };
type NoteRow = {
  id: number; deck_id: number; deck_version: number; card_index: number | null; body: string;
  author_kind: Kind; author_name: string | null; created_at: string;
};

const NOT_FOUND = { error: 'deck_not_found', message: 'That deck is not one you can read.' };

/**
 * What the caller is to this deck's notes, or null: an admin (or the Super
 * Admin on HQ) by role; a founder only with the deck's write access, so an
 * advisor member, who can read the deck itself, reads no notes.
 */
async function noteRole(c: any, user: User, projectId: number, posting: boolean): Promise<Kind | null> {
  if (String(user.role || '').toLowerCase() === 'admin') {
    return isSuperAdmin(await hydrateSuperAdmin(c.env, user)) ? 'super_admin' : 'admin';
  }
  try {
    // A founder's post is a write: projectOwned records a non-owner's authorization first.
    await projectOwned(c, user, projectId, { write: true, audit: posting });
    return 'founder';
  } catch {
    return null;
  }
}

async function deckRow(env: Env, id: number): Promise<DeckRow | null> {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return env.DB.prepare('SELECT id, project_id, version, slides FROM pitch_decks WHERE id = ?').bind(id).first<DeckRow>();
}

const slideCount = (row: DeckRow) => {
  try { const s = JSON.parse(row.slides || '[]'); return Array.isArray(s) ? s.length : 0; } catch { return 0; }
};

function noteView(r: NoteRow) {
  return {
    id: r.id,
    deck_id: r.deck_id,
    deck_version: r.deck_version,
    card_index: r.card_index,
    body: r.body,
    author: { name: r.author_name ?? null, kind: r.author_kind },
    created_at: r.created_at,
  };
}

deckNotes.get('/:id/notes', async (c) => {
  const user = await requireAuth(c);
  const row = await deckRow(c.env, Number(c.req.param('id')));
  if (!row) return c.json(NOT_FOUND, 404);
  const kind = await noteRole(c, user, Number(row.project_id), false);
  if (!kind) return c.json(NOT_FOUND, 404);
  const rows = (await c.env.DB.prepare(
    `SELECT n.id, n.deck_id, n.deck_version, n.card_index, n.body, n.author_kind, n.created_at, u.name AS author_name
       FROM deck_notes n LEFT JOIN users u ON u.id = n.author_user_id
      WHERE n.project_id = ?
      ORDER BY n.created_at, n.id LIMIT ?`,
  ).bind(row.project_id, NOTE_LIST_MAX).all<NoteRow>()).results ?? [];
  return c.json({ notes: rows.map(noteView), viewer: kind });
});

deckNotes.post('/:id/notes', async (c) => {
  const user = await requireAuth(c);
  const row = await deckRow(c.env, Number(c.req.param('id')));
  if (!row) return c.json(NOT_FOUND, 404);
  const kind = await noteRole(c, user, Number(row.project_id), true);
  if (!kind) return c.json(NOT_FOUND, 404);

  const input = await c.req.json().catch(() => null) as { body?: unknown; card_index?: unknown } | null;
  const body = typeof input?.body === 'string' ? input.body.trim() : '';
  if (!body) return c.json({ error: 'note_required', message: 'Write the note first.' }, 400);
  if (body.length > NOTE_MAX) return c.json({ error: 'note_too_long', message: `A note is at most ${NOTE_MAX.toLocaleString('en-US')} characters.` }, 400);
  let card: number | null = null;
  if (input?.card_index !== undefined && input?.card_index !== null) {
    const n = Number(input.card_index);
    if (!Number.isInteger(n) || n < 0 || n >= slideCount(row)) {
      return c.json({ error: 'invalid_card', message: 'That card is not in this version of the deck.' }, 400);
    }
    card = n;
  }

  const projectId = Number(row.project_id);
  const where = card === null ? 'the deck' : `card ${card + 1}`;
  const [insert] = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO deck_notes (project_id, deck_id, deck_version, card_index, author_user_id, author_kind, body)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(projectId, row.id, row.version, card, user.id, kind, body),
    logCycleWriteStatement(c.env, {
      projectId, userId: Number(user.id), cycle: 'raise', module: 'pitch-deck', entityId: row.id,
      action: 'deck_note_posted', summary: `Note posted on ${where}, v${row.version}`,
    }),
  ]);
  const id = Number(insert?.meta?.last_row_id);
  const saved = await c.env.DB.prepare(
    `SELECT n.id, n.deck_id, n.deck_version, n.card_index, n.body, n.author_kind, n.created_at, u.name AS author_name
       FROM deck_notes n LEFT JOIN users u ON u.id = n.author_user_id WHERE n.id = ? AND n.project_id = ?`,
  ).bind(id, projectId).first<NoteRow>();
  if (!saved) return c.json({ error: 'note_unreadable', message: 'The note was saved but could not be read back. Reload the notes.' }, 500);
  return c.json({ note: noteView(saved) }, 201);
});

export default deckNotes;
