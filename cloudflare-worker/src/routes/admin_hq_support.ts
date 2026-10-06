/**
 * HQ · Support — the three queues as one read (D204, canvas H22 drawing Y1).
 *
 *   GET /    escalations from subsidiaries, HQ-held users, and subsidiary
 *            administrators about the Admin product; the tenant × queue matrix;
 *            and the ticket→GitHub mirror strip.
 *   PUT /sla-tiers   HQ sets the P1/P2/P3 ticket hours (D482), audited.
 *
 * SUPER ADMIN ONLY. A route that names another account's standing and which
 * licence it administers is a cross-admin read whatever it renders — the rule
 * D132 stated and D133 applied — and on a branch there is no elevation at all,
 * so it answers "HQ only" (D106).
 *
 * EVERY READ ANSWERS FOR ITSELF. Six reads, each with its own failure: an
 * unreadable escalation board costs the escalation queue and the matrix's
 * escalation cells, never the ticket queues beside them. A read that failed is
 * `available: false` with its reason; a read that hit its ceiling is
 * `complete: false`, and its count is null rather than the length of a cut list.
 *
 * THE TOTAL IS A SUM OF EVERY TERM OR IT IS NOT SHOWN. The band at the top of
 * the page reads "N open"; if any of the three queues could not be counted in
 * full, N is null with the reason — the `backlogOf` rule, one page over.
 *
 * Mounted at /api/admin/hq-support BEFORE the /api/admin catch-all in index.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { openEscalationSummary, ESCALATION_KINDS, SLA_HOURS, type OpenEscalation } from '../rpc/hqOps';
import { ageHours } from '../services/approvalSources';
import {
  readOpenTickets, summariseTickets, readTicketSync, readSupportLicences,
  readSupportDeployments, buildTenantMatrix, branchTicketLine, SUPPORT_LIST_LIMIT,
  type TicketQueues, type BranchTicketLine, type BranchTicketsRead,
} from '../services/supportQueues';
import { fanOut, withRegistry, coverage } from '../services/branches';
import {
  readOpenTicketTaxonomy, ticketMappingText, readSlaTiers, parseSlaTiers, SLA_TIERS,
} from '../services/supportSlaPolicy';
import { logAdminAction } from '../services/adminAudit';
import { refuse } from '../util/refusal';
import { dueSoonWindowHours } from '../services/slaWindow';

/**
 * The two SLA tables, named side by side (D459). Tickets band against the
 * P1/P2/P3 hours; escalations carry a `due_at` stamped from their kind's hours
 * (`SLA_HOURS`). They are different promises about different things, so the
 * panel shows both rather than mapping one onto the other. Each row carries
 * the due-soon window its limit gives, from the one module that defines it.
 *
 * D482: the ticket tiers are HQ's store, read on every call. When it cannot be
 * read, `tiers` is unavailable with its reason, and nothing stands in for it.
 */
export function slaPolicyBody(tiersRead: Awaited<ReturnType<typeof readSlaTiers>>) {
  return {
    tiers: tiersRead.available
      ? { available: true as const, items: tiersRead.tiers.map((t) => ({ ...t, due_soon_hours: dueSoonWindowHours(t.hours) })) }
      : { available: false as const, reason: tiersRead.reason },
    escalation_kinds: ESCALATION_KINDS.map((kind) => ({
      kind, hours: SLA_HOURS[kind], due_soon_hours: dueSoonWindowHours(SLA_HOURS[kind]),
    })),
    note: 'Set here and inherited whole: a subsidiary can escalate a ticket’s priority but cannot redefine what P1 means. The escalation hours are fixed in code.',
    // Held (D482): a branch reads these hours only once its licence copy carries
    // them, and that copy is `routes/licence.ts`, slot S05's.
    branch_copy: {
      held: true as const,
      reason: 'Branches do not carry these hours yet: the licence copy that would send them is held (slot S05, routes/licence.ts). A branch bands its tickets with the hours it shipped with.',
    },
    ticket_mapping: ticketMappingText(),
  };
}

const r = new Hono<{ Bindings: Env }>();

export const ESCALATIONS_UNREADABLE =
  'The hq_escalations table could not be read on this database (migration 259), so what the branches have pushed up is unknown — not nothing.';

type EscalationsRead =
  | { available: true; complete: boolean; items: OpenEscalation[] }
  | { available: false; reason: string };

