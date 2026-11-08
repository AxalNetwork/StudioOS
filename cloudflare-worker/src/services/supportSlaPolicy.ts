/**
 * HQ · Support — inherited SLA bands for tickets (D455, canvas Y1).
 *
 * Escalations carry `due_at` and use `slaBand()` in `rpc/hqOps.ts`. Tickets
 * carry priority (`urgent` | `high` | `medium` | `low`) and no due date, so
 * their band is derived from age against the tier HQ assigns from priority.
 *
 * THE HOURS ARE A STORE (D482, #1022). HQ edits the P1/P2/P3 hours at
 * `PUT /api/admin/hq-support/sla-tiers` (`hq_support_sla_tiers`, migration
 * 333), each change audited. `HQ_TICKET_SLA_HOURS` is the seed migration 333
 * writes, not the live rule: a read that cannot reach the store says so, and
 * its tickets are not banded against these numbers in its place.
 */
import { OPEN_TICKET_STATUSES } from './supportQueues';
import { TICKET_CATEGORIES, type TicketCategory } from './ticketCategories';
import { bandForRemaining, dueSoonWindowHours, SLA_DUE_SOON_HOURS, type SlaBand } from './slaWindow';

export type { SlaBand };
export { SLA_DUE_SOON_HOURS };

/** Migration 333's seed (D459's hours). */
export const HQ_TICKET_SLA_HOURS = { P1: 24, P2: 48, P3: 96 } as const;

export type SupportSlaTier = keyof typeof HQ_TICKET_SLA_HOURS;
export type TierHours = Record<SupportSlaTier, number>;
export const SLA_TIERS = ['P1', 'P2', 'P3'] as const satisfies readonly SupportSlaTier[];
/** The bounds migration 333's CHECK sets: an hour to thirty days. */
export const SLA_TIER_HOURS_MIN = 1;
export const SLA_TIER_HOURS_MAX = 720;

export const HQ_SUPPORT_SLA_POLICY: ReadonlyArray<{
  id: SupportSlaTier;
  hours: number;
  description: string;
}> = [
  { id: 'P1', hours: HQ_TICKET_SLA_HOURS.P1, description: 'Money, access, or data at risk' },
  { id: 'P2', hours: HQ_TICKET_SLA_HOURS.P2, description: 'A workflow is blocked, a workaround exists' },
  { id: 'P3', hours: HQ_TICKET_SLA_HOURS.P3, description: 'Wrong, but nobody is stopped' },
];

/** Map filing priority to the inherited response tier. */
export function ticketPriorityTier(priority: string): SupportSlaTier {
  const p = String(priority || '').trim().toLowerCase();
  if (p === 'urgent') return 'P1';
  if (p === 'high') return 'P2';
  return 'P3';
}

/** The priorities a ticket is filed with, in the order the mapping line reads them. */
const TICKET_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;

/**
 * "urgent → P1 · high → P2 · medium and low → P3", built from `ticketPriorityTier`
 * so the sentence the panel shows cannot drift from the rule the bands use.
 */
export function ticketMappingText(): string {
  const byTier = new Map<SupportSlaTier, string[]>();
  for (const p of TICKET_PRIORITIES) {
    const t = ticketPriorityTier(p);
    byTier.set(t, [...(byTier.get(t) || []), p]);
  }
  return [...byTier].map(([t, ps]) => `${ps.join(' and ')} → ${t}`).join(' · ');
}

/**
 * Band from age and a limit in hours (D459). Returns null when age is unknown.
 * The window and the boundary are `slaWindow.ts`'s, the same ones escalations use.
 */
export function ticketSlaBand(
  ageHours: number | null,
  limitHours: number,
  dueSoonHours = dueSoonWindowHours(limitHours),
): SlaBand | null {
  if (ageHours === null || !Number.isFinite(ageHours)) return null;
  return bandForRemaining(limitHours - ageHours, dueSoonHours);
}

export function ticketSlaBandForPriority(
  ageHours: number | null, priority: string, hours: TierHours = HQ_TICKET_SLA_HOURS,
): SlaBand | null {
  const tier = ticketPriorityTier(priority);
  return ticketSlaBand(ageHours, hours[tier]);
}

