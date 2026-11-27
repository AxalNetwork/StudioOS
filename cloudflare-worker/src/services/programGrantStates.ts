/**
 * D956 (#2789, part 3 of #2371) — what each viewer reads of a program's grant:
 * the `grant` field on the Programs catalogue's rows and on `/:key`
 * (`routes/admin_programs.ts`), keyed to the canvas's Admin-view words
 * (`dc:324`; #2376 uses the same ones, PROGRAMS_MAP §6.2).
 *
 * WHO READS WHAT (`grantViewerOf`):
 *   - a Super Admin reads `granted_to`, with `granted_count` (the licences
 *     holding it `granted`), or `hq_only` for a program HQ cannot grant
 *     (`dc:341-349`, `dc:351`);
 *   - an Admin bound to a licence (`licence_admins`) whose studio is deployed
 *     reads that licence's state: `granted` ("Granted to your studio", with
 *     `in_force`), `requested` (an open `program_grant` request, D983, with its
 *     `since`), `paused` ("Paused by HQ"), `ended`, `not_granted`, `runs_at_hq`
 *     for Product testing, and `not_offered` for a program that cannot be
 *     granted. A draft (migration 562) reads `not_granted`: it is HQ's;
 *   - an admin bound to no licence reads the held mode, as S-HELD reads it
 *     today (D953): `hq_held`, `not_offered` and `runs_at_hq`;
 *   - so does a licence administrator on HQ whose studio is not deployed,
 *     until #2376's owner decision 1 is answered (does a grant limit what they
 *     may do on HQ-held accounts, or only what their studio runs once
 *     deployed). "Deployed" is `DEPLOYED_STATUSES`, Insights' rule;
 *   - on a branch the state is the licence's, read from D984's dated copy
 *     (`branch_licence.program_grants_json`, migration 554) and the branch's own
 *     open requests to HQ (`branch_escalations`). A copy HQ has not sent yet is
 *     unreadable, never `not_granted`.
 *
 * `nothing_granted` is true when a viewer reading a licence's state holds no
 * `granted` row (PG16a, `dc:486`), and false for every other viewer.
 *
 * A FAILED READ IS UNREADABLE, with its reason, never a state: the whole grant
 * block is `{ available: false, unreadable: true, reason }`.
 *
 * OFFER TO STUDIOS (PG13s, `dc:495`; `offerToStudios`) writes D982's "can be
 * granted" switch (`program_grant_defaults.grantable`); there is no second
 * flag. Switching it on needs, in order: not Product testing (409
 * `runs_at_hq`), a program that is built (409 `not_built`), a published
 * playbook (409 `not_published`: AI-native Venture's draft says "When HQ
 * publishes it, you can request it.", `dc:458`), and D982's readiness (409
 * `not_grantable`). `offerRefusal` is that rule, and D982's own defaults write
 * applies it too, so the switch has one rule whichever page flips it. Switching
 * it off leaves every grant as it is, and the answer counts them. Only the
 * nine carry defaults, so a program D955 added is 409 `not_offerable`.
 */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { DEPLOYED_STATUSES } from './insightsScope';
import { logAdminAction } from './adminAudit';
import { presentGrant, programOf, readDefaults, readinessRefusal, type LicenceLite } from './programGrants';
import { ProgramError, programByKey, type Actor } from './programRegistry';
import { parseProgramCopy } from './licencePrograms';
import { requestIn } from './programRequests';

export type GrantViewer =
  | { mode: 'super_admin' }
  | { mode: 'held'; why: 'no_licence' | 'not_deployed' }
  | { mode: 'licence'; licence: LicenceLite; deploymentCode: string }
  | { mode: 'branch' };

export const HELD_STATES = ['hq_held', 'not_offered', 'runs_at_hq'] as const;
export const LICENCE_STATES = ['granted', 'requested', 'paused', 'ended', 'not_granted', 'runs_at_hq', 'not_offered'] as const;
export const SUPER_ADMIN_STATES = ['granted_to', 'hq_only'] as const;

