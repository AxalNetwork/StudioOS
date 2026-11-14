/**
 * D4289 P2 (#4291) — attribution through an influencer's handle, separate from
 * `normaliseReferralCode` (which upper-cases and strips everything but letters
 * and digits, so it would read `axalfan` as `FAN`).
 *
 * THE REFERENCE. The `/@handle` page sets the first-touch cookie `axal_ref` to
 * `h:<handle>[:<channel>]`; `@handle` and `@handle/channel` are read the same
 * way. Anything else is a referral code, as before.
 *
 * THE WINDOW AND THE LOCK (D-e). A handle referral holds 90 days from the
 * first touch (a code still holds 30), and the first eligible referral is the
 * account's: `referral_attributions.user_id` is UNIQUE, and an INSERT OR
 * IGNORE never replaces it.
 *
 * FRAUD (D-k). Refused at once, with a row in HQ's review queue
 * (`influencer_referral_flags`):
 *   - self_account       the influencer referring their own account;
 *   - self_email_domain  the same email domain, unless it is a public mail
 *                        provider (everyone shares gmail.com);
 *   - loop               the influencer was referred by this member (A refers
 *                        B, B refers A);
 *   - self_card          at checkout, the same card fingerprint as one of the
 *                        influencer's own saved cards (`selfCardRefusal`).
 * Held for HQ: a sign-up past the handle's daily cap (`velocity`) is recorded
 * `flagged`, and checkout stamps no referrer until HQ clears it.
 */
import type { Env } from '../../types';
import { CHANNEL_SHAPE, HANDLE_SHAPE } from '../influencerHandles';

export const HANDLE_WINDOW_DAYS = 90;
/** Sign-ups through one handle in one UTC day before the next is held for HQ. INFLUENCER_HANDLE_DAILY_CAP overrides it. */
export const HANDLE_DAILY_CAP_DEFAULT = 25;
const DAY_MS = 86_400_000;

/** Public mail providers: a shared domain there says nothing about who owns the account. */
export const PUBLIC_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com', 'icloud.com',
  'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'web.de', 'mail.com', 'zoho.com',
  'yandex.com', 'yandex.ru', 'qq.com', '163.com', 'fastmail.com', 'hey.com', 'tutanota.com', 'orange.fr', 'free.fr', 'laposte.net',
]);

export type HandleRef = { handle: string; channel: string | null };

/** `h:jane`, `h:jane:yt`, `@jane`, `@jane/yt` (any case) → the handle reference; anything else → null. */
export function parseHandleRef(raw: unknown): HandleRef | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  let rest: string;
  if (v.startsWith('h:')) rest = v.slice(2).replace(':', '/');
  else if (v.startsWith('@')) rest = v.slice(1);
  else return null;
  const [handle, channel, extra] = rest.split('/');
  if (extra !== undefined || !HANDLE_SHAPE.test(handle || '')) return null;
  if (channel !== undefined && !CHANNEL_SHAPE.test(channel)) return null;
  return { handle, channel: channel ?? null };
}

export const refValue = (r: HandleRef) => `h:${r.handle}${r.channel ? `:${r.channel}` : ''}`;
const sqlTime = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const domainOf = (email: unknown) => String(email || '').trim().toLowerCase().split('@')[1] || '';
const dailyCap = (env: Env) => {
  const n = Number((env as any).INFLUENCER_HANDLE_DAILY_CAP);
  return Number.isSafeInteger(n) && n > 0 ? n : HANDLE_DAILY_CAP_DEFAULT;
};

type Live = { influencer_id: number; user_id: number; handle: string; channel: string | null };

/** The active influencer behind a handle reference (a channel that is not live reads as the handle), or null. */
export async function liveHandle(env: Env, ref: HandleRef): Promise<Live | null> {
  const m = await env.DB.prepare("SELECT id, user_id, handle FROM influencers WHERE handle = ? AND status = 'active'").bind(ref.handle).first<{ id: number; user_id: number; handle: string }>();
  if (!m) return null;
  let channel: string | null = null;
  if (ref.channel) {
    const l = await env.DB.prepare('SELECT channel FROM influencer_links WHERE influencer_id = ? AND channel = ? AND archived_at IS NULL').bind(m.id, ref.channel).first<{ channel: string }>();
    channel = l ? l.channel : null;
  }
  return { influencer_id: Number(m.id), user_id: Number(m.user_id), handle: m.handle, channel };
}

