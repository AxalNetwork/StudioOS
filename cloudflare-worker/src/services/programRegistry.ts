/**
 * D954 (#2787) — THE PROGRAM REGISTRY AND THE PLAYBOOK STORE (migration 560).
 *
 * THE REGISTRY is one row per program the Programs catalogue draws: its key,
 * group, name, purpose, who, join method, status and position. The nine keys
 * are `PROGRAM_KEYS`. A NULL purpose, who or join reads "Not recorded" on the
 * page. A Super Admin edits the purpose, who, join and status; `paused` is
 * refused, because what Pause enforces is OD-PAUSE's and nothing enforces it
 * yet (D953 §5).
 *
 * THE PLAYBOOK is ordered sections per program and version. Version 0 is the
 * draft, which only a Super Admin reads and edits; publishing copies it to the
 * next version. An Admin reads the latest published version, and never the
 * draft. A NULL body reads "Not set". A `computed` section's body is drawn by
 * the page from live data (Mentor's cycle, from the Lab's calendar), so only
 * its title is stored and a body sent for it is refused.
 *
 * A SECTION NAMES CONTRACT TEMPLATES BY SLUG. Each must be an active template
 * in the contracts library's store (`listTemplates`), the list the Contracts
 * page reads from `GET /api/admin/contracts/templates/store`, or the save is
 * refused with `unknown_template`.
 *
 * EVERY WRITE IS AUDITED with `logAdminAction`, under the actions in
 * `REGISTRY_ACTIONS`, which every program's Activity lists
 * (`services/programActivity.ts`).
 *
 * D955 (#2788): A PROGRAM MAY BE ADDED. Approving a studio's proposal, or HQ's
 * New program, writes a row with status `proposed` (`insertProgramStatements`).
 * So a key is any lower-case slug (`PROGRAM_KEY_RE`), not only the nine, and
 * `proposals` and `propose` are refused as keys because they are sub-paths
 * (D953 §1). A program approved for one studio only carries that licence's uid
 * (migration 561): it is read only by that studio and by a Super Admin
 * (`ProgramReader`), and is "No program has that key" to every other studio.
 */
import type { Env } from '../types';
import { logAdminAction } from './adminAudit';
import { listTemplates } from './legalTemplateStore';

/** The nine programs, in the canvas's order (dc:341-349). */
export const PROGRAM_KEYS = [
  'spinout-lab', 'ai-native-venture', 'mentor-cohorts', 'investor-cohorts', 'referral-partners',
  'refer-and-earn', 'perks', 'learning', 'product-testing',
] as const;
export type ProgramKey = typeof PROGRAM_KEYS[number];

/** The canvas's five status words (dc:322), as stored. */
export const PROGRAM_STATUSES = ['live', 'partly_built', 'not_built', 'proposed', 'paused'] as const;
export type ProgramStatus = typeof PROGRAM_STATUSES[number];

/** The canvas's six groups (dc:358). */
export const PROGRAM_GROUPS = ['Ventures', 'Access', 'Network and referrals', 'Rewards', 'Learning', 'Product'] as const;

/** The registry and playbook writes, as `admin_audit_log.action`. */
export const REGISTRY_ACTIONS = {
  update: 'program.registry.update',
  edit: 'program.playbook.edit',
  publish: 'program.playbook.publish',
} as const;

/**
 * D955: the proposal writes, as `admin_audit_log.action`. A decision names the
 * program an approval made, so each program's Activity lists it
 * (`PROGRAM_ACTIVITY_ACTIONS`' registry list); a send, or a send back or
 * decline, names no program and is read in the admin audit.
 */
export const PROPOSAL_ACTIONS = {
  send: 'program.proposal.send',
  decide: 'program.proposal.decide',
  create: 'program.registry.create',
} as const;

export const PAUSE_NOT_DECIDED =
  'What pausing a program enforces is not decided yet (OD-PAUSE), so a program cannot be paused.';

const TEXT_MAX = { purpose: 300, who: 200, join_method: 120, title: 120, body: 5000 } as const;
const TEMPLATES_MAX = 20;