export type GrantField =
  | { state: typeof HELD_STATES[number] }
  | { state: typeof LICENCE_STATES[number]; in_force?: boolean; since?: string | null }
  | { state: typeof SUPER_ADMIN_STATES[number]; granted_count: number | null };

export type GrantRead =
  | { available: true; viewer: GrantViewer['mode']; held_because: string | null; nothing_granted: boolean; states: Record<string, GrantField> }
  | { available: false; unreadable: true; reason: string };

export const NO_COPY_REASON =
  'HQ has not sent this branch its programs yet, so no grant can be read. That is not the same as not granted.';
export const GRANTS_UNREADABLE = 'Program grants could not be read. That is not the same as not granted.';

const LICENCE_SELECT = `SELECT l.id, l.uid, l.licence_ref, l.brand_name, l.kind, l.status, l.renews_on
   FROM licence_admins la JOIN territory_licences l ON l.id = la.licence_id
  WHERE la.user_id = ? ORDER BY la.licence_id LIMIT 1`;

/** Which grant answer `user` reads, on this deployment. */
export async function grantViewerOf(env: Env, user: { id: number; superAdmin: boolean }): Promise<GrantViewer> {
  if (branchOf(env)) return { mode: 'branch' };
  if (user.superAdmin) return { mode: 'super_admin' };
  const licence = await env.DB.prepare(LICENCE_SELECT).bind(user.id).first<LicenceLite>();
  if (!licence) return { mode: 'held', why: 'no_licence' };
  const d = await env.DB.prepare(
    `SELECT code FROM licence_deployments WHERE licence_uid = ? AND status IN (?, ?, ?)`,
  ).bind(licence.uid, ...DEPLOYED_STATUSES).first<{ code: string }>();
  if (!d) return { mode: 'held', why: 'not_deployed' };
  return { mode: 'licence', licence, deploymentCode: d.code };
}

const HELD_BECAUSE = {
  no_licence: 'Your account is not linked to a licence. On HQ-held accounts, HQ runs every program.',
  not_deployed: 'Your studio is not deployed yet, so you read programs as HQ-held accounts do.',
} as const;

/** Whether HQ grants a program at all: one of the nine, ready, and switched on. A program D955 added is not offered. */
async function offeredMap(env: Env): Promise<Record<string, boolean>> {
  return Object.fromEntries((await readDefaults(env)).map((d) => [d.program_key, d.grantable]));
}

/** The open `program_grant` requests' programs, each with its oldest date. */
function requestedSince(rows: Array<{ detail: string | null; created_at: string }>) {
  const out = new Map<string, string>();
  for (const r of rows) {
    const program = requestIn(r.detail)?.program;
    if (typeof program !== 'string') continue;
    const prev = out.get(program);
    if (!prev || r.created_at < prev) out.set(program, r.created_at);
  }
  return out;
}

function licenceState(
  key: string, row: Record<string, any> | undefined, requested: Map<string, string>,
  offered: Record<string, boolean>, licence: LicenceLite, today: string,
): GrantField {
  if (programOf(key)?.readiness === 'hq') return { state: 'runs_at_hq' };
  if (row?.state === 'granted') return { state: 'granted', in_force: presentGrant(row, licence, today).in_force };
  if (row?.state === 'paused') return { state: 'paused' };
  if (requested.has(key)) return { state: 'requested', since: requested.get(key) ?? null };
  if (row?.state === 'ended') return { state: 'ended' };
  // A draft is HQ's (D956): the studio reads Not granted until HQ grants it.
  if (row?.state === 'draft') return { state: 'not_granted' };
  return offered[key] === true ? { state: 'not_granted' } : { state: 'not_offered' };
}

function heldState(key: string, offered: Record<string, boolean>): GrantField {
  if (programOf(key)?.readiness === 'hq') return { state: 'runs_at_hq' };
  return offered[key] === true ? { state: 'hq_held' } : { state: 'not_offered' };
}

/**
 * The grant field of each program in `keys`, for `viewer`, on `today`.
 * Never throws: a failed read is the whole block unreadable.
 */
