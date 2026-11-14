/**
 * D4330 (#4330, D1357 part 8b) — Eadwyn's three drafts for an introduction.
 *
 *   ask_reason  RI3 "Draft from this record": the reason for an ask, written for the asker from the
 *               relationship they can see and, when named, the record they are on.
 *   intro       RI4 "Draft with Eadwyn": the intro email, for the teammate who accepted, to open in
 *               the Email composer and send from their own mailbox.
 *   follow_up   RI6 "Draft a follow-up": a follow-up after the intro, for either person on it.
 *
 * Each is a QUOTED PROPOSAL. `estimate: true` answers what the run would hold and runs nothing; the run
 * is the router's `mail_draft` task (D1341), held, guarded and charged in AI tokens like every other
 * Eadwyn run, and logged against `/network/introductions`. Nothing is stored and nothing is sent: the
 * member copies the words into the request or the composer.
 *
 * WHAT A PROMPT MAY CARRY is what its caller may already see under D1356's rule, read through the same
 * statements the routes use (`visibleRelationship`, `requestOf`): a teammate's shared row (name, company,
 * title, how and since when) or the request the caller is on, and the record the asker names through its
 * own module's read (`personRecord`). Never an email, phone, profile URL or note from a member's book:
 * the shared projection has no such column, and every line is scrubbed of anything that looks like one
 * before it reaches the model.
 */
import type { Env, User } from '../types';
import { quoteRun, run, type RailContext, type RunOptions } from './aiRouter';
import { AI_SURFACE } from './aiSurfaces';
import { parseDraft } from './mail/drafts';
import { MailError, personRecord } from './mail/contextPack';
import { NOT_FOUND, OUTCOME_LABEL, RelationshipRefusal, requestOf, visibleRelationship, type Interaction } from './relationships';

export const DRAFT_KINDS = ['ask_reason', 'intro', 'follow_up'] as const;
export type DraftKind = typeof DRAFT_KINDS[number];
const MAX_TOKENS: Record<DraftKind, number> = { ask_reason: 300, intro: 600, follow_up: 450 };

/** Anything that looks like a contact detail never reaches the model, whatever line it came from. */
export function scrub(text: string): string {
  return String(text ?? '')
    .replace(/[^\s@<>()[\],;:]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi, '[email withheld]')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[link withheld]')
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|ai|vc|app|invalid)\/\S*/gi, '[link withheld]')
    // A phone number: seven digits or more, run together with spaces, dots, dashes or brackets. A date is not one.
    .replace(/\+?\d[\d ().-]{7,}\d/g, (m) => (/^\d{4}-\d{2}-\d{2}$/.test(m) || m.replace(/\D/g, '').length < 7 ? m : '[number withheld]'));
}

const SYSTEM: Record<DraftKind, string> = {
  ask_reason: [
    'You draft the reason a member gives a teammate when asking them for an introduction.',
    'Two to four sentences, first person, plain text, no greeting and no sign-off.',
    'Use only the facts given. Never invent a figure, a name, a date, a promise or a quote. If a fact is missing, leave it out.',
    'Reply with JSON only: {"text": "..."}.',
  ].join(' '),
  intro: [
    'You draft one introduction email that a member sends from their own mailbox to a person they know, introducing a teammate.',
    'Use only the facts given. Never invent a figure, a name, a date, a promise or a quote. If a fact is missing, leave it out.',
    'Reply with JSON only: {"subject": "...", "body": "..."}. The body is plain text with line breaks, signed off without a name.',
  ].join(' '),
  follow_up: [
    'You draft one short follow-up email after an introduction, for the member to review and send themselves.',
    'Use only the facts given. Never invent a figure, a name, a date, a promise or a quote. Do not claim a reply that is not recorded.',
    'Reply with JSON only: {"subject": "...", "body": "..."}. The body is plain text with line breaks, signed off without a name.',
  ].join(' '),
};

export type DraftInput = { kind: DraftKind; lines: string[] };

const line = (k: string, v: unknown) => (v == null || v === '' ? null : `${k}: ${scrub(String(v)).slice(0, 1200)}`);
const join = (xs: Array<string | null>) => xs.filter((x): x is string => !!x);
const named = (s: string | null | undefined, fallback: string) => (s && s.trim() ? s.trim() : fallback);

async function nameOf(env: Env, id: number): Promise<string | null> {
  const r = await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(id).first<{ name: string | null }>();
  return r?.name ?? null;
}

/** RI3: the relationship the asker sees, and the record they are on, read through its module's own gate. */
export async function askReasonInput(env: Env, user: User, b: { teammate?: unknown; ref?: unknown; record?: unknown }): Promise<DraftInput> {
  const known = await visibleRelationship(env, user, b.teammate, b.ref);
  if (!known) throw new RelationshipRefusal(404, 'not_found', NOT_FOUND);
  let record: string[] = [];
  if (b.record != null && b.record !== '') {
    try {
      const { person, item } = await personRecord(env, user, b.record);
      record = ['', 'THE RECORD YOU ARE ON', line('Record', item.label), line('Name', person.name), scrub(item.text).slice(0, 1500)].filter((x): x is string => x != null);
    } catch (e) {
      if (e instanceof MailError) throw new RelationshipRefusal(404, 'not_found', NOT_FOUND);
      throw e;
    }
  }
  return {
    kind: 'ask_reason',
    lines: [
      ...join([line('You are asking', named(known.teammate.name, 'your teammate')), line('Team', known.team.label)]),
      '', 'THE PERSON THEY KNOW',
      ...join([line('Name', known.person.name), line('Company', known.person.company), line('Title', known.person.title),
        line('How they know them', known.how.source_label), line('Connected since', known.how.connected_since)]),
      ...record,
    ],
  };
}