export function isProgramKey(v: unknown): v is ProgramKey {
  return typeof v === 'string' && (PROGRAM_KEYS as readonly string[]).includes(v);
}

/** D955: a registry key, the nine's or one an approval or New program made. */
export const PROGRAM_KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PROGRAM_KEY_MAX = 60;
/** Sub-paths of /api/admin/programs and /admin/programs (D953 §1): never a program's key. */
export const RESERVED_PROGRAM_KEYS = ['proposals', 'propose'] as const;

export const isRegistryKey = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= PROGRAM_KEY_MAX && PROGRAM_KEY_RE.test(v);

/** A key from a program's name: "Operator Fellowship" → "operator-fellowship". */
export function keyFromName(name: string): string {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, PROGRAM_KEY_MAX).replace(/-+$/, '');
}

/**
 * Who reads the registry: a Super Admin reads every row; anyone else reads the
 * rows for every studio and their own studio's (`licenceUid`, null when they
 * hold no licence).
 */
export type ProgramReader = { superAdmin: boolean; licenceUid: string | null };
const ALL_ROWS: ProgramReader = { superAdmin: true, licenceUid: null };

/** Binds `(? = 1 OR licence_uid IS NULL OR licence_uid = ?)`: every row for a Super Admin, else every studio's and theirs. */
const readerArgs = (reader: ProgramReader) => [reader.superAdmin ? 1 : 0, reader.licenceUid ?? ''];

/** A refusal a route sends as is: its status, its code and the sentence we wrote for it. */
export class ProgramError extends Error {
  status: 400 | 404 | 409;
  code: string;
  sentence: string;
  constructor(status: 400 | 404 | 409, code: string, sentence: string) {
    super(sentence);
    this.status = status;
    this.code = code;
    this.sentence = sentence;
  }
}

export type ProgramRow = {
  key: string; grp: string; name: string; purpose: string | null; who: string | null;
  join_method: string | null; status: ProgramStatus; position: number; updated_at: string;
  licence_uid: string | null;
};

const PROGRAM_SELECT = 'SELECT key, grp, name, purpose, who, join_method, status, position, updated_at, licence_uid FROM programs';

/** Every row `reader` may read, in the catalogue's order. With no reader, every row (HQ's own writes). */
export async function listPrograms(env: Env, reader: ProgramReader = ALL_ROWS): Promise<ProgramRow[]> {
  const r = await env.DB.prepare(PROGRAM_SELECT + ' WHERE (? = 1 OR licence_uid IS NULL OR licence_uid = ?) ORDER BY position, key')
    .bind(...readerArgs(reader)).all<ProgramRow>();
  return r.results || [];
}

/** One row by key, if `reader` may read it; otherwise 404 `unknown_program`, as for a key that does not exist. */
export async function programByKey(env: Env, key: string, reader: ProgramReader = ALL_ROWS): Promise<ProgramRow> {
  const row = isRegistryKey(key)
    ? await env.DB.prepare(PROGRAM_SELECT + ' WHERE key = ? AND (? = 1 OR licence_uid IS NULL OR licence_uid = ?)')
      .bind(key, ...readerArgs(reader)).first<ProgramRow>()
    : null;
  if (!row) throw new ProgramError(404, 'unknown_program', 'No program has that key.');
  return row;
}

export function programView(p: ProgramRow) {
  return {
    key: p.key, group: p.grp, name: p.name, purpose: p.purpose ?? null, who: p.who ?? null,
    join_method: p.join_method ?? null, status: p.status, position: Number(p.position), updated_at: p.updated_at,
    studio_only: p.licence_uid ?? null,
  };
}

export type Actor = { id: number; email: string };

/** A trimmed string up to `max`; `null` clears it; `undefined` leaves it. Anything else is a 400. */
function textField(b: Record<string, unknown>, k: string, max: number): string | null | undefined {
  if (!(k in b)) return undefined;
  const v = b[k];
  if (v === null) return null;
  if (typeof v !== 'string') throw new ProgramError(400, `bad_${k}`, `${k} must be text, or null to clear it.`);
  const t = v.trim();
  if (t.length > max) throw new ProgramError(400, `bad_${k}`, `${k} is at most ${max} characters.`);
  return t || null;
}