export type StoredSlaTier = {
  id: SupportSlaTier; hours: number; description: string;
  updated_at: string | null; updated_by_name: string | null;
};

export const SLA_TIERS_UNREADABLE =
  'The hq_support_sla_tiers table could not be read on this database (migration 333), so the ticket SLA hours are unknown and no ticket is banded.';

/**
 * The ticket SLA tiers as HQ last set them. All three or none: a store missing
 * a tier cannot band that tier's tickets, so it reads as unreadable too.
 */
export async function readSlaTiers(
  env: { DB: import('../types').Env['DB'] },
): Promise<{ available: true; tiers: StoredSlaTier[]; hours: TierHours } | { available: false; reason: string }> {
  let rows: any[];
  try {
    const res = await env.DB.prepare(
      `SELECT t.tier, t.hours, t.description, t.updated_at, COALESCE(u.display_name, u.name) AS updated_by_name
         FROM hq_support_sla_tiers t LEFT JOIN users u ON u.id = t.updated_by
        ORDER BY t.tier`,
    ).all<any>();
    rows = res.results || [];
  } catch {
    return { available: false, reason: SLA_TIERS_UNREADABLE };
  }
  const by = new Map(rows.map((r) => [String(r.tier), r]));
  if (!SLA_TIERS.every((t) => by.has(t))) {
    return { available: false, reason: 'The SLA tier store is missing a tier, so the ticket SLA hours are incomplete and no ticket is banded.' };
  }
  const tiers = SLA_TIERS.map((t) => {
    const r = by.get(t);
    return {
      id: t, hours: Number(r.hours), description: String(r.description),
      updated_at: r.updated_at ?? null, updated_by_name: r.updated_by_name ?? null,
    };
  });
  const hours = Object.fromEntries(tiers.map((t) => [t.id, t.hours])) as TierHours;
  return { available: true, tiers, hours };
}

export type SlaTierInput = Record<SupportSlaTier, { hours: number; description: string }>;

/**
 * The body of `PUT /sla-tiers`: all three tiers, each a whole number of hours
 * within the CHECK's bounds and a description, and P1 ≤ P2 ≤ P3 — a P1 that
 * waits longer than a P2 inverts what the tiers mean.
 */
export function parseSlaTiers(body: unknown): { ok: true; value: SlaTierInput } | { ok: false; error: string } {
  const src = body && typeof body === 'object' ? (body as any).tiers : null;
  if (!src || typeof src !== 'object') return { ok: false, error: 'tiers must name P1, P2 and P3' };
  const out = {} as SlaTierInput;
  for (const t of SLA_TIERS) {
    const row = src[t];
    if (!row || typeof row !== 'object') return { ok: false, error: `tiers.${t} is missing` };
    const hours = Number(row.hours);
    if (!Number.isInteger(hours) || hours < SLA_TIER_HOURS_MIN || hours > SLA_TIER_HOURS_MAX) {
      return { ok: false, error: `tiers.${t}.hours must be a whole number from ${SLA_TIER_HOURS_MIN} to ${SLA_TIER_HOURS_MAX}` };
    }
    const description = typeof row.description === 'string' ? row.description.trim() : '';
    if (!description || description.length > 200) return { ok: false, error: `tiers.${t}.description must be 1-200 characters` };
    out[t] = { hours, description };
  }
  if (!(out.P1.hours <= out.P2.hours && out.P2.hours <= out.P3.hours)) {
    return { ok: false, error: 'P1 must not wait longer than P2, nor P2 longer than P3' };
  }
  return { ok: true, value: out };
}

/**
 * Tally a queue's bands. A ticket with no readable age has no band, and is
 * counted as `undated` rather than left out, so the four always sum to the queue.
 */
export function tallySlaBands(bands: Array<SlaBand | null>): { ok: number; due_soon: number; past: number; undated: number } {
  const out = { ok: 0, due_soon: 0, past: 0, undated: 0 };
  for (const b of bands) {
    if (b === 'ok') out.ok += 1;
    else if (b === 'due_soon') out.due_soon += 1;
    else if (b === 'past') out.past += 1;
    else out.undated += 1;
  }
  return out;
}

export type TicketTaxonomyRow = { category: TicketCategory; label: string; open: number };

