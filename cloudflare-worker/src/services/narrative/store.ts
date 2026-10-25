/**
 * D908 (#2692) — the Investor narrative's stores, part 2 of #2454: a
 * version's sections, the venture's positioning (core plus a version's own
 * fields), the figures bound into a section, and a section-by-section compare.
 * The pages (parts 3 to 5) read these through `/api/cycles/raise/narrative/*`.
 *
 * WHERE A SECTION'S WORDS LIVE. One sentence has one home:
 *   - a section with a deck key (Problem, Market, Traction, Competition, The
 *     ask, the closing line) keeps its words in the version's own
 *     `spinout_deck_overrides` row, so the deck and the narrative never
 *     disagree;
 *   - Why now keeps its words in `narrative_version_meta.why_now` (463), where
 *     the record and the check already read them;
 *   - Solution, Business model and Team keep theirs in `narrative_sections.body`.
 * Every section's place, audience note and provenance are in `narrative_sections`.
 *
 * VERSION 0 IS THE LIVE DECK. It reads like any version, and no route here
 * writes it: the deck editor does.
 *
 * READS NEVER PASS FOR EMPTY. Each part of a read is `{ state: 'ok', … }` or
 * `{ state: 'unreadable' }`; a store that failed is never an empty list. A
 * section with no words is `body: null` ("Not recorded"), never "".
 *
 * WRITES. Each one is the venture's or an admin's (`canWrite`, in the route),
 * on a version of this venture's, and logs one `raise.investor-narrative` row
 * through `logCycleWrite`, naming the section or field and never its words, a
 * figure or an investor. Words Eadwyn proposed carry no digit: a figure enters
 * a section only as a binding.
 */
import type { Env } from '../../types';
import { WriterError } from '../validateWriters';
import { ownVersion, runCheck, setWords } from '../raiseWriters';
import { logCycleWrite } from '../cycleActivity';
import { VERSION_MARKER_KEY } from '../raiseCycle';

type Store = 'deck' | 'meta' | 'section';
export interface SectionSpec { key: string; label: string; store: Store; deckKey: string | null; max: number }

/** The story's sections in their default order (the canvas, NAR2), and where each one's words live. */
export const NARRATIVE_SECTIONS: readonly SectionSpec[] = Object.freeze([
  { key: 'problem', label: 'Problem', store: 'deck', deckKey: 'problem.framing', max: 600 },
  { key: 'solution', label: 'Solution', store: 'section', deckKey: null, max: 4000 },
  { key: 'why_now', label: 'Why now', store: 'meta', deckKey: null, max: 2000 },
  { key: 'market', label: 'Market', store: 'deck', deckKey: 'market.assumptions', max: 600 },
  { key: 'traction', label: 'Traction', store: 'deck', deckKey: 'traction.takeaway', max: 600 },
  { key: 'business_model', label: 'Business model', store: 'section', deckKey: null, max: 4000 },
  { key: 'competition', label: 'Competition', store: 'deck', deckKey: 'competitive.whitespace', max: 600 },
  { key: 'team', label: 'Team', store: 'section', deckKey: null, max: 4000 },
  // The ask keeps the same limit as New version's (`WORD_FIELDS.ask`).
  { key: 'ask', label: 'The ask', store: 'deck', deckKey: 'ask.title', max: 300 },
  { key: 'closing', label: 'Closing line', store: 'deck', deckKey: 'deal.closingLine', max: 600 },
]);
const SECTION = new Map(NARRATIVE_SECTIONS.map((s) => [s.key, s]));

export const POSITIONING_KINDS = ['one_liner', 'elevator', 'line', 'category', 'wedge', 'for_whom', 'instead_of'] as const;
type Kind = typeof POSITIONING_KINDS[number];
const KIND_MAX: Record<Kind, number> = { one_liner: 200, elevator: 1200, line: 300, category: 300, wedge: 300, for_whom: 300, instead_of: 300 };
/** Positioning lines are several, by position; every other field is one. */
const MAX_LINES = 20;

