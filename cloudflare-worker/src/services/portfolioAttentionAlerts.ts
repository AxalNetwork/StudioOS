/**
 * D6218 (#6218): tell an investor when a company they hold turns to Attention.
 *
 * Hung off the health recompute (`routes/portfolio.ts`), the only writer of
 * health snapshots. After a snapshot is written:
 *
 *   - It must be red ("Attention", D5129's word), and the company's previous
 *     snapshot must exist and not be red. A first snapshot is not a change
 *     (the same rule as #6210's "changed at"), and a company still red on a
 *     later recompute raised its notice already.
 *   - Recipients are the company's holders only: the seat owners with a
 *     confirmed commitment on one of its deals, and the members of their seats,
 *     each kept only when `investorHeldProjectIds` (D1057, the Portfolio
 *     positions rule) includes the company for them.
 *   - `portfolio_attention_alerts` holds one row per company, holder and change
 *     (`changed_on`). The notice goes out only when that row is new, so the
 *     same snapshot never notifies twice.
 *   - A health read that failed wrote no snapshot, so nothing reaches here. A
 *     read here that fails raises nothing: the caller logs and moves on, and the
 *     recompute answers as before.
 *
 * Whether the notice is delivered, and on which channel, is `notify()`'s
 * (D4615): the member's switch for `portfolio_needs_attention` in Settings ›
 * Notifications turns it off.
 */
import type { Env, User } from '../types';
import { notify } from './notify';
import { heldLicences } from './accountLicences';
import { investorHeldProjectIds } from '../routes/_investorProjectScope';

export const ATTENTION_TYPE = 'portfolio_needs_attention';
/** D5129's state words, as Portfolio draws the badges. */
const WORD: Record<string, string> = { red: 'Attention', yellow: 'Watch', green: 'Healthy' };

type Snapshot = { uid: string; project_id: number; snapshot_date: string; score: number; badge: string };
type Project = { id: number; uid: string; name: string };

/** The investors who hold `projectId`, as user rows ready for the scope rule. */
async function holders(env: Env, projectId: number): Promise<User[]> {
  const owners = await env.DB.prepare(
    `SELECT DISTINCT t.investor_user_id AS id
       FROM commitments t JOIN deals d ON d.id = t.deal_id
      WHERE d.project_id = ? AND t.status = 'confirmed'`,
  ).bind(projectId).all<{ id: number }>();
  if (owners.success !== true) throw new Error('Holders unreadable');
  const ids = (owners.results || []).map((r) => Number(r.id)).filter(Number.isSafeInteger);
  if (!ids.length) return [];
  const rows = await env.DB.prepare(
    `SELECT id, role, is_active FROM users
      WHERE is_active = 1 AND (id IN (SELECT value FROM json_each(?))
         OR investor_seat_primary_user_id IN (SELECT value FROM json_each(?)))
      ORDER BY id`,
  ).bind(JSON.stringify(ids), JSON.stringify(ids)).all<{ id: number; role: string | null; is_active: number }>();
  if (rows.success !== true) throw new Error('Holders unreadable');
  const out: User[] = [];
  for (const row of rows.results || []) {
    const user = { ...row, licences: await heldLicences(env.DB, { id: row.id, role: row.role } as any) } as unknown as User;
    const held = await investorHeldProjectIds(env, user, null);
    if (held && held.includes(projectId)) out.push(user);
  }
  return out;
}

/**
 * Raise the Attention notice for a snapshot just written. Returns how many
 * notices were raised (new ledger rows). Throws on a failed read; the caller
 * catches, so a recompute never fails because of an alert.
 */
export async function raiseAttentionAlerts(env: Env, project: Project, snap: Snapshot): Promise<number> {
  if (snap.badge !== 'red') return 0;
  const previous = await env.DB.prepare(
    `SELECT snapshot_date, score, badge FROM portfolio_health_snapshots
      WHERE project_id = ? AND snapshot_date < ? ORDER BY snapshot_date DESC LIMIT 1`,
  ).bind(project.id, snap.snapshot_date).first<{ snapshot_date: string; score: number; badge: string }>();
  if (!previous || previous.badge === 'red') return 0;
  const recipients = await holders(env, project.id);
  let raised = 0;
  for (const user of recipients) {
    const row = await env.DB.prepare(
      `INSERT OR IGNORE INTO portfolio_attention_alerts (project_id, user_id, changed_on, snapshot_uid) VALUES (?, ?, ?, ?)`,
    ).bind(project.id, (user as any).id, snap.snapshot_date, snap.uid).run();
    if (Number(row?.meta?.changes || 0) !== 1) continue;
    raised += 1;
    await notify(env, {
      userId: Number((user as any).id),
      type: ATTENTION_TYPE,
      category: 'scoring',
      channels: ['in_app', 'email'],
      title: `${project.name} needs attention`,
      body: `Health turned to Attention on ${snap.snapshot_date}: score ${snap.score}, from ${WORD[previous.badge] ?? previous.badge} (${previous.score}) on ${previous.snapshot_date}. Source: Health.`,
      link: `/portfolio/companies/${project.uid}`,
      payload: { project_uid: project.uid, snapshot_uid: snap.uid, changed_on: snap.snapshot_date,
        previous_badge: previous.badge, previous_snapshot_date: previous.snapshot_date },
    });
  }
  return raised;
}