export type FraudReason = 'self_account' | 'self_email_domain' | 'loop' | 'self_card' | 'velocity';

/** Why a referral by `referrerId` of `memberId` is refused, or null when it may stand. */
export async function selfReferralReason(env: Env, referrerId: number, memberId: number): Promise<FraudReason | null> {
  if (referrerId === memberId) return 'self_account';
  const r = await env.DB.prepare(
    `SELECT (SELECT email FROM users WHERE id = ?1) AS ref_email, (SELECT email FROM users WHERE id = ?2) AS member_email,
            EXISTS (SELECT 1 FROM referrals WHERE referrer_id = ?2 AND referred_id = ?1)
              OR EXISTS (SELECT 1 FROM referral_attributions WHERE referrer_user_id = ?2 AND user_id = ?1 AND status <> 'refused') AS loop`,
  ).bind(referrerId, memberId).first<{ ref_email: string | null; member_email: string | null; loop: number }>();
  if (Number(r?.loop) === 1) return 'loop';
  const a = domainOf(r?.ref_email), b = domainOf(r?.member_email);
  if (a && a === b && !PUBLIC_MAIL_DOMAINS.has(a)) return 'self_email_domain';
  return null;
}

const flagStatement = (env: Env, live: Live, memberId: number, reason: FraudReason, outcome: 'refused' | 'held', at: string) =>
  env.DB.prepare(
    `INSERT INTO influencer_referral_flags (uid, influencer_id, referred_user_id, reason, outcome, handle, channel, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(`irf_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`, live.influencer_id, memberId, reason, outcome, live.handle, live.channel, at);

export type HandleAttach = { attached: boolean; status?: 'active' | 'flagged'; reason?: FraudReason | 'not_live' | 'already_attributed' };

/**
 * Attributes `memberId` to the handle `ref` refers to: the first eligible
 * referral, for 90 days. On a new account it also writes the `referrals` row
 * the code path writes, so Refer & Earn counts the sign-up. Never throws:
 * attribution must never block a sign-up or a purchase.
 */
export async function attachHandleReferral(env: Env, memberId: number, ref: HandleRef, opts: { signup: boolean; now?: number } = { signup: true }): Promise<HandleAttach> {
  const now = opts.now ?? Date.now();
  try {
    const live = await liveHandle(env, ref);
    if (!live) return { attached: false, reason: 'not_live' };
    const existing = await env.DB.prepare('SELECT status FROM referral_attributions WHERE user_id = ?').bind(memberId).first<{ status: string }>();
    if (existing) return { attached: false, reason: 'already_attributed' };
    const at = sqlTime(now);
    const fraud = await selfReferralReason(env, live.user_id, memberId);
    if (fraud) {
      // The self-account case never gets a row: it is not a referral at all.
      if (fraud !== 'self_account') await flagStatement(env, live, memberId, fraud, 'refused', at).run();
      return { attached: false, reason: fraud };
    }
    const today = at.slice(0, 10);
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM referral_attributions WHERE referrer_user_id = ? AND source = 'handle' AND substr(first_touch_at, 1, 10) = ?`,
    ).bind(live.user_id, today).first<{ n: number }>();
    const status: 'active' | 'flagged' = Number(count?.n ?? 0) >= dailyCap(env) ? 'flagged' : 'active';
    const value = refValue({ handle: live.handle, channel: live.channel });
    const stmts: D1PreparedStatement[] = [
      env.DB.prepare(
        `INSERT OR IGNORE INTO referral_attributions (user_id, referral_code, referrer_user_id, first_touch_at, expires_at, source, handle, channel, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'handle', ?, ?, ?, ?)`,
      ).bind(memberId, value, live.user_id, at, sqlTime(now + HANDLE_WINDOW_DAYS * DAY_MS), live.handle, live.channel, status, at),
    ];
    if (status === 'flagged') stmts.push(flagStatement(env, live, memberId, 'velocity', 'held', at));
    if (opts.signup) {
      stmts.push(env.DB.prepare(
        `INSERT OR IGNORE INTO referrals (referrer_id, referred_id, referral_code, status, created_at) VALUES (?, ?, ?, 'pending', ?)`,
      ).bind(live.user_id, memberId, value, at));
    }
    const out = await env.DB.batch(stmts);
    if (!Number(out[0]?.meta?.changes)) return { attached: false, reason: 'already_attributed' };
    if (opts.signup) {
      try {
        const { buildReferralChain } = await import('../../routes/networkfx');
        await buildReferralChain(env, memberId, live.user_id);
      } catch (e) { console.warn('[handleAttribution] referral chain not built', (e as Error)?.message); }
    }
    return { attached: true, status };
  } catch (e) {
    console.warn('[handleAttribution] attach failed', (e as Error)?.message);
    return { attached: false };
  }
}

