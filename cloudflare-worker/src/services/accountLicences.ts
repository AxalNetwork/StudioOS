/** D4472 (#4472): additional licence grants, atomic audit events and the ordered access union. */
import type { Env, User } from '../types';
import { ensureRoleProfile } from './ensureRoleProfile';
import { seedObligations } from './trust';

export const LICENCE_ORDER = ['founder', 'investor', 'advisor', 'partner'] as const;
export type Licence = typeof LICENCE_ORDER[number];
export function isLicence(value: unknown): value is Licence {
  return typeof value === 'string' && (LICENCE_ORDER as readonly string[]).includes(value);
}

type Principal = { id: number; role: string; licences?: readonly string[] };

export async function heldLicences(db: D1Database, user: Pick<Principal, 'id' | 'role'>): Promise<Licence[]> {
  const primary = String(user.role || '').toLowerCase();
  let rows: D1Result<{ licence: string }>;
  try { rows = await db.prepare(
    'SELECT licence FROM account_licences WHERE user_id = ? AND revoked_at IS NULL',
  ).bind(user.id).all<{ licence: string }>();
  } catch (error) {
    // A pre-migration database has no possible grants; preserve its primary
    // access. Other read failures propagate and never manufacture a grant.
    if (/no such table: (?:main\.)?account_licences/i.test(String(error))) return LICENCE_ORDER.filter(licence => licence === primary);
    throw error;
  }
  return LICENCE_ORDER.filter(licence => licence === primary || rows.results.some(row => row.licence === licence));
}

/** Auth hydrates licences once; primary-only objects remain usable by existing pure access predicates. */
export function holdsLicence(user: { role?: string | null; licences?: readonly string[] }, licence: Licence): boolean {
  return user.licences ? user.licences.includes(licence) : String(user.role || '').toLowerCase() === licence;
}

/** An exclusive-role restriction must not remove another licence's access. */
export function holdsOnlyLicence(user: { role?: string | null; licences?: readonly string[] }, licence: Licence): boolean {
  return String(user.role || '').toLowerCase() !== 'admin' && holdsLicence(user, licence) && !(user.licences || []).some(held => held !== licence);
}

export class LicenceRefusal extends Error {
  code: 'invalid_licence' | 'invalid_retention' | 'not_found' | 'primary_licence';
  status: 400 | 404 | 409;
  constructor(code: LicenceRefusal['code'], status: LicenceRefusal['status']) {
    super(code);
    this.code = code; this.status = status;
  }
}
type Change = { userId: number; licence: unknown; actorId: number; source: string;
  retainPrimary?: boolean; appointmentStatements?: D1PreparedStatement[] };
async function subject(db: D1Database, change: Change): Promise<User> {
  if (!isLicence(change.licence)) throw new LicenceRefusal('invalid_licence', 400);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(change.userId).first<User>();
  if (!user) throw new LicenceRefusal('not_found', 404);
  return user;
}

export async function grantLicence(db: D1Database, change: Change): Promise<'granted' | 'already_held'> {
  if (change.retainPrimary && change.source !== 'admin_appointment') throw new LicenceRefusal('invalid_retention', 400);
  if (change.appointmentStatements && !change.retainPrimary) throw new LicenceRefusal('invalid_retention', 400);
  const user = await subject(db, change);
  if (change.retainPrimary && String(user.role).toLowerCase() !== change.licence) throw new LicenceRefusal('invalid_retention', 400);
  if (!change.retainPrimary && String(user.role).toLowerCase() === change.licence) return 'already_held';
  const { userId, licence, actorId, source } = change;
  // Both the active-row guard and the event are decided inside one transaction.
  // changes() refers to the immediately preceding insert/upsert, so retries
  // (including concurrent ones) never append a second grant event.
  // A stale retained primary violates the existing NOT NULL constraint inside
  // this transaction, rolling back the appointment's binding and audit too.
  const statements = [
    db.prepare(`INSERT INTO account_licences (user_id, licence, source, granted_by)
      SELECT ?, CASE WHEN ? = 1 AND NOT EXISTS
        (SELECT 1 FROM users WHERE id = ? AND lower(role) = ?)
        THEN NULL ELSE ? END, ?, ?
      WHERE ? = 1 OR EXISTS (SELECT 1 FROM users WHERE id = ? AND lower(role) <> ?)
      ON CONFLICT(user_id, licence) DO UPDATE SET source = excluded.source,
        granted_by = excluded.granted_by, granted_at = datetime('now'), revoked_at = NULL, revoked_by = NULL
      WHERE account_licences.revoked_at IS NOT NULL`)
      .bind(userId, change.retainPrimary ? 1 : 0, userId, licence, licence, source, actorId,
        change.retainPrimary ? 1 : 0, userId, licence),
    db.prepare(`INSERT INTO account_licence_events (user_id, licence, action, actor_id, source)
      SELECT ?, ?, 'grant', ?, ? WHERE changes() = 1`).bind(userId, licence, actorId, source),
  ];
  // S1's explicit exception: preserve the old primary and appoint the admin
  // atomically. No route is allowed to run a second, separate role write.
  if (change.retainPrimary) statements.push(db.prepare(`UPDATE users SET role = 'admin'
    WHERE id = ? AND lower(role) = ? AND EXISTS (SELECT 1 FROM account_licences
      WHERE user_id = ? AND licence = ? AND revoked_at IS NULL)`)
    .bind(userId, licence, userId, licence));
  statements.push(...(change.appointmentStatements || []));
  const result = await db.batch(statements);
  if (change.retainPrimary && !result[2].meta.changes) throw new LicenceRefusal('primary_licence', 409);
  if (!result[0].meta.changes && !change.retainPrimary) return 'already_held';
  const env = { DB: db } as Env;
  await ensureRoleProfile(env, { ...user, role: licence } as User);
  try { await seedObligations(env, userId, String(licence)); }
  catch (error) { console.error('[accountLicences] trust seeding failed', error); }
  return 'granted';
}

export async function revokeLicence(db: D1Database, change: Change): Promise<'revoked' | 'not_held'> {
  const user = await subject(db, change);
  if (String(user.role).toLowerCase() === change.licence) throw new LicenceRefusal('primary_licence', 409);
  const { userId, licence, actorId, source } = change;
  const result = await db.batch([
    db.prepare(`UPDATE account_licences SET revoked_at = datetime('now'), revoked_by = ?
      WHERE user_id = ? AND licence = ? AND revoked_at IS NULL
        AND EXISTS (SELECT 1 FROM users WHERE id = ? AND lower(role) <> ?)`)
      .bind(actorId, userId, licence, userId, licence),
    db.prepare(`INSERT INTO account_licence_events (user_id, licence, action, actor_id, source)
      SELECT ?, ?, 'revoke', ?, ? WHERE changes() = 1`).bind(userId, licence, actorId, source),
  ]);
  return result[0].meta.changes ? 'revoked' : 'not_held';
}