/** The escalation queue as the page draws it: count, SLA bands, the oldest few. */
function escalationQueue(read: EscalationsRead, nowMs: number) {
  if (!read.available) return { available: false as const, reason: read.reason };
  const bands = { ok: 0, due_soon: 0, past: 0 };
  for (const e of read.items) bands[e.sla] += 1;
  return {
    available: true as const,
    complete: read.complete,
    // A count and its bands are one measurement: past the ceiling both are cut,
    // so both are withheld rather than one of them being shown as whole.
    count: read.complete ? read.items.length : null,
    bands: read.complete ? bands : null,
    oldest_age_hours: read.items.length ? ageHours(read.items[0].created_at, nowMs) : null,
    items: read.items.slice(0, SUPPORT_LIST_LIMIT).map((e) => ({
      uid: e.uid,
      branch_code: e.branch_code,
      kind: e.kind,
      subject: e.subject,
      subject_ref: e.subject_ref,
      detail: e.detail,
      raised_by_name: e.raised_by_name,
      created_at: e.created_at,
      due_at: e.due_at,
      sla: e.sla,
      age_hours: ageHours(e.created_at, nowMs),
      relation: e.relation,
    })),
  };
}

type Queue = { count: number | null; oldest_age_hours: number | null };

/**
 * "All tenants · N open · oldest 96h". N is the three queues — H22's own sum —
 * and it exists only when all three were counted in full.
 */
function totalOf(
  escalations: ReturnType<typeof escalationQueue>,
  tickets: ({ available: true } & TicketQueues) | { available: false; reason: string },
  branchLines: BranchTicketLine[] = [],
) {
  if (!escalations.available) {
    return { value: null, reason: 'Escalations could not be read, so the three queues have no total.' };
  }
  if (!tickets.available) {
    return { value: null, reason: 'Tickets could not be read, so two of the three queues are uncounted and a total would be a part.' };
  }
  if (!escalations.complete || !tickets.complete) {
    return { value: null, reason: 'A queue holds more items than one read counts, so a total would be a cut count.' };
  }
  // D485 — a branch's administrators' tickets are part of the About-Admin
  // queue, so a branch that could not be read leaves the total a part.
  const unread = branchLines.filter((b) => b.state !== 'ok');
  if (unread.length) {
    return {
      value: null,
      reason: `The tickets filed on ${unread.map((b) => b.label).join(', ')} could not be read, so the About-Admin queue is uncounted and a total would be a part.`,
    };
  }
  if (branchLines.some((b) => b.state === 'ok' && b.count === null)) {
    return { value: null, reason: 'A branch holds more open tickets than one read counts, so a total would be a cut count.' };
  }
  const parts: Array<[string, Queue]> = [
    ['escalations', { count: escalations.count, oldest_age_hours: escalations.oldest_age_hours }],
    ['hq_held', tickets.buckets.hq_held],
    ['admin_product', tickets.buckets.admin_product],
    ...branchLines.map((b): [string, Queue] => [
      `branch:${b.code}`,
      b.state === 'ok' ? { count: b.count, oldest_age_hours: b.oldest_age_hours } : { count: null, oldest_age_hours: null },
    ]),
  ];
  let value = 0;
  let oldest: { age_hours: number; queue: string } | null = null;
  for (const [queue, q] of parts) {
    value += q.count || 0;
    if (q.oldest_age_hours !== null && (!oldest || q.oldest_age_hours > oldest.age_hours)) {
      oldest = { age_hours: q.oldest_age_hours, queue };
    }
  }
  return { value, oldest };
}