/** #2431's provenance contract. NULL kind is words typed by hand. */
export const SOURCE_KINDS = ['eadwyn', 'connector', 'module'] as const;
export const SOURCE_LABELS = ['connector', 'document', 'recorded', 'signed', 'typed'] as const;
/** D896's grades a binding can carry, strongest first. */
export const BINDING_GRADES = ['Measured', 'Reviewed', 'Sourced', 'Stated'] as const;
const MAX_BINDINGS = 20;

type Source = { kind: string | null; ref: string | null; label: string | null };
type Part<T> = { state: 'ok' } & T | { state: 'unreadable' };

const HAS_DIGIT = /[0-9]/;

function text(v: unknown, max: number, what: string): string | null {
  if (v === null) return null;
  if (typeof v !== 'string') throw new WriterError(400, `${what} is text, or null to clear it`);
  const s = v.trim();
  if (s.length > max) throw new WriterError(400, `${what} is at most ${max} characters`);
  return s || null;
}

/** `source`: absent (typed by hand), or { kind, ref?, label? } under #2431's names. */
function sourceOf(v: unknown): Source {
  if (v === undefined || v === null) return { kind: null, ref: null, label: null };
  if (typeof v !== 'object' || Array.isArray(v)) throw new WriterError(400, 'source is { kind, ref, label }');
  const o = v as Record<string, unknown>;
  const kind = o.kind == null ? null : String(o.kind);
  if (kind !== null && !(SOURCE_KINDS as readonly string[]).includes(kind)) throw new WriterError(400, 'source.kind is eadwyn, connector or module');
  const label = o.label == null ? null : String(o.label);
  if (label !== null && !(SOURCE_LABELS as readonly string[]).includes(label)) throw new WriterError(400, 'source.label is connector, document, recorded, signed or typed');
  if (kind === 'eadwyn' && label !== null) throw new WriterError(400, 'An Eadwyn value carries no source label');
  const ref = o.ref == null ? null : String(o.ref).trim().slice(0, 200) || null;
  return { kind, ref, label };
}

/** Eadwyn's wording carries no number: a figure enters only as a binding the founder inserts. */
function eadwynHasNoNumber(source: Source, words: string | null) {
  if (source.kind === 'eadwyn' && words && HAS_DIGIT.test(words)) {
    throw new WriterError(400, "Eadwyn's wording carries no number. Insert the figure as a bound figure instead.");
  }
}

type Binding = { source_key: string; record_ref: string | null; as_of: string | null; grade: string; snapshot_hash: string | null };

function bindingsOf(v: unknown): Binding[] {
  if (!Array.isArray(v)) throw new WriterError(400, 'bindings is a list');
  if (v.length > MAX_BINDINGS) throw new WriterError(400, `A section binds at most ${MAX_BINDINGS} figures`);
  return v.map((b) => {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new WriterError(400, 'Each binding is { source_key, record_ref, as_of, grade, snapshot_hash }');
    const o = b as Record<string, unknown>;
    const key = String(o.source_key ?? '');
    if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(key)) throw new WriterError(400, 'A binding names its source_key, such as validate.interviews');
    const grade = String(o.grade ?? '');
    if (!(BINDING_GRADES as readonly string[]).includes(grade)) throw new WriterError(400, 'A binding\'s grade is Measured, Reviewed, Sourced or Stated');
    const asOf = o.as_of == null ? null : String(o.as_of);
    if (asOf !== null && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new WriterError(400, 'A binding\'s as_of is a date, YYYY-MM-DD, or null');
    const hash = o.snapshot_hash == null ? null : String(o.snapshot_hash);
    if (hash !== null && !/^[0-9a-f]{24}$/.test(hash)) throw new WriterError(400, 'A binding\'s snapshot_hash is 24 hex characters');
    const ref = o.record_ref == null ? null : String(o.record_ref).slice(0, 200);
    return { source_key: key, record_ref: ref, as_of: asOf, grade, snapshot_hash: hash };
  });
}

/** A version to read: 0 (the live deck) always, or one of this venture's. */
export async function readableVersion(env: Env, projectId: number, v: unknown): Promise<number> {
  if (v === 0 || v === '0') return 0;
  return ownVersion(env, projectId, v, 'Version');
}

/** A version to write: one of this venture's saved versions, never 0. */
async function writableVersion(env: Env, projectId: number, v: unknown): Promise<number> {
  if (v === 0 || v === '0') throw new WriterError(409, "Version 0 is the live deck's wording. Change it in the deck, or in a saved version.");
  return ownVersion(env, projectId, v, 'Version');
}

