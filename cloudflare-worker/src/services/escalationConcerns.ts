/**
 * What a content escalation concerns (D208, #312).
 *
 * THE ABSENCE THIS CLOSES, AND THE ONE IT DOES NOT. D112 gave HQ's Content page
 * a localisation lane over escalations of kind `content`, and left one gap
 * standing: nothing said WHICH item a submission was about. The items live on
 * the branch — its own articles, and HQ's template library as pushed to it
 * (D147) — in a database HQ cannot read (D.2). So a foreign key is out by
 * construction, and migration 259's header already says so: `subject_ref` is
 * free text on purpose, "a label a person can act on". This file builds that
 * label from the row the branch holds.
 *
 * ONE LABEL FORMAT, BUILT HERE AND NOWHERE ELSE. The list the drawer offers and
 * the value the route stores both come from `concernLabel`, so the words a
 * branch admin picks are the words HQ reads, byte for byte. A second format —
 * one for the menu, one for the stored row — is how a pick and its record
 * drift apart, and the SPA is refused one: it renders the label it was sent.
 *
 * A LABEL, NOT A LINK, AND NOT A STATUS. HQ cannot open the item, so the label
 * says what it is and where it came from: its kind, its title, its version
 * where it has one, and its slug. It carries no status, because a status is
 * stale the moment the item moves, and the escalation's own `created_at`
 * already dates the label.
 *
 * WHAT IT SAID IT DID NOT SAY, AND D275 NOW RECORDS. Naming an item is not
 * saying the submission is a localisation of it: a French version of template
 * X and "please fix clause 4 of template X" both name X. That was filed here
 * rather than guessed, and the decision has since been taken: a content
 * escalation that names an item records an explicit RELATION, `localises` or
 * `changes`, and the relation is required whenever an item is picked
 * (migration 296). It travels beside the pick, never inside it — the concern
 * says which item, the relation says what the submission is to it — and its
 * vocabulary and refusals live at the bottom of this file, so the branch route
 * and HQ's `recordEscalation` read one list. What is still not recorded: the
 * relation of any row raised before 296, and anything a branch localises in
 * its own database without sending it to HQ.
 *
 * THE LIST NEVER THROWS. Each source is read in its own try and answers for
 * itself; the lane GET builds this outside its own try, so a branch without
 * migration 268 still reads its lane. An unreadable source is its own state
 * with its reason — never an empty list, which would claim the branch holds
 * nothing to name. The resolver's failures are typed refusals the route turns
 * into a 400 or a 503, and none of them is ever stored as a guess.
 */
import type { Env } from '../types';

/** The two kinds of item a branch can name, in the order the drawer groups them. */
export const CONCERN_TYPES = ['template', 'article'] as const;
export type ConcernType = (typeof CONCERN_TYPES)[number];

/** The one escalation kind that may name an item. */
export const CONCERN_KIND = 'content';

/**
 * The longest label either end will keep. Both escalation tables clip
 * `subject_ref` to this — the branch route and `recordEscalation` at HQ — so a
 * longer label would be stored as something other than what was listed.
 */
export const CONCERN_LABEL_MAX = 300;

/** How many of a branch's articles the drawer offers, newest first. */
export const CONCERN_ARTICLE_CAP = 100;

const SEP = ' · ';
const oneLine = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * The label for one item: `HQ template · {title} · v{version} · {slug}` or
 * `Article · {title} · {slug}`.
 *
 * THE TITLE GIVES WAY, NEVER THE SLUG. A label past the limit is shortened in
 * its title, with an ellipsis, because the slug is the part a person acts on
 * and the part that tells two same-titled items apart. The final clip only
 * matters for a slug that could not fit on its own.
 *
 * A version that is not a positive whole number is left out rather than
 * written as `v1`: the label says what the row says, and nothing it does not.
 */
