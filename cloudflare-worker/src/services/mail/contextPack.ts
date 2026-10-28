/**
 * D1341 (#3549, #3547 EM2) — the records a draft may quote, for one person.
 *
 * A person is a ref, `kind:id`. Each kind is one module's record, read through
 * that module's own read: the record page's gate, store check and section
 * gates (`../records/read.ts`), or, for an engagement, the founder's own rule
 * (`advisor_engagements.founder_user_id`, `engagements.founder_id`). A ref the
 * member cannot read answers exactly as a ref that does not exist: 404,
 * "Record not found." Nothing here is read from a table the module does not
 * read itself.
 *
 * The pack holds the person's record, selected, and the member's company (the
 * one-liner and the KPI board) where the person belongs to a venture or the
 * member names one, never selected. Each item has a ref, a one-line label, an
 * `as_of` day and a link; its text is what the prompt may carry when chosen.
 */
import type { Env, User } from '../../types';
import type { ProjectRef } from '../../routes/_founder_validate_helpers';
import { readableRecord } from '../records/read';
import { INTENTS, RELATIONSHIP_OF, type Intent, type Relationship } from './intents';
import { computeBlock, type BlockKind } from './blocks';
import { shareOf } from './shares';
import { caseOnly, profileRecord, RecordMissing } from './profileRecords';

export const NOT_FOUND = 'Record not found.';

export class MailError extends Error {
  readonly status: number;
  readonly code: string;
  readonly sentence: string;
  constructor(status: number, code: string, sentence: string) { super(sentence); this.status = status; this.code = code; this.sentence = sentence; }
}
export const notFound = () => new MailError(404, 'not_found', NOT_FOUND);

export type PackItem = { ref: string; kind: string; label: string; as_of: string | null; link: string; selected: boolean; text: string };
// `email_ready` (D1342): a Network match's Email opens only when both members have shared an address.
export type Person = { ref: string; kind: string; relationship: Relationship; name: string; project_id: number | null; email_ready?: boolean };
export type Pack = { person: Person; intents: readonly Intent[]; items: PackItem[] };

const REF = /^([a-z_]{3,20}):([a-z0-9][a-z0-9_-]{0,63})$/;
const NUMERIC = /^[1-9][0-9]{0,9}$/;
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export function parseRef(raw: unknown): { kind: string; id: string } | null {
  const m = typeof raw === 'string' ? REF.exec(raw.trim()) : null;
  return m ? { kind: m[1], id: m[2] } : null;
}

type Found = { project_id: number | null; updated_at: string | null; pains_json?: string | null; stage?: string | null; invited_at?: string | null; booked_at?: string | null; done_at?: string | null };

/** An interview's pains and its recruiting row (its own stage), from the row the record's gate already admitted. */
function interviewLines(row: Found): string[] {
  let pains: unknown[] = [];
  try { const p = JSON.parse(String(row.pains_json ?? '[]')); pains = Array.isArray(p) ? p : []; } catch { pains = []; }
  const named = pains.map((p: any) => String(typeof p === 'string' ? p : p?.text ?? p?.pain ?? '').trim()).filter(Boolean);
  const stage = row.stage == null ? 'done' : row.stage;
  const when = stage === 'done' ? day(row.done_at) : stage === 'booked' ? day(row.booked_at) : stage === 'invited' ? day(row.invited_at) : null;
  return [`Recruiting stage: ${stage}${when ? ` since ${when}` : ''}`, ...(named.length ? ['Pains:', ...named.slice(0, 8).map((p) => `- ${p}`)] : ['Pains: none logged'])];
}

/**
 * A person kind's module: where its record lives and how its venture is found
 * (fixed statements only), the record-page sections a draft leaves out (a raw
 * transcript, a run's cost, the session's plumbing), and lines of its own row.
 */
const MODULES: Record<string, { cycle: string; slug: string; module: string; sql: string; id: (id: string) => string | number | null; link: (id: string, p: number) => string; skip?: string[]; lines?: (row: Found) => string[] }> = {
  interviewee: {
    cycle: 'validate', slug: 'customer-research', module: 'Customer research',
    sql: 'SELECT project_id, updated_at, pains_json, stage, invited_at, booked_at, done_at FROM discovery_interviews WHERE id = ?',
    skip: ['transcript', 'cost', 'session'], lines: interviewLines,
    id: (id) => (NUMERIC.test(id) ? Number(id) : null),
    link: (id, p) => `/validate/customer-research/${id}?project=${p}`,
  },
  prospect: {
    cycle: 'raise', slug: 'capital-relationships', module: 'Capital relationships',
    sql: 'SELECT project_id, updated_at FROM raise_prospects WHERE id = ?',
    id: (id) => (NUMERIC.test(id) ? Number(id) : null),
    link: (id, p) => `/raise/capital-relationships/${id}?project_id=${p}`,
  },
  cofounder: {
    cycle: 'build', slug: 'founding-team', module: 'Founding team',
    // A holder with no founder role is no co-founder: `ownedRow` refuses it, as the record page does.
    sql: 'SELECT project_id, updated_at FROM cap_table_holders WHERE id = ?',
    id: (id) => (id.startsWith('h-') && NUMERIC.test(id.slice(2)) ? Number(id.slice(2)) : null),
    link: (id, p) => `/build/founding-team/${id}?project=${p}`,
  },
  growth_partner: {
    cycle: 'grow', slug: 'partner-network', module: 'Partner network',
    sql: 'SELECT project_id, updated_at FROM growth_partners WHERE uid = ?',
    id: (id) => id,
    link: (id, p) => `/grow/partner-network/${id}?project_id=${p}`,
  },
};

