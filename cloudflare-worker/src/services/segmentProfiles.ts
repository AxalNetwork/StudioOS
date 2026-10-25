/**
 * D1000 (#2815), Persona segments part 3: the segment profile store
 * (migration 559), its writes, the status rules, and the needs read.
 *
 * WHAT IS STORED, AND WHAT IS NOT. `segment_profiles` holds what HQ writes
 * about a segment: name, profile, status, who they are, the typical member,
 * the needs in order with what answers each, and the programs, perks and
 * content offered. Two kinds of offer are NOT stored, because something else
 * already decides them and a stored copy would say what the product does not do:
 *   - sidebar links are the persona's `nav_extras` in code, which is what the
 *     sidebar draws (D998's rule: only when the member's profile matches the
 *     segment's code profile);
 *   - events are each event's own audience rule (D567), read here.
 * The sign-up questions stay in code too (D997 §5, owner decision 1).
 *
 * THE STATUS RULES (D997 §5):
 *   active   sign-up offers it, and an admin may place members in it;
 *   draft    sign-up does not offer it; only an admin places members in it;
 *   retired  no new members, by sign-up or by an admin. Current members keep
 *            it until they are moved.
 * A code persona with no row yet reads `active`, which is what sign-up
 * offered before this store existed. A failed read is an error, never a
 * fallback: the caller answers 503.
 *
 * COUNTS leave admin accounts out, and a count from 1 to 4 is suppressed
 * (`suppressGroup`, `SMALL_CELL_MIN`), with one more cell where a total would
 * give it away.
 */
import type { Env } from '../types';
import { PERSONAS, PERSONA_BY_ID } from '../personas';
import { SMALL_CELL_MIN, suppressGroup, type Cell } from './profileEvolution';

export const SEGMENT_STATUSES = ['active', 'draft', 'retired'] as const;
export const SEGMENT_PROFILES = ['founder', 'investor', 'advisor', 'partner', 'exploring', 'any'] as const;
export const ANSWER_KINDS = ['program', 'perk', 'content', 'sidebar_link', 'events'] as const;
export const OFFER_KINDS = ['programs', 'perks', 'content'] as const;
export const LIMITS = {
  name: 80, who: 280, typical: 4, typicalLine: 120, needs: 6, needText: 200, answers: 6, offers: 20, reason: 280,
} as const;

export type SegmentStatus = (typeof SEGMENT_STATUSES)[number];
type Profile = (typeof SEGMENT_PROFILES)[number];
type AnswerKind = (typeof ANSWER_KINDS)[number];
type OfferKind = (typeof OFFER_KINDS)[number];

export interface Answer { kind: AnswerKind; ref: string | null }
export interface Need { id: string; text: string; answered_by: Answer[] }
export type Offers = Record<OfferKind, string[]>;

interface Row {
  key: string; name: string; profile: Profile; status: SegmentStatus; who: string | null;
  typical_json: string; needs_json: string; offers_json: string; version: number;
  updated_by: number | null; created_at: string; updated_at: string;
}

/** A refusal of a write: a code, a sentence, and its status. */
export class SegmentInputError extends Error {
  readonly code: string;
  readonly sentence: string;
  readonly status: 400 | 404 | 409;
  constructor(code: string, sentence: string, status: 400 | 404 | 409 = 400) {
    super(sentence);
    this.code = code; this.sentence = sentence; this.status = status;
  }
}

const parse = <T>(json: string | null | undefined, fallback: T): T => {
  try { const v = JSON.parse(json || ''); return v ?? fallback; } catch { return fallback; }
};

const emptyOffers = (): Offers => ({ programs: [], perks: [], content: [] });