/** PATCH /api/admin/programs/:key — purpose, who, join and status. */
export async function updateProgram(env: Env, key: string, body: unknown, actor: Actor) {
  const p = await programByKey(env, key);
  const b = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const purpose = textField(b, 'purpose', TEXT_MAX.purpose);
  const who = textField(b, 'who', TEXT_MAX.who);
  const join = textField(b, 'join_method', TEXT_MAX.join_method);
  let status: ProgramStatus | undefined;
  if ('status' in b) {
    if (b.status === 'paused') throw new ProgramError(400, 'pause_not_decided', PAUSE_NOT_DECIDED);
    if (!(PROGRAM_STATUSES as readonly unknown[]).includes(b.status)) {
      throw new ProgramError(400, 'bad_status', 'status is live, partly_built, not_built or proposed.');
    }
    status = b.status as ProgramStatus;
  }
  const fields = { purpose, who, join_method: join, status };
  const changed = Object.keys(fields).filter((k) => fields[k as keyof typeof fields] !== undefined);
  if (!changed.length) {
    throw new ProgramError(400, 'nothing_to_change', 'Send at least one of purpose, who, join_method or status.');
  }
  // Each column is written only when it was sent: `? = 1` says whether it was.
  await env.DB.prepare(
    `UPDATE programs SET
       purpose = CASE WHEN ? = 1 THEN ? ELSE purpose END,
       who = CASE WHEN ? = 1 THEN ? ELSE who END,
       join_method = CASE WHEN ? = 1 THEN ? ELSE join_method END,
       status = CASE WHEN ? = 1 THEN ? ELSE status END,
       updated_at = ?
     WHERE key = ?`,
  ).bind(
    purpose !== undefined ? 1 : 0, purpose ?? null,
    who !== undefined ? 1 : 0, who ?? null,
    join !== undefined ? 1 : 0, join ?? null,
    status !== undefined ? 1 : 0, status ?? null,
    new Date().toISOString(), p.key,
  ).run();
  await logAdminAction(env, actor.id, actor.email, REGISTRY_ACTIONS.update, { program_key: p.key, fields: changed });
  return programView(await programByKey(env, p.key));
}

// ---------------------------------------------------------------------------
// The playbook
// ---------------------------------------------------------------------------

type SectionRow = {
  section_key: string; position: number; title: string; body: string | null; computed: number;
  template_keys: string; edited_at: string | null;
};

const SECTION_SELECT =
  'SELECT section_key, position, title, body, computed, template_keys, edited_at FROM program_playbook_sections';