/**
 * Open tickets by category (D482): every one of the eight, in the canvas's
 * order, with its count (0 is a count here: the eight are fixed, so a category
 * nobody filed under has none open). Tickets with no category recorded —
 * every ticket filed before migration 333 — are counted apart as
 * `uncategorised`, never folded into Other.
 */
export async function readOpenTicketTaxonomy(
  env: { DB: import('../types').Env['DB'] },
): Promise<{ available: true; items: TicketTaxonomyRow[]; uncategorised: number } | { available: false; reason: string }> {
  try {
    // The `?` pair binds `OPEN_TICKET_STATUSES` itself, the one definition of
    // open; its tuple type makes a third status a compile error here.
    const res = await env.DB.prepare(
      `SELECT category, COUNT(*) AS n
         FROM tickets
        WHERE status IN (?, ?)
        GROUP BY category`,
    ).bind(...OPEN_TICKET_STATUSES).all<{ category: string | null; n: number }>();
    const counts = new Map<string | null, number>();
    for (const r of res.results || []) counts.set(r.category ?? null, Number(r.n));
    return {
      available: true,
      items: TICKET_CATEGORIES.map((c) => ({ category: c.id, label: c.label, open: counts.get(c.id) ?? 0 })),
      uncategorised: counts.get(null) ?? 0,
    };
  } catch {
    return {
      available: false,
      reason: 'The tickets table, or its category column (migration 333), could not be read on this database, so open counts by category are unknown.',
    };
  }
}

// ─── The policy's version, and its copy on every branch (D5032, #5032) ────

/**
 * The version of the tier rows on THIS database (`support_sla_policy_state`,
 * the 202611082049 migration). On HQ it advances with every save that changes
 * a tier; on a branch it is the HQ version the last applied copy carried.
 * `version` null: the store answered and holds no row, so these hours carry no
 * number — never read as version 0 or as current.
 */
export type SlaPolicyVersionRead =
  | { available: true; version: number | null; source: 'hq' | 'pushed' | null; applied_at: string | null }
  | { available: false; reason: string };

export const SLA_POLICY_VERSION_UNREADABLE =
  'The SLA policy version could not be read on this database (support_sla_policy_state), so which version of the hours it holds is unknown.';

export async function readSlaPolicyVersion(env: { DB: import('../types').Env['DB'] }): Promise<SlaPolicyVersionRead> {
  try {
    const row = await env.DB.prepare(
      'SELECT version, source, applied_at FROM support_sla_policy_state WHERE id = 1',
    ).first<{ version: number; source: string; applied_at: string }>();
    if (!row) return { available: true, version: null, source: null, applied_at: null };
    const v = Number(row.version);
    return {
      available: true,
      version: Number.isInteger(v) && v >= 1 ? v : null,
      source: row.source === 'hq' || row.source === 'pushed' ? row.source : null,
      applied_at: row.applied_at ?? null,
    };
  } catch {
    return { available: false, reason: SLA_POLICY_VERSION_UNREADABLE };
  }
}

/**
 * HQ's save advances the version in the SAME batch as the tier rows, so a
 * version never names hours it does not hold. The first save numbers the
 * policy 1.
 */
export function advanceSlaPolicyStatement(env: { DB: import('../types').Env['DB'] }) {
  return env.DB.prepare(
    `INSERT INTO support_sla_policy_state (id, version, source, applied_at) VALUES (1, 1, 'hq', datetime('now'))
     ON CONFLICT(id) DO UPDATE SET version = support_sla_policy_state.version + 1, source = 'hq', applied_at = datetime('now')`,
  );
}

/** What the licence copy carries: the version and all three tiers. */
export type SlaPolicyCopy = { version: number; tiers: Array<{ id: SupportSlaTier; hours: number; description: string }> };

/**
 * HQ's policy as the licence push sends it. A policy that was never saved
 * since versions began is numbered 1 here, the first time it is distributed:
 * the hours are HQ's live ones either way, and a branch needs a number to
 * order copies by. Throws when the tiers or the version store cannot be read,
 * so the push reports the section as unreadable rather than sending a guess.
 */