export function concernLabel(
  type: ConcernType,
  row: { title?: unknown; slug?: unknown; version?: unknown },
): string {
  const head = type === 'template' ? 'HQ template' : 'Article';
  const version = Number(row.version);
  const tail = [
    ...(type === 'template' && Number.isInteger(version) && version > 0 ? [`v${version}`] : []),
    ...(oneLine(row.slug) ? [oneLine(row.slug)] : []),
  ];
  const title = oneLine(row.title) || '(untitled)';
  // Everything but the title, plus the one separator the title adds.
  const room = CONCERN_LABEL_MAX - [head, ...tail].join(SEP).length - SEP.length;
  const fitted = title.length <= room ? title : `${title.slice(0, Math.max(1, room - 1))}…`;
  return [head, fitted, ...tail].join(SEP).slice(0, CONCERN_LABEL_MAX);
}

export type ConcernItem = { type: ConcernType; id: string | number; label: string };

export type ConcernSource =
  | { type: ConcernType; available: true; listed: number; truncated: boolean }
  | { type: ConcernType; available: false; reason: string };

export type ConcernsBlock = {
  available: boolean;
  reason?: string;
  items: ConcernItem[];
  sources: ConcernSource[];
  truncated: boolean;
  cap: number;
  note: string;
};

const TEMPLATES_UNREADABLE =
  'HQ\'s template library could not be read on this branch (branch_templates, migration 268), '
  + 'so no template can be named.';
const ARTICLES_UNREADABLE = 'This branch\'s articles could not be read, so no article can be named.';
const NOTHING_READABLE =
  'Neither HQ\'s template library nor this branch\'s articles could be read, so no item can be '
  + 'named. A content escalation can still be raised without one.';

/**
 * SAID ON THE PAYLOAD, like the lane's `answer_note`, so no screen has to
 * remember it: what travels is a name, and HQ cannot follow it anywhere.
 */
export const CONCERNS_NOTE =
  'HQ receives the name this branch gives the item, not a link to it: the item lives in this '
  + 'branch\'s database, which HQ cannot open.';

/**
 * Every item a content escalation can name: HQ's whole template library as
 * pushed here, by title, and this branch's most recent articles, newest first.
 */
export async function listConcerns(env: Env): Promise<ConcernsBlock> {
  const items: ConcernItem[] = [];
  const sources: ConcernSource[] = [];

  // The whole library: it is HQ's set, pushed whole (D147), and small.
  try {
    const rows = await env.DB.prepare(
      'SELECT slug, title, version FROM branch_templates ORDER BY title COLLATE NOCASE, slug',
    ).all<{ slug: string; title: string; version: number }>();
    const list = rows.results || [];
    for (const r of list) {
      items.push({ type: 'template', id: String(r.slug), label: concernLabel('template', r) });
    }
    sources.push({ type: 'template', available: true, listed: list.length, truncated: false });
  } catch {
    sources.push({ type: 'template', available: false, reason: TEMPLATES_UNREADABLE });
  }

  // One more than the cap is read, so a cut list says it was cut.
  try {
    const rows = await env.DB.prepare(
      'SELECT id, slug, title FROM articles ORDER BY id DESC LIMIT ?',
    ).bind(CONCERN_ARTICLE_CAP + 1).all<{ id: number; slug: string; title: string }>();
    const list = rows.results || [];
    const shown = list.slice(0, CONCERN_ARTICLE_CAP);
    for (const r of shown) {
      items.push({ type: 'article', id: Number(r.id), label: concernLabel('article', r) });
    }
    sources.push({
      type: 'article', available: true, listed: shown.length,
      truncated: list.length > CONCERN_ARTICLE_CAP,
    });
  } catch {
    sources.push({ type: 'article', available: false, reason: ARTICLES_UNREADABLE });
  }

  const available = sources.some((s) => s.available);
  return {
    available,
    ...(available ? {} : { reason: NOTHING_READABLE }),
    items,
    sources,
    truncated: sources.some((s) => s.available && s.truncated),
    cap: CONCERN_ARTICLE_CAP,
    note: CONCERNS_NOTE,
  };
}

export type ParsedConcern = { type: 'template'; id: string } | { type: 'article'; id: number };

/**
 * `{ type, id }` as a raise sends it, or null when it is not one: a template
 * by its slug, an article by its numeric id.
 */