export type ActiveAttribution = { referrer_user_id: number; source: 'code' | 'handle'; handle: string | null; channel: string | null; referral_code: string };

/** The member's attribution checkout may stamp: active (not flagged or refused), not expired, not their own. */
export async function activeAttribution(env: Env, memberId: number, now = Date.now()): Promise<ActiveAttribution | null> {
  try {
    const r = await env.DB.prepare(
      `SELECT referrer_user_id, source, handle, channel, referral_code FROM referral_attributions
        WHERE user_id = ? AND referrer_user_id <> ? AND status = 'active' AND datetime(expires_at) > datetime(?)`,
    ).bind(memberId, memberId, sqlTime(now)).first<any>();
    if (!r) return null;
    return {
      referrer_user_id: Number(r.referrer_user_id), source: r.source === 'handle' ? 'handle' : 'code',
      handle: r.handle ?? null, channel: r.channel ?? null, referral_code: String(r.referral_code),
    };
  } catch { return null; }
}

/** The Stripe subscription metadata a referred plan carries (P3 reads these keys exactly). */
export function referralMetadata(a: ActiveAttribution | null): Record<string, string> {
  if (!a) return {};
  return {
    'metadata[referrer_user_id]': String(a.referrer_user_id),
    'metadata[referral_source]': a.source,
    ...(a.handle ? { 'metadata[handle]': a.handle } : {}),
    ...(a.channel ? { 'metadata[channel]': a.channel } : {}),
  };
}

type Fetcher = (path: string) => Promise<any>;

/**
 * Self-referral by card (D-k): the buyer's card fingerprint against the
 * referrer's own saved cards on each of their Stripe customers. True refuses
 * the attribution (`self_card`) and records it for HQ. A read that fails says
 * nothing (false): checkout is never blocked by it.
 */
export async function selfCardRefusal(env: Env, memberId: number, a: ActiveAttribution, fingerprint: string | null | undefined, stripeGet: Fetcher, now = Date.now()): Promise<boolean> {
  if (!fingerprint) return false;
  try {
    const ref = await env.DB.prepare('SELECT stripe_customer_id, investor_stripe_customer_id FROM users WHERE id = ?').bind(a.referrer_user_id).first<any>();
    const customers = [ref?.stripe_customer_id, ref?.investor_stripe_customer_id].filter((x): x is string => typeof x === 'string' && x.startsWith('cus_'));
    for (const cus of [...new Set(customers)]) {
      const list = await stripeGet(`/customers/${encodeURIComponent(cus)}/payment_methods?type=card&limit=100`);
      if ((list?.data || []).some((pm: any) => pm?.card?.fingerprint && pm.card.fingerprint === fingerprint)) {
        const at = sqlTime(now);
        const live = await env.DB.prepare('SELECT id FROM influencers WHERE user_id = ?').bind(a.referrer_user_id).first<{ id: number }>();
        await env.DB.batch([
          env.DB.prepare("UPDATE referral_attributions SET status = 'refused', refused_reason = 'self_card' WHERE user_id = ? AND status <> 'refused'").bind(memberId),
          ...(live ? [flagStatement(env, { influencer_id: Number(live.id), user_id: a.referrer_user_id, handle: a.handle ?? '', channel: a.channel }, memberId, 'self_card', 'refused', at)] : []),
        ]);
        return true;
      }
    }
    return false;
  } catch (e) {
    console.warn('[handleAttribution] card check could not run', (e as Error)?.message);
    return false;
  }
}

