/**
 * D1326 (#3487, #2431 part 3) — the `form` handler's gather, prompt and parse
 * (D720 §7: "forms and uploads (D777)" are a bespoke handler).
 *
 * WHAT IT ASKS FOR. The blank fields of one form (FILL_FIELDS, D1325) that
 * Eadwyn is offered (`offeredToEadwyn`): never a measured field, never a
 * never-fill one, and never a field the member has typed into. With `rows`,
 * up to that many whole rows for an Add form instead.
 *
 * WHAT IT GATHERS. Only the venture's own records the fields restate (its
 * pain themes and unretired hypotheses, as D1325's module sources read them),
 * the titles already on the form's table (so a proposal does not repeat one),
 * and the member's own words. The gathered rows are the member's own store, so
 * the guard checks only the member's words (`guardText`, D763).
 *
 * WHAT THE PARSE KEEPS, per field, by the class FILL_FIELDS gives it:
 *   restatement   a value that matches one of the venture's own records, by
 *                 id; anything else is dropped (`unmatched`), never written
 *                 with a hedge (D46's match-back);
 *   sourced       only with a citation; none is dropped (`no_citation`);
 *   composition   prose, never aimed at a measured field (`measured`);
 * and refuses outright a field the never-fill registry names (`never_fill`).
 * A field the form does not have, or did not ask for, is dropped too. The
 * parse writes nothing: the route stores what it keeps as proposals.
 */
import type { Env } from '../../types';
import { offeredToEadwyn, type FillField } from './fields';
import { neverFillReason } from './neverFill';
import type { Citation } from './types';
import type { ScopeContext } from './scopes';
import { noteFirm } from '../dealNotes';
import { studioOf } from '../programProposals';
import { investorEvidence } from '../raiseEvidence';

/** The most rows one run may propose, and the most Accept all takes at once (#2431 question 3, A). */
export const MAX_RUN_ROWS = 10;
export const ACCEPT_ALL_MAX = 50;
const MAX_VALUE = 300;

export type DropReason = 'unknown_field' | 'not_asked' | 'never_fill' | 'measured' | 'no_citation' | 'unmatched' | 'invalid' | 'empty';
export interface KeptValue { field: string; value: string | number; citation: Citation | null }
export interface Dropped { field: string; why: DropReason; row?: number }
export interface ParsedFields { kept: KeptValue[]; dropped: Dropped[] }

/** What the form's records restate, by field: the ids a restatement may name, with their words. */
export type Choices = Map<string, Array<{ id: number; label: string }>>;

export interface FormGather {
  choices: Choices;
  /** Titles already on the form's table for this venture, newest first, at most 40. */
  existing: string[];
  /** D1329: what a record that is not a venture's says about itself (titles, names), never a figure. */
  context?: string[];
  /** #4046 (B2): the fields this record offers when it offers fewer than its form lists (a programme's questions). */
  only?: string[];
  /** #4046 (B2): one line on how this form's words are written (an answer in the member's own voice). */
  guide?: string;
  /** #3938 part 7: a retrieval step's hint (VA12's interviewees by meaning), read after the facts; never an answer. */
  hint?: string;
  /** #6194: what a draft read, source by source, for the member: used, none, not shared or unreadable. */
  sources?: DraftSource[];
  /** #6194: the longest value a composition may keep on this run (a deal summary is longer than a title). */
  maxValue?: number;
}

/** #6194: one source a deal summary drew on, or why it did not. `note` is said to the member, never a figure. */
export interface DraftSource { key: 'deal' | 'terms' | 'evidence' | 'diligence' | 'notes'; label: string; state: 'used' | 'none' | 'not_shared' | 'unreadable'; note: string }

/** #6194: the longest deal summary kept, well inside a note's 10,000 characters. */
export const DEAL_SUMMARY_MAX = 1500;

/**
 * Effort as the Add feature writer stores it (`cycle_build.ts` EFFORT_IN: Low,
 * Medium and High write S, M and L), so a kept proposal equals what the Save
 * writes and `POST /api/fills/record` can tell it was kept.
 */
const EFFORT_WORDS: Readonly<Record<string, string>> = Object.freeze({ low: 'S', medium: 'M', high: 'L', s: 'S', m: 'M', l: 'L', xl: 'XL' });

