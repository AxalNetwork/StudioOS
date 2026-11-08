/**
 * HQ · Support — the three queues as one read (D204, canvas H22 drawing Y1).
 *
 *   GET /    escalations from subsidiaries, HQ-held users, and subsidiary
 *            administrators about the Admin product; the tenant × queue matrix;
 *            and the ticket→GitHub mirror strip.
 *   GET /local   D5031 (#5031) — the same payload's HQ-local half only: the
 *            escalation board, HQ's ticket queues, the mirror strip, the SLA
 *            policy and the taxonomy. It never waits on a branch, so the page
 *            draws HQ's actionable desk first and the branch hosts beside it.
 *   PUT /sla-tiers   HQ sets the P1/P2/P3 ticket hours (D482), audited; since
 *            D5032 (#5032) the save advances the policy's version and pushes
 *            it to every deployed branch through the licence copy.
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
import { fanOut, withRegistry, coverage, type BranchResult } from '../services/branches';
import {
  readOpenTicketTaxonomy, ticketMappingText, readSlaTiers, parseSlaTiers, SLA_TIERS,
  readSlaPolicyVersion, advanceSlaPolicyStatement, type SlaPolicyVersionRead,
} from '../services/supportSlaPolicy';
import { logAdminAction } from '../services/adminAudit';
import { refuse } from '../util/refusal';
import { dueSoonWindowHours } from '../services/slaWindow';
import { pushLicenceToBranch, queuePushStatement } from '../services/licencePush';
import { withDeadline, DeadlineExceeded } from '../util/deadline';

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
export function slaPolicyBody(
  tiersRead: Awaited<ReturnType<typeof readSlaTiers>>,
  versionRead: SlaPolicyVersionRead | null = null,
  propagation: SlaPropagation | null = null,
) {
  return {
    tiers: tiersRead.available
      ? { available: true as const, items: tiersRead.tiers.map((t) => ({ ...t, due_soon_hours: dueSoonWindowHours(t.hours) })) }
      : { available: false as const, reason: tiersRead.reason },
    // D5032 — the policy's version on HQ. `null` when the store holds no row
    // (never saved or distributed since versions began): no number, not v0.
    version: versionRead
      ? (versionRead.available
        ? { available: true as const, value: versionRead.version, updated_at: versionRead.applied_at }
        : { available: false as const, reason: versionRead.reason })
      : null,
    escalation_kinds: ESCALATION_KINDS.map((kind) => ({
      kind, hours: SLA_HOURS[kind], due_soon_hours: dueSoonWindowHours(SLA_HOURS[kind]),
    })),
    note: 'Set here and inherited whole: a subsidiary can escalate a ticket’s priority but cannot redefine what P1 means. The escalation hours are fixed in code.',
    // D5032 (#5032) — no longer held. The licence copy carries the policy, and
    // each branch reports the version it bands with; `propagation` is null on
    // the HQ-local read, which asks no branch.
    branch_copy: {
      held: false as const,
      how: 'Carried to each deployed branch in its licence copy, with its version. A branch bands its own tickets with the version it last applied, and reports that version here.',
      propagation,
    },
    ticket_mapping: ticketMappingText(),
  };
}

/**
 * D5032 — which version of HQ's ticket SLA policy each branch says it applies.
 * Five states, none of them inferred: `current` (the branch reports HQ's
 * version), `stale` (it reports another version, or none), `unreported` (it
 * answered from a deploy that predates the report), `unreadable` (it did not
 * answer, or could not read its own store) and `not_deployed` (no binding).
 * `complete` only when every branch is current — an SLA save is never shown
 * as applied platform-wide on less.
 */
export type SlaBranchState = 'current' | 'stale' | 'unreported' | 'unreadable' | 'not_deployed';
export type SlaPropagation = {
  version: number | null;
  total: number;
  current: number;
  complete: boolean;
  reason?: string;
  branches: Array<{ code: string; label: string; state: SlaBranchState; version: number | null; reason: string | null }>;
};