export function parseConcern(raw: unknown): ParsedConcern | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const type = String((raw as { type?: unknown }).type ?? '').trim().toLowerCase();
  const id = (raw as { id?: unknown }).id;
  if (type === 'template') {
    const slug = typeof id === 'string' ? id.trim() : '';
    return slug && slug.length <= 200 ? { type, id: slug } : null;
  }
  if (type === 'article') {
    const n = typeof id === 'number'
      ? id
      : typeof id === 'string' && /^\d+$/.test(id.trim()) ? Number(id.trim()) : Number.NaN;
    return Number.isSafeInteger(n) && n > 0 ? { type, id: n } : null;
  }
  return null;
}

export const BAD_CONCERN =
  'A content escalation names its item as { type, id }, with type "template" or "article". '
  + 'Pick an item from the list, or raise it without one.';

export type ConcernResolution =
  | { ok: true; label: string }
  | { ok: false; error: 'concerns_not_found' | 'concerns_unreadable'; message: string };

/**
 * The label for a picked item, read from the row this branch holds now.
 *
 * READ AGAIN, NOT TAKEN FROM THE CLIENT. The list the drawer showed can be a
 * minute old, and an item can be withdrawn by HQ's next push or deleted here in
 * that minute. So the pick is looked up at the moment of the raise, and a pick
 * that no longer resolves is refused rather than sent under a stale name.
 */
export async function resolveConcern(env: Env, c: ParsedConcern): Promise<ConcernResolution> {
  const noun = c.type === 'template' ? 'HQ template' : 'article';
  let row: Record<string, unknown> | null;
  try {
    row = c.type === 'template'
      ? await env.DB.prepare('SELECT slug, title, version FROM branch_templates WHERE slug = ?')
        .bind(c.id).first<Record<string, unknown>>()
      : await env.DB.prepare('SELECT id, slug, title FROM articles WHERE id = ?')
        .bind(c.id).first<Record<string, unknown>>();
  } catch {
    return {
      ok: false,
      error: 'concerns_unreadable',
      message: `The ${noun} this names could not be read on this branch, so it cannot be named. `
        + 'Nothing was sent to HQ; raise it again, or raise it without naming an item.',
    };
  }
  if (!row) {
    return {
      ok: false,
      error: 'concerns_not_found',
      message: `That ${noun} is not on this branch — it may have been removed since the list was `
        + 'read. Nothing was sent to HQ; pick an item from the list again, or raise it without one.',
    };
  }
  return { ok: true, label: concernLabel(c.type, row) };
}

/* ------------------------------------------------------------------ *
 * D275 — what the submission is TO the item it names                  *
 * ------------------------------------------------------------------ */

/**
 * The two relations a content escalation that names an item can record
 * (migration 296 closes the same list with a CHECK). A third is a product
 * decision, not a new value.
 */
export const CONCERN_RELATIONS = ['localises', 'changes'] as const;
export type ConcernRelation = (typeof CONCERN_RELATIONS)[number];

/**
 * A relation as sent, normalised; `undefined` when none was sent, `null` when
 * what was sent is not one of the two. Absent is `undefined` or `null` on the
 * wire — anything else, an empty string included, is a value that must be one
 * of the two, because an empty string is a client sending the field, not
 * leaving it out.
 */
export function parseRelation(raw: unknown): ConcernRelation | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  const v = String(raw).trim().toLowerCase();
  return (CONCERN_RELATIONS as readonly string[]).includes(v) ? (v as ConcernRelation) : null;
}

/** The refusals, one sentence each, shared by the branch route and HQ. */
export const RELATION_REQUIRED =
  'A content escalation that names an item says what it is to that item: that it localises it, '
  + 'or that it asks for a change to it. Choose one, or raise it without naming an item.';
export const BAD_RELATION =
  'relation must be "localises" or "changes". Nothing was sent to HQ.';
export const RELATION_NEEDS_ITEM =
  'A relation says what a submission is to the item it names, so it needs an item. Pick the '
  + 'item it concerns, or leave the relation out.';
export const RELATION_NOT_FOR_KIND =
  'Only a content escalation that names an item records a relation. Leave it out for this kind.';