async function projectRef(env: Env, id: number): Promise<ProjectRef | null> {
  return await env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?').bind(id).first<ProjectRef>();
}

/** A module record's text: its title, its line, its facts (a missing one in its own words), and each section it shows. */
function recordText(r: NonNullable<Awaited<ReturnType<typeof readableRecord>>>, skip: string[] = [], own: string[] = []): string {
  const lines = [r.record.title, r.record.sub].filter(Boolean);
  for (const f of r.record.facts) lines.push(`${f.label}: ${f.value == null || f.value === '' ? (f.reason || 'Not recorded') : f.value}`);
  lines.push(...own);
  for (const s of r.sections) {
    if (!s.rows.length || skip.includes(s.key)) continue;
    lines.push(`${s.title}:`);
    for (const row of s.rows.slice(0, 8)) lines.push(`- ${[row.a, row.b, row.c].filter(Boolean).join(' · ')}`);
  }
  return lines.join('\n');
}

type Read = { person: Person; item: PackItem; more?: PackItem[] };

async function moduleRecord(env: Env, user: User, kind: string, id: string): Promise<Read> {
  const m = MODULES[kind];
  const key = m.id(id);
  if (key == null) throw notFound();
  const row = await env.DB.prepare(m.sql).bind(key).first<Found>();
  const project = row?.project_id ? await projectRef(env, Number(row.project_id)) : null;
  if (!project) throw notFound();
  const read = await readableRecord(env, user, m.cycle, m.slug, project, id);
  if (!read) throw notFound();
  const ref = `${kind}:${id}`;
  const projectId = Number(project.id);
  return {
    person: { ref, kind, relationship: RELATIONSHIP_OF[kind], name: read.record.title, project_id: projectId },
    item: { ref, kind, label: `${m.module} · ${read.record.title}`, as_of: day(row!.updated_at), link: m.link(id, projectId), selected: true, text: recordText(read, m.skip, m.lines?.(row!) ?? []) },
  };
}

/** An advisor engagement the member is the client of, and their last session with that advisor. */
async function advisorEngagement(env: Env, user: User, id: string): Promise<Read> {
  if (!NUMERIC.test(id)) throw notFound();
  const e = await env.DB.prepare(
    `SELECT e.id, e.advisor_id, e.lane, e.shape, e.scope_label, e.started_at, e.term_ends_at, e.updated_at, a.display_name
       FROM advisor_engagements e JOIN advisors a ON a.id = e.advisor_id
      WHERE e.id = ? AND e.founder_user_id = ?`,
  ).bind(Number(id), user.id).first<{ advisor_id: number; lane: string; shape: string; scope_label: string | null; started_at: string | null; term_ends_at: string | null; updated_at: string | null; display_name: string | null }>();
  if (!e) throw notFound();
  const last = await env.DB.prepare(
    `SELECT s.starts_at, b.topic FROM advisor_bookings b JOIN advisor_office_hour_slots s ON s.id = b.slot_id
      WHERE b.advisor_id = ? AND b.founder_user_id = ? AND b.status <> 'cancelled' AND s.starts_at <= ?
      ORDER BY s.starts_at DESC LIMIT 1`,
  ).bind(e.advisor_id, user.id, new Date().toISOString()).first<{ starts_at: string; topic: string | null }>();
  const name = String(e.display_name || '').trim() || 'Advisor';
  const text = [name, `Engagement: ${e.lane}, ${e.shape}${e.scope_label ? ` · ${e.scope_label}` : ''}`,
    `Started: ${day(e.started_at) ?? 'Not recorded'}`, `Term ends: ${day(e.term_ends_at) ?? 'Not recorded'}`,
    last ? `Last session: ${day(last.starts_at)}${last.topic ? ` · ${last.topic}` : ''}` : 'Last session: none recorded'].join('\n');
  const ref = `advisor:${id}`;
  return {
    person: { ref, kind: 'advisor', relationship: 'advisor', name, project_id: null },
    item: { ref, kind: 'advisor', label: `Advisor engagement · ${name}`, as_of: day(last?.starts_at ?? e.updated_at), link: '/build/team?mode=workspace&tab=advisor', selected: true, text },
  };
}

