/**
 * D1170 (#3083, part 4 of #2449) — the storage guard and its notices.
 *
 * `assertStorageRoom(env, owner, incomingBytes, caller)` runs before every
 * member upload's R2 write. The file counts to one member, by part 3's rule
 * (D1169 §1): a company file to the company's first primary admin, else the
 * venture's founder; a personal file to its own owner. When the bytes that
 * member's plan already holds, plus this file, would pass their allowance,
 * the write is refused with one shape everywhere:
 *
 *   413 { error: 'storage_full', message, used_bytes, allowance_bytes,
 *         incoming_bytes, plan_key, counts_to }
 *
 * thrown as a Response, which every route's `mapError` and the app's
 * `withThrownResponses` answer as it is. Nothing is written before it.
 *
 * WHO PASSES. Staff uploading (`role = 'admin'`); a file that counts to a
 * staff account (no allowance, D1167); a negotiated plan (its allowance is
 * not a number we hold); and a venture whose files count to no member. When
 * the plan or the stored bytes cannot be read, the upload also passes: a read
 * failure of ours never refuses a member's file. Each pass is counted in the
 * log by its reason, never with a name, key or figure.
 *
 * NEVER DELETE, HIDE OR CUT (#2449 owner questions 4 and 5, A). The guard
 * only refuses a new write. Reading, downloading and every stored file are
 * untouched; Record a Session checks once, at its start, and a session in
 * progress is never cut.
 *
 * THE NOTICES. After the write lands, `noteStorageLanded(env, ticket)` sends
 * one in-app notice for each crossing of 80%, 95% and 100% of the allowance:
 * a threshold the bytes before this file were under and the bytes after it
 * reach. The crossing itself is the record, so no ledger is kept: going back
 * under a threshold (a plan upgrade) and up again is a new crossing. Only the
 * highest threshold crossed by one file is sent.
 */
import type { Env, User } from '../types';
import { storagePlan, storagePlanKey, STORAGE_GB } from './storagePlans';
import { storageUsedBytes } from './storageUsage';

export const STORAGE_THRESHOLDS = [80, 95, 100] as const;
export type StorageThreshold = typeof STORAGE_THRESHOLDS[number];

/** Whose plan a file counts to: a member, or a venture (its owner, by D1169's rule). */
export type StorageOwner = { userId: number } | { projectId: number };

export type StorageTicket = {
  /** The member the file counts to, or null when the upload passed unweighed. */
  ownerId: number | null;
  used: number | null;
  allowance: number | null;
  incoming: number;
  passed: 'measured' | 'staff' | 'no_allowance' | 'negotiated' | 'no_owner' | 'unreadable';
};