export async function slaPolicyForCopy(env: { DB: import('../types').Env['DB'] }): Promise<SlaPolicyCopy> {
  // Raw reads, so a database without the store throws "no such table" and the
  // push omits the section (nothing recorded), while any other failure makes
  // the push partial — the licence copy's #4686 rule.
  const res = await env.DB.prepare('SELECT tier, hours, description FROM hq_support_sla_tiers ORDER BY tier')
    .all<{ tier: string; hours: number; description: string }>();
  const by = new Map((res.results || []).map((r) => [String(r.tier), r]));
  if (!SLA_TIERS.every((t) => by.has(t))) throw new Error('The SLA tier store is missing a tier.');
  const read = () => env.DB.prepare('SELECT version FROM support_sla_policy_state WHERE id = 1').first<{ version: number }>();
  let row = await read();
  if (!row) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO support_sla_policy_state (id, version, source, applied_at) VALUES (1, 1, 'hq', datetime('now'))`,
    ).run();
    row = await read();
  }
  const version = Number(row?.version);
  if (!Number.isInteger(version) || version < 1) throw new Error('The SLA policy version could not be allocated.');
  return {
    version,
    tiers: SLA_TIERS.map((t) => ({ id: t, hours: Number(by.get(t)!.hours), description: String(by.get(t)!.description) })),
  };
}

/** Parse the copy a branch receives. The same bounds and order HQ's save enforces. */
export function parseSlaPolicyCopy(raw: unknown): { ok: true; value: SlaPolicyCopy } | { ok: false; error: string } {
  let src: any = raw;
  if (typeof raw === 'string') {
    try { src = JSON.parse(raw); } catch { return { ok: false, error: 'support_sla_json is not JSON' }; }
  }
  if (!src || typeof src !== 'object') return { ok: false, error: 'support_sla_json must be an object' };
  const version = Number(src.version);
  if (!Number.isInteger(version) || version < 1) return { ok: false, error: 'support_sla_json.version must be a positive integer' };
  const byId = new Map((Array.isArray(src.tiers) ? src.tiers : []).map((t: any) => [String(t?.id), t]));
  const parsed = parseSlaTiers({ tiers: Object.fromEntries(SLA_TIERS.map((t) => [t, byId.get(t)])) });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, value: { version, tiers: SLA_TIERS.map((t) => ({ id: t, ...parsed.value[t] })) } };
}

/**
 * A branch writes HQ's tiers and the version they came with, in one batch.
 * A copy older than the version the branch holds changes nothing (`stale`),
 * the same rule the licence copy follows for its revision. Throws when the
 * write fails, so `applyLicenceCopy` reports the section as not written.
 */
export async function applySlaPolicyCopy(
  env: { DB: import('../types').Env['DB'] }, copy: SlaPolicyCopy,
): Promise<{ applied: boolean; version: number; stale: boolean }> {
  const held = await readSlaPolicyVersion(env);
  if (!held.available) throw new Error(held.reason);
  if (held.version !== null && held.version > copy.version) {
    return { applied: false, version: held.version, stale: true };
  }
  // Each statement re-checks the version inside the batch (one transaction),
  // so two copies racing cannot leave older hours under a newer number.
  await env.DB.batch([
    ...copy.tiers.map((t) => env.DB.prepare(
      `INSERT INTO hq_support_sla_tiers (tier, hours, description, updated_at, updated_by)
       SELECT ?, ?, ?, datetime('now'), NULL
        WHERE NOT EXISTS (SELECT 1 FROM support_sla_policy_state WHERE id = 1 AND version > ?)
       ON CONFLICT(tier) DO UPDATE SET hours = excluded.hours, description = excluded.description,
                                       updated_at = excluded.updated_at, updated_by = NULL`,
    ).bind(t.id, t.hours, t.description, copy.version)),
    env.DB.prepare(
      `INSERT INTO support_sla_policy_state (id, version, source, applied_at) VALUES (1, ?, 'pushed', datetime('now'))
       ON CONFLICT(id) DO UPDATE SET version = excluded.version, source = 'pushed', applied_at = excluded.applied_at
        WHERE excluded.version >= support_sla_policy_state.version`,
    ).bind(copy.version),
  ]);
  const after = await readSlaPolicyVersion(env);
  if (after.available && after.version !== null && after.version > copy.version) {
    return { applied: false, version: after.version, stale: true };
  }
  return { applied: true, version: copy.version, stale: false };
}