/**
 * The fields one run asks Eadwyn for: offered, and blank in what the member
 * sees now (`values`, the form's own state) and in the record when there is one.
 */
export function fieldsToAsk(fields: readonly FillField[], values: Record<string, unknown> = {}, row: Record<string, unknown> | null = null): FillField[] {
  const blank = (v: unknown) => v == null || String(v).trim() === '';
  return fields.filter((f) => offeredToEadwyn(f) && blank(values[f.field]) && (!row || blank(row[f.column])));
}

/**
 * What is already on each form's table for this venture, newest first, so a
 * proposed row does not repeat one. One literal statement per table (D1328
 * adds Validate's themes, segments and hypotheses).
 */
export const EXISTING_READS: Readonly<Record<string, string>> = Object.freeze({
  mvp_features: 'SELECT title AS value FROM mvp_features WHERE project_id = ? ORDER BY id DESC LIMIT 40',
  pain_groups: 'SELECT title AS value FROM pain_groups WHERE project_id = ? ORDER BY id DESC LIMIT 40',
  customer_segments: 'SELECT name AS value FROM customer_segments WHERE project_id = ? AND archived_at IS NULL ORDER BY id DESC LIMIT 40',
  hypotheses: 'SELECT claim AS value FROM hypotheses WHERE project_id = ? AND retired_at IS NULL ORDER BY id DESC LIMIT 40',
  // #3740 part 2a: what the venture already holds, so a proposal is not a repeat.
  roadmap_okrs: 'SELECT objective AS value FROM roadmap_okrs WHERE project_id = ? ORDER BY id DESC LIMIT 40',
  raise_prospects: 'SELECT name AS value FROM raise_prospects WHERE project_id = ? ORDER BY id DESC LIMIT 40',
  job_postings: 'SELECT title AS value FROM job_postings WHERE project_id = ? ORDER BY id DESC LIMIT 40',
  // #4046 (Group A1). Feedback's themes, never what a customer said.
  competitor_tracking: "SELECT why_it_matters AS value FROM competitor_tracking WHERE project_id = ? AND why_it_matters IS NOT NULL AND trim(why_it_matters) <> '' ORDER BY id DESC LIMIT 40",
  product_feedback: "SELECT DISTINCT theme AS value FROM product_feedback WHERE project_id = ? AND theme IS NOT NULL AND trim(theme) <> '' ORDER BY theme LIMIT 40",
  compliance_events: 'SELECT title AS value FROM compliance_events WHERE project_id = ? ORDER BY id DESC LIMIT 40',
  // #4046: the venture's other channel names, so a new one is not a repeat. Never a spend or a bar.
  growth_channels: 'SELECT name AS value FROM growth_channels WHERE project_id = ? ORDER BY id DESC LIMIT 40',
});

/** The venture's own records the form's restatement fields pick from. Literal statements only. */
export async function gatherForm(env: Env, projectId: number, fields: readonly FillField[]): Promise<FormGather> {
  const choices: Choices = new Map();
  for (const f of fields) {
    if (f.sources.includes('module:validate/problem-discovery')) {
      const rows = ((await env.DB.prepare('SELECT id, title FROM pain_groups WHERE project_id = ? ORDER BY sort_order, id LIMIT 200')
        .bind(projectId).all<{ id: number; title: string }>()).results) || [];
      choices.set(f.field, rows.map((r) => ({ id: Number(r.id), label: String(r.title) })));
    }
    if (f.sources.includes('module:validate/experiments')) {
      const rows = ((await env.DB.prepare('SELECT id, code, claim FROM hypotheses WHERE project_id = ? AND retired_at IS NULL ORDER BY sort_order, id LIMIT 200')
        .bind(projectId).all<{ id: number; code: string; claim: string }>()).results) || [];
      choices.set(f.field, rows.map((r) => ({ id: Number(r.id), label: `${r.code}: ${r.claim}` })));
    }
  }
  const table = fields[0]?.table;
  const read = table ? EXISTING_READS[table] : undefined;
  const existing = read
    ? (((await env.DB.prepare(read).bind(projectId).all<{ value: string }>()).results) || []).map((r) => String(r.value))
    : [];
  return { choices, existing };
}

