/**
 * D1342 (#3550, part 3 of #3547; the owner's option A) — Network members email
 * each other after a mutual accept, each sharing their own address
 * (migration 649, `mail_address_shares`).
 *
 * A pair is one row, opened when both sides of an introduction proposition
 * have accepted (`routes/introductions.ts`), or lazily when a member lists
 * their matches, so a pair accepted before this migration has one too. Each
 * side shares, declines or takes a share back on its own. The other member's
 * address is served only while both have shared and neither has revoked or
 * declined since, and only here: D414's rule stands everywhere else.
 *
 * A pair is named by its share uid, never a user id. Another member's uid,
 * or one that does not exist, is the same 404.
 */
import type { Env, User } from '../../types';
import { ensureIntroNetworkSchema } from '../introductions';
import { notify } from '../notify';
import { MailError } from './contextPack';

export const SHARE_NOT_FOUND = 'Match not found.';
export const MATCHED_LINE = 'You’re matched. Email needs both of you to share an address.';
const shareNotFound = () => new MailError(404, 'not_found', SHARE_NOT_FOUND);

export type SideState = 'pending' | 'shared' | 'declined' | 'revoked';

type ShareRow = {
  id: number; uid: string; user_low: number; user_high: number; source_kind: string; source_ref: string;
  low_shared_at: string | null; low_declined_at: string | null; low_revoked_at: string | null;
  high_shared_at: string | null; high_declined_at: string | null; high_revoked_at: string | null;
  created_at: string; updated_at: string;
};

const stampNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/** One side's state: a revoke wins, then a share, then a decline. Sharing again clears the other two. */
export function sideState(shared: string | null, declined: string | null, revoked: string | null): SideState {
  if (revoked) return 'revoked';
  if (shared) return 'shared';
  if (declined) return 'declined';
  return 'pending';
}

function sides(row: ShareRow, userId: number) {
  const low = Number(row.user_low) === Number(userId);
  const mine = low ? sideState(row.low_shared_at, row.low_declined_at, row.low_revoked_at) : sideState(row.high_shared_at, row.high_declined_at, row.high_revoked_at);
  const theirs = low ? sideState(row.high_shared_at, row.high_declined_at, row.high_revoked_at) : sideState(row.low_shared_at, row.low_declined_at, row.low_revoked_at);
  return { low, mine, theirs, other: Number(low ? row.user_high : row.user_low) };
}

/** Both have shared, and neither has revoked or declined since. */
export const ready = (mine: SideState, theirs: SideState) => mine === 'shared' && theirs === 'shared';

/** The pair, opened once; true when this call opened it. The caller has checked the mutual accept. */
export async function openPair(env: Env, a: number, b: number, sourceRef: string): Promise<boolean> {
  const [low, high] = a < b ? [a, b] : [b, a];
  if (low === high) return false;
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO mail_address_shares (uid, user_low, user_high, source_kind, source_ref)
     VALUES (lower(hex(randomblob(12))), ?, ?, 'introduction', ?)`,
  ).bind(low, high, sourceRef).run();
  return Number(r?.meta?.changes ?? 0) > 0;
}

/**
 * Whether these two members accepted each other's introduction: each side's
 * proposition for the other is `accepted`. The only way a pair exists.
 */
export async function mutuallyAccepted(env: Env, a: number, b: number): Promise<string | null> {
  await ensureIntroNetworkSchema(env);
  const row = await env.DB.prepare(
    `SELECT p.uid FROM intro_propositions p JOIN intro_propositions q ON q.user_id = p.target_user_id AND q.target_user_id = p.user_id
      WHERE p.user_id = ? AND p.target_user_id = ? AND p.status = 'accepted' AND q.status = 'accepted'`,
  ).bind(Math.min(a, b), Math.max(a, b)).first<{ uid: string }>();
  return row?.uid ?? null;
}

/** Open a pair for each of this member's mutual accepts that has none yet (a pair from before migration 649). No notice is sent. */
async function backfill(env: Env, userId: number): Promise<void> {
  await ensureIntroNetworkSchema(env);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO mail_address_shares (uid, user_low, user_high, source_kind, source_ref)
     SELECT lower(hex(randomblob(12))), MIN(p.user_id, p.target_user_id), MAX(p.user_id, p.target_user_id), 'introduction', p.uid
       FROM intro_propositions p JOIN intro_propositions q ON q.user_id = p.target_user_id AND q.target_user_id = p.user_id
      WHERE p.status = 'accepted' AND q.status = 'accepted' AND p.user_id < p.target_user_id
        AND (p.user_id = ? OR p.target_user_id = ?)`,
  ).bind(userId, userId).run();
}

const SELECT = `SELECT s.*, u.name AS other_name, u.display_name AS other_display_name, u.role AS other_role, u.email AS other_email
  FROM mail_address_shares s JOIN users u ON u.id = CASE WHEN s.user_low = ?1 THEN s.user_high ELSE s.user_low END`;

/** What the member sees of one pair. The other's address only when both have shared. */
function view(row: ShareRow & { other_name: string | null; other_display_name: string | null; other_role: string | null; other_email: string | null }, userId: number) {
  const s = sides(row, userId);
  const ok = ready(s.mine, s.theirs);
  const name = String(row.other_display_name || row.other_name || '').trim() || 'A member';
  return {
    uid: row.uid,
    person: `member:${row.uid}`,
    name,
    role: row.other_role ?? null,
    source: row.source_kind,
    matched_at: row.created_at,
    mine: s.mine,
    theirs: s.theirs,
    ready: ok,
    // D414: the address only while both have shared; never otherwise.
    address: ok ? String(row.other_email || '').trim().toLowerCase() || null : null,
    line: ok ? `You can email ${name}.` : s.mine === 'shared' ? `Waiting for ${name} to share their address.` : MATCHED_LINE,
  };
}
export type ShareView = ReturnType<typeof view>;