/** The one member a venture's files count to, by `storageUsage.ts`'s `VENTURE_OWNERS` rule. */
export async function ventureStorageOwner(env: Env, projectId: number): Promise<number | null> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(
       (SELECT l2.user_id FROM user_company_links l2 WHERE l2.company_id = p.company_id AND l2.is_primary_admin = 1
         ORDER BY l2.created_at, l2.id LIMIT 1),
       (SELECT MIN(u.id) FROM users u WHERE u.founder_id = p.founder_id)) AS user_id
     FROM projects p WHERE p.id = ?`,
  ).bind(projectId).first<{ user_id: number | null }>();
  const id = Number(row?.user_id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** "1.5 GB", "240 MB": binary units, as the catalogue counts them (1 GB = 1,024 MB). */
export function storageText(bytes: number): string {
  const mb = 1024 ** 2;
  if (bytes >= STORAGE_GB) return `${Number((bytes / STORAGE_GB).toFixed(bytes % STORAGE_GB === 0 ? 0 : 1))} GB`;
  if (bytes >= mb) return `${Math.max(1, Math.round(bytes / mb))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const pass = (passed: StorageTicket['passed'], incoming: number, ownerId: number | null = null): StorageTicket =>
  ({ ownerId, used: null, allowance: null, incoming, passed });

/** The refusal's body: the one shape every member upload answers with. */
export function storageFullBody(a: { used: number; allowance: number; incoming: number; planKey: string; yours: boolean }) {
  const left = Math.max(0, a.allowance - a.used);
  const whose = a.yours ? 'your storage plan' : 'the storage plan of the company owner it counts to';
  return {
    error: 'storage_full',
    message: a.used >= a.allowance
      ? `There is no room for this file. It counts to ${whose}, which is full. Nothing was saved, and every stored file is unchanged.`
      : `There is no room for this file. It is ${storageText(a.incoming)} and ${whose} has ${storageText(left)} left. Nothing was saved, and every stored file is unchanged.`,
    used_bytes: a.used,
    allowance_bytes: a.allowance,
    incoming_bytes: a.incoming,
    plan_key: a.planKey,
    counts_to: a.yours ? 'you' : 'company_owner',
  };
}

/**
 * Refuse a write that would not fit, before anything is stored. Returns the
 * ticket `noteStorageLanded` takes once the write lands. `incomingBytes` is
 * the file's size; a size the route cannot know yet (a session's start) is 0,
 * which refuses only a plan already full.
 */
export async function assertStorageRoom(
  env: Env, owner: StorageOwner, incomingBytes: number, caller: { id: number; role?: string | null } | null,
): Promise<StorageTicket> {
  const incoming = Number.isSafeInteger(incomingBytes) && incomingBytes > 0 ? incomingBytes : 0;
  // A writer that knows only the caller's id: their role is read, so staff still pass.
  let role = caller?.role ?? null;
  if (role == null && caller && Number.isSafeInteger(caller.id) && caller.id > 0) {
    role = (await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(caller.id).first<{ role: string }>().catch(() => null))?.role ?? null;
  }
  if (String(role ?? '').toLowerCase() === 'admin') return pass('staff', incoming);
  let ownerId: number | null;
  try {
    ownerId = 'userId' in owner ? owner.userId : await ventureStorageOwner(env, owner.projectId);
  } catch {
    console.warn('[storage-room] pass: owner unreadable');
    return pass('unreadable', incoming);
  }
  if (ownerId === null) return pass('no_owner', incoming);

  let member: User | null;
  try {
    member = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(ownerId).first<User>();
  } catch {
    console.warn('[storage-room] pass: owner unreadable');
    return pass('unreadable', incoming, ownerId);
  }
  if (!member) return pass('no_owner', incoming);
  if (String(member.role).toLowerCase() === 'admin') return pass('no_allowance', incoming, ownerId);

  let planKey: string;
  try { planKey = await storagePlanKey(env, member); } catch {
    console.warn('[storage-room] pass: plan unreadable');
    return pass('unreadable', incoming, ownerId);
  }
  const allowance = storagePlan(planKey)?.allowance_bytes ?? null;
  if (allowance === null) return pass(planKey === 'admin' ? 'no_allowance' : 'negotiated', incoming, ownerId);

  const used = await storageUsedBytes(env, ownerId).catch(() => null);
  if (used === null) {
    console.warn('[storage-room] pass: stored bytes unreadable');
    return pass('unreadable', incoming, ownerId);
  }
  if (used.measured_bytes + incoming > allowance || (incoming === 0 && used.measured_bytes >= allowance)) {
    console.log('[storage-room] refused: storage_full');
    throw new Response(JSON.stringify(storageFullBody({
      used: used.measured_bytes, allowance, incoming, planKey, yours: Number(caller?.id) === ownerId,
    })), { status: 413, headers: { 'Content-Type': 'application/json' } });
  }
  return { ownerId, used: used.measured_bytes, allowance, incoming, passed: 'measured' };
}

/** The thresholds this file crossed: under before it, reached with it. */
export function crossed(before: number, after: number, allowance: number): StorageThreshold[] {
  if (!(allowance > 0) || after <= before) return [];
  return STORAGE_THRESHOLDS.filter((t) => before * 100 < allowance * t && after * 100 >= allowance * t);
}

/**
 * After the write: one in-app notice to the member the file counts to, for
 * the highest threshold it crossed. Never throws; a notice that cannot be
 * sent never undoes a stored file.
 */
export async function noteStorageLanded(env: Env, ticket: StorageTicket): Promise<StorageThreshold | null> {
  try {
    if (ticket.passed !== 'measured' || ticket.ownerId === null || ticket.used === null || ticket.allowance === null) return null;
    const passedNow = crossed(ticket.used, ticket.used + ticket.incoming, ticket.allowance);
    const top = passedNow.length ? passedNow[passedNow.length - 1] : null;
    if (top === null) return null;
    const { notify } = await import('./notify');
    const of = storageText(ticket.allowance);
    await notify(env, {
      userId: ticket.ownerId, type: 'storage_threshold', category: 'billing', channels: ['in_app'],
      title: top === 100 ? `Your storage is full: ${of} used` : `You have used ${top}% of your ${of} of storage`,
      body: top === 100
        ? 'New uploads are paused until there is room. Every stored file stays readable and downloadable.'
        : 'Nothing changes yet. New uploads pause when the storage is full; stored files are never removed.',
      link: '/account/usage/storage',
      payload: { threshold: top, allowance_bytes: ticket.allowance },
    });
    console.log('[storage-room] notice', top);
    return top;
  } catch {
    console.warn('[storage-room] notice not sent');
    return null;
  }
}
