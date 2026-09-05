/**
 * Task #6 (W-1) — Investor introduction requests with quarterly quota.
 *
 *   POST /api/introductions/request   — investor → founder. Decrements
 *                                       investor_quota_intros_used; returns
 *                                       402 with code:'quota_intros_exhausted'
 *                                       when at cap.
 *   GET  /api/introductions/quota     — caller's current usage / cap.
 *   GET  /api/introductions/          — caller's intro history.
 *
 * The 3-way Founder/Investor/Axal NDA flow is owned by /api/trust/intro/*
 * (T3 Trust Center). This route only enforces the *paid quota* on top.
 *
 * ── Network Introductions (all user types) ─────────────────────────────────
 * The curated warm-intro surface under Network. Every authenticated user
 * (founder / investor / partner / advisor / …) receives matched propositions
 * and spends INTRODUCTION CREDITS to accept them. Backed by
 * services/introductions.ts (schema, credit ledger, scoring):
 *
 *   GET  /api/introductions/propositions           list (+ lazy generate/expire)
 *   POST /api/introductions/propositions/:uid/accept   spends 1 credit (402 when out)
 *   POST /api/introductions/propositions/:uid/decline  free
 *   GET  /api/introductions/credits                 balance breakdown
 *   GET  /api/introductions/credits/history         append-only ledger
 *   GET  /api/introductions/packs                   purchasable packs (10/100/1000)
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import type { User } from '../types';
import {
  ensureInvestorPaywallSchema,
  getIntroQuotaState,
  effectiveInvestorTier,
  type InvestorUser,
} from '../middleware/requireInvestorTier';
import {
  ensureIntroNetworkSchema,
  getIntroCreditState,
  generateIntroPropositions,
  pickSpendBucket,
  INTRO_PACKS,
} from '../services/introductions';
import { hashEmail } from '../util/hashEmail';

const introductions = new Hono<{ Bindings: Env }>();

introductions.use('*', async (c, next) => {
  await requireAuth(c);
  await ensureInvestorPaywallSchema(c.env);
  await next();
});

introductions.get('/quota', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  if (user.role !== 'investor' && user.role !== 'admin') {
    return c.json({ error: 'investor_only' }, 403);
  }
  const state = await getIntroQuotaState(c.env, user.id);
  return c.json({
    tier: state.tier,
    quarter: state.quarter,
    used: state.used,
    cap: state.cap,
    remaining: Math.max(0, state.cap - state.used),
  });
});

introductions.get('/', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  if (user.role !== 'investor' && user.role !== 'admin') {
    return c.json({ error: 'investor_only' }, 403);
  }
  const rows = await c.env.DB.prepare(
    `SELECT uid, investor_user_id, founder_user_id, founder_id, project_id,
            message, status, quarter, created_at
     FROM investor_introductions
     WHERE investor_user_id = ?
     ORDER BY created_at DESC LIMIT 200`
  ).bind(user.id).all();
  return c.json({ introductions: rows.results || [] });
});

introductions.post('/request', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  if (user.role !== 'investor') {
    return c.json({ error: 'investor_only' }, 403);
  }

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const founderUserId = body.founder_user_id != null ? Number(body.founder_user_id) : null;
  const founderId = body.founder_id != null ? Number(body.founder_id) : null;
  const projectId = body.project_id != null ? Number(body.project_id) : null;
  const message = typeof body.message === 'string' ? body.message.slice(0, 2000) : null;

  if (!founderUserId && !founderId && !projectId) {
    return c.json({ error: 'target_required', message: 'Provide founder_user_id, founder_id, or project_id' }, 400);
  }

  // Quota check — paywall gate. Free investors get 3/quarter, Pro 25, Inst 100.
  const state = await getIntroQuotaState(c.env, user.id);
  if (state.used >= state.cap) {
    return c.json(
      {
        error: 'quota_exceeded',
        code: 'quota_intros_exhausted',
        message: `You have used all ${state.cap} introductions for ${state.quarter}.`,
        used: state.used,
        cap: state.cap,
        tier: state.tier,
        upgrade_to: state.tier === 'free' ? 'professional' : 'institutional',
        checkout_path: '/api/billing/investor/checkout',
      },
      402,
    );
  }

  // Atomic reserve-then-insert: bump counter first; if insert fails we
  // accept the (rare) wasted slot rather than risk double-spend on race.
  await c.env.DB.prepare(
    `UPDATE users SET investor_quota_intros_used = investor_quota_intros_used + 1
     WHERE id = ? AND investor_quota_intros_quarter = ?`
  ).bind(user.id, state.quarter).run();

  const uid = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO investor_introductions
       (uid, investor_user_id, founder_user_id, founder_id, project_id,
        message, status, quarter)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(uid, user.id, founderUserId, founderId, projectId, message, state.quarter).run();

  // The 3-way Founder/Investor/Axal NDA envelope is minted by the Trust
  // Center route POST /api/trust/intro/request — the frontend calls that
  // immediately after a successful quota grant here. We deliberately do
  // NOT couple the two writes; if the NDA flow fails the quota was still
  // spent (matches Stripe-style "reserve the slot, retry the side-effect").

  return c.json({
    ok: true,
    uid,
    used: state.used + 1,
    cap: state.cap,
    remaining: state.cap - state.used - 1,
    tier: effectiveInvestorTier(user),
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Network Introductions — curated warm-intro propositions for ALL user types.
// Credits: one accepted introduction consumes one credit; declines are free.
// Buckets (allowance / referral-earned / purchased) live in
// intro_credit_ledger; see services/introductions.ts for the math.
// ────────────────────────────────────────────────────────────────────────────

/** Target-profile projection joined onto each proposition row. */
const PROPOSITION_SELECT = `
  SELECT p.uid, p.status, p.score, p.breakdown_json, p.source,
         p.expires_at, p.responded_at, p.created_at,
         u.uid AS target_uid, COALESCE(u.display_name, u.name) AS target_name,
         u.role AS target_role, u.headline AS target_headline,
         u.country AS target_country,
         CASE WHEN u.headshot_r2_key IS NOT NULL
              THEN '/api/settings/headshot/' || u.uid ELSE NULL END AS target_headshot_url,
         (SELECT persona_id FROM user_personas up
           WHERE up.user_id = u.id AND up.is_primary = 1 LIMIT 1) AS target_persona
    FROM intro_propositions p
    JOIN users u ON u.id = p.target_user_id`;