r.get('/', async (c) => {
  await requireSuperAdmin(c);
  const env = c.env;
  const nowMs = Date.now();

  // Each of these catches its own failure and answers `available: false`, so
  // the parallel read cannot reject as a whole.
  const [ticketsRead, licences, deployments, sync, taxonomy, tiersRead] = await Promise.all([
    readOpenTickets(env),
    readSupportLicences(env),
    readSupportDeployments(env),
    readTicketSync(env),
    readOpenTicketTaxonomy(env),
    readSlaTiers(env),
  ]);

  // D485 — each branch's administrators' tickets, filed on its own host.
  // Asked of every bound branch and merged with the registry, so a deployed
  // branch with no binding is named rather than silently left out. Labels come
  // from the licence ledger the matrix already read.
  const answers = await fanOut<{ tickets: BranchTicketsRead }>(env, 'openTickets');
  const registry = deployments.available ? deployments.rows.map((d) => ({ code: d.code, licence_uid: d.licence_uid })) : [];
  const brandOf = new Map((licences.available ? licences.rows : []).map((l) => [l.uid, l.brand_name]));
  const labelOf = new Map(registry.map((d) => [String(d.code).toLowerCase(), brandOf.get(d.licence_uid) || d.code]));
  const branchResults = withRegistry(answers, registry);
  const branchLines: BranchTicketLine[] = branchResults.map((b) => {
    const label = labelOf.get(b.code) || b.code;
    if (b.status === 'ok' && b.data?.tickets) {
      return branchTicketLine(b.code, label, b.data.tickets, nowMs, tiersRead.available ? tiersRead.hours : null);
    }
    return {
      code: b.code, label,
      state: b.status === 'not_deployed' ? 'not_deployed' as const : 'unreadable' as const,
      reason: b.reason || 'This branch did not answer.',
    };
  });

  let escalationsRead: EscalationsRead;
  try {
    escalationsRead = { available: true, ...(await openEscalationSummary(env, nowMs)) };
  } catch {
    escalationsRead = { available: false, reason: ESCALATIONS_UNREADABLE };
  }

  const escalations = escalationQueue(escalationsRead, nowMs);
  const tickets = ticketsRead.available
    ? { available: true as const, ...summariseTickets(ticketsRead, nowMs, tiersRead.available ? tiersRead.hours : null) }
    : { available: false as const, reason: ticketsRead.reason };

  const matrix = licences.available
    ? {
      available: true as const,
      ...buildTenantMatrix({
        licences: licences.rows,
        deployments,
        escalations: escalationsRead,
        tickets: ticketsRead,
        nowMs,
        branchTickets: new Map(branchLines.map((b) => [b.code, b])),
      }),
    }
    : { available: false as const, reason: licences.reason };

  return c.json({
    read_at: new Date(nowMs).toISOString(),
    list_limit: SUPPORT_LIST_LIMIT,
    total: totalOf(escalations, tickets, branchLines),
    escalations,
    tickets,
    branch_tickets: {
      lines: branchLines,
      coverage: coverage(branchResults),
      whose: 'Each branch’s active administrators, filing on its own host about the Admin product. A branch member’s own ticket is the branch’s to answer and is not sent.',
    },
    matrix,
    sync,
    sla_policy: slaPolicyBody(tiersRead),
    taxonomy,
  });
});

/**
 * D482 — HQ sets the three ticket tiers at once, so the P1 ≤ P2 ≤ P3 order is
 * checked on the whole set. Each change is one `logAdminAction` row carrying
 * the hours before and after; a write that changes nothing writes no row.
 */
r.put('/sla-tiers', async (c) => {
  const admin = await requireSuperAdmin(c);
  const parsed = parseSlaTiers(await c.req.json().catch(() => null));
  if (!parsed.ok) return refuse(c, 400, { code: 'invalid_tiers', message: parsed.error });
  const before = await readSlaTiers(c.env);
  if (!before.available) return refuse(c, 503, { code: 'sla_tiers_unreadable', message: before.reason });
  const changed = SLA_TIERS.filter((t) => {
    const was = before.tiers.find((x) => x.id === t)!;
    return was.hours !== parsed.value[t].hours || was.description !== parsed.value[t].description;
  });
  if (changed.length) {
    await c.env.DB.batch(changed.map((t) => c.env.DB.prepare(
      `UPDATE hq_support_sla_tiers SET hours = ?, description = ?, updated_at = datetime('now'), updated_by = ? WHERE tier = ?`,
    ).bind(parsed.value[t].hours, parsed.value[t].description, admin.id, t)));
    await logAdminAction(c.env, admin.id, admin.email || '', 'hq_support.sla_tiers.update', {
      changed: changed.map((t) => {
        const was = before.tiers.find((x) => x.id === t)!;
        return { tier: t, hours: [was.hours, parsed.value[t].hours], description: [was.description, parsed.value[t].description] };
      }),
    });
  }
  const after = await readSlaTiers(c.env);
  return c.json({ changed, sla_policy: slaPolicyBody(after) });
});

export default r;