const requestLines = (r: Interaction, asker: string | null, teammate: string | null) => join([
  line('Asked by', named(asker, 'a teammate')), line('Asked of', named(teammate, 'a teammate')),
  line('Person', r.person_name), line('Company', r.person_company), line('Reason for the ask', r.note),
]);

/** RI4: for the teammate on an accepted request only. The context note is theirs to forward, so it may be quoted. */
export async function introInput(env: Env, user: User, requestUid: string): Promise<DraftInput> {
  const r = await requestOf(env, user, requestUid, 'teammate');
  if (r.status !== 'accepted') throw new RelationshipRefusal(409, 'intro_not_accepted', 'Accept the request before writing the intro.');
  return {
    kind: 'intro',
    lines: [...requestLines(r, await nameOf(env, r.requester_user_id), user.name ?? null), ...join([line('Context to share with the person', r.context_note)]),
      '', 'You are the sender. Introduce the person who asked to the person, say briefly why, and leave the next step to them.'],
  };
}

/** RI6: either person on a made introduction. What came of it so far is what was recorded, never assumed. */
export async function followUpInput(env: Env, user: User, requestUid: string): Promise<DraftInput> {
  const r = await requestOf(env, user, requestUid, 'either');
  if (r.status !== 'made') throw new RelationshipRefusal(409, 'intro_not_made', 'A follow-up is drafted once the introduction has been made.');
  const latest = await env.DB.prepare(
    "SELECT outcome FROM relationship_interactions WHERE parent_uid = ? AND kind = 'outcome' ORDER BY id DESC LIMIT 1",
  ).bind(r.uid).first<{ outcome: string }>();
  const asker = r.requester_user_id === user.id;
  return {
    kind: 'follow_up',
    lines: [
      ...requestLines(r, await nameOf(env, r.requester_user_id), await nameOf(env, r.teammate_user_id)),
      ...join([line('Introduced on', r.made_at?.slice(0, 10)), line('Outcome so far', latest ? OUTCOME_LABEL[latest.outcome] ?? latest.outcome : 'Not recorded')]),
      '', asker
        ? 'You are the person who asked. Write to the person you were introduced to, thank them for their time and suggest one next step.'
        : 'You made the introduction. Write to the person you introduced, checking in lightly on whether the two connected.',
    ],
  };
}

export function draftOptions(user: User, input: DraftInput, rail: RailContext): RunOptions {
  return {
    task: 'mail_draft', userId: Number(user.id), maxTokens: MAX_TOKENS[input.kind], rail, surface: AI_SURFACE.networkIntroductions,
    messages: [{ role: 'system' as const, content: SYSTEM[input.kind] }, { role: 'user' as const, content: input.lines.join('\n') }],
  };
}

/** `{ text }` for the reason, `{ subject, body }` for an email; null when the model gave neither. */
export function parseProposal(kind: DraftKind, output: unknown): { text: string } | { subject: string; body: string } | null {
  if (kind !== 'ask_reason') return parseDraft(output);
  const raw = String(output ?? '');
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const t = JSON.parse(raw.slice(start, end + 1))?.text;
    const text = typeof t === 'string' ? t.trim().slice(0, 1000) : '';
    return text ? { text } : null;
  } catch { return null; }
}

export type DraftResult =
  | { ok: true; estimate: { hold_microusd: number; model: string } }
  | { ok: true; draft: { kind: DraftKind; proposal: true; model: string | null } & ({ text: string } | { subject: string; body: string }) }
  | { ok: false; refusal: string; error?: string }
  | { ok: false; refusal: null; code: 'draft_unreadable'; message: string };

/** The quote, or the run. Nothing is stored and nothing is sent. */
export async function pressDraft(env: Env, user: User, input: DraftInput, rail: RailContext, estimate: boolean): Promise<DraftResult> {
  const opts = draftOptions(user, input, rail);
  if (estimate) {
    const q = await quoteRun(env, { ...opts, surface: AI_SURFACE.networkIntroductions, rail });
    return q.ok ? { ok: true, estimate: { hold_microusd: q.hold_microusd, model: q.model } } : { ok: false, refusal: q.refusal, error: q.error };
  }
  // The page and the rail are named at the call, where D552's and D765's scans read them.
  const out = await run(env, { ...opts, surface: AI_SURFACE.networkIntroductions, rail });
  if (out.refusal) return { ok: false, refusal: out.refusal, error: out.error };
  if (!out.ok) return { ok: false, refusal: null, code: 'draft_unreadable', message: 'Eadwyn could not draft this. Try again.' };
  const parsed = parseProposal(input.kind, out.output);
  if (!parsed) return { ok: false, refusal: null, code: 'draft_unreadable', message: 'Eadwyn’s answer was not a draft. Try again; the run may still be charged.' };
  return { ok: true, draft: { kind: input.kind, proposal: true, model: out.usage?.model ?? null, ...parsed } };
}