export function slaPropagation(
  hqVersion: SlaPolicyVersionRead,
  results: Array<BranchResult<{ sla_policy?: SlaPolicyVersionRead }>>,
  labelOf: (code: string) => string,
): SlaPropagation {
  const version = hqVersion.available ? hqVersion.version : null;
  const branches = results.map((b) => {
    const label = labelOf(b.code);
    if (b.status === 'not_deployed') return { code: b.code, label, state: 'not_deployed' as const, version: null, reason: b.reason || 'No binding to this branch.' };
    if (b.status !== 'ok') return { code: b.code, label, state: 'unreadable' as const, version: null, reason: b.reason || 'This branch did not answer.' };
    const sp = b.data?.sla_policy;
    if (!sp || typeof sp !== 'object') {
      return { code: b.code, label, state: 'unreported' as const, version: null, reason: 'This branch answered without saying which SLA policy it applies: it runs a deploy older than the report.' };
    }
    if (!sp.available) return { code: b.code, label, state: 'unreadable' as const, version: null, reason: sp.reason };
    if (version !== null && sp.version === version) return { code: b.code, label, state: 'current' as const, version: sp.version, reason: null };
    return {
      code: b.code, label, state: 'stale' as const, version: sp.version,
      reason: sp.version === null
        ? 'This branch holds no version of HQ’s policy: it bands its tickets with the hours it shipped with.'
        : version === null
          ? `This branch reports version ${sp.version}, and HQ’s own version could not be read.`
          : `This branch bands its tickets with version ${sp.version}; HQ’s current version is ${version}.`,
    };
  });
  const current = branches.filter((x) => x.state === 'current').length;
  return {
    version,
    total: branches.length,
    current,
    complete: version !== null && current === branches.length,
    ...(hqVersion.available
      ? (version === null ? { reason: 'HQ’s policy has no version yet: it is numbered 1 the first time it is saved or sent to a branch.' } : {})
      : { reason: hqVersion.reason }),
    branches,
  };
}

const r = new Hono<{ Bindings: Env }>();

export const ESCALATIONS_UNREADABLE =
  'The hq_escalations table could not be read on this database (migration 259), so what the branches have pushed up is unknown — not nothing.';

type EscalationsRead =
  | { available: true; complete: boolean; items: OpenEscalation[] }
  | { available: false; reason: string };

/** What the page needs of one escalation. */
function escalationItem(e: OpenEscalation, nowMs: number) {
  return {
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
  };
}

/**
 * D5030 (#5030) — the kind filter's counts and rows, from the WHOLE read rather
 * than the oldest `SUPPORT_LIST_LIMIT` the card lists. Every kind on the board,
 * plus the kinds the page always offers, each with its count and its own oldest
 * items. Past the read's ceiling a count is null — the cut list does not say
 * how many of a kind there are — while the items stay exact, because the read
 * is ordered oldest first.
 */
export function escalationKinds(items: OpenEscalation[], complete: boolean, nowMs: number, always: readonly string[] = []) {
  const byKind = new Map<string, OpenEscalation[]>();
  for (const e of items) {
    const k = String(e.kind);
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k)!.push(e);
  }
  for (const k of always) if (!byKind.has(k)) byKind.set(k, []);
  return [...byKind].map(([kind, list]) => ({
    kind,
    count: complete ? list.length : null,
    items: list.slice(0, SUPPORT_LIST_LIMIT).map((e) => escalationItem(e, nowMs)),
  }));
}

/** D799's four request kinds: the filter offers them even when none is open. */
export const ALWAYS_OFFERED_KINDS = ['renewal', 'terms_change', 'delegate', 'non_renewal'] as const;

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
    items: read.items.slice(0, SUPPORT_LIST_LIMIT).map((e) => escalationItem(e, nowMs)),
    kinds: escalationKinds(read.items, read.complete, nowMs, ALWAYS_OFFERED_KINDS),
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
  branchesNotRead: string | null = null,
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
  // D5031 — the HQ-local read asks no branch. When a branch is deployed its
  // administrators' tickets are part of the total, so the local read has none.
  if (branchesNotRead) return { value: null, reason: branchesNotRead };
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

export const BRANCHES_READ_SEPARATELY =
  'Branch hosts are read separately, and their administrators’ tickets are part of the total, so this HQ-only read has none.';

/**
 * Every HQ-local read, in parallel (D5031). Each catches its own failure and
 * answers `available: false`, so the parallel read cannot reject as a whole.
 */