/** The member's Network matches, newest first. */
export async function listShares(env: Env, user: User): Promise<ShareView[]> {
  await backfill(env, Number(user.id));
  const { results } = await env.DB.prepare(`${SELECT} WHERE s.user_low = ?1 OR s.user_high = ?1 ORDER BY s.created_at DESC, s.id DESC`)
    .bind(Number(user.id)).all<any>();
  return (results || []).map((r: any) => view(r, Number(user.id)));
}

/** One pair this member is in, or 404. */
export async function shareOf(env: Env, user: User, uid: string): Promise<ShareView> {
  const row = await env.DB.prepare(`${SELECT} WHERE s.uid = ?2 AND (s.user_low = ?1 OR s.user_high = ?1)`)
    .bind(Number(user.id), String(uid)).first<any>();
  if (!row) throw shareNotFound();
  return view(row, Number(user.id));
}

async function rowOf(env: Env, user: User, uid: string): Promise<ShareRow> {
  const row = await env.DB.prepare('SELECT * FROM mail_address_shares WHERE uid = ? AND (user_low = ? OR user_high = ?)')
    .bind(String(uid), Number(user.id), Number(user.id)).first<ShareRow>();
  if (!row) throw shareNotFound();
  return row;
}

/**
 * `{ share: true }` shares the member's address (clearing a decline or a
 * revoke); `{ share: false }` declines. The pair must still be a mutual
 * accept. The other member is told when an address is shared with them.
 */
export async function setShare(env: Env, user: User, uid: string, share: boolean): Promise<ShareView> {
  const row = await rowOf(env, user, uid);
  if (!(await mutuallyAccepted(env, row.user_low, row.user_high))) {
    throw new MailError(409, 'not_matched', 'Email needs an introduction you both accepted.');
  }
  const low = Number(row.user_low) === Number(user.id);
  const now = stampNow();
  // Fixed statements, one per side and choice: no column name is assembled.
  const sql = low
    ? (share ? 'UPDATE mail_address_shares SET low_shared_at = ?, low_declined_at = NULL, low_revoked_at = NULL, updated_at = ? WHERE id = ?'
      : 'UPDATE mail_address_shares SET low_declined_at = ?, low_shared_at = NULL, low_revoked_at = NULL, updated_at = ? WHERE id = ?')
    : (share ? 'UPDATE mail_address_shares SET high_shared_at = ?, high_declined_at = NULL, high_revoked_at = NULL, updated_at = ? WHERE id = ?'
      : 'UPDATE mail_address_shares SET high_declined_at = ?, high_shared_at = NULL, high_revoked_at = NULL, updated_at = ? WHERE id = ?');
  await env.DB.prepare(sql).bind(now, now, row.id).run();
  const after = await shareOf(env, user, uid);
  if (share) {
    const other = Number(low ? row.user_high : row.user_low);
    const me = String((user as any).display_name || user.name || '').trim() || 'Your match';
    try {
      await notify(env, {
        userId: other, type: 'mail_share_shared', category: 'proactive_nudges', channels: ['in_app'], link: '/email',
        title: after.ready ? `You can now email ${me}` : `${me} shared their email address with you`,
        body: after.ready ? 'You have both shared your addresses. Email opens from their row.' : 'Share yours to email each other.',
        payload: { share_uid: uid },
      });
    } catch { /* best-effort, as every notice */ }
  }
  return after;
}

/** Take a share back: the address is hidden from the other member at once. Only a shared side can. */
export async function revokeShare(env: Env, user: User, uid: string): Promise<ShareView> {
  const row = await rowOf(env, user, uid);
  const low = Number(row.user_low) === Number(user.id);
  const now = stampNow();
  const r = await env.DB.prepare(low
    ? 'UPDATE mail_address_shares SET low_revoked_at = ?, updated_at = ? WHERE id = ? AND low_shared_at IS NOT NULL AND low_revoked_at IS NULL'
    : 'UPDATE mail_address_shares SET high_revoked_at = ?, updated_at = ? WHERE id = ? AND high_shared_at IS NOT NULL AND high_revoked_at IS NULL',
  ).bind(now, now, row.id).run();
  if (Number(r?.meta?.changes ?? 0) === 0) throw new MailError(409, 'not_shared', 'You have not shared your address with this match.');
  return shareOf(env, user, uid);
}

/** A mutual accept just completed: open the pair and ask both members, best-effort. */
export async function askBoth(env: Env, a: { id: number; name: string }, b: { id: number; name: string }, sourceRef: string): Promise<void> {
  if (!(await openPair(env, a.id, b.id, sourceRef))) return;
  for (const [to, other] of [[a, b], [b, a]] as const) {
    try {
      await notify(env, {
        userId: to.id, type: 'mail_share_request', category: 'proactive_nudges', channels: ['in_app'], link: '/email',
        title: `Share your email address with ${other.name}?`, body: MATCHED_LINE, payload: {},
      });
    } catch { /* best-effort */ }
  }
}
