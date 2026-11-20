/**
 * #6157 (D6157): `GET /api/deals/closing-overview`, the Closing zone's per-deal rows (DE08 A) in one
 * read, joined to the caller's closing room. Every part comes from a read the platform already scopes:
 *
 *   deals       funded deals the caller may read (`readableWorkspaceDealIds`), never a withdrawn or
 *               unreleased preparation (`hiddenDealIds('transactional')`)
 *   checklist   the deal's closing checklist (`closingChecklistForDeal`): items done of items counted
 *   envelopes   the deal's envelopes this caller may read (`esignEnvelopeScope`): executed of total,
 *               and signatures outstanding on paper out for signature
 *   conditions  open IC conditions (`openConditionsOnDeal`): the number the caller may see; another
 *               firm's open condition only holds the deal, with no number, as `transfer-gate` says
 *   transfer    whether a transfer is recorded on the deal (`deal_transfers`)
 *   closing     the closing this caller reads on the deal (`listClosings`, `readClosing`): its uid
 *               and status, and the caller's own lines with their status
 *
 * Each part has `state`: `recorded`, `unrecorded` (with its reason) or `unreadable` (with its
 * reason). A part that cannot be read never reads as 0 and never fails the others.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import type { RouteMount } from '../util/routeRegistry';
import deals, { closingChecklistForDeal } from './deals';
import { openConditionsOnDeal } from './ic';
import { readableWorkspaceDealIds } from '../services/dealAccess';
import { hiddenDealIds } from '../services/dealPreparation';
import { esignEnvelopeScope } from '../services/tenancyScope';
import { listClosings, readClosing } from '../services/closings';

const r = new Hono<{ Bindings: Env }>();

/** The reasons each part gives, one sentence each. */
export const OVERVIEW_REASONS = Object.freeze({
  checklistUnreadable: 'This deal’s closing checklist could not be read.',
  noChecklist: 'No closing checklist is applied to this deal.',
  checklistEmpty: 'The closing checklist has no items yet.',
  envelopesUnreadable: 'The signature archive could not be read.',
  noEnvelopes: 'No closing paper you can read is raised on this deal.',
  conditionsUnreadable: 'The conditions record could not be read.',
  transferUnreadable: 'The transfers record could not be read.',
  closingsUnreadable: 'The closing record could not be read.',
  noClosing: 'No closing you can read is opened on this deal.',
});

type Part = Record<string, unknown> & { state: 'recorded' | 'unrecorded' | 'unreadable' };
const unreadable = (reason: string): Part => ({ state: 'unreadable', reason });
const unrecorded = (reason: string): Part => ({ state: 'unrecorded', reason });

/** One part, read on its own: a failure is that part's `unreadable`, never the whole row's. */
async function part(reason: string, read: () => Promise<Part>): Promise<Part> {
  try {
    return await read();
  } catch (e) {
    console.warn('[deal_closing_overview] a part could not be read:', (e as Error)?.name);
    return unreadable(reason);
  }
}

/** Items done of the items that count; a skipped item counts neither way (the zone's rule). */
export function checklistPart(list: any): Part {
  if (!list) return unrecorded(OVERVIEW_REASONS.noChecklist);
  const counted = (Array.isArray(list.items) ? list.items : []).filter((i: any) => i.state !== 'skipped');
  if (!counted.length) return unrecorded(OVERVIEW_REASONS.checklistEmpty);
  return { state: 'recorded', done: counted.filter((i: any) => i.state === 'done').length, total: counted.length };
}

/**
 * Executed means `completed` and nothing else. Signatures outstanding are counted only on paper out
 * for signature (`sent`); an envelope that records no recipient cannot be counted and is reported
 * apart (`uncounted`), never folded in as 0.
 */
export function envelopesPart(rows: Array<{ status: string; recipient_count: number; signed_count: number }>): Part {
  if (!rows.length) return unrecorded(OVERVIEW_REASONS.noEnvelopes);
  let outstanding = 0; let uncounted = 0;
  for (const e of rows) {
    if (e.status !== 'sent') continue;
    const need = Number(e.recipient_count);
    if (!Number.isFinite(need) || need <= 0) { uncounted += 1; continue; }
    outstanding += Math.max(0, need - (Number(e.signed_count) || 0));
  }
  return {
    state: 'recorded',
    executed: rows.filter((e) => e.status === 'completed').length,
    total: rows.length,
    signatures_outstanding: outstanding,
    uncounted,
  };
}