async function readLocal(env: Env, nowMs: number) {
  const [ticketsRead, licences, deployments, sync, taxonomy, tiersRead, versionRead, escalationsRead] = await Promise.all([
    readOpenTickets(env),
    readSupportLicences(env),
    readSupportDeployments(env),
    readTicketSync(env),
    readOpenTicketTaxonomy(env),
    readSlaTiers(env),
    readSlaPolicyVersion(env),
    openEscalationSummary(env, nowMs).then(
      (x): EscalationsRead => ({ available: true, ...x }),
      (): EscalationsRead => ({ available: false, reason: ESCALATIONS_UNREADABLE }),
    ),
  ]);
  const escalations = escalationQueue(escalationsRead, nowMs);
  const tickets = ticketsRead.available
    ? { available: true as const, ...summariseTickets(ticketsRead, nowMs, tiersRead.available ? tiersRead.hours : null) }
    : { available: false as const, reason: ticketsRead.reason };
  return { ticketsRead, licences, deployments, sync, taxonomy, tiersRead, versionRead, escalationsRead, escalations, tickets };
}

/** D5031 — HQ's own desk, never waiting on a branch. */
r.get('/local', async (c) => {
  await requireSuperAdmin(c);
  const nowMs = Date.now();
  const l = await readLocal(c.env, nowMs);
  // A deployment registry that cannot be read leaves unknown whether any
  // branch's tickets belong in the total, so it withholds the total too.
  const branchesNotRead = !l.deployments.available
    ? l.deployments.reason
    : (l.deployments.rows.length ? BRANCHES_READ_SEPARATELY : null);
  return c.json({
    scope: 'hq_local',
    read_at: new Date(nowMs).toISOString(),
    list_limit: SUPPORT_LIST_LIMIT,
    total: totalOf(l.escalations, l.tickets, [], branchesNotRead),
    escalations: l.escalations,
    tickets: l.tickets,
    sync: l.sync,
    sla_policy: slaPolicyBody(l.tiersRead, l.versionRead, null),
    taxonomy: l.taxonomy,
  });
});

r.get('/', async (c) => {
  await requireSuperAdmin(c);
  const env = c.env;
  const nowMs = Date.now();

  // D5031 — HQ's reads and the branch fan-out run AT ONCE: the slowest branch
  // costs its own deadline, never that plus HQ's reads in series.
  // D485 — each branch's administrators' tickets, filed on its own host.
  // Asked of every bound branch and merged with the registry, so a deployed
  // branch with no binding is named rather than silently left out. Labels come
  // from the licence ledger the matrix already read.
  const [l, answers] = await Promise.all([
    readLocal(env, nowMs),
    fanOut<{ tickets: BranchTicketsRead; sla_policy?: SlaPolicyVersionRead }>(env, 'openTickets'),
  ]);
  const { ticketsRead, licences, deployments, tiersRead, escalationsRead, escalations, tickets } = l;
  const registry = deployments.available ? deployments.rows.map((d) => ({ code: d.code, licence_uid: d.licence_uid })) : [];
  const brandOf = new Map((licences.available ? licences.rows : []).map((x) => [x.uid, x.brand_name]));
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
    scope: 'all',
    read_at: new Date(nowMs).toISOString(),
    list_limit: SUPPORT_LIST_LIMIT,
    // A registry that could not be read leaves unknown which branches exist,
    // so the total is withheld rather than summed over the ones that answered.
    total: totalOf(escalations, tickets, branchLines, deployments.available ? null : deployments.reason),
    escalations,
    tickets,
    branch_tickets: {
      lines: branchLines,
      coverage: coverage(branchResults),
      whose: 'Each branch’s active administrators, filing on its own host about the Admin product. A branch member’s own ticket is the branch’s to answer and is not sent.',
    },
    matrix,
    sync: l.sync,
    sla_policy: slaPolicyBody(tiersRead, l.versionRead, slaPropagation(l.versionRead, branchResults, (code) => labelOf.get(code) || code)),
    taxonomy: l.taxonomy,
  });
});

/** D5032 — how long the save waits on each branch's push before reporting it as not yet confirmed. */
export const SLA_PUSH_DEADLINE_MS = 5_000;

/**
 * One branch's answer to the save's push. `applied` only when the branch
 * acknowledged the copy that carried the new version; anything else stays
 * queued (`licence_push_pending`) and the cron retries it (D272).
 */
export type SlaDistributionLine = {
  code: string; label: string;
  state: 'applied' | 'failed' | 'unknown';
  reason: string | null;
};