const sectionSpec = (key: unknown): SectionSpec => {
  const s = typeof key === 'string' ? SECTION.get(key) : undefined;
  if (!s) throw new WriterError(404, 'Unknown section');
  return s;
};

async function log(env: Env, userId: number, projectId: number, version: number | null, action: string, summary: string) {
  await logCycleWrite(env, { projectId, userId, cycle: 'raise', module: 'investor-narrative', entityId: version, action, summary });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type SectionRow = { section: string; position: number | null; body: string | null; audience_note: string | null;
  source_kind: string | null; source_ref: string | null; source_label: string | null; updated_at: string | null };

async function sectionsOf(env: Env, projectId: number, version: number) {
  const deck = await env.DB.prepare(
    'SELECT field_key, value FROM spinout_deck_overrides WHERE project_id = ? AND version = ? AND field_key != ?',
  ).bind(projectId, version, VERSION_MARKER_KEY).all<{ field_key: string; value: string }>();
  const words = new Map((deck.results || []).map((r) => [r.field_key, r.value]));
  const meta = version === 0 ? null : await env.DB.prepare(
    'SELECT why_now FROM narrative_version_meta WHERE project_id = ? AND version = ?',
  ).bind(projectId, version).first<{ why_now: string | null }>();
  const rows = version === 0 ? [] : ((await env.DB.prepare(
    `SELECT section, position, body, audience_note, source_kind, source_ref, source_label, updated_at
       FROM narrative_sections WHERE project_id = ? AND version = ?`,
  ).bind(projectId, version).all<SectionRow>()).results || []);
  const own = new Map(rows.map((r) => [r.section, r]));
  const sections = NARRATIVE_SECTIONS.map((s, i) => {
    const r = own.get(s.key);
    const body = s.store === 'deck' ? words.get(s.deckKey!) ?? null : s.store === 'meta' ? meta?.why_now ?? null : r?.body ?? null;
    return {
      key: s.key, label: s.label, store: s.store, deck_key: s.deckKey,
      position: r?.position ?? i,
      body: body && body.trim() ? body : null,
      audience_note: r?.audience_note ?? null,
      source: r && (r.source_kind || r.source_label) ? { kind: r.source_kind, ref: r.source_ref, label: r.source_label } : null,
      updated_at: r?.updated_at ?? null,
    };
  });
  // Stable: a section with no recorded place keeps its default one; on a tie
  // the section placed there on purpose comes first.
  const placed = (key: string) => (own.get(key)?.position != null ? 0 : 1);
  return sections.map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.position - b.s.position || placed(a.s.key) - placed(b.s.key) || a.i - b.i)
    .map((x) => x.s);
}

type PositioningRow = { version: number | null; kind: Kind; position: number; text: string;
  source_kind: string | null; source_ref: string | null; source_label: string | null; updated_at: string; by_name?: string | null };

const positioningView = (r: PositioningRow) => ({
  kind: r.kind, position: Number(r.position), text: r.text, version: r.version == null ? null : Number(r.version),
  source: r.source_kind || r.source_label ? { kind: r.source_kind, ref: r.source_ref, label: r.source_label } : null,
  updated_at: r.updated_at,
  // D1114: who saved it, by name, for NAR4's "Proposed by Eadwyn, accepted by [Name]". Null when not recorded.
  by: r.by_name ?? null,
});

/** The core, a version's own fields, and what the version reads: its own field where it has one, else the core's. */
export async function readPositioning(env: Env, projectId: number, version: number | null) {
  const rows = ((await env.DB.prepare(
    `SELECT p.version, p.kind, p.position, p.text, p.source_kind, p.source_ref, p.source_label, p.updated_at, u.name AS by_name
       FROM narrative_positioning p LEFT JOIN users u ON u.id = p.updated_by
      WHERE p.project_id = ? AND (p.version IS NULL OR p.version = ?) ORDER BY p.kind, p.position`,
  ).bind(projectId, version).all<PositioningRow>()).results || []);
  const core = rows.filter((r) => r.version == null).map(positioningView);
  const overrides = version == null ? [] : rows.filter((r) => r.version != null).map(positioningView);
  const adjusted = new Set(overrides.map((o) => o.kind));
  const effective = [...core.filter((c) => !adjusted.has(c.kind)), ...overrides]
    .sort((a, b) => POSITIONING_KINDS.indexOf(a.kind) - POSITIONING_KINDS.indexOf(b.kind) || a.position - b.position);
  return { core, overrides, effective };
}