/**
 * D1329 (#3490): what Eadwyn reads for a record that is not a venture's, by
 * its table, all literal statements on rows the route has already scoped:
 * the record's own title and kind, the advisor's own recorded outcomes and
 * services, the event's sessions. Never an amount, a term, a vote or a decision.
 * D1595 (#3868): a support entry's company and the caller's own last entries
 * on it; the caller's own offering titles; the caller's own perk offers.
 * #4046: a deal note reads the deal's company and stage and its firm's last notes.
 * #6194: asked for a deal summary (`ctx.purpose`), it also reads what this
 * investor may read (`dealSummarySources`) and says, source by source, what it used.
 */
export async function gatherScoped(env: Env, userId: number, table: string, row: Record<string, unknown> | null, parentId: number | null = null, ctx?: ScopeContext): Promise<FormGather> {
  const out: FormGather = { choices: new Map(), existing: [], context: [] };
  const list = async (sql: string, ...binds: unknown[]) => ((((await env.DB.prepare(sql).bind(...binds).all<{ value: string }>()).results) || []).map((r) => String(r.value)));
  if (table === 'advisor_services') {
    out.context = (await list(`SELECT p.title AS value FROM advisor_proof_items p JOIN advisors a ON a.id = p.advisor_id
      WHERE a.user_id = ? AND p.kind = 'outcome' ORDER BY p.id DESC LIMIT 20`, userId)).map((t) => `Recorded outcome: ${t}`);
    out.existing = await list('SELECT s.title AS value FROM advisor_services s JOIN advisors a ON a.id = s.advisor_id WHERE a.user_id = ? ORDER BY s.id DESC LIMIT 40', userId);
  } else if (table === 'ic_decisions' && row) {
    const name = await env.DB.prepare('SELECT name FROM projects WHERE id = ? AND deleted_at IS NULL').bind(row.project_id ?? null).first<{ name: string }>();
    out.context = [`Decision: ${String(row.title ?? 'title not recorded')}`, `Company: ${name?.name ?? 'not recorded'}`];
  } else if (table === 'events' && row) {
    out.context = [`Event: ${String(row.title ?? 'title not recorded')}`, `Kind: ${String(row.type ?? 'not recorded')}`];
  } else if (table === 'events') {
    // #4046 (B2): /events/new. The host's own last event titles, so a new one is not a repeat; nothing else is read.
    out.existing = await list('SELECT title AS value FROM events WHERE host_user_id = ? ORDER BY id DESC LIMIT 20', userId);
  } else if (table === 'testing_applications') {
    // #4046 (B2): the programme as the member reads it (its firm, what the test asks, its questions) and what the
    // member's own profile says (their role and headline). Never another tester's answers, the places or the dates.
    const programmeId = row ? row.programme_id : parentId;
    const p = await env.DB.prepare(`SELECT p.product_name, p.summary, p.tester_tasks, p.time_needed, p.questions,
        CASE WHEN p.owner_kind = 'hq' THEN 'Axal VC' ELSE COALESCE(pt.company, pt.name) END AS owner_name
      FROM testing_programmes p LEFT JOIN partners pt ON pt.id = p.owner_partner_id WHERE p.id = ?`)
      .bind(programmeId ?? null).first<Record<string, unknown>>();
    let questions: string[] = [];
    try { const q = JSON.parse(String(p?.questions ?? '[]')); if (Array.isArray(q)) questions = q.map((x) => String(x)).slice(0, 5); } catch { questions = []; }
    const me = await env.DB.prepare('SELECT role, headline FROM users WHERE id = ?').bind(userId).first<{ role: string | null; headline: string | null }>();
    out.context = [
      `Product: ${String(p?.product_name ?? 'not recorded')}`,
      `Run by: ${String(p?.owner_name ?? 'not recorded')}`,
      `What the test asks: ${String(p?.tester_tasks ?? p?.summary ?? 'not described')}`,
      ...questions.map((q, i) => `answer_${i + 1} replies to the question: ${q}`),
      `The member's role: ${String(me?.role ?? 'not recorded')}`,
      `The member's headline: ${String(me?.headline ?? 'not recorded')}`,
    ];
    out.only = questions.map((_, i) => `answer_${i + 1}`);
    out.guide = 'Write each answer in the member\'s own voice, in the first person, a few lines long. Use only what is on record and the member\'s notes; never claim an experience, a tool or a figure they did not give. Leave out an answer you cannot write from that.';
  } else if (table === 'event_agenda_items') {
    const eventId = row ? row.event_id : parentId;
    out.existing = await list('SELECT title AS value FROM event_agenda_items WHERE event_id = ? ORDER BY display_order, id LIMIT 40', eventId ?? null);
    const ev = await env.DB.prepare('SELECT title FROM events WHERE id = ?').bind(eventId ?? null).first<{ title: string }>();
    out.context = ev ? [`Event: ${ev.title}`] : [];
  } else if (table === 'portfolio_support_entries') {
    const projectId = row ? row.project_id : parentId;
    const company = await env.DB.prepare('SELECT name FROM projects WHERE id = ? AND deleted_at IS NULL').bind(projectId ?? null).first<{ name: string }>();
    out.context = [`Company: ${company?.name ?? 'not recorded'}`];
    out.existing = await list(`SELECT summary AS value FROM portfolio_support_entries
      WHERE project_id = ? AND recorded_by = ? ORDER BY id DESC LIMIT 10`, projectId ?? null, userId);
  } else if (table === 'service_offerings') {
    out.existing = await list('SELECT title AS value FROM service_offerings WHERE owner_user_id = ? ORDER BY id DESC LIMIT 40', userId);
  } else if (table === 'perks') {
    out.existing = await list('SELECT offer AS value FROM perks WHERE partner_user_id = ? ORDER BY id DESC LIMIT 40', userId);
  } else if (table === 'deal_notes') {
    // #4046: the deal's company and stage, and the firm's own last notes on it (what the caller already reads).
    // Never a figure: no amount, valuation, commitment or vote is read here.
    const dealId = row ? row.deal_id : parentId;
    const deal = await env.DB.prepare(`SELECT p.name, d.status FROM deals d JOIN projects p ON p.id = d.project_id
      WHERE d.id = ? AND p.deleted_at IS NULL`).bind(dealId ?? null).first<{ name: string; status: string }>();
    out.context = deal ? [`Company: ${deal.name}`, `Deal stage: ${deal.status ?? 'not recorded'}`] : [];
    // The firm the note is (or will be) filed under, by the route's rule; none resolvable reads no notes.
    const firm = row ? row.company_id ?? null : ctx ? await noteFirm(env.DB, userId, await ctx.activeCompany(), !!ctx.claimed?.()) : undefined;
    if (firm === undefined) return out;
    out.existing = await list(`SELECT substr(body, 1, 300) AS value FROM deal_notes
      WHERE deal_id = ? AND company_id IS ? AND (company_id IS NOT NULL OR author_user_id = ?) ORDER BY id DESC LIMIT 10`, dealId ?? null, firm, userId);
    if (ctx?.purpose === 'deal_summary') await dealSummarySources(env, userId, Number(dealId), firm == null ? null : Number(firm), out, !!deal);
  } else if (table === 'program_proposals') {
    // #4046 (B4): the studio's own other proposal names (`ownRow`'s rule) and the program names its admins can
    // already see (the registry reader's licence filter, narrowed to leave out HQ's 'proposed' drafts), so a name is not a repeat; and
    // the choices already on this proposal (who it is for, group, join method, cycle). Never HQ's note or
    // decision, seats, weeks, rewards, templates, what HQ receives, tools, a sender or another studio's proposal.
    const studio = await studioOf(env, userId);
    out.existing = [
      ...await list(`SELECT name AS value FROM program_proposals WHERE ((? IS NOT NULL AND licence_uid = ?) OR (licence_uid IS NULL AND created_by_user_id = ?))
        AND id IS NOT ? AND name IS NOT NULL AND trim(name) <> '' ORDER BY id DESC LIMIT 20`, studio, studio, studio ? -1 : userId, row ? row.id ?? null : null),
      ...await list("SELECT name AS value FROM programs WHERE (licence_uid IS NULL OR licence_uid = ?) AND status <> 'proposed' ORDER BY id DESC LIMIT 40", studio),
    ];
    if (row) {
      let who: string[] = [];
      try { const w = JSON.parse(String(row.who_json ?? '[]')); if (Array.isArray(w)) who = w.map((x) => String(x)); } catch { who = []; }
      out.context = [
        ...(row.name ? [`This proposal's name: ${String(row.name)}`] : []),
        ...(who.length ? [`Who it is for: ${who.join(', ')}`] : []),
        ...(row.grp ? [`Group: ${String(row.grp)}`] : []),
        ...(row.join_method ? [`Join method: ${String(row.join_method)}`] : []),
        ...(row.cycle ? [`Cycle: ${String(row.cycle)}`] : []),
      ];
    }
  } else if (table === 'partner_invitations') {
    // #4046 (B4): the inviting admin's own last few messages, so a new one is not a repeat. Never the invitee's email
    // or name, the lookup, what to offer, the terms or another admin's invitation.
    out.existing = await list(`SELECT substr(personal_message, 1, 300) AS value FROM partner_invitations
      WHERE invited_by_user_id = ? AND personal_message IS NOT NULL AND trim(personal_message) <> '' ORDER BY id DESC LIMIT 5`, userId);
  } else if (table === 'article_review_comments') {
    // #4046 (B4): the article's own text, as the reviewer reads it (title, subtitle, sector and the first 4000
    // characters), and its last first comments, so a note is not a repeat. Never the author's name or email, a
    // reviewer, a revision's reason, the stage, views or any reason given in a stage change.
    const articleId = row ? row.article_id : parentId;
    const a = await env.DB.prepare('SELECT title, subtitle, sector, substr(body_markdown, 1, 4000) AS body FROM articles WHERE id = ?')
      .bind(articleId ?? null).first<{ title: string | null; subtitle: string | null; sector: string | null; body: string | null }>();
    out.context = a ? [
      `Title: ${String(a.title ?? 'not recorded')}`,
      ...(a.subtitle ? [`Subtitle: ${String(a.subtitle)}`] : []),
      ...(a.sector ? [`Sector: ${String(a.sector)}`] : []),
      `Article text (first 4000 characters): ${String(a.body ?? '')}`,
    ] : [];
    out.existing = await list(`SELECT substr(body, 1, 300) AS value FROM article_review_comments
      WHERE article_id = ? AND parent_id IS NULL ORDER BY id DESC LIMIT 10`, articleId ?? null);
    out.guide = 'Write a reviewer\'s note to the article\'s author about its text: what to clarify, cut or check. Never say whether it will be approved, rejected or published, never give a stage or a deadline, and never name the author.';
  } else if (table === 'segment_profiles') {
    // #4046 (B4): the segment names already on file, so a new one is not a repeat. Names alone: never a key (the
    // segment's permanent identity), a profile, a status, a member count, a member, a suggestion or a history actor.
    out.existing = await list('SELECT name AS value FROM segment_profiles ORDER BY rowid DESC LIMIT 40');
  } else if (table === 'admin_publications' && row) {
    out.context = [`Publication: ${String(row.title ?? 'title not recorded')}`, `Section: ${String(row.section ?? 'not recorded')}`];
  }
  return out;
}