async function distributeSlaPolicy(
  env: Env, deployed: Array<{ licence_id: number; code: string; label: string }>,
): Promise<SlaDistributionLine[]> {
  return Promise.all(deployed.map(async (d): Promise<SlaDistributionLine> => {
    try {
      const res = await withDeadline(pushLicenceToBranch(env, d.licence_id), SLA_PUSH_DEADLINE_MS, `push to ${d.code}`);
      if (res.ok) return { code: d.code, label: d.label, state: 'applied', reason: null };
      return {
        code: d.code, label: d.label, state: 'failed',
        reason: `${res.reason || 'The branch did not take the copy.'} It stays queued and is sent again.`,
      };
    } catch (e) {
      return {
        code: d.code, label: d.label, state: 'unknown',
        reason: e instanceof DeadlineExceeded
          ? `The branch did not answer within ${SLA_PUSH_DEADLINE_MS / 1000}s, so whether it applied the new hours is not known yet. The push stays queued and is sent again.`
          : `Whether the branch applied the new hours is not known: ${(e as Error)?.message || 'the push failed'}. It stays queued and is sent again.`,
      };
    }
  }));
}

/**
 * D482 — HQ sets the three ticket tiers at once, so the P1 ≤ P2 ≤ P3 order is
 * checked on the whole set. Each change is one `logAdminAction` row carrying
 * the hours before and after; a write that changes nothing writes no row.
 *
 * D5032 (#5032) — A CHANGE IS A NEW VERSION, AND IT IS OWED TO EVERY BRANCH.
 * The tier rows, the version and one queued licence push per deployed licence
 * are ONE batch, so a save that commits always leaves its distribution owed —
 * a Worker that dies after the commit leaves the cron (D272) to send it. Then
 * each push is tried inline with a deadline, and the answer says branch by
 * branch whether it is applied, failed or not yet known. The save never says
 * "applied everywhere" on less than every branch's acknowledgement.
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
  let deployed: Array<{ licence_id: number; code: string; label: string }> | null = null;
  let distribution: {
    version: number | null; total: number; applied: number; complete: boolean;
    branches: SlaDistributionLine[]; reason?: string;
  } | null = null;
  if (changed.length) {
    try {
      const res = await c.env.DB.prepare(
        `SELECT l.id AS licence_id, d.code AS code, l.brand_name AS label
           FROM licence_deployments d JOIN territory_licences l ON l.uid = d.licence_uid
          ORDER BY d.code`,
      ).all<{ licence_id: number; code: string; label: string | null }>();
      deployed = (res.results || []).map((x) => ({ licence_id: Number(x.licence_id), code: String(x.code), label: x.label || String(x.code) }));
    } catch {
      deployed = null;
    }
    // The version advances only where its store exists: a database without the
    // migration saves the hours and says the save carries no version.
    const versioned = (await readSlaPolicyVersion(c.env)).available;
    await c.env.DB.batch([
      ...changed.map((t) => c.env.DB.prepare(
        `UPDATE hq_support_sla_tiers SET hours = ?, description = ?, updated_at = datetime('now'), updated_by = ? WHERE tier = ?`,
      ).bind(parsed.value[t].hours, parsed.value[t].description, admin.id, t)),
      ...(versioned ? [advanceSlaPolicyStatement(c.env)] : []),
      ...(deployed || []).map((d) => queuePushStatement(c.env, d.licence_id)),
    ]);
    const version = await readSlaPolicyVersion(c.env);
    const versionValue = version.available ? version.version : null;
    await logAdminAction(c.env, admin.id, admin.email || '', 'hq_support.sla_tiers.update', {
      version: versionValue,
      changed: changed.map((t) => {
        const was = before.tiers.find((x) => x.id === t)!;
        return { tier: t, hours: [was.hours, parsed.value[t].hours], description: [was.description, parsed.value[t].description] };
      }),
    });
    if (deployed === null) {
      distribution = {
        version: versionValue, total: 0, applied: 0, complete: false, branches: [],
        reason: 'The deployment registry could not be read, so which branches are owed the new hours is unknown. None is reported as applied.',
      };
    } else {
      const branches = await distributeSlaPolicy(c.env, deployed);
      const applied = branches.filter((b) => b.state === 'applied').length;
      distribution = {
        version: versionValue, total: branches.length, applied,
        complete: versionValue !== null && applied === branches.length,
        branches,
        ...(versionValue === null ? { reason: 'The SLA policy version could not be read, so no branch can be shown as holding this save.' } : {}),
      };
    }
  }
  const [after, versionAfter] = await Promise.all([readSlaTiers(c.env), readSlaPolicyVersion(c.env)]);
  return c.json({ changed, distribution, sla_policy: slaPolicyBody(after, versionAfter, null) });
});

export default r;