async function bindingsOfVersion(env: Env, projectId: number, version: number) {
  if (version === 0) return [];
  return ((await env.DB.prepare(
    `SELECT section, position, source_key, record_ref, as_of, grade, snapshot_hash
       FROM narrative_bindings WHERE project_id = ? AND version = ? ORDER BY section, position, id`,
  ).bind(projectId, version).all<Binding & { section: string; position: number }>()).results || []);
}

async function part<T extends object>(what: string, read: () => Promise<T>): Promise<Part<T>> {
  try {
    return { state: 'ok', ...(await read()) };
  } catch (e) {
    console.warn('[narrative] %s unreadable:', what, (e as Error)?.message);
    return { state: 'unreadable' };
  }
}

/** `GET /narrative/:version`: the version's meta, its sections in order, its positioning and its bindings. */
export async function readNarrative(env: Env, projectId: number, versionParam: unknown) {
  const version = await readableVersion(env, projectId, versionParam);
  const meta = await part('meta', async () => {
    if (version === 0) return { live: true, investor_type: null, deck_version: null, start_from: null, based_on_version: null, check_against: null };
    const marker = await env.DB.prepare(
      'SELECT investor_type, deck_version FROM spinout_deck_overrides WHERE project_id = ? AND version = ? ORDER BY field_key = ? DESC LIMIT 1',
    ).bind(projectId, version, VERSION_MARKER_KEY).first<{ investor_type: string | null; deck_version: number | null }>();
    const m = await env.DB.prepare(
      'SELECT start_from, based_on_version, check_against_json FROM narrative_version_meta WHERE project_id = ? AND version = ?',
    ).bind(projectId, version).first<{ start_from: string | null; based_on_version: number | null; check_against_json: string | null }>();
    let checkAgainst: string[] | null = null;
    try { checkAgainst = m?.check_against_json ? JSON.parse(m.check_against_json) : null; } catch { checkAgainst = null; }
    return {
      live: false, investor_type: marker?.investor_type ?? null, deck_version: marker?.deck_version ?? null,
      start_from: m?.start_from ?? null, based_on_version: m?.based_on_version ?? null, check_against: checkAgainst,
    };
  });
  const sections = await part('sections', async () => ({ items: await sectionsOf(env, projectId, version) }));
  const positioning = await part('positioning', () => readPositioning(env, projectId, version === 0 ? null : version));
  const bindings = await part('bindings', async () => ({ items: await bindingsOfVersion(env, projectId, version) }));
  return { version, meta, sections, positioning, bindings };
}

