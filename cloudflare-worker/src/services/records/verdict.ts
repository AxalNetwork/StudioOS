/**
 * D693 (#1703) — Verdict's record: one decision, the evidence it rests on and
 * the commitments it created, drawn as CO:368.
 *
 * Reads with `canReadDecision`, so partners never see a decision (D693
 * decision 7), and writes with `canWrite`. Every read and write of the three
 * decision tables goes through `services/verdict.ts` (decision 6); this file
 * names them only as its store keys.
 *
 * Not yet in `RECORD_SPECS`: registering one Validate spec turns on records
 * for the whole cycle, so the dispatch line lands with #1692's Validate
 * service (#1703's closing PR).
 */
import { canReadDecision, canWrite, ownsVenture } from '../../routes/_founder_validate_helpers';
import type { User } from '../../types';
import {
  addCommitment, completeCommitment, decisionById, earlierGivenInScope, evidenceFor, openCommitments,
  DECISION_EVIDENCE_BAR, NO_EVIDENCE_REASON, VerdictError, type DecisionKind, type EvidenceSource,
} from '../verdict';
import type { ModuleSpec, RecordAction, RecordContent, RecordContext } from './types';

const WORD: Record<DecisionKind, string> = { proceed: 'Proceed', pivot: 'Pivot', stop: 'Stop' };
const TONE: Record<DecisionKind, string> = { proceed: 'ok', pivot: 'warn', stop: 'bad' };
const STRENGTH: Record<string, string> = { anecdote: 'Anecdote', pattern: 'Pattern', measured: 'Measured' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Oct", in UTC, as the canvas writes a date; null when there is none to read. */
export function dMon(raw: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? ''));
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month}` : null;
}

const strengthWord = (s: string | null) => (s && STRENGTH[s]) || 'Strength not recorded';
const joined = (...parts: Array<string | null>) => parts.filter(Boolean).join(' · ');
const items = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** A refusal from the writer, as the status and sentence the route answers with. */
async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (err) {
    if (err instanceof VerdictError) {
      throw new Response(JSON.stringify({ detail: err.sentence }), { status: err.status, headers: { 'Content-Type': 'application/json' } });
    }
    throw err;
  }
}

type Loaded = NonNullable<Awaited<ReturnType<typeof decisionById>>>;
type Claim = { id: number; code: string | null; claim: string | null };

const loaded = new WeakMap<RecordContext, Map<string, Promise<{ d: Loaded; claim: Claim | null }>>>();

/** One decision read per request: the record, its sections and its actions share it. */
function load(ctx: RecordContext, id: string): Promise<{ d: Loaded; claim: Claim | null }> {
  let byId = loaded.get(ctx);
  if (!byId) { byId = new Map(); loaded.set(ctx, byId); }
  let hit = byId.get(id);
  if (!hit) {
    hit = (async () => {
      const d = await decisionById(ctx.env, ctx.projectId, Number(id));
      // `ownedRow` passed before the spec runs, so a missing row is a race with a delete.
      if (!d) throw new Response(JSON.stringify({ detail: 'Record not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      const claim = d.hypothesis_id == null ? null : await ctx.env.DB.prepare(
        'SELECT id, code, claim FROM hypotheses WHERE id = ? AND project_id = ?',
      ).bind(d.hypothesis_id, ctx.projectId).first<Claim>();
      return { d, claim };
    })();
    byId.set(id, hit);
  }
  return hit;
}

/** Decision 5: a given decision with no evidence rows came from the old route. */
const isLegacy = (d: Loaded) => d.state === 'given' && Number(d.evidence_count) === 0;
const scopeName = (claim: Claim | null) => (claim ? claim.code ?? `H${claim.id}` : 'the venture');

async function supersedesFact(ctx: RecordContext, d: Loaded, claim: Claim | null) {
  if (d.supersedes_id != null) {
    const prev = await decisionById(ctx.env, ctx.projectId, d.supersedes_id);
    if (prev) return { label: 'Supersedes', value: joined(WORD[prev.decision], dMon(prev.decided_at)) };
  }
  if (d.state === 'withheld') return { label: 'Supersedes', value: 'Nothing, withheld' };
  if (!await earlierGivenInScope(ctx.env, ctx.projectId, d)) {
    return { label: 'Supersedes', value: `Nothing, the first for ${scopeName(claim)}` };
  }
  return { label: 'Supersedes', value: null, reason: 'Recorded before decisions named what they replaced.' };
}

/** The venture's owners, the only people a commitment may name (decision 8). */
async function ventureOwners(ctx: RecordContext): Promise<Array<{ value: string; label: string }>> {
  if (ctx.project.founder_id == null) return [];
  const res = await ctx.env.DB.prepare(
    `SELECT id, name, role, founder_id, spinout_lab_active FROM users
      WHERE founder_id = ? AND is_active = 1 ORDER BY name, id`,
  ).bind(ctx.project.founder_id).all<User & { name: string | null }>();
  return (res.results || []).filter((u) => ownsVenture(ctx.project, u))
    .map((u) => ({ value: String(u.id), label: u.name || `User ${u.id}` }));
}

export function verdictSpec({ evidenceSource = evidenceFor }: { evidenceSource?: EvidenceSource } = {}): ModuleSpec {
  return {
    read: canReadDecision,
    write: canWrite,
    store: 'validation_decisions',
    activityType: 'validate.verdict',

    async record(ctx, id): Promise<RecordContent> {
      const { d, claim } = await load(ctx, id);
      const word = WORD[d.decision];
      const legacy = isLegacy(d);
      const n = Number(d.evidence_count);
      const recorded = `Recorded ${dMon(d.decided_at) ?? 'on an unrecorded date'}${d.decided_by_name ? ` by ${d.decided_by_name}` : ''}`;
      const status = d.state === 'withheld' ? { text: 'Withheld', tone: 'grey' }
        : d.superseded_at ? { text: 'Superseded', tone: 'grey' } : { text: 'Current', tone: 'v1' };
      return {
        title: `${word} · ${claim ? claim.claim ?? scopeName(claim) : 'the venture'}`,
        sub: legacy ? recorded : `${recorded} · rests on ${items(n, 'piece of evidence', 'pieces of evidence')}`,
        pills: [{ text: word, tone: TONE[d.decision] }, status],
        facts: [
          { label: 'Decision', value: word },
          { label: 'For', value: claim ? joined(claim.code, claim.claim) : 'The venture' },
          legacy ? { label: 'Evidence', value: null, reason: NO_EVIDENCE_REASON } : { label: 'Evidence', value: items(n, 'item', 'items') },
          await supersedesFact(ctx, d, claim),
        ],
        createdBy: d.decided_by,
        createdAt: d.decided_at,
      };
    },

    sections: [
      {
        key: 'reasoning', title: 'Reasoning',
        read: async (ctx, id) => {
          const { d } = await load(ctx, id);
          const text = String(d.reasoning ?? '').trim();
          return { rows: text ? [{ a: text }] : [], empty: 'No reasoning recorded.' };
        },
      },
      {
        key: 'evidence', title: 'Evidence it rests on',
        read: async (ctx, id) => {
          const { d } = await load(ctx, id);
          return {
            rows: d.evidence.map((e) => ({
              a: e.label,
              b: joined(strengthWord(e.strength), dMon(e.on_date)),
              c: e.direction === 'contradicts' ? 'Contradicts' : 'Supports',
              tone: e.direction === 'contradicts' ? 'bad' : 'ok',
            })),
            empty: isLegacy(d) ? NO_EVIDENCE_REASON : 'No evidence checked.',
          };
        },
      },
      {
        key: 'commitments', title: 'Commitments it created', side: true,
        read: async (ctx, id) => {
          const { d } = await load(ctx, id);
          return {
            rows: d.commitments.map((m) => ({
              a: m.text,
              b: m.done_at ? `Done ${dMon(m.done_at)}` : joined(m.owner_name ?? 'No owner', dMon(m.due_date)),
            })),
            empty: 'No commitments yet.',
            action: 'add-commitment',
          };
        },
      },
      {
        key: 'memo', title: 'Memo', side: true,
        read: async () => ({ rows: [{ a: 'Decision memo', b: 'Export PDF', action: 'export-memo' }] }),
      },
    ],

    async actions(ctx, id): Promise<RecordAction[]> {
      const { d } = await load(ctx, id);
      const forValue = d.hypothesis_id == null ? 'venture' : `h-${d.hypothesis_id}`;
      const owners = await ventureOwners(ctx);
      const mine = owners.find((o) => o.value === String(ctx.user.id));
      const actions: RecordAction[] = [
        // First, so the record's `next` is Record a new decision (CO:265-269).
        {
          key: 'record-new-decision', label: 'Record a new decision', kind: 'link', tone: 'primary',
          href: `/validate/verdict/new?project=${ctx.projectId}&for=${forValue}`,
        },
        // #1658's client action: the memo is drawn in the browser (decision 11).
        { key: 'export-memo', label: 'Export memo', kind: 'write' },
        {
          key: 'add-commitment', label: 'Add a commitment', kind: 'form',
          form: {
            title: 'Add a commitment', cta: 'Add',
            fields: [
              { key: 'text', label: 'Commitment', kind: 'T', required: true },
              { key: 'owner_user_id', label: 'Owner', kind: 'CH', options: owners, value: mine?.value },
              { key: 'due_date', label: 'Due', kind: 'T', input: 'date' },
            ],
          },
          execute: (c, recordId, body) => refusing(async () => {
            const b = body as Record<string, unknown>;
            await addCommitment(c.env, c.user, c.project, Number(recordId), {
              text: b.text, owner_user_id: b.owner_user_id, due_date: b.due_date,
            });
            return { ok: true };
          }),
        },
      ];
      const open = await openCommitments(ctx.env, ctx.projectId, d.id);
      if (open.length) {
        actions.push({
          key: 'commitment-done', label: 'Mark a commitment done', kind: 'form',
          form: {
            title: 'Mark a commitment done', cta: 'Mark done',
            fields: [{ key: 'commitment_id', label: 'Commitment', kind: 'CH', required: true,
              options: open.map((m) => ({ value: String(m.id), label: m.text })) }],
          },
          references: (body) => {
            const raw = (body as Record<string, unknown>).commitment_id;
            return [{ store: 'validation_decision_commitments', id: typeof raw === 'number' || typeof raw === 'string' ? raw : '' }];
          },
          execute: (c, recordId, body) => refusing(async () => {
            await completeCommitment(c.env, c.user, c.project, Number(recordId), (body as Record<string, unknown>).commitment_id);
            return { ok: true };
          }),
        });
      }
      return actions;
    },

    /** Record a decision's choices. It sends no query, so `query` is unused. */
    async formOptions(ctx) {
      const [claims, evidence] = await Promise.all([
        ctx.env.DB.prepare(
          'SELECT id, code, claim FROM hypotheses WHERE project_id = ? AND retired_at IS NULL ORDER BY id',
        ).bind(ctx.projectId).all<Claim>(),
        evidenceSource(ctx.env, ctx.projectId),
      ]);
      return {
        for: {
          options: [
            { value: 'venture', label: 'The venture' },
            ...(claims.results || []).map((h) => ({ value: `h-${h.id}`, label: joined(h.code, h.claim) })),
          ],
        },
        evidence: {
          bar: DECISION_EVIDENCE_BAR,
          options: evidence.map((e) => ({
            value: e.id, label: joined(e.label, strengthWord(e.strength)), meta: dMon(e.date), hypothesis_id: e.hypothesis_id ?? null,
          })),
        },
      };
    },
  };
}
