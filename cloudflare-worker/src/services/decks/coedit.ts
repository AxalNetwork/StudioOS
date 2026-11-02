/**
 * D1577 (#3824, deck v2 E4) — co-editing a deck: what an area save may change,
 * what a single-slide restore puts back, and the presence and soft-lock rules
 * the `DeckPresence` Durable Object applies. Pure, so every rule is tested
 * without a database or a socket.
 *
 * AN AREA is one place on a card a member edits: a block, by its `id`, or the
 * card's title (`AREA_TITLE`). Two members editing different areas of one card
 * must never lose an edit; two members editing the same area must never
 * overwrite each other without being told.
 *
 *   - `mergeArea` applies one area onto the card as the server holds it now,
 *     but only when that area still reads as the member read it (`base`). Any
 *     other area may have changed meanwhile: it is kept as the server has it.
 *   - An area that changed since the member read it is `area_conflict`, with
 *     the server's copy, and nothing is saved.
 *
 * SINGLE-SLIDE RESTORE (`restoreOneCard`): one card of an older version
 * replaces the card with the same `uid` in the current version. Every other
 * card, its order and its content, is left as it is. A card the current
 * version no longer has goes back at its old place.
 *
 * PRESENCE AND SOFT LOCKS: each editor is one socket. Its state lives in the
 * socket's attachment (no Durable Object storage): who, a colour, the card and
 * area it is editing, when it last edited there, and its cursor. A soft lock is
 * advisory: the area an editor is in is theirs until `LOCK_TTL_MS` after their
 * last edit there. Another editor who enters it is told who holds it ("Wait or
 * ask [Name]"); the hard guarantee is still `mergeArea` on the save.
 */

export const AREA_TITLE = '__title';
export const AREA_ID = /^[A-Za-z0-9_-]{1,40}$/;
/** A soft lock lapses this long after its holder's last edit in the area. */
export const LOCK_TTL_MS = 30_000;
/** At most five cursor frames a second per editor (the cost estimate in D1577 assumes it). */
export const CURSOR_MIN_MS = 200;
/** At most this many editors on one deck at once. */
export const EDITORS_MAX = 12;

/** Stable JSON: the same value always reads the same, whatever its key order. */
export function stable(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
}

const blocksOf = (card: any): any[] => (Array.isArray(card?.blocks) ? card.blocks : []);

/** An area of a card as it reads now: the title string, the block, or null when the card has no such area. */
export function areaOf(card: any, area: string): unknown {
  if (area === AREA_TITLE) return typeof card?.title === 'string' ? card.title : '';
  return blocksOf(card).find((b) => b && String(b.id) === area) ?? null;
}

export type AreaMerge =
  | { ok: true; card: any; changed: boolean }
  | { ok: false; code: 'area_conflict'; server: unknown }
  | { ok: false; code: 'invalid_area'; message: string };

/**
 * One area applied onto the card the server holds now. `base` is the area as
 * the member read it (null for a block they are adding); `next` is what they
 * wrote (null removes the block).
 */
export function mergeArea(current: any, area: string, base: unknown, next: unknown): AreaMerge {
  if (!AREA_ID.test(area)) return { ok: false, code: 'invalid_area', message: 'That is not an area of this card.' };
  const card = current && typeof current === 'object' ? current : {};
  const now = areaOf(card, area);
  if (area === AREA_TITLE) {
    if (typeof next !== 'string') return { ok: false, code: 'invalid_area', message: 'A title is text.' };
    if (stable(now) !== stable(base ?? '')) return { ok: false, code: 'area_conflict', server: now };
    return { ok: true, card: { ...card, title: next }, changed: next !== now };
  }
  if (next !== null && (typeof next !== 'object' || Array.isArray(next) || String((next as any).id) !== area)) {
    return { ok: false, code: 'invalid_area', message: 'A block keeps its own id.' };
  }
  if (stable(now) !== stable(base ?? null)) return { ok: false, code: 'area_conflict', server: now };
  const blocks = blocksOf(card);
  let out: any[];
  if (next === null) out = blocks.filter((b) => !(b && String(b.id) === area));
  else if (now === null) out = [...blocks, next];
  else out = blocks.map((b) => (b && String(b.id) === area ? next : b));
  return { ok: true, card: { ...card, blocks: out }, changed: stable(now) !== stable(next) };
}

export type RestoreOne =
  | { ok: true; slides: any[]; placed: 'replaced' | 'reinserted'; index: number }
  | { ok: false; code: 'card_not_in_version' | 'unchanged' };