/** `GET /narrative/compare?a=&b=`: each section of two versions side by side. */
export async function compareNarrative(env: Env, projectId: number, aParam: unknown, bParam: unknown) {
  const a = await readableVersion(env, projectId, aParam);
  const b = await readableVersion(env, projectId, bParam);
  const [sa, sb] = await Promise.all([sectionsOf(env, projectId, a), sectionsOf(env, projectId, b)]);
  const byKey = new Map(sb.map((s) => [s.key, s]));
  const norm = (t: string | null) => (t == null ? null : t.replace(/\s+/g, ' ').trim());
  const pairs = sa.map((s) => {
    const o = byKey.get(s.key)!;
    const [x, y] = [norm(s.body), norm(o.body)];
    const state = x == null && y == null ? 'not_recorded' : x === y ? 'same' : 'changed';
    return { key: s.key, label: s.label, a: { body: s.body }, b: { body: o.body }, state };
  });
  return { a, b, pairs };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * `PUT /narrative/:version/sections/:section` — `{ body?, audience_note?,
 * position?, source?, bindings? }`; at least one. A section with a deck key
 * writes its words to the version's deck row, Why now to the version's meta,
 * the rest to `narrative_sections.body`. `prior_value` keeps the words it
 * replaced. A change to a deck row runs the version's check again.
 */
export async function saveNarrativeSection(env: Env, a: { projectId: number; userId: number; version: unknown; section: unknown; body: Record<string, unknown> }) {
  const version = await writableVersion(env, a.projectId, a.version);
  const spec = sectionSpec(a.section);
  const b = a.body;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
  if (!['body', 'audience_note', 'position', 'source', 'bindings'].some(has)) throw new WriterError(400, 'Nothing to change');
  const words = has('body') ? text(b.body, spec.max, spec.label) : undefined;
  const note = has('audience_note') ? text(b.audience_note, 500, 'The audience note') : undefined;
  let position: number | null | undefined;
  if (has('position')) {
    if (b.position !== null && !(Number.isSafeInteger(b.position) && (b.position as number) >= 0 && (b.position as number) < 100)) {
      throw new WriterError(400, 'position is a whole number from 0, or null for the default order');
    }
    position = b.position as number | null;
  }
  const source = sourceOf(b.source);
  if (words !== undefined) eadwynHasNoNumber(source, words);
  const bindings = has('bindings') ? bindingsOf(b.bindings) : undefined;

  const current = await env.DB.prepare(
    `SELECT body, position, audience_note, source_kind, source_ref, source_label, prior_value
       FROM narrative_sections WHERE project_id = ? AND version = ? AND section = ?`,
  ).bind(a.projectId, version, spec.key).first<{ body: string | null; position: number | null; audience_note: string | null;
    source_kind: string | null; source_ref: string | null; source_label: string | null; prior_value: string | null }>();
  let prior: string | null = null;
  const changed: string[] = [];

  if (words !== undefined) {
    if (spec.store === 'deck') {
      const row = await env.DB.prepare('SELECT value FROM spinout_deck_overrides WHERE project_id = ? AND version = ? AND field_key = ?')
        .bind(a.projectId, version, spec.deckKey).first<{ value: string }>();
      prior = row?.value ?? null;
      const marker = await env.DB.prepare(
        'SELECT investor_type, deck_version FROM spinout_deck_overrides WHERE project_id = ? AND version = ? ORDER BY field_key = ? DESC LIMIT 1',
      ).bind(a.projectId, version, VERSION_MARKER_KEY).first<{ investor_type: string | null; deck_version: number | null }>();
      await setWords(env, { projectId: a.projectId, userId: a.userId, version, investorType: marker?.investor_type ?? null,
        deckVersion: marker?.deck_version ?? null, fieldKey: spec.deckKey!, value: words });
    } else if (spec.store === 'meta') {
      const m = await env.DB.prepare('SELECT why_now FROM narrative_version_meta WHERE project_id = ? AND version = ?')
        .bind(a.projectId, version).first<{ why_now: string | null }>();
      prior = m?.why_now ?? null;
      await env.DB.prepare(
        `INSERT INTO narrative_version_meta (project_id, version, start_from, created_by) VALUES (?, ?, 'live', ?)
         ON CONFLICT (project_id, version) DO NOTHING`,
      ).bind(a.projectId, version, a.userId).run();
      await env.DB.prepare(`UPDATE narrative_version_meta SET why_now = ?, updated_at = datetime('now') WHERE project_id = ? AND version = ?`)
        .bind(words, a.projectId, version).run();
    } else {
      prior = current?.body ?? null;
    }
    changed.push('words');
  }
  if (note !== undefined) changed.push('audience note');
  if (position !== undefined) changed.push('place');
  // Provenance follows the words: a change of note or place keeps where the words came from.
  const keep = words === undefined && !has('source');
  const src = keep ? { kind: current?.source_kind ?? null, ref: current?.source_ref ?? null, label: current?.source_label ?? null } : source;

  // The section's own row: its words (when it keeps them), place, note and provenance.
  await env.DB.prepare(
    `INSERT INTO narrative_sections (project_id, version, section, position, body, audience_note, source_kind, source_ref, source_label, prior_value, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (project_id, version, section) DO UPDATE SET
       position = excluded.position, body = excluded.body, audience_note = excluded.audience_note,
       source_kind = excluded.source_kind, source_ref = excluded.source_ref, source_label = excluded.source_label,
       prior_value = excluded.prior_value, undone_at = NULL, undone_by = NULL,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(
    a.projectId, version, spec.key,
    position !== undefined ? position : current?.position ?? null,
    spec.store === 'section' ? (words !== undefined ? words : current?.body ?? null) : null,
    note !== undefined ? note : current?.audience_note ?? null,
    src.kind, src.ref, src.label,
    words !== undefined ? prior : current?.prior_value ?? null,
    a.userId,
  ).run();

  if (bindings !== undefined) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM narrative_bindings WHERE project_id = ? AND version = ? AND section = ?').bind(a.projectId, version, spec.key),
      ...bindings.map((x, i) => env.DB.prepare(
        `INSERT INTO narrative_bindings (project_id, version, section, position, source_key, record_ref, as_of, grade, snapshot_hash, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(a.projectId, version, spec.key, i, x.source_key, x.record_ref, x.as_of, x.grade, x.snapshot_hash, a.userId)),
    ]);
    changed.push(`${bindings.length} bound ${bindings.length === 1 ? 'figure' : 'figures'}`);
  }

  if (words !== undefined && spec.store !== 'section') await runCheck(env, a.projectId, version);
  await log(env, a.userId, a.projectId, version, 'narrative_section_saved', `Version ${version}: ${spec.label} saved (${changed.join(', ')})`);
  const section = (await sectionsOf(env, a.projectId, version)).find((s) => s.key === spec.key)!;
  return { version, section, bindings: (await bindingsOfVersion(env, a.projectId, version)).filter((x) => x.section === spec.key), changed };
}