export async function grantStates(env: Env, viewer: GrantViewer, keys: string[], today: string): Promise<GrantRead> {
  try {
    if (viewer.mode === 'super_admin') {
      const offered = await offeredMap(env);
      const rows = ((await env.DB.prepare(
        `SELECT program_key, COUNT(*) AS n FROM program_grants WHERE state = 'granted' GROUP BY program_key`,
      ).all<{ program_key: string; n: number }>()).results || []);
      const count = new Map(rows.map((r) => [r.program_key, Number(r.n)]));
      const states = Object.fromEntries(keys.map((k): [string, GrantField] => {
        const nine = programOf(k);
        const hqOnly = nine ? (nine.readiness === 'hq' || offered[k] !== true) : false;
        return [k, hqOnly ? { state: 'hq_only', granted_count: null } : { state: 'granted_to', granted_count: count.get(k) ?? 0 }];
      }));
      return { available: true, viewer: viewer.mode, held_because: null, nothing_granted: false, states };
    }

    if (viewer.mode === 'held') {
      const offered = await offeredMap(env);
      const states = Object.fromEntries(keys.map((k) => [k, heldState(k, offered)]));
      return { available: true, viewer: viewer.mode, held_because: HELD_BECAUSE[viewer.why], nothing_granted: false, states };
    }

    let licence: LicenceLite;
    let rows: Array<Record<string, any>>;
    let offered: Record<string, boolean>;
    let requests: Array<{ detail: string | null; created_at: string }>;
    if (viewer.mode === 'licence') {
      licence = viewer.licence;
      rows = ((await env.DB.prepare('SELECT * FROM program_grants WHERE licence_id = ?').bind(licence.id)
        .all<Record<string, any>>()).results || []);
      offered = await offeredMap(env);
      requests = ((await env.DB.prepare(
        `SELECT detail, created_at FROM hq_escalations
          WHERE kind = 'program_grant' AND status = 'open'
            AND ((branch_code = 'hq' AND subject_ref = ?) OR branch_code = ?)`,
      ).bind(licence.uid, viewer.deploymentCode).all<{ detail: string | null; created_at: string }>()).results || []);
    } else {
      const copy = await env.DB.prepare(
        'SELECT licence_uid, licence_ref, brand_name, kind, status, renewal_at, program_grants_json FROM branch_licence WHERE id = 1',
      ).first<Record<string, any>>();
      if (!copy || copy.program_grants_json == null) return { available: false, unreadable: true, reason: NO_COPY_REASON };
      const parsed = parseProgramCopy(String(copy.program_grants_json));
      if (!parsed) throw new Error('branch_licence.program_grants_json is not a program copy');
      licence = {
        id: 0, uid: String(copy.licence_uid), licence_ref: copy.licence_ref ?? null, brand_name: copy.brand_name ?? null,
        kind: copy.kind ?? null, status: String(copy.status), renews_on: copy.renewal_at ?? null,
      };
      rows = parsed.grants as Array<Record<string, any>>;
      offered = parsed.offered;
      requests = ((await env.DB.prepare(
        `SELECT detail, created_at FROM branch_escalations WHERE kind = 'program_grant' AND status = 'open'`,
      ).all<{ detail: string | null; created_at: string }>()).results || []);
    }
    const byKey = new Map(rows.map((r) => [String(r.program_key), r]));
    const requested = requestedSince(requests);
    const states = Object.fromEntries(keys.map((k) => [k, licenceState(k, byKey.get(k), requested, offered, licence, today)]));
    return {
      available: true, viewer: viewer.mode, held_because: null,
      nothing_granted: !rows.some((r) => r.state === 'granted'),
      states,
    };
  } catch (e) {
    console.error('[program-grant-states]', (e as Error)?.message);
    return { available: false, unreadable: true, reason: GRANTS_UNREADABLE };
  }
}

/** One program's field from a read, or the read's own unreadable answer. */
export function grantFieldOf(read: GrantRead, key: string) {
  return read.available ? (read.states[key] ?? null) : { available: false as const, unreadable: true as const, reason: read.reason };
}

// ---------------------------------------------------------------------------
// Offer to studios
// ---------------------------------------------------------------------------

/** The admin audit action Offer to studios writes; every program's Activity lists it (`programActivity.ts`). */
export const GRANT_ACTIONS = { offer: 'program.grant.offer', defaults: 'program_grant_defaults_changed' } as const;