function offersOf(json: string): Offers {
  const raw = parse<Record<string, unknown>>(json, {});
  const out = emptyOffers();
  for (const k of OFFER_KINDS) out[k] = Array.isArray(raw[k]) ? (raw[k] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  return out;
}

/** The persona's sidebar links, from code: the only links the sidebar draws for it. */
export const sidebarLinksOf = (key: string) => (PERSONA_BY_ID as Record<string, { nav_extras?: Array<{ to: string; label: string }> } | undefined>)[key]?.nav_extras ?? [];

/** A stored profile as the routes return it. */
export function viewOf(row: Row) {
  const code = (PERSONA_BY_ID as Record<string, (typeof PERSONAS)[number] | undefined>)[row.key];
  return {
    key: row.key,
    name: row.name,
    profile: row.profile,
    status: row.status,
    who: row.who ?? null,
    typical: parse<unknown[]>(row.typical_json, []).filter((x): x is string => typeof x === 'string'),
    needs: parse<Need[]>(row.needs_json, []),
    offers: { ...offersOf(row.offers_json), sidebar_links: sidebarLinksOf(row.key) },
    // From code, read only: the profile the sidebar rule compares and the sign-up questions.
    in_code: Boolean(code),
    code_profile: code?.profile ?? null,
    sign_up_questions: code ? code.follow_up_questions.length : null,
    version: row.version,
    updated_by: row.updated_by ?? null,
    updated_at: row.updated_at,
  };
}

async function rows(env: Env): Promise<Row[]> {
  const r = await env.DB.prepare(`SELECT key, name, profile, status, who, typical_json, needs_json, offers_json, version, updated_by, created_at, updated_at FROM segment_profiles ORDER BY key`).all<Row>();
  if (!r || !Array.isArray(r.results)) throw new Error('segment profiles were not returned');
  return r.results;
}

export async function listProfiles(env: Env) {
  return (await rows(env)).map(viewOf);
}

export async function getProfile(env: Env, key: string) {
  const row = await env.DB.prepare(`SELECT key, name, profile, status, who, typical_json, needs_json, offers_json, version, updated_by, created_at, updated_at FROM segment_profiles WHERE key = ?`).bind(key).first<Row>();
  return row ? viewOf(row) : null;
}

export async function historyOf(env: Env, key: string, limit = 50) {
  const r = await env.DB.prepare(
    `SELECT h.id, h.version, h.action, h.fields_json, h.before_json, h.after_json, h.reason, h.created_at,
            CASE WHEN h.actor_user_id IS NULL THEN NULL ELSE COALESCE(u.name, 'An admin') END AS actor_name
       FROM segment_profile_history h LEFT JOIN users u ON u.id = h.actor_user_id
      WHERE h.segment_key = ? ORDER BY h.id DESC LIMIT ?`,
  ).bind(key, limit).all<any>();
  if (!r || !Array.isArray(r.results)) throw new Error('segment history was not returned');
  return r.results.map((h) => ({
    id: h.id, version: h.version, action: h.action,
    fields: parse<string[]>(h.fields_json, []), before: parse<Record<string, unknown> | null>(h.before_json, null), after: parse<Record<string, unknown> | null>(h.after_json, null),
    reason: h.reason ?? null, by: h.actor_name ?? null, at: h.created_at,
  }));
}

/** Each key's status. A code persona with no row reads `active`; a key in neither is absent. */
export async function statusesOf(env: Env): Promise<Map<string, SegmentStatus>> {
  const r = await env.DB.prepare(`SELECT key, status FROM segment_profiles`).all<{ key: string; status: SegmentStatus }>();
  if (!r || !Array.isArray(r.results)) throw new Error('segment statuses were not returned');
  const out = new Map<string, SegmentStatus>(PERSONAS.map((p) => [p.id, 'active' as SegmentStatus]));
  for (const row of r.results) out.set(row.key, row.status);
  return out;
}

export const NOT_OFFERED = 'That segment is not open for sign-up. Pick one of the segments shown.';
export const retiredSentence = (name: string) => `${name} is retired, so it takes no new members.`;

/* ------------------------------------------------------------------ *
 * The write
 * ------------------------------------------------------------------ */

const FIELDS = ['name', 'profile', 'status', 'who', 'typical', 'needs', 'offers'] as const;
type Field = (typeof FIELDS)[number];

const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** Each kind's lookup: the values of `values` (a JSON list) that its store holds, and the word for one. */
const OFFER_LOOKUP: Record<OfferKind, { sql: string; word: string }> = {
  programs: { sql: `SELECT p.key AS v FROM programs p JOIN json_each(?) j ON j.value = p.key`, word: 'program' },
  perks: { sql: `SELECT p.uid AS v FROM perks p JOIN json_each(?) j ON j.value = p.uid`, word: 'perk' },
  content: { sql: `SELECT a.slug AS v FROM articles a JOIN json_each(?) j ON j.value = a.slug`, word: 'content' },
};

async function existing(env: Env, kind: OfferKind, values: string[]): Promise<Set<string>> {
  if (!values.length) return new Set();
  const r = await env.DB.prepare(OFFER_LOOKUP[kind].sql).bind(JSON.stringify(values)).all<{ v: string }>();
  if (!r || !Array.isArray(r.results)) throw new Error(`${kind} were not returned`);
  return new Set(r.results.map((x) => x.v));
}
const ANSWER_OFFER: Partial<Record<AnswerKind, OfferKind>> = { program: 'programs', perk: 'perks', content: 'content' };

function stringList(value: unknown, max: number, maxLen: number, code: string, what: string): string[] {
  if (!Array.isArray(value)) throw new SegmentInputError(code, `${what} is a list.`);
  const out = value.map(clean);
  if (out.length > max) throw new SegmentInputError(code, `${what} holds at most ${max}.`);
  if (out.some((s) => !s || s.length > maxLen)) throw new SegmentInputError(code, `Each line of ${what.toLowerCase()} is 1 to ${maxLen} characters.`);
  if (new Set(out).size !== out.length) throw new SegmentInputError(code, `${what} names the same item twice.`);
  return out;
}

/**
 * The changes a body asks for, checked against the stores they name. Only the
 * fields present change. A program, perk or article must exist; a need's
 * answer must be one of this segment's offers, one of its code sidebar links,
 * or `events`.
 */
export async function checkedChanges(env: Env, current: ReturnType<typeof viewOf>, body: Record<string, unknown>) {
  const allowed = new Set<string>([...FIELDS, 'expected_version', 'reason']);
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length) {
    const ro = unknown.find((k) => ['sidebar_links', 'events', 'sign_up_questions', 'key'].includes(k));
    throw new SegmentInputError(ro ? 'read_only' : 'unknown_field', ro
      ? `${ro.replace(/_/g, ' ')} cannot be written here: sidebar links and sign-up questions are set in code, and events by each event's audience.`
      : `Unknown field: ${unknown[0]}.`);
  }
  const next: Partial<Record<Field, unknown>> = {};
  if ('name' in body) {
    const name = clean(body.name);
    if (!name || name.length > LIMITS.name) throw new SegmentInputError('invalid_name', `A name is 1 to ${LIMITS.name} characters.`);
    next.name = name;
  }
  if ('profile' in body) {
    if (!(SEGMENT_PROFILES as readonly string[]).includes(String(body.profile))) throw new SegmentInputError('invalid_profile', 'A profile is Founders, Investors, Advisors, Operating Partners, Explorers or Any profile.');
    next.profile = body.profile;
  }
  if ('status' in body) {
    if (!(SEGMENT_STATUSES as readonly string[]).includes(String(body.status))) throw new SegmentInputError('invalid_status', 'A status is Active, Draft or Retired.');
    next.status = body.status;
  }
  if ('who' in body) {
    const who = body.who === null ? '' : clean(body.who);
    if (who.length > LIMITS.who) throw new SegmentInputError('invalid_who', `Who they are is at most ${LIMITS.who} characters.`);
    next.who = who || null;
  }
  if ('typical' in body) next.typical = stringList(body.typical, LIMITS.typical, LIMITS.typicalLine, 'invalid_typical', 'Typical member');

  let offers = current.offers as Offers;
  if ('offers' in body) {
    const raw = body.offers;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SegmentInputError('invalid_offers', 'Offers are programs, perks and content.');
    const extra = Object.keys(raw).filter((k) => !(OFFER_KINDS as readonly string[]).includes(k));
    if (extra.length) throw new SegmentInputError(extra.includes('sidebar_links') ? 'read_only' : 'invalid_offers', extra.includes('sidebar_links')
      ? 'sidebar links cannot be written here: they are set in code, which is what the sidebar draws.'
      : `Offers are programs, perks and content, not ${extra[0]}.`);
    const out = { ...offers };
    for (const kind of OFFER_KINDS) {
      if (!(kind in raw)) continue;
      const list = stringList((raw as Record<string, unknown>)[kind], LIMITS.offers, 120, 'invalid_offers', `Offers of ${kind}`);
      const found = await existing(env, kind, list);
      const missing = list.find((v) => !found.has(v));
      const { word } = OFFER_LOOKUP[kind];
      if (missing) throw new SegmentInputError(`unknown_${word}`, `No ${word} is recorded as ${missing}.`);
      out[kind] = list;
    }
    offers = out;
    next.offers = { programs: out.programs, perks: out.perks, content: out.content };
  }

  const links = new Set(sidebarLinksOf(current.key).map((l) => l.to));
  const checkNeeds = (needs: Need[]) => {
    for (const n of needs) {
      for (const a of n.answered_by) {
        const offerKind = ANSWER_OFFER[a.kind];
        if (offerKind && !offers[offerKind].includes(String(a.ref))) throw new SegmentInputError('answer_not_offered', `‘${n.text}’ names a ${a.kind} this segment does not offer: ${a.ref}.`);
        if (a.kind === 'sidebar_link' && !links.has(String(a.ref))) throw new SegmentInputError('answer_not_offered', `‘${n.text}’ names a sidebar link this segment does not have: ${a.ref}.`);
      }
    }
  };
  if ('needs' in body) {
    const raw = body.needs;
    if (!Array.isArray(raw)) throw new SegmentInputError('invalid_needs', 'Needs are a list.');
    if (raw.length > LIMITS.needs) throw new SegmentInputError('invalid_needs', `A segment has at most ${LIMITS.needs} needs.`);
    const ids = new Set<string>();
    const needs: Need[] = raw.map((n: any, i: number) => {
      const text = clean(n?.text);
      if (!text || text.length > LIMITS.needText) throw new SegmentInputError('invalid_needs', `Each need is 1 to ${LIMITS.needText} characters.`);
      const id = clean(n?.id) || `n${i + 1}`;
      if (!/^[a-z0-9_-]{1,32}$/i.test(id) || ids.has(id)) throw new SegmentInputError('invalid_needs', 'Each need has its own id.');
      ids.add(id);
      const answers = Array.isArray(n?.answered_by) ? n.answered_by : [];
      if (answers.length > LIMITS.answers) throw new SegmentInputError('invalid_needs', `A need names at most ${LIMITS.answers} answers.`);
      const answered_by: Answer[] = answers.map((a: any) => {
        if (!(ANSWER_KINDS as readonly string[]).includes(a?.kind)) throw new SegmentInputError('invalid_needs', 'An answer is a program, a perk, content, a sidebar link or events.');
        const ref = a.kind === 'events' ? null : clean(a.ref);
        if (a.kind !== 'events' && !ref) throw new SegmentInputError('invalid_needs', 'An answer names what answers it.');
        return { kind: a.kind, ref };
      });
      return { id, text, answered_by };
    });
    checkNeeds(needs);
    next.needs = needs;
  } else if ('offers' in body) {
    // Taking an offer away must not leave a need naming it.
    checkNeeds(current.needs as Need[]);
  }
  return next;
}