function propositionDto(r: any) {
  let breakdown: any = null;
  try { breakdown = r.breakdown_json ? JSON.parse(r.breakdown_json) : null; } catch { /* keep null */ }
  return {
    uid: r.uid,
    status: r.status,
    score: Math.round(Number(r.score) || 0),
    source: r.source,
    expires_at: r.expires_at,
    responded_at: r.responded_at,
    created_at: r.created_at,
    breakdown,
    target: {
      uid: r.target_uid,
      name: r.target_name,
      role: r.target_role,
      headline: r.target_headline || null,
      country: r.target_country || null,
      headshot_url: r.target_headshot_url || null,
      persona: r.target_persona || null,
      profile_path: r.target_uid ? `/u/${r.target_uid}` : null,
    },
  };
}

// GET /propositions?status=pending|accepted|declined|expired&refresh=1
// Lazily expires stale rows and tops the list up from the matching engine
// when the user has fewer than 3 live propositions (or asks to refresh).
introductions.get('/propositions', async (c) => {
  const user = (await requireAuth(c)) as User;
  await ensureIntroNetworkSchema(c.env);

  // Lazy expiry — declining nothing, spending nothing.
  try {
    await c.env.DB.prepare(
      `UPDATE intro_propositions SET status = 'expired'
        WHERE user_id = ? AND status = 'pending'
          AND expires_at IS NOT NULL AND expires_at < datetime('now')`,
    ).bind(user.id).run();
  } catch { /* best-effort */ }

  const wantRefresh = c.req.query('refresh') === '1';
  let generated = 0;
  try {
    const pendingRow = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM intro_propositions WHERE user_id = ? AND status = 'pending'`,
    ).bind(user.id).first<{ n: number }>();
    const pending = Number(pendingRow?.n || 0);
    if (wantRefresh || pending < 3) {
      generated = await generateIntroPropositions(c.env, user as any, { max: 5 });
    }
  } catch (e) {
    console.warn('[introductions] generation failed:', (e as Error).message);
  }

  const status = (c.req.query('status') || '').trim().toLowerCase();
  const wheres = ['p.user_id = ?'];
  const binds: unknown[] = [user.id];
  if (['pending', 'accepted', 'declined', 'expired'].includes(status)) {
    wheres.push('p.status = ?');
    binds.push(status);
  }
  const tail = `WHERE ${wheres.join(' AND ')}
      ORDER BY CASE p.status WHEN 'pending' THEN 0 ELSE 1 END, p.score DESC, p.created_at DESC
      LIMIT 200`;
  let rows: { results?: unknown[] };
  try {
    rows = await c.env.DB.prepare(`${PROPOSITION_SELECT} ${tail}`).bind(...binds).all();
  } catch {
    // Older/dev DBs may lack the lazily-added identity columns
    // (display_name / headline / headshot_r2_key) or user_personas — degrade
    // to the guaranteed columns rather than 500ing the page.
    rows = await c.env.DB.prepare(
      `SELECT p.uid, p.status, p.score, p.breakdown_json, p.source,
              p.expires_at, p.responded_at, p.created_at,
              u.uid AS target_uid, u.name AS target_name, u.role AS target_role,
              NULL AS target_headline, NULL AS target_country,
              NULL AS target_headshot_url, NULL AS target_persona
         FROM intro_propositions p
         JOIN users u ON u.id = p.target_user_id ${tail}`,
    ).bind(...binds).all();
  }

  const credits = await getIntroCreditState(c.env, user as any);
  return c.json({
    propositions: (rows.results || []).map(propositionDto),
    credits,
    generated,
  });
});

// POST /propositions/:uid/accept — spends exactly one credit, atomically.
// The D1 batch guards all three invariants in one transaction: the row is
// still pending, the balance is positive, and this uid was never spent
// before (UNIQUE(user_id, kind, source_ref) → no double-accept, no double
// spend even under concurrent clicks).
introductions.post('/propositions/:uid/accept', async (c) => {
  const user = (await requireAuth(c)) as User;
  await ensureIntroNetworkSchema(c.env);
  const uid = String(c.req.param('uid') || '').trim();
  if (!uid) return c.json({ error: 'uid_required' }, 400);

  const prop = await c.env.DB.prepare(
    `SELECT id, uid, user_id, target_user_id, status FROM intro_propositions
      WHERE uid = ? AND user_id = ?`,
  ).bind(uid, user.id).first<{ id: number; uid: string; user_id: number; target_user_id: number; status: string }>();
  if (!prop) return c.json({ error: 'not_found' }, 404);
  if (prop.status !== 'pending') {
    return c.json({ error: 'already_responded', status: prop.status }, 409);
  }

  const state = await getIntroCreditState(c.env, user as any);
  if (state.balance <= 0) {
    return c.json(
      {
        error: 'no_credits',
        code: 'intro_credits_exhausted',
        message: 'You are out of introduction credits for now.',
        credits: state,
        packs: Object.entries(INTRO_PACKS).map(([key, p]) => ({ key, ...p })),
        buy_path: '/products#introduction-packs',
        refer_path: '/account/referrals',
      },
      402,
    );
  }
  const bucket = pickSpendBucket(state);
  const sourceRef = `intro:${uid}`;

  const batch = await c.env.DB.batch([
    // 1. Conditional spend — only lands while the row is pending, the balance
    //    is still positive, and no spend for this uid exists yet.
    c.env.DB.prepare(
      `INSERT INTO intro_credit_ledger (user_id, delta, bucket, kind, source_ref, note)
       SELECT ?1, -1, ?2, 'spend', ?3, 'Accepted introduction'
        WHERE EXISTS (SELECT 1 FROM intro_propositions
                       WHERE uid = ?4 AND user_id = ?1 AND status = 'pending')
          AND NOT EXISTS (SELECT 1 FROM intro_credit_ledger
                           WHERE user_id = ?1 AND kind = 'spend' AND source_ref = ?3)
          AND (
            (SELECT COALESCE(SUM(delta), 0) FROM intro_credit_ledger
              WHERE user_id = ?1 AND bucket = 'allowance'
                AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now'))
            + (SELECT COALESCE(SUM(delta), 0) FROM intro_credit_ledger
                WHERE user_id = ?1 AND bucket IN ('purchased', 'referral'))
          ) > 0`,
    ).bind(user.id, bucket, sourceRef, uid),
    // 2. Flip the proposition only if the spend row actually landed.
    c.env.DB.prepare(
      `UPDATE intro_propositions
          SET status = 'accepted', responded_at = datetime('now')
        WHERE uid = ? AND user_id = ? AND status = 'pending'
          AND EXISTS (SELECT 1 FROM intro_credit_ledger
                       WHERE user_id = ? AND kind = 'spend' AND source_ref = ?)`,
    ).bind(uid, user.id, user.id, sourceRef),
  ]);
  const accepted = Number(batch[1]?.meta?.changes || 0) > 0;
  if (!accepted) {
    // Re-read to give the caller a precise reason.
    const fresh = await getIntroCreditState(c.env, user as any);
    if (fresh.balance <= 0) {
      return c.json({ error: 'no_credits', code: 'intro_credits_exhausted', credits: fresh }, 402);
    }
    return c.json({ error: 'already_responded' }, 409);
  }

  // Audit trail (append-only, mirrors the products/redeem pattern).
  try {
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id)
       VALUES ('intro_accepted', ?, ?, ?)`,
    ).bind(
      JSON.stringify({ proposition_uid: uid, target_user_id: prop.target_user_id, bucket }),
      await hashEmail(user.email || ''),
      user.id,
    ).run();
  } catch { /* best-effort */ }

  // Tell the counterpart — and if both sides have now accepted, celebrate the
  // completed connection on both ends.
  try {
    const { notify } = await import('../services/notify');
    const accepterName = (user as any).display_name || user.name || 'A member';
    const mirror = await c.env.DB.prepare(
      `SELECT uid, status FROM intro_propositions WHERE user_id = ? AND target_user_id = ?`,
    ).bind(prop.target_user_id, user.id).first<{ uid: string; status: string }>();
    if (mirror?.status === 'accepted') {
      const targetName = await c.env.DB.prepare(
        `SELECT COALESCE(display_name, name) AS n FROM users WHERE id = ?`,
      ).bind(prop.target_user_id).first<{ n: string | null }>().then((r) => r?.n || 'your match');
      await Promise.all([
        notify(c.env, {
          userId: prop.target_user_id,
          type: 'intro_connected',
          category: 'proactive_nudges',
          title: `Introduction complete — you're connected with ${accepterName}`,
          body: 'Both of you accepted. Open their profile to start the conversation.',
          link: `/network?tab=introductions&intro=${mirror.uid}`,
          payload: { proposition_uid: mirror.uid, counterpart_user_id: user.id },
          channels: ['in_app', 'email'],
        }),
        notify(c.env, {
          userId: user.id,
          type: 'intro_connected',
          category: 'proactive_nudges',
          title: `Introduction complete — you're connected with ${targetName}`,
          body: 'Both of you accepted. Open their profile to start the conversation.',
          link: `/network?tab=introductions&intro=${uid}`,
          payload: { proposition_uid: uid, counterpart_user_id: prop.target_user_id },
          channels: ['in_app'],
        }),
      ]);
    } else {
      await notify(c.env, {
        userId: prop.target_user_id,
        type: 'intro_accepted',
        category: 'proactive_nudges',
        title: `${accepterName} accepted an introduction with you`,
        body: mirror
          ? 'Review the match on your side to complete the connection.'
          : 'Open Introductions to see the match.',
        link: mirror
          ? `/network?tab=introductions&intro=${mirror.uid}`
          : '/network?tab=introductions',
        payload: { counterpart_user_id: user.id },
        channels: ['in_app'],
      });
    }
  } catch (e) {
    console.warn('[introductions] accept notify failed:', (e as Error).message);
  }

  const credits = await getIntroCreditState(c.env, user as any);
  return c.json({ ok: true, uid, status: 'accepted', spent_bucket: bucket, credits });
});