export const OFFER_REASON_MIN = 10;

export const OFFER_REFUSALS = {
  runs_at_hq: 'Product testing runs at HQ, so it is not offered to studios.',
  not_built: 'This program is not built yet, so it cannot be offered to studios.',
  not_published: 'Publish this program\'s playbook first. Studios ask for a program by what its playbook says.',
  not_offerable: 'Only the nine programs carry HQ\'s grant terms, so a program added later cannot be offered to studios yet.',
} as const;

/** Why `key` cannot be switched on, or null. The one rule for the switch (D956). */
export async function offerRefusal(env: Env, key: string): Promise<{ code: string; message: string } | null> {
  const nine = programOf(key);
  if (!nine) return { code: 'not_offerable', message: OFFER_REFUSALS.not_offerable };
  if (nine.readiness === 'hq') return { code: 'runs_at_hq', message: OFFER_REFUSALS.runs_at_hq };
  const row = await env.DB.prepare('SELECT status FROM programs WHERE key = ?').bind(key).first<{ status: string }>();
  if (row?.status === 'not_built') return { code: 'not_built', message: OFFER_REFUSALS.not_built };
  const published = await env.DB.prepare('SELECT 1 AS n FROM program_playbook_versions WHERE program_key = ? LIMIT 1')
    .bind(key).first<{ n: number }>();
  if (!published) return { code: 'not_published', message: OFFER_REFUSALS.not_published };
  const notReady = readinessRefusal(key);
  if (notReady) return { code: 'not_grantable', message: notReady };
  return null;
}

/**
 * PUT /api/admin/programs/:key/grantable — `{ grantable, reason }`, after the
 * route's `requireSuperAdminWriteBar`. Audited as `program.grant.offer`.
 */
export async function offerToStudios(env: Env, key: string, body: unknown, actor: Actor) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  if (typeof b.grantable !== 'boolean') throw new ProgramError(400, 'bad_grantable', 'grantable must be true or false.');
  const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) : '';
  if (reason.length < OFFER_REASON_MIN) {
    throw new ProgramError(400, 'reason_required', `Say why, in at least ${OFFER_REASON_MIN} characters. It is the line HQ's record keeps.`);
  }
  const p = await programByKey(env, key);
  if (!programOf(p.key)) throw new ProgramError(409, 'not_offerable', OFFER_REFUSALS.not_offerable);
  if (b.grantable) {
    const refused = await offerRefusal(env, p.key);
    if (refused) throw new ProgramError(409, refused.code, refused.message);
  }
  const before = await env.DB.prepare('SELECT grantable FROM program_grant_defaults WHERE program_key = ?')
    .bind(p.key).first<{ grantable: number }>();
  if (before && (Number(before.grantable) === 1) === b.grantable) {
    throw new ProgramError(400, 'no_change', b.grantable ? 'This program is already offered to studios.' : 'This program is already not offered to studios.');
  }
  await env.DB.prepare(
    `INSERT INTO program_grant_defaults (program_key, grantable, updated_by_user_id, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(program_key) DO UPDATE SET grantable = excluded.grantable, updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`,
  ).bind(p.key, b.grantable ? 1 : 0, actor.id, new Date().toISOString()).run();
  // Grants already made are not touched either way; the answer says how many stand.
  const kept = await env.DB.prepare(
    `SELECT SUM(CASE WHEN state = 'granted' THEN 1 ELSE 0 END) AS granted, SUM(CASE WHEN state = 'paused' THEN 1 ELSE 0 END) AS paused
       FROM program_grants WHERE program_key = ?`,
  ).bind(p.key).first<{ granted: number | null; paused: number | null }>();
  const grantsKept = { granted: Number(kept?.granted ?? 0), paused: Number(kept?.paused ?? 0) };
  await logAdminAction(env, actor.id, actor.email, GRANT_ACTIONS.offer, {
    program_key: p.key, grantable: b.grantable, reason, grants_kept: grantsKept,
  });
  return { program_key: p.key, grantable: b.grantable, grants_kept: grantsKept };
}