function templateKeysOf(raw: unknown): string[] {
  try {
    const v = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function sectionView(s: SectionRow) {
  return {
    key: s.section_key, position: Number(s.position), title: s.title, body: s.body ?? null,
    computed: Number(s.computed) === 1, template_keys: templateKeysOf(s.template_keys),
  };
}

async function sectionsOf(env: Env, key: string, version: number): Promise<SectionRow[]> {
  const r = await env.DB.prepare(SECTION_SELECT + ' WHERE program_key = ? AND version = ? ORDER BY position, section_key')
    .bind(key, version).all<SectionRow>();
  return r.results || [];
}

async function latestVersion(env: Env, key: string) {
  return env.DB.prepare(
    'SELECT version, published_at FROM program_playbook_versions WHERE program_key = ? ORDER BY version DESC LIMIT 1',
  ).bind(key).first<{ version: number; published_at: string }>();
}

/** What a section holds, for "does the draft differ". The edit stamp is not content. */
const contentOf = (rows: SectionRow[]) =>
  JSON.stringify(rows.map((s) => [s.section_key, Number(s.position), s.title, s.body ?? null, Number(s.computed),
    JSON.stringify(templateKeysOf(s.template_keys))]));

/**
 * GET /api/admin/programs/:key — the registry row and the published playbook,
 * with its version and date. A Super Admin also gets the draft: its sections,
 * when it was last edited, and whether it differs from what is published.
 */
export async function programDetail(env: Env, key: string, superAdmin: boolean, reader: ProgramReader = ALL_ROWS) {
  const p = await programByKey(env, key, reader);
  const latest = await latestVersion(env, p.key);
  const published = latest ? await sectionsOf(env, p.key, Number(latest.version)) : [];
  const out: Record<string, unknown> = {
    program: programView(p),
    playbook: latest
      ? { published: true, version: Number(latest.version), published_at: latest.published_at, sections: published.map(sectionView) }
      : { published: false, version: null, published_at: null, sections: [] },
  };
  if (superAdmin) {
    const draft = await sectionsOf(env, p.key, 0);
    const edited = draft.map((s) => s.edited_at).filter((x): x is string => !!x).sort();
    out.draft = {
      sections: draft.map(sectionView),
      edited_at: edited.length ? edited[edited.length - 1] : null,
      differs: contentOf(draft) !== contentOf(published),
    };
  }
  return out;
}

/** The slugs a section may name: active templates in the contracts library. */
export async function checkTemplates(env: Env, raw: unknown): Promise<string[]> {
  if (!Array.isArray(raw) || raw.length > TEMPLATES_MAX || raw.some((x) => typeof x !== 'string' || !x.trim())) {
    throw new ProgramError(400, 'bad_template_keys', `template_keys is a list of at most ${TEMPLATES_MAX} template slugs.`);
  }
  const wanted = [...new Set(raw.map((x: string) => x.trim()))];
  if (!wanted.length) return [];
  const known = new Set((await listTemplates(env)).map((t) => t.slug));
  const unknown = wanted.filter((s) => !known.has(s));
  if (unknown.length) {
    throw new ProgramError(400, 'unknown_template', `No contract template has the slug ${unknown.join(', ')}.`);
  }
  return wanted;
}

/** PUT /api/admin/programs/:key/playbook/sections/:section — edits the draft's section. */
export async function editDraftSection(env: Env, key: string, sectionKey: string, body: unknown, actor: Actor) {
  const p = await programByKey(env, key);
  const s = await env.DB.prepare(SECTION_SELECT + ' WHERE program_key = ? AND version = 0 AND section_key = ?')
    .bind(p.key, sectionKey).first<SectionRow>();
  if (!s) throw new ProgramError(404, 'unknown_section', 'This program\'s playbook has no section with that key.');
  const b = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const title = textField(b, 'title', TEXT_MAX.title);
  if (title === null) throw new ProgramError(400, 'bad_title', 'A section needs a title.');
  const text = textField(b, 'body', TEXT_MAX.body);
  if (text !== undefined && Number(s.computed) === 1) {
    throw new ProgramError(400, 'computed_section', 'This section is drawn from live data, so it holds no text.');
  }
  const templates = 'template_keys' in b ? await checkTemplates(env, b.template_keys) : undefined;
  const changed = [title !== undefined && 'title', text !== undefined && 'body', templates !== undefined && 'template_keys']
    .filter((x): x is string => !!x);
  if (!changed.length) throw new ProgramError(400, 'nothing_to_change', 'Send at least one of title, body or template_keys.');
  await env.DB.prepare(
    `UPDATE program_playbook_sections SET
       title = CASE WHEN ? = 1 THEN ? ELSE title END,
       body = CASE WHEN ? = 1 THEN ? ELSE body END,
       template_keys = CASE WHEN ? = 1 THEN ? ELSE template_keys END,
       edited_at = ?, edited_by_user_id = ?
     WHERE program_key = ? AND version = 0 AND section_key = ?`,
  ).bind(
    title !== undefined ? 1 : 0, title ?? null,
    text !== undefined ? 1 : 0, text ?? null,
    templates !== undefined ? 1 : 0, JSON.stringify(templates ?? []),
    new Date().toISOString(), actor.id, p.key, s.section_key,
  ).run();
  await logAdminAction(env, actor.id, actor.email, REGISTRY_ACTIONS.edit,
    { program_key: p.key, section: s.section_key, fields: changed });
  return programDetail(env, p.key, true);
}

/**
 * POST /api/admin/programs/:key/playbook/publish — the draft becomes the next
 * version. Nothing to publish (the draft is what is published, or is empty)
 * is a 409. The version row and its sections go in one batch, and the version
 * number is unique per program, so two publishes racing cannot both land.
 */
export async function publishDraft(env: Env, key: string, actor: Actor) {
  const p = await programByKey(env, key);
  const latest = await latestVersion(env, p.key);
  const draft = await sectionsOf(env, p.key, 0);
  const published = latest ? await sectionsOf(env, p.key, Number(latest.version)) : [];
  if (!draft.length || contentOf(draft) === contentOf(published)) {
    throw new ProgramError(409, 'nothing_to_publish', 'The draft is the same as the published playbook.');
  }
  const next = (latest ? Number(latest.version) : 0) + 1;
  const t = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO program_playbook_versions (program_key, version, published_at, published_by_user_id) VALUES (?, ?, ?, ?)',
      ).bind(p.key, next, t, actor.id),
      env.DB.prepare(
        `INSERT INTO program_playbook_sections
           (program_key, version, section_key, position, title, body, computed, template_keys, edited_at, edited_by_user_id)
         SELECT program_key, ?, section_key, position, title, body, computed, template_keys, edited_at, edited_by_user_id
           FROM program_playbook_sections WHERE program_key = ? AND version = 0`,
      ).bind(next, p.key),
    ]);
  } catch (e) {
    if (/UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e))) {
      throw new ProgramError(409, 'publish_conflict', 'Another publish landed first. Reload and publish again.');
    }
    throw e;
  }
  await logAdminAction(env, actor.id, actor.email, REGISTRY_ACTIONS.publish, { program_key: p.key, version: next });
  return programDetail(env, p.key, true);
}