// POST /propositions/:uid/decline — free, audited, no notification to the
// counterpart (declines stay private).
introductions.post('/propositions/:uid/decline', async (c) => {
  const user = (await requireAuth(c)) as User;
  await ensureIntroNetworkSchema(c.env);
  const uid = String(c.req.param('uid') || '').trim();
  if (!uid) return c.json({ error: 'uid_required' }, 400);

  const r = await c.env.DB.prepare(
    `UPDATE intro_propositions
        SET status = 'declined', responded_at = datetime('now')
      WHERE uid = ? AND user_id = ? AND status = 'pending'`,
  ).bind(uid, user.id).run();
  if (!Number(r?.meta?.changes || 0)) {
    const row = await c.env.DB.prepare(
      `SELECT status FROM intro_propositions WHERE uid = ? AND user_id = ?`,
    ).bind(uid, user.id).first<{ status: string }>();
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ error: 'already_responded', status: row.status }, 409);
  }

  try {
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id)
       VALUES ('intro_declined', ?, ?, ?)`,
    ).bind(JSON.stringify({ proposition_uid: uid }), await hashEmail(user.email || ''), user.id).run();
  } catch { /* best-effort */ }

  const credits = await getIntroCreditState(c.env, user as any);
  return c.json({ ok: true, uid, status: 'declined', credits });
});

// GET /credits — balance breakdown for the header summary.
introductions.get('/credits', async (c) => {
  const user = (await requireAuth(c)) as User;
  const credits = await getIntroCreditState(c.env, user as any);
  return c.json({
    credits,
    buy_path: '/products#introduction-packs',
    refer_path: '/account/referrals',
  });
});

// GET /credits/history — the append-only ledger (auditable transactions).
introductions.get('/credits/history', async (c) => {
  const user = (await requireAuth(c)) as User;
  await ensureIntroNetworkSchema(c.env);
  const rows = await c.env.DB.prepare(
    `SELECT delta, bucket, kind, source_ref, note, created_at
       FROM intro_credit_ledger
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 100`,
  ).bind(user.id).all();
  return c.json({ history: rows.results || [] });
});

// GET /packs — purchasable intro-credit packs (rendered on Products).
introductions.get('/packs', async (c) => {
  await requireAuth(c);
  return c.json({
    packs: Object.entries(INTRO_PACKS).map(([key, p]) => ({ key, ...p })),
  });
});

export default introductions;