/** An operating partner's engagement on the member's venture, and their last session with that partner. */
async function partnerEngagement(env: Env, user: User, id: string): Promise<Read> {
  if (!NUMERIC.test(id) || user.founder_id == null) throw notFound();
  const e = await env.DB.prepare(
    `SELECT e.partner_id, e.project_id, e.status, e.delivered_at, e.created_at, e.updated_at, p.name, p.company
       FROM engagements e JOIN partners p ON p.id = e.partner_id
      WHERE e.id = ? AND e.founder_id = ?`,
  ).bind(Number(id), Number(user.founder_id)).first<{ partner_id: number; project_id: number; status: string; delivered_at: string | null; created_at: string | null; updated_at: string | null; name: string | null; company: string | null }>();
  if (!e) throw notFound();
  const last = await env.DB.prepare(
    `SELECT s.starts_at, b.topic FROM partner_bookings b JOIN partner_office_hour_slots s ON s.id = b.slot_id
      WHERE b.partner_id = ? AND b.founder_user_id = ? AND b.status <> 'cancelled' AND s.starts_at <= ?
      ORDER BY s.starts_at DESC LIMIT 1`,
  ).bind(e.partner_id, user.id, new Date().toISOString()).first<{ starts_at: string; topic: string | null }>();
  const name = [e.name, e.company].map((v) => String(v || '').trim()).filter(Boolean).join(' · ') || 'Operating partner';
  const text = [name, `Engagement: ${e.status}`, `Started: ${day(e.created_at) ?? 'Not recorded'}`,
    `Delivered: ${day(e.delivered_at) ?? 'Not yet'}`,
    last ? `Last session: ${day(last.starts_at)}${last.topic ? ` · ${last.topic}` : ''}` : 'Last session: none recorded'].join('\n');
  const ref = `partner:${id}`;
  return {
    person: { ref, kind: 'partner', relationship: 'advisor', name, project_id: Number(e.project_id) },
    item: { ref, kind: 'partner', label: `Operating partner engagement · ${name}`, as_of: day(last?.starts_at ?? e.updated_at), link: '/needs', selected: true, text },
  };
}

/**
 * D1342 (#3550): a Network match, named by its share uid. The record is the
 * match itself: who they are and how they were matched. Never their address,
 * which only the shares read serves, and only once both have shared.
 */
async function networkMatch(env: Env, user: User, id: string): Promise<Read> {
  let m;
  try { m = await shareOf(env, user, id); } catch { throw notFound(); }
  const ref = `member:${id}`;
  const text = [m.name, `Role: ${m.role ?? 'Not recorded'}`, `Matched through an introduction you both accepted on ${day(m.matched_at) ?? 'a day not recorded'}.`].join('\n');
  return {
    person: { ref, kind: 'member', relationship: 'network', name: m.name, project_id: null, email_ready: m.ready },
    item: { ref, kind: 'member', label: `Network match · ${m.name}`, as_of: day(m.matched_at), link: '/email', selected: true, text },
  };
}

/**
 * The person's own record. `member` is a Network match (D1342); the other
 * profiles' kinds are `profileRecords.ts`'s (D1348); any other kind does not exist.
 */
export async function personRecord(env: Env, user: User, raw: unknown): Promise<Read> {
  const ref = parseRef(raw);
  if (!ref) throw notFound();
  // D1348 (#3555): the other profiles' kinds, each under its module's rule. An admin reads the case only.
  try {
    const other = await profileRecord(env, user, ref.kind, ref.id);
    if (other) return other;
  } catch (e) {
    if (e instanceof RecordMissing) throw notFound();
    throw e;
  }
  if (caseOnly(user)) throw notFound();
  if (MODULES[ref.kind]) return moduleRecord(env, user, ref.kind, ref.id);
  if (ref.kind === 'advisor') return advisorEngagement(env, user, ref.id);
  if (ref.kind === 'partner') return partnerEngagement(env, user, ref.id);
  if (ref.kind === 'member') return networkMatch(env, user, ref.id);
  throw notFound();
}

/** The company items: each is a block's own read, offered only when it has something to say. */
export const COMPANY_ITEMS: ReadonlyArray<{ kind: BlockKind; label: string }> = [
  { kind: 'one_liner', label: 'One-liner' },
  { kind: 'kpis', label: 'KPI board' },
];

export async function companyItems(env: Env, user: User, projectId: number | null, now: number): Promise<PackItem[]> {
  // D1348: an admin's pack is the case only; no company item is reachable from it.
  if (projectId == null || caseOnly(user)) return [];
  const project = await projectRef(env, projectId);
  if (!project) return [];
  const out: PackItem[] = [];
  for (const c of COMPANY_ITEMS) {
    const block = await computeBlock(env, user, c.kind, project, now);
    if (block) out.push({ ref: `${c.kind}:${projectId}`, kind: c.kind, label: c.label, as_of: block.as_of, link: block.link, selected: false, text: block.text });
  }
  return out;
}

/** The pack for one person. `projectParam` names the member's company when the person has none (an advisor). */
export async function contextPack(env: Env, user: User, raw: unknown, projectParam: number | null = null, now = Date.now()): Promise<Pack> {
  const { person, item, more = [] } = await personRecord(env, user, raw);
  const company = await companyItems(env, user, person.project_id ?? projectParam, now);
  return { person, intents: INTENTS[person.relationship], items: [item, ...more, ...company] };
}