/** One card of an older version put back into the current one; nothing else moves. */
export function restoreOneCard(current: readonly any[], older: readonly any[], uid: string): RestoreOne {
  const from = older.findIndex((s) => s && s.uid === uid);
  if (from < 0) return { ok: false, code: 'card_not_in_version' };
  const card = older[from];
  const at = current.findIndex((s) => s && s.uid === uid);
  if (at >= 0) {
    if (stable(current[at]) === stable(card)) return { ok: false, code: 'unchanged' };
    return { ok: true, slides: current.map((s, i) => (i === at ? card : s)), placed: 'replaced', index: at };
  }
  const index = Math.min(from, current.length);
  return { ok: true, slides: [...current.slice(0, index), card, ...current.slice(index)], placed: 'reinserted', index };
}

// ─────────────────────────────────────────────────────────── presence

/** Eight editor colours that hold 3:1 against the light and the dark canvas. */
export const EDITOR_COLOURS = Object.freeze(['#2563eb', '#c2410c', '#15803d', '#9333ea', '#be123c', '#0e7490', '#a16207', '#4f46e5']);

/** A member's colour, the same on every deck and every tab. */
export const colourOf = (userId: number) => EDITOR_COLOURS[Math.abs(Math.trunc(Number(userId) || 0)) % EDITOR_COLOURS.length];

export type Editor = {
  userId: number; name: string | null; colour: string; tab: string;
  card: string | null; area: string | null; areaAt: number;
  cursor: { x: number; y: number } | null; cursorAt: number;
};

/** What every editor is shown of another: never an address, a token or a role. */
export function editorView(e: Editor, now: number) {
  return {
    user_id: e.userId, name: e.name, colour: e.colour,
    card: e.card, area: e.area && now - e.areaAt < LOCK_TTL_MS ? e.area : null,
    cursor: e.cursor,
  };
}

/** Who holds an area's soft lock, other than `self`, or null. One member's own tabs never lock each other out. */
export function lockHolder(editors: readonly Editor[], self: Editor, card: string, area: string, now: number): Editor | null {
  return editors.find((e) => e !== self && e.userId !== self.userId && e.card === card && e.area === area && now - e.areaAt < LOCK_TTL_MS) ?? null;
}

export const waitOrAsk = (holder: { name: string | null }) => `${holder.name || 'Another member'} is editing this area. Wait or ask ${holder.name || 'them'}.`;

const unit = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);
const idOrNull = (v: unknown) => (typeof v === 'string' && AREA_ID.test(v) ? v : null);

export type Step =
  | { kind: 'ignore' }
  | { kind: 'broadcast'; editor: Editor }
  | { kind: 'locked'; editor: Editor; holder: Editor; message: string };

/**
 * One frame from an editor, applied to its state. `cursor` frames faster than
 * `CURSOR_MIN_MS` are dropped; `area` claims or leaves an area (a claim on an
 * area someone else holds is refused, the editor keeps no lock there);
 * `edit` refreshes the lock's clock.
 */
export function step(editors: readonly Editor[], self: Editor, frame: unknown, now: number): Step {
  const f = frame && typeof frame === 'object' ? (frame as Record<string, unknown>) : {};
  if (f.type === 'cursor') {
    if (now - self.cursorAt < CURSOR_MIN_MS) return { kind: 'ignore' };
    const x = unit(f.x); const y = unit(f.y);
    const card = idOrNull(f.card);
    const cursor = x == null || y == null ? null : { x, y };
    return { kind: 'broadcast', editor: { ...self, cursor, card: card ?? self.card, cursorAt: now } };
  }
  if (f.type === 'area') {
    const card = idOrNull(f.card);
    const area = idOrNull(f.area);
    if (!card || !area) return { kind: 'broadcast', editor: { ...self, area: null, areaAt: 0, card: card ?? self.card } };
    const holder = lockHolder(editors, self, card, area, now);
    if (holder) return { kind: 'locked', editor: { ...self, card, area: null, areaAt: 0 }, holder, message: waitOrAsk(holder) };
    return { kind: 'broadcast', editor: { ...self, card, area, areaAt: now } };
  }
  if (f.type === 'edit') {
    if (!self.area) return { kind: 'ignore' };
    return { kind: 'broadcast', editor: { ...self, areaAt: now } };
  }
  return { kind: 'ignore' };
}