const SYSTEM = [
  'You fill blank fields of one form for a founder, as JSON only.',
  'Answer with {"fields":[{"field":"<name>","value":<value>}]} for one record, or {"rows":[{"<name>":<value>,…}]} when rows are asked for.',
  'Only use the fields listed. For a field with choices, answer one choice\'s id as a number, or leave the field out.',
  'Never invent a figure. If you cannot fill a field from what is given, leave it out.',
].join(' ');

/** The run's messages, and the member's own words for the guard (`guardText`). */
export function formMessages(asked: readonly FillField[], gather: FormGather, opts: { text?: string; rows?: number } = {}) {
  const lines = asked.map((f) => {
    const choice = gather.choices.get(f.field);
    const effort = f.field === 'effort' ? ' (one of Low, Medium, High)' : '';
    return choice
      ? `- ${f.field} ("${f.label}"): choose by id from ${JSON.stringify(choice.map((c) => ({ id: c.id, label: c.label })))}`
      : `- ${f.field} ("${f.label}")${effort}`;
  });
  const words = String(opts.text ?? '').trim().slice(0, 4000);
  const user = [
    opts.rows ? `Propose up to ${opts.rows} new rows.` : 'Fill these fields for one record.',
    'Fields:', ...lines,
    gather.existing.length ? `Already on file, do not repeat: ${JSON.stringify(gather.existing)}` : '',
    gather.context?.length ? `On record: ${JSON.stringify(gather.context)}` : '',
    gather.guide ?? '',
    gather.hint ?? '',
    words ? `The founder's notes: ${words}` : '',
  ].filter(Boolean).join('\n');
  return {
    messages: [{ role: 'system' as const, content: SYSTEM }, { role: 'user' as const, content: user }],
    guardText: words,
  };
}