/** HQ's decision on a held sign-up: clear makes the attribution active, uphold refuses it. */
export async function decideFlag(env: Env, adminId: number, uid: string, decision: 'clear' | 'uphold', reason: string, now = Date.now()) {
  const f = await env.DB.prepare('SELECT * FROM influencer_referral_flags WHERE uid = ?').bind(uid).first<any>();
  if (!f) return { status: 404 as const, code: 'flag_not_found', sentence: 'No flagged sign-up has that id.' };
  if (f.outcome !== 'held') return { status: 409 as const, code: 'flag_decided', sentence: 'Only a held sign-up is HQ\'s to decide; this one is already decided.' };
  const at = sqlTime(now);
  const outcome = decision === 'clear' ? 'cleared' : 'upheld';
  const out = await env.DB.batch([
    env.DB.prepare(`UPDATE influencer_referral_flags SET outcome = ?, decided_by = ?, decided_at = ?, decision_reason = ? WHERE id = ? AND outcome = 'held'`)
      .bind(outcome, adminId, at, reason, f.id),
    env.DB.prepare(
      `UPDATE referral_attributions SET status = ?, refused_reason = ? WHERE user_id = ? AND status = 'flagged'
         AND EXISTS (SELECT 1 FROM influencer_referral_flags WHERE id = ? AND outcome = ?)`,
    ).bind(decision === 'clear' ? 'active' : 'refused', decision === 'clear' ? null : 'velocity', f.referred_user_id, f.id, outcome),
  ]);
  if (!Number(out[0]?.meta?.changes)) return { status: 409 as const, code: 'flag_decided', sentence: 'This sign-up was decided while you were looking. Read it again.' };
  return { status: 200 as const, flag: { uid, outcome } };
}

export async function listFlags(env: Env, outcome: string, limit: number) {
  const r = await env.DB.prepare(
    `SELECT f.uid, f.reason, f.outcome, f.handle, f.channel, f.created_at, f.decided_at, f.decision_reason,
            i.uid AS influencer_uid, f.referred_user_id
       FROM influencer_referral_flags f JOIN influencers i ON i.id = f.influencer_id
      WHERE ?1 = 'all' OR f.outcome = ?1 ORDER BY f.id DESC LIMIT ?2`,
  ).bind(outcome, limit).all<any>();
  return { flags: (r.results || []).map((x) => ({ ...x, referred_user_id: Number(x.referred_user_id) })) };
}

/**
 * A new account's referral, from the body's `ref_code` or the `axal_ref`
 * cookie: a handle reference goes through `attachHandleReferral`, anything else
 * through the code path (`attachReferral`). Partner codes (PART-…) stay the
 * register route's own. Used by /register, Google sign-up and magic-link
 * sign-up, so no sign-up path drops the attribution. Never throws.
 */
export async function attachSignupReferral(env: Env, newUserId: number, raw: string | null | undefined): Promise<boolean> {
  try {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) return false;
    const ref = parseHandleRef(value);
    if (ref) return (await attachHandleReferral(env, newUserId, ref, { signup: true })).attached;
    if (value.toUpperCase().startsWith('PART-')) return false;
    const { attachReferral } = await import('../../routes/network');
    return await attachReferral(env, newUserId, value.toUpperCase());
  } catch (e) {
    console.warn('[handleAttribution] sign-up referral not attached', (e as Error)?.message);
    return false;
  }
}