async function envelopesByDeal(env: Env, user: User, dealIds: number[]) {
  // The envelope scope's clause is fixed text with bound values (`tenancyScope.ts`), the esign list's own read.
  const scope = esignEnvelopeScope(user);
  const sql = `SELECT e.deal_id, e.status,
            (SELECT COUNT(*) FROM esign_recipients WHERE envelope_id = e.id) AS recipient_count,
            (SELECT COUNT(*) FROM esign_recipients WHERE envelope_id = e.id AND status = 'signed') AS signed_count
       FROM esign_envelopes e
      WHERE e.deal_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) AND ${scope.sql}`;
  const res = await env.DB.prepare(sql).bind(JSON.stringify(dealIds), ...scope.binds).all<{ deal_id: number; status: string; recipient_count: number; signed_count: number }>();
  const out = new Map<number, Array<{ status: string; recipient_count: number; signed_count: number }>>();
  for (const e of res.results || []) out.set(Number(e.deal_id), [...(out.get(Number(e.deal_id)) || []), e]);
  return out;
}

async function transfersByDeal(env: Env, dealIds: number[]) {
  const res = await env.DB.prepare(
    `SELECT deal_id, COUNT(*) AS n FROM deal_transfers
      WHERE deal_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) GROUP BY deal_id`,
  ).bind(JSON.stringify(dealIds)).all<{ deal_id: number; n: number }>();
  return new Map((res.results || []).map((t) => [Number(t.deal_id), Number(t.n) || 0]));
}

/** The closing on this deal the caller reads (newest first), with the caller's own lines only. */
async function closingPart(env: Env, user: User, closings: any[], dealId: number): Promise<Part> {
  const mine = closings.find((x) => Number(x.deal_id) === dealId);
  if (!mine) return unrecorded(OVERVIEW_REASONS.noClosing);
  const read = await readClosing(env, user, String(mine.uid));
  const own = (read.lines || []).filter((l: any) => Number(l.investor_user_id) === Number(user.id));
  return {
    state: 'recorded',
    uid: read.uid,
    status: read.status,
    reach: read.reach,
    own_lines: own.map((l: any) => ({ uid: l.uid, status: l.status })),
  };
}

r.get('/closing-overview', async (c) => {
  const user = await requireAuth(c);
  // The deal record is the list itself: without it there are no rows to draw, so it alone fails the read.
  let rows: Array<{ id: number; project_id: number; name: string | null; currency: string | null; capital_committed: number }>;
  try {
    const funded = await c.env.DB.prepare(
      `SELECT d.id, d.project_id, p.name AS name, d.currency,
              (SELECT COALESCE(SUM(cm.amount), 0) FROM commitments cm WHERE cm.deal_id = d.id AND cm.status = 'confirmed') AS capital_committed
         FROM deals d JOIN projects p ON p.id = d.project_id
        WHERE d.status = 'funded' AND p.deleted_at IS NULL
        ORDER BY d.id DESC LIMIT 200`,
    ).all<any>();
    const all = funded.results || [];
    const readable = await readableWorkspaceDealIds(c.env, user, all.map((d: any) => Number(d.id)));
    const hidden = await hiddenDealIds(c.env, 'transactional');
    rows = all.filter((d: any) => readable.has(Number(d.id)) && !hidden.has(Number(d.id)));
  } catch (e) {
    console.error('[deal_closing_overview] the deal record could not be read:', (e as Error)?.name);
    return c.json({ error: 'closing_overview_unreadable', message: 'The deals at closing could not be read. Try again.' }, 503);
  }
  const ids = rows.map((d) => Number(d.id));
  if (!ids.length) return c.json({ deals: [] });

  // The batched reads: one failure costs that part on every row, and nothing else.
  const envelopes = await envelopesByDeal(c.env, user, ids).catch(() => null);
  const transfers = await transfersByDeal(c.env, ids).catch(() => null);
  const closings = await listClosings(c.env, user).catch(() => null);

  const out = [];
  for (const d of rows) {
    const id = Number(d.id);
    out.push({
      id,
      project_id: d.project_id,
      name: d.name,
      currency: d.currency ?? null,
      capital_committed: Number(d.capital_committed) || 0,
      checklist: await part(OVERVIEW_REASONS.checklistUnreadable, async () => checklistPart(await closingChecklistForDeal(c.env, id))),
      envelopes: envelopes ? envelopesPart(envelopes.get(id) || []) : unreadable(OVERVIEW_REASONS.envelopesUnreadable),
      conditions: await part(OVERVIEW_REASONS.conditionsUnreadable, async () => {
        const gate = await openConditionsOnDeal(c.env, user, id);
        return { state: 'recorded', open: gate.visible, held: gate.visible > 0 || gate.hidden > 0 };
      }),
      transfer: transfers
        ? { state: 'recorded', recorded: (transfers.get(id) || 0) > 0, count: transfers.get(id) || 0 }
        : unreadable(OVERVIEW_REASONS.transferUnreadable),
      closing: closings
        ? await part(OVERVIEW_REASONS.closingsUnreadable, () => closingPart(c.env, user, closings, id))
        : unreadable(OVERVIEW_REASONS.closingsUnreadable),
    });
  }
  return c.json({ deals: out });
});

export default r;

// Ahead of the deals router, whose `GET /:id` would read `closing-overview` as a deal id.
export const mount: RouteMount = { path: '/api/deals', router: r, before: [deals] };