/** The model's JSON, with or without a code fence; null when it is not an object. */
export function readJson(output: string | undefined): Record<string, unknown> | null {
  const raw = String(output ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { const v = JSON.parse(raw.slice(start, end + 1)); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

function citationOf(v: unknown): Citation | null {
  const c = v as Record<string, unknown> | null;
  if (!c || typeof c !== 'object' || typeof c.quote !== 'string' || !c.quote.trim()) return null;
  if (c.kind === 'library' && Number.isSafeInteger(c.document_id) && typeof c.title === 'string') {
    return { kind: 'library', document_id: Number(c.document_id), title: c.title, chunk: Number(c.chunk) || 0, quote: c.quote };
  }
  if (c.kind === 'research' && typeof c.source === 'string' && typeof c.query === 'string') {
    return { kind: 'research', task: String(c.task ?? ''), query: c.query, source: c.source, quote: c.quote };
  }
  return null;
}

/** One proposed value against its field's rules: the value kept, or why it is dropped. */
export function checkValue(f: FillField | undefined, name: string, value: unknown, citation: unknown, asked: ReadonlySet<string>, gather: FormGather): KeptValue | Dropped {
  // A never-fill name is refused as such even when the form does not have it, so the refusal is said, not hidden.
  if (neverFillReason(name) || (f && neverFillReason(`${f.table}.${f.column}`))) return { field: name, why: 'never_fill' };
  if (!f) return { field: name, why: 'unknown_field' };
  if (f.class === 'measured') return { field: name, why: 'measured' };
  if (!asked.has(f.field)) return { field: name, why: 'not_asked' };
  if (value == null || String(value).trim() === '') return { field: name, why: 'empty' };
  if (f.class === 'restatement') {
    const id = Number(value);
    const known = gather.choices.get(f.field) ?? [];
    return Number.isSafeInteger(id) && known.some((c) => c.id === id) ? { field: f.field, value: id, citation: null } : { field: name, why: 'unmatched' };
  }
  if (f.class === 'sourced') {
    const cite = citationOf(citation);
    if (!cite) return { field: name, why: 'no_citation' };
    return { field: f.field, value: String(value).trim().slice(0, gather.maxValue ?? MAX_VALUE), citation: cite };
  }
  if (f.field === 'effort') {
    const word = EFFORT_WORDS[String(value).trim().toLowerCase()];
    return word ? { field: f.field, value: word, citation: null } : { field: name, why: 'invalid' };
  }
  if (typeof value !== 'string' && typeof value !== 'number') return { field: name, why: 'invalid' };
  return { field: f.field, value: String(value).trim().slice(0, gather.maxValue ?? MAX_VALUE), citation: null };
}

const isKept = (x: KeptValue | Dropped): x is KeptValue => 'value' in x;

/** `{"fields":[…]}` for one record: one kept value per field at most. */
export function parseFields(output: string | undefined, fields: readonly FillField[], asked: readonly FillField[], gather: FormGather): ParsedFields {
  const json = readJson(output);
  const list = Array.isArray(json?.fields) ? json!.fields as unknown[] : [];
  const byName = new Map(fields.map((f) => [f.field, f]));
  const askedSet = new Set(asked.map((f) => f.field));
  const kept: KeptValue[] = [];
  const dropped: Dropped[] = [];
  for (const item of list) {
    const o = (item ?? {}) as Record<string, unknown>;
    const name = typeof o.field === 'string' ? o.field : '';
    const r = checkValue(byName.get(name), name, o.value, o.citation, askedSet, gather);
    if (isKept(r)) { if (!kept.some((k) => k.field === r.field)) kept.push(r); } else dropped.push(r);
  }
  return { kept, dropped };
}

/** `{"rows":[…]}` for an Add form: each row's fields checked alone; a row needs a value for every field the form requires. */
export function parseRows(output: string | undefined, fields: readonly FillField[], asked: readonly FillField[], gather: FormGather, max: number, required: readonly string[] = []) {
  const json = readJson(output);
  const list = (Array.isArray(json?.rows) ? json!.rows as unknown[] : []).slice(0, Math.max(0, Math.min(max, MAX_RUN_ROWS)));
  const byName = new Map(fields.map((f) => [f.field, f]));
  const askedSet = new Set(asked.map((f) => f.field));
  const rows: Array<Record<string, string | number>> = [];
  const dropped: Dropped[] = [];
  list.forEach((item, i) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const row: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(o)) {
      const r = checkValue(byName.get(name), name, value, null, askedSet, gather);
      if (isKept(r)) row[r.field] = r.value; else dropped.push({ ...r, row: i });
    }
    if (required.every((k) => row[k] != null) && Object.keys(row).length) rows.push(row);
    else dropped.push({ field: required.find((k) => row[k] == null) ?? '', why: 'empty', row: i });
  });
  return { rows, dropped };
}

/**
 * #6194 — what a deal summary reads beyond the note's own context, each only as this investor may
 * read it, and each said as a source: used, none on record, not shared, or unreadable. `readEvidence` is
 * `investorEvidence`; a test passes its own.
 *
 *   terms      the deal's terms a Free reader is shown (`GET /api/deals/:id`): instrument, target
 *              raise, currency and closing date. Never another investor's commitment, the round's
 *              total, a vote or an IC decision.
 *   evidence   the founder's shared Raise evidence, through `investorEvidence` (D1265), which
 *              applies the audience, the NDA, each item's sharing, the file gate and quote consent
 *              and logs the open. Before the NDA it is coverage only; nothing behind it is read.
 *   diligence  the caller's own diligence case on the company (owner or reviewer, as the deal's
 *              stage reads it): its status, risk band, checklist counts and open findings' titles
 *              and severities. Never a note, a detail or an excerpt (they are encrypted and private).
 *   notes      the firm's own notes, already read above (`out.existing`): another firm's never are.
 */
export async function dealSummarySources(env: Env, userId: number, dealId: number, firm: number | null, out: FormGather, dealRead: boolean,
  readEvidence: typeof investorEvidence = investorEvidence): Promise<void> {
  const sources: DraftSource[] = [];
  const ctx = out.context ?? (out.context = []);
  sources.push(dealRead
    ? { key: 'deal', label: 'The deal', state: 'used', note: 'Its company and stage.' }
    : { key: 'deal', label: 'The deal', state: 'unreadable', note: 'The deal could not be read.' });
  let projectId: number | null = null;
  try {
    const d = await env.DB.prepare(`SELECT d.project_id, d.instrument, COALESCE(d.target_raise, d.amount) AS target, COALESCE(d.currency, 'USD') AS currency,
        d.closing_deadline, p.sector FROM deals d JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL WHERE d.id = ?`)
      .bind(dealId).first<{ project_id: number; instrument: string | null; target: number | null; currency: string; closing_deadline: string | null; sector: string | null }>();
    projectId = d ? Number(d.project_id) : null;
    const terms = d ? [
      d.instrument ? `Instrument: ${d.instrument}` : null,
      d.target != null ? `Target raise: ${Number(d.target)} ${d.currency}` : null,
      d.closing_deadline ? `Closing date: ${d.closing_deadline}` : null,
      d.sector ? `Sector: ${d.sector}` : null,
    ].filter((x): x is string => !!x) : [];
    if (terms.length) { ctx.push(...terms); sources.push({ key: 'terms', label: 'The deal\'s terms', state: 'used', note: 'Instrument, target raise and closing date, as the deal states them.' }); }
    else sources.push({ key: 'terms', label: 'The deal\'s terms', state: 'none', note: 'No terms are recorded on this deal.' });
  } catch { sources.push({ key: 'terms', label: 'The deal\'s terms', state: 'unreadable', note: 'The deal\'s terms could not be read.' }); }

  if (projectId == null) {
    sources.push({ key: 'evidence', label: 'Shared evidence', state: 'unreadable', note: 'The company could not be read, so its evidence was not.' });
  } else {
    try {
      const view: any = await readEvidence(env, projectId, userId);
      const groups = view?.coverage?.state === 'recorded' ? view.coverage.groups || [] : null;
      if (!view.nda_signed) {
        if (groups?.length) ctx.push(...groups.slice(0, 10).map((g: any) => `Evidence on file (coverage only): ${g.area} · ${g.kind} · ${g.count} item${g.count === 1 ? '' : 's'}`));
        sources.push({ key: 'evidence', label: 'Shared evidence', state: 'not_shared',
          note: groups?.length ? 'Coverage only: the NDA is not signed, so no figure, file or quote behind it was used.' : 'The NDA is not signed, and nothing is shared before it.' });
      } else if (view.items?.state !== 'recorded') {
        sources.push({ key: 'evidence', label: 'Shared evidence', state: 'unreadable', note: 'The shared evidence could not be read.' });
      } else if (!view.items.rows.length) {
        sources.push({ key: 'evidence', label: 'Shared evidence', state: 'none', note: 'The founder has shared no evidence with you.' });
      } else {
        ctx.push(...view.items.rows.slice(0, 15).map((r: any) => `Evidence: ${r.area} · ${r.kind} · ${String(r.summary ?? '').slice(0, 200)}${r.value_num != null ? ` · ${r.value_num}${r.value_unit ? ` ${r.value_unit}` : ''}${r.currency ? ` ${r.currency}` : ''}` : ''}${r.observed_on ? ` (observed ${r.observed_on})` : ''}`));
        sources.push({ key: 'evidence', label: 'Shared evidence', state: 'used', note: `${view.items.rows.length} item${view.items.rows.length === 1 ? '' : 's'} the founder shared with you.` });
      }
    } catch (e: any) {
      sources.push(e?.code === 'not_found'
        ? { key: 'evidence', label: 'Shared evidence', state: 'not_shared', note: 'The founder has not shared evidence with you.' }
        : { key: 'evidence', label: 'Shared evidence', state: 'unreadable', note: 'The shared evidence could not be read.' });
    }
    try {
      const dd = await env.DB.prepare(`SELECT d.id, d.status, d.risk_band FROM dd_cases d WHERE d.subject_type = 'project' AND d.subject_id = ?
          AND d.status != 'archived' AND (d.owner_user_id = ? OR EXISTS (SELECT 1 FROM dd_reviewers v WHERE v.case_id = d.id AND v.user_id = ?))
          ORDER BY julianday(d.updated_at) DESC, d.id DESC LIMIT 1`).bind(projectId, userId, userId).first<{ id: number; status: string; risk_band: string | null }>();
      if (!dd) sources.push({ key: 'diligence', label: 'Your diligence case', state: 'none', note: 'You have no diligence case on this company.' });
      else {
        const items = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM dd_checklist_items WHERE case_id = ? GROUP BY status').bind(dd.id).all<{ status: string; n: number }>();
        const findings = await env.DB.prepare(`SELECT title, severity FROM dd_findings WHERE case_id = ? AND resolved_at IS NULL
            ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, id LIMIT 10`).bind(dd.id).all<{ title: string; severity: string }>();
        ctx.push(`Diligence case: ${dd.status}${dd.risk_band ? `, risk band ${dd.risk_band}` : ''}`);
        const counts = (items.results || []).map((r) => `${r.n} ${r.status}`).join(', ');
        if (counts) ctx.push(`Diligence checklist: ${counts}`);
        ctx.push(...(findings.results || []).map((f) => `Open diligence finding (${f.severity}): ${String(f.title).slice(0, 160)}`));
        sources.push({ key: 'diligence', label: 'Your diligence case', state: 'used', note: 'Its status, checklist and open findings\' titles.' });
      }
    } catch { sources.push({ key: 'diligence', label: 'Your diligence case', state: 'unreadable', note: 'Your diligence case could not be read.' }); }
  }
  sources.push(out.existing.length
    ? { key: 'notes', label: firm == null ? 'Your notes' : 'Your firm\'s notes', state: 'used', note: `The last ${out.existing.length} on this deal.` }
    : { key: 'notes', label: firm == null ? 'Your notes' : 'Your firm\'s notes', state: 'none', note: 'None on this deal yet.' });
  out.sources = sources;
  out.maxValue = DEAL_SUMMARY_MAX;
  out.guide = 'Write a short deal summary for the investor\'s own note, from what is on record only: what the company does, the terms on record, '
    + 'what the shared evidence shows and where their diligence case stands. Say plainly what is not recorded. Never invent a figure, never name '
    + 'another investor, and never tell the reader what to decide. A few short paragraphs, under 1500 characters. Put it in the body field.';
}