/**
 * `PUT /narrative/positioning?version=` — `{ kind, position?, text, source? }`.
 * Without a version it writes the venture's core; with one, that version's
 * own field. `text: null` clears it: a version's field then reads the core again.
 */
export async function savePositioning(env: Env, a: { projectId: number; userId: number; version: unknown; body: Record<string, unknown> }) {
  const version = a.version === undefined || a.version === null || a.version === '' ? null : await writableVersion(env, a.projectId, a.version);
  const b = a.body;
  const kind = String(b.kind ?? '') as Kind;
  if (!(POSITIONING_KINDS as readonly string[]).includes(kind)) throw new WriterError(400, `kind is ${POSITIONING_KINDS.join(', ')}`);
  const position = b.position === undefined ? 0 : b.position;
  if (!Number.isSafeInteger(position) || (position as number) < 0 || (position as number) >= (kind === 'line' ? MAX_LINES : 1)) {
    throw new WriterError(400, kind === 'line' ? `position is a line's place, 0 to ${MAX_LINES - 1}` : `${kind} has one field, at position 0`);
  }
  if (!Object.prototype.hasOwnProperty.call(b, 'text')) throw new WriterError(400, 'text is required, or null to clear it');
  const words = text(b.text, KIND_MAX[kind], 'The text');
  const source = sourceOf(b.source);
  eadwynHasNoNumber(source, words);

  const current = await env.DB.prepare(
    'SELECT text FROM narrative_positioning WHERE project_id = ? AND version IS ? AND kind = ? AND position = ?',
  ).bind(a.projectId, version, kind, position).first<{ text: string }>();
  const stmts = [env.DB.prepare('DELETE FROM narrative_positioning WHERE project_id = ? AND version IS ? AND kind = ? AND position = ?')
    .bind(a.projectId, version, kind, position)];
  if (words !== null) {
    stmts.push(env.DB.prepare(
      `INSERT INTO narrative_positioning (project_id, version, kind, position, text, source_kind, source_ref, source_label, prior_value, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).bind(a.projectId, version, kind, position, words, source.kind, source.ref, source.label, current?.text ?? null, a.userId));
  }
  await env.DB.batch(stmts);
  const where = version == null ? 'Core positioning' : `Version ${version} positioning`;
  await log(env, a.userId, a.projectId, version, words === null ? 'narrative_positioning_cleared' : 'narrative_positioning_saved',
    `${where}: ${kind.replace(/_/g, ' ')}${kind === 'line' ? ` ${Number(position) + 1}` : ''} ${words === null ? 'cleared' : 'saved'}`);
  return { version, positioning: await readPositioning(env, a.projectId, version) };
}