// ---------------------------------------------------------------------------
// D955: adding a program
// ---------------------------------------------------------------------------

export type NewProgram = {
  key: string; grp: string; name: string; purpose: string | null; who: string | null; join_method: string | null;
  licence_uid: string | null;
  /** The playbook draft (version 0), in order. Nothing is published. */
  sections: Array<{ key: string; title: string; body: string | null; template_keys?: string[] }>;
};

/**
 * Refuses a key that is not a slug, a reserved sub-path, or a key the registry
 * already holds (in any studio): 409 `program_key_taken`.
 */
export async function checkNewKey(env: Env, key: string) {
  if (!isRegistryKey(key) || !key) {
    throw new ProgramError(400, 'bad_key', 'A program\'s key is lower-case letters, digits and hyphens, from its name.');
  }
  if ((RESERVED_PROGRAM_KEYS as readonly string[]).includes(key)) {
    throw new ProgramError(409, 'program_key_taken', `${key} is part of the Programs address, so no program can use it as its key.`);
  }
  const hit = await env.DB.prepare('SELECT 1 AS n FROM programs WHERE key = ?').bind(key).first<{ n: number }>();
  if (hit) throw new ProgramError(409, 'program_key_taken', `A program with the key ${key} already exists.`);
}

/**
 * The statements that write a `proposed` registry row at the end of the
 * catalogue and its unpublished draft, for a caller's `DB.batch`. Call
 * `checkNewKey` first; the key's UNIQUE constraint still refuses a race.
 */
export function insertProgramStatements(env: Env, p: NewProgram, actorId: number) {
  const t = new Date().toISOString();
  return [
    env.DB.prepare(
      `INSERT INTO programs (key, grp, name, purpose, who, join_method, status, position, licence_uid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'proposed', (SELECT COALESCE(MAX(position), 0) + 1 FROM programs), ?, ?, ?)`,
    ).bind(p.key, p.grp, p.name, p.purpose, p.who, p.join_method, p.licence_uid, t, t),
    ...p.sections.map((s, i) => env.DB.prepare(
      `INSERT INTO program_playbook_sections
         (program_key, version, section_key, position, title, body, computed, template_keys, edited_at, edited_by_user_id)
       VALUES (?, 0, ?, ?, ?, ?, 0, ?, ?, ?)`,
    ).bind(p.key, s.key, i + 1, s.title, s.body, JSON.stringify(s.template_keys ?? []), t, actorId)),
  ];
}

export const isKeyTaken = (e: unknown) => /UNIQUE constraint failed: programs\.key/i.test(String((e as Error)?.message ?? e));