/**
 * One write: the fields that changed, a version more, and one history row,
 * in one batch. The UPDATE names the version the writer read, so a second
 * writer who read the same version changes nothing and is told to reload.
 */
export async function writeProfile(env: Env, key: string, body: Record<string, unknown>, actor: { id: number }) {
  const current = await getProfile(env, key);
  if (!current) throw new SegmentInputError('not_found', 'No segment is recorded with that key.', 404);
  const expected = Number(body.expected_version);
  if (!Number.isInteger(expected) || expected < 1) throw new SegmentInputError('expected_version_required', 'Say which version you edited (expected_version).');
  if (expected !== current.version) throw new SegmentInputError('segment_changed', 'This segment changed since you opened it. Reload to see the latest.', 409);
  const reason = body.reason == null ? null : clean(body.reason);
  if (reason && reason.length > LIMITS.reason) throw new SegmentInputError('invalid_reason', `A reason is at most ${LIMITS.reason} characters.`);

  const next = await checkedChanges(env, current, body);
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const was: Record<Field, unknown> = {
    name: current.name, profile: current.profile, status: current.status, who: current.who,
    typical: current.typical, needs: current.needs,
    offers: { programs: current.offers.programs, perks: current.offers.perks, content: current.offers.content },
  };
  for (const f of FIELDS) {
    if (!(f in next)) continue;
    if (JSON.stringify(was[f]) === JSON.stringify(next[f])) continue;
    before[f] = was[f]; after[f] = next[f];
  }
  const fields = Object.keys(after);
  if (!fields.length) return { profile: current, changed: [] as string[] };

  const v = { ...was, ...after } as Record<Field, any>;
  const version = current.version + 1;
  const [update] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE segment_profiles
          SET name = ?, profile = ?, status = ?, who = ?, typical_json = ?, needs_json = ?, offers_json = ?,
              version = ?, updated_by = ?, updated_at = datetime('now')
        WHERE key = ? AND version = ?`,
    ).bind(v.name, v.profile, v.status, v.who, JSON.stringify(v.typical), JSON.stringify(v.needs), JSON.stringify(v.offers),
      version, actor.id, key, current.version),
    // Written only when this batch's UPDATE took: the row is at the new
    // version and nobody has written that version's history yet.
    env.DB.prepare(
      `INSERT INTO segment_profile_history (segment_key, version, action, fields_json, before_json, after_json, reason, actor_user_id)
       SELECT ?, ?, 'edited', ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM segment_profiles WHERE key = ? AND version = ? AND updated_by = ?)
          AND NOT EXISTS (SELECT 1 FROM segment_profile_history WHERE segment_key = ? AND version = ?)`,
    ).bind(key, version, JSON.stringify(fields), JSON.stringify(before), JSON.stringify(after), reason, actor.id,
      key, version, actor.id, key, version),
  ]);
  if (!update?.meta?.changes) throw new SegmentInputError('segment_changed', 'This segment changed since you opened it. Reload to see the latest.', 409);
  // The write has landed. A re-read that fails must not read as a failed write,
  // so it falls back to the values just written.
  let profile: ReturnType<typeof viewOf> | null = null;
  try { profile = await getProfile(env, key); } catch { profile = null; }
  profile ??= { ...current, ...v, offers: { ...v.offers, sidebar_links: current.offers.sidebar_links }, version, updated_by: actor.id };
  return { profile, changed: fields };
}

/* ------------------------------------------------------------------ *
 * The needs read: what is met, what is a gap, and how far links reach
 * ------------------------------------------------------------------ */

const NOT_READ = (what: string) => ({ available: false as const, unreadable: true as const, reason: `${what} could not be read. That is not a claim that there are none.` });

async function liveSet(env: Env, sql: string): Promise<Set<string>> {
  const r = await env.DB.prepare(sql).all<{ v: string }>();
  if (!r || !Array.isArray(r.results)) throw new Error('rows were not returned');
  return new Set(r.results.map((x) => x.v));
}

/** Whether an event's registration rule admits a segment: everyone, or the segment named, or its code profile named. */
export function eventAdmits(rulesJson: string | null, key: string, codeProfile: string | null): boolean {
  const r = parse<Record<string, unknown>>(rulesJson, {});
  const mode = typeof r.mode === 'string' ? r.mode : 'everyone';
  if (mode === 'everyone') return true;
  if (mode !== 'selected') return false;
  const personas = Array.isArray(r.personas) ? r.personas : [];
  const roles = Array.isArray(r.roles) ? r.roles : [];
  return personas.includes(key) || (codeProfile !== null && roles.includes(codeProfile));
}

const cell = (c: Cell) => ({ count: c.count, suppressed: c.suppressed });

/**
 * Per segment: members (admins out), its needs met and gaps, and its offers by
 * kind. A need is met when one of its answers resolves: a live program, a live
 * perk, a published article, a sidebar link in code, or at least one upcoming
 * published event that admits the segment. A segment with no needs written
 * reads `recorded: false` ("Not recorded"), never 0 of 0.
 */
export async function segmentCoverage(env: Env, now = Date.now()) {
  const profiles = await listProfiles(env);
  const members = await env.DB.prepare(
    `SELECT up.persona_id AS key, u.role AS role, COUNT(*) AS n
       FROM user_personas up JOIN users u ON u.id = up.user_id
      WHERE up.is_primary = 1 AND u.role != 'admin'
      GROUP BY up.persona_id, u.role`,
  ).all<{ key: string; role: string; n: number }>();
  if (!members || !Array.isArray(members.results)) throw new Error('members were not returned');

  const read = async <T>(what: string, fn: () => Promise<T>) => {
    try { return { ok: true as const, value: await fn() }; } catch (e) {
      console.error('[segment-coverage]', what, (e as Error)?.message);
      return { ok: false as const, block: NOT_READ(what) };
    }
  };
  const programs = await read('Programs', () => liveSet(env, `SELECT key AS v FROM programs WHERE status = 'live'`));
  const perks = await read('Perks', () => liveSet(env, `SELECT uid AS v FROM perks WHERE status = 'live'`));
  const content = await read('Content', () => liveSet(env, `SELECT slug AS v FROM articles WHERE status = 'published'`));
  const events = await read('Events', async () => {
    const r = await env.DB.prepare(
      `SELECT id, starts_at, audience_rules_json FROM events WHERE status = 'published' AND visibility != 'private'`,
    ).all<{ id: number; starts_at: string; audience_rules_json: string }>();
    if (!r || !Array.isArray(r.results)) throw new Error('events were not returned');
    return r.results.filter((e) => {
      const at = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(String(e.starts_at)) ? e.starts_at : `${String(e.starts_at).replace(' ', 'T')}Z`);
      return Number.isFinite(at) && at > now;
    });
  });

  const byKey = new Map<string, Array<{ role: string; n: number }>>();
  for (const m of members.results) byKey.set(m.key, [...(byKey.get(m.key) || []), { role: m.role, n: Number(m.n) }]);

  const segments = profiles.map((p) => {
    const rows = byKey.get(p.key) || [];
    const total = rows.reduce((s, r) => s + r.n, 0);
    // D998's sidebar rule: a link shows only when the member's role is the segment's code profile.
    const reached = p.code_profile ? rows.filter((r) => r.role === p.code_profile).reduce((s, r) => s + r.n, 0) : 0;
    const reachCells = suppressGroup([reached, total - reached]);
    const memberCell = suppressGroup([total]).cells[0];
    const openEvents = events.ok ? events.value.filter((e) => eventAdmits(e.audience_rules_json, p.key, p.code_profile)).length : null;

    const resolves = (a: Answer): boolean | null => {
      if (a.kind === 'program') return programs.ok ? programs.value.has(String(a.ref)) : null;
      if (a.kind === 'perk') return perks.ok ? perks.value.has(String(a.ref)) : null;
      if (a.kind === 'content') return content.ok ? content.value.has(String(a.ref)) : null;
      if (a.kind === 'sidebar_link') return p.offers.sidebar_links.some((l) => l.to === a.ref);
      return openEvents === null ? null : openEvents > 0;
    };
    const needs = (p.needs as Need[]).map((n) => {
      const answers = n.answered_by.map((a) => ({ ...a, resolved: resolves(a) }));
      const met = answers.some((a) => a.resolved === true);
      // Unknown, not unmet, when every answer that could meet it could not be read.
      const unknown = !met && answers.some((a) => a.resolved === null);
      return { id: n.id, text: n.text, met: unknown ? null : met, answers };
    });
    const gapKinds = ANSWER_KINDS.filter((k) => needs.some((n) => n.answers.some((a) => a.kind === k)
      && !n.answers.some((a) => a.kind === k && a.resolved !== false)));

    const kindBlock = (r: typeof programs, list: string[]) => (r.ok
      ? { available: true as const, count: list.length, live: list.filter((x) => r.value.has(x)).length }
      : r.block);
    return {
      key: p.key, name: p.name, profile: p.profile, status: p.status,
      members: cell(memberCell),
      needs: needs.length
        ? {
          recorded: true as const,
          total: needs.length,
          met: needs.some((n) => n.met === null) ? null : needs.filter((n) => n.met).length,
          gaps: needs.filter((n) => n.met === false).map((n) => ({ id: n.id, text: n.text })),
          items: needs,
        }
        : { recorded: false as const, reason: 'HQ has not written needs for this segment yet.' },
      gap_kinds: gapKinds,
      offers: {
        programs: kindBlock(programs, p.offers.programs),
        perks: kindBlock(perks, p.offers.perks),
        content: kindBlock(content, p.offers.content),
        events: events.ok ? { available: true as const, count: openEvents } : events.block,
        sidebar_links: {
          available: true as const,
          count: p.offers.sidebar_links.length,
          reach: p.offers.sidebar_links.length
            // suppressGroup hides a second cell beside a hidden one, so the total can be shown.
            ? { reached: cell(reachCells.cells[0]), of: cell(memberCell) }
            : null,
          rule: 'A sidebar link shows only when the member’s profile is the segment’s profile in code.',
          code_profile: p.code_profile,
          profile_differs: p.code_profile !== null && p.profile !== 'any' && p.profile !== p.code_profile,
        },
      },
    };
  });
  return { segments, small_cell_min: SMALL_CELL_MIN, admins: 'left out of every count' };
}
