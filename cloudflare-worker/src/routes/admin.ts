import { Hono } from 'hono';
import { clampLimit, parseOffset } from '../util/pagination';
import { hashEmail } from '../util/hashEmail';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAdmin, createJWT, hashToken, requireFactor, requireStepUp } from '../auth';
import {
  serializeTranscriptCsv,
  classifyOnboardingEmpty,
  type TranscriptRow,
  type WriteMap,
} from './admin.conversations.helpers';
import { runTotpRemediation } from '../services/totpRemediation';
import { assignFounderPublicId, assignPartnerPublicId, ensurePublicIdColumns } from '../services/publicIds';
// Task #9 follow-up — lets the generic role-change endpoint move a user
// INTO the 'exploring' holding state (e.g. demoting a partner back for
// re-review). ensureExploringSchema guarantees the CHECK admits the value.
import { ensureExploringSchema } from '../services/exploringSchema';
// Task #102 — admin Spin-Out Lab participants endpoint derives week/tool
// unlocks from the shared milestone catalog (single source of truth).
import { MILESTONES as SPINOUT_MILESTONES, unlockedFeaturesThrough } from '../services/spinoutLabCatalog';

const admin = new Hono<{ Bindings: Env }>();

// Lazy schema migration — adds the columns the admin profile UI relies on
// without breaking older databases. Idempotent and cheap (CF wraps the
// PRAGMA-style ALTER in IF NOT EXISTS semantics for column adds via try/catch).
let profileSchemaMigrated = false;
async function ensureProfileColumns(env: Env): Promise<void> {
  if (profileSchemaMigrated) return;
  const stmts = [
    `ALTER TABLE users ADD COLUMN admin_notes TEXT`,
    `ALTER TABLE users ADD COLUMN last_active_at TIMESTAMP`,
    // 'limited' lets a user past the KYC gate to browse the platform but
    // does NOT permit signing legal/financial agreements (server-enforced
    // in /api/legal/esign/sign/:token). Null/missing = normal flow.
    `ALTER TABLE users ADD COLUMN access_level TEXT`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); } catch {} // duplicate-column errors are expected
  }
  profileSchemaMigrated = true;
}

admin.get('/users', async (c) => {
  await requireAdmin(c);
  // Make sure access_level (and other admin-only columns) exist on the row
  // shape before we SELECT them — older databases predate these adds.
  await ensureProfileColumns(c.env);
  const sql = getSQL(c.env);
  // T17 — pagination. Default 100 (existing UX), max 200. The previous
  // implementation returned EVERY user with no limit — fine for a 50-user
  // workspace but a foot-gun once the directory grows.
  const limit = clampLimit(c.req.query('limit'), 100, 200);
  const offset = parseOffset(c.req.query('offset'));
  // Include `kyc_status` and `access_level` so the admin user table can
  // show who's been verified, who has a manual full-access grant, and who
  // has limited (browse-only, can't sign legal docs) access. The UI uses
  // these to decide which "Grant" buttons to render.
  const rows = await sql`SELECT id, uid, email, name, role, is_active, email_verified, kyc_status, access_level, created_at FROM users ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  await sql.end();
  // Back-compat: existing frontend reads this as a flat array. Keep that
  // shape; a new ?envelope=1 mode can be added later without breaking the UI.
  return c.json(rows);
});

// GET /api/admin/users/:user_id/profile — comprehensive admin view of a user.
// Returns: user record, registration timeline, KYC status, agreements
// (eSign envelopes), recent activity logs (with full detail), tickets,
// integrations, founder/partner profile snippets. Single endpoint to keep
// the modal load to one round-trip.
admin.get('/users/:user_id/profile', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureProfileColumns(c.env);
  const userId = parseInt(c.req.param('user_id'));
  if (!Number.isFinite(userId) || userId <= 0) return c.json({ error: 'Invalid user_id' }, 400);

  // Task #1 (DB) — guarantee the new columns exist BEFORE the SELECT
  // references them; otherwise a partially-migrated D1 raises
  // "no such column" and the whole profile call 500s. Idempotent +
  // sentinel-cached after the first call per isolate.
  await ensurePublicIdColumns(c.env);
  const userRow: any = await c.env.DB.prepare(
    `SELECT id, uid, email, name, role, is_active, email_verified, founder_id, partner_id,
            kyc_status, kyc_provider, kyc_submitted_at, kyc_reviewed_at, kyc_rejection_reason,
            COALESCE(admin_notes, '') AS admin_notes,
            founder_public_id, partner_public_id, last_active_at, created_at
       FROM users WHERE id = ?`
  ).bind(userId).first();
  if (!userRow) return c.json({ error: 'User not found' }, 404);

  // ----- Activity logs (D1, last 100) -----
  const activityRes: any = await c.env.DB.prepare(
    `SELECT id, action, details, actor, created_at
       FROM activity_logs
      WHERE user_id = ? OR LOWER(actor) = LOWER(?)
      ORDER BY datetime(created_at) DESC
      LIMIT 100`
  ).bind(userId, userRow.email).all();
  const activity = activityRes?.results || [];

  // ----- Registration / lifecycle timeline -----
  // Build from the user row + selected activity_log events. Includes account
  // creation, email verification, KYC milestones, role changes, eSign sent,
  // eSign signed.
  const REG_ACTIONS = new Set([
    'user_registered', 'email_verified', 'email_verified_admin',
    'profile_captured', 'profile_reviewed_by_admin', 'profile_verified',
    'kyc_submitted', 'kyc_approved', 'kyc_approved_by_admin',
    'kyc_rejected', 'kyc_rejected_by_admin',
    'role_changed', 'your_role_changed',
    'account_status_changed', 'user_toggled',
    'esign_envelope_created', 'esign_envelope_sent', 'esign_signed',
    'esign_document_downloaded_by_recipient', 'esign_envelope_completed',
  ]);
  const timeline = [
    {
      ts: userRow.created_at,
      kind: 'account_created',
      label: 'Account created',
      detail: `Registered as ${userRow.role}`,
    },
    ...activity
      .filter((a: any) => REG_ACTIONS.has(a.action))
      .map((a: any) => ({
        ts: a.created_at,
        kind: a.action,
        label: a.action.replace(/_/g, ' '),
        detail: a.details || null,
      })),
  ].sort((x, y) => String(y.ts).localeCompare(String(x.ts)));

  // ----- Agreements (eSign) — both as recipient and as creator -----
  // Lazy schema dependency: if esign tables don't exist yet, swallow.
  let agreements: any[] = [];
  try {
    // Schema reference (esign.ts): esign_envelopes has `completed_at` (not
    // `signed_at`); per-recipient signing timestamps live on
    // esign_recipients.signed_at.
    const recRes: any = await c.env.DB.prepare(
      `SELECT e.id            AS envelope_id,
              e.envelope_uuid,
              e.document_type,
              e.document_title,
              e.status        AS envelope_status,
              e.created_at,
              e.completed_at,
              r.id            AS recipient_id,
              r.recipient_email,
              r.recipient_name,
              r.status        AS recipient_status,
              r.signed_at     AS recipient_signed_at,
              r.token_expires_at,
              CASE WHEN e.created_by = ? THEN 'creator' ELSE 'recipient' END AS role_in_envelope
         FROM esign_envelopes e
         LEFT JOIN esign_recipients r ON r.envelope_id = e.id
        WHERE e.user_id = ?
           OR LOWER(r.recipient_email) = LOWER(?)
           OR e.created_by = ?
        ORDER BY datetime(e.created_at) DESC
        LIMIT 50`
    ).bind(userId, userId, userRow.email, userId).all();
    agreements = recRes?.results || [];
  } catch (e: any) {
    // Surface schema mismatches loudly — empty agreements is misleading if
    // the cause is a query bug rather than missing data.
    console.error('[admin/profile] esign agreements query failed:', e?.message, e?.stack);
  }

  // ----- Tickets (best-effort) -----
  let tickets: any[] = [];
  try {
    const tres: any = await c.env.DB.prepare(
      `SELECT id, title, status, priority, created_at
         FROM tickets WHERE user_id = ? ORDER BY datetime(created_at) DESC LIMIT 20`
    ).bind(userId).all();
    tickets = tres?.results || [];
  } catch {}

  // ----- Integrations (best-effort) -----
  let integrations: any[] = [];
  try {
    const ires: any = await c.env.DB.prepare(
      `SELECT uid, provider_name, display_name, status, last_synced_at
         FROM integrations WHERE user_id = ? ORDER BY datetime(created_at) DESC`
    ).bind(userId).all();
    integrations = ires?.results || [];
  } catch {}

  // ----- Personal Advisor transcripts (Task #11) -----
  // Surfaces TWO advisor sessions for the admin user-profile drawer:
  //   • onboarding_conversation: the FIRST advisor session created for the
  //     user (week-1 / sign-up flow). Powers the "Onboarding Conversation"
  //     tab which previously always rendered "0 messages".
  //   • ongoing_conversation:    the MOST RECENT advisor session by
  //     updated_at. Powers the new "Ongoing Conversation" tab.
  // When the user has only one session both keys point at the same row.
  // Defensive try/catch — advisor_* tables may be missing in older D1
  // envs (migration 029 not yet applied), in which case we degrade to
  // empty objects rather than 500-ing the whole profile load.
  let onboardingConversation: any = null;
  let ongoingConversation: any = null;
  try {
    // Architect-flagged: order in SQL with `datetime(...)`, not JS string
    // sort, so timezone-suffixed / mixed-precision timestamps still order
    // deterministically. Two cheap point-lookups beat fetching all rows
    // and sorting client-side; both share idx_advisor_conv_user.
    const CONV_COLS = `id, uid, persona, state, current_question_id,
              total_questions, answered_count, skipped_count,
              created_at, updated_at`;
    const first: any = await c.env.DB.prepare(
      `SELECT ${CONV_COLS}
         FROM advisor_conversations
        WHERE user_id = ?
        ORDER BY datetime(created_at) ASC, id ASC
        LIMIT 1`
    ).bind(userId).first();
    if (first) {
      const last: any = await c.env.DB.prepare(
        `SELECT ${CONV_COLS}
           FROM advisor_conversations
          WHERE user_id = ?
          ORDER BY datetime(updated_at) DESC, id DESC
          LIMIT 1`
      ).bind(userId).first();
      // Helper — pull up to 500 messages for a conversation in chronological
      // order. We deliberately omit meta_json from the response to keep the
      // payload small; admins only need the visible transcript here.
      const fetchMessages = async (convId: number) => {
        const r: any = await c.env.DB.prepare(
          `SELECT role, question_id, content, created_at
             FROM advisor_messages
            WHERE conversation_id = ?
            ORDER BY id ASC
            LIMIT 500`
        ).bind(convId).all();
        return (r?.results || []).map((m: any) => ({
          role: m.role,
          content: m.content,
          ts: m.created_at,
          question_id: m.question_id || null,
        }));
      };
      onboardingConversation = {
        conversation: first,
        messages: await fetchMessages(first.id),
      };
      // Avoid an extra round-trip when first === last (single conversation).
      ongoingConversation = !last || first.id === last.id
        ? onboardingConversation
        : { conversation: last, messages: await fetchMessages(last.id) };
    }
  } catch (e: any) {
    // Silent degrade — log for ops visibility but never break the profile load.
    console.error('[admin/profile] advisor transcripts query failed:', e?.message);
  }

  // ----- Linked founder / partner row -----
  let founder: any = null;
  if (userRow.founder_id) {
    try {
      founder = await c.env.DB.prepare(`SELECT * FROM founders WHERE id = ?`).bind(userRow.founder_id).first();
    } catch {}
  }
  let partner: any = null;
  if (userRow.partner_id) {
    try {
      partner = await c.env.DB.prepare(`SELECT * FROM partners WHERE id = ?`).bind(userRow.partner_id).first();
    } catch {}
  }

  // Task #1 (DB) — lazy-assign public AXF-/AXP- identifiers when the
  // user has the corresponding role but no id yet. Idempotent: returns
  // the existing value when one is already set. Mirrored back onto
  // userRow so the response includes the freshly-minted id.
  await ensurePublicIdColumns(c.env);
  if ((userRow.role === 'founder' || userRow.founder_id) && !userRow.founder_public_id) {
    const fid = await assignFounderPublicId(c.env, userRow.id);
    if (fid) userRow.founder_public_id = fid;
  }
  if ((userRow.role === 'partner' || userRow.partner_id) && !userRow.partner_public_id) {
    const pid = await assignPartnerPublicId(c.env, userRow.id);
    if (pid) userRow.partner_public_id = pid;
  }

  // Audit trail — admin viewed this profile. Epic 11 — actor stores
  // hashEmail(adminUser.email), never the plaintext, to keep PII out of
  // activity_logs. user_id is the join key for support workflows.
  try {
    const adminHash = await hashEmail(adminUser.email);
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`
    ).bind('admin_viewed_profile',
      `Admin ${adminUser.name} viewed full profile for ${userRow.name} (user_id=${userRow.id})`,
      adminHash, adminUser.id).run();
  } catch {}

  return c.json({
    ok: true,
    user: userRow,
    kyc: {
      status: userRow.kyc_status || 'not_started',
      provider: userRow.kyc_provider || null,
      submitted_at: userRow.kyc_submitted_at || null,
      reviewed_at: userRow.kyc_reviewed_at || null,
      rejection_reason: userRow.kyc_rejection_reason || null,
      totp_enabled: false, // placeholder — wire to actual TOTP table when added
      id_uploaded: userRow.kyc_status && userRow.kyc_status !== 'not_started',
    },
    timeline,
    agreements,
    activity,
    tickets,
    integrations,
    founder,
    partner,
    // Task #11 — Personal Advisor transcripts for the admin user-profile drawer.
    // See the fetch block above for shape; either may be null when the user
    // has never started an advisor session.
    onboarding_conversation: onboardingConversation,
    ongoing_conversation: ongoingConversation,
    stats: {
      activity_count: activity.length,
      ticket_count: tickets.length,
      integration_count: integrations.length,
      agreement_count: agreements.length,
      signed_agreement_count: agreements.filter((a: any) => a.recipient_status === 'signed').length,
    },
  });
});

// ---------------------------------------------------------------------------
// Task #1 (DB) — Dedicated transcript endpoints. The /profile endpoint above
// returns the first + most-recent advisor conversation inline; these endpoints
// give the admin UI per-conversation pagination and a discoverable list of
// every advisor session a user has owned. Each call also writes a row to
// admin_audit_log + activity_logs so we have a per-conversation view trail.
// ---------------------------------------------------------------------------

// Generic admin_audit_log (export / publication actions PLUS, per
// Task #1 (DB), per-conversation profile-view rows with first-class
// columns viewed_user_id / conversation_id / viewed_at).
//
// The lazy bootstrap below is PRAGMA-guarded so it stays idempotent:
// CREATE TABLE / INDEX use IF NOT EXISTS, and each ADD COLUMN is only
// emitted when the column is genuinely missing from PRAGMA
// table_info(). Safe to call on every request, on a fresh DB, and on
// a DB that already has the canonical schema.
let adminAuditLogTableReady = false;
export async function ensureAdminAuditLogTable(env: Env): Promise<void> {
  if (adminAuditLogTableReady) return;
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS admin_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL, report_type TEXT, format TEXT, filters_json TEXT, storage_key TEXT, download_url TEXT, exported_at TEXT NOT NULL DEFAULT (datetime('now')), viewed_user_id INTEGER, conversation_id INTEGER, viewed_at TEXT)",
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_admin_audit_user_ts ON admin_audit_log(admin_user_id, exported_at DESC)',
    );
    // PRAGMA-guarded ADD COLUMN for the three Task #1 (DB) columns —
    // needed when the table already existed from an earlier migration
    // without these columns.
    let cols = new Set<string>();
    try {
      const info: any = await env.DB.prepare(`PRAGMA table_info(admin_audit_log)`).all();
      for (const r of (info?.results || []) as Array<{ name: string }>) cols.add(r.name);
    } catch {}
    const adds: Array<[string, string]> = [
      ['viewed_user_id', `ALTER TABLE admin_audit_log ADD COLUMN viewed_user_id INTEGER`],
      ['conversation_id', `ALTER TABLE admin_audit_log ADD COLUMN conversation_id INTEGER`],
      ['viewed_at', `ALTER TABLE admin_audit_log ADD COLUMN viewed_at TEXT`],
    ];
    for (const [name, sql] of adds) {
      if (!cols.has(name)) { try { await env.DB.exec(sql); } catch {} }
    }
    try {
      await env.DB.exec(
        'CREATE INDEX IF NOT EXISTS idx_admin_audit_viewed_user ON admin_audit_log(viewed_user_id, viewed_at DESC)',
      );
    } catch {}
  } catch {}
  adminAuditLogTableReady = true;
}

// Task #1 (DB) — dedicated profile-view audit trail with first-class
// columns (admin_user_id, viewed_user_id, conversation_id, viewed_at)
// for SQL-friendly investigator queries. Bridged into admin_audit_log
// above so existing oversight reports keep working unchanged.
let adminProfileAuditReady = false;
async function ensureAdminProfileAuditTable(env: Env): Promise<void> {
  if (adminProfileAuditReady) return;
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS admin_profile_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER NOT NULL, viewed_user_id INTEGER NOT NULL, conversation_id INTEGER, action TEXT NOT NULL, viewed_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_admin_profile_audit_viewed ON admin_profile_audit(viewed_user_id, viewed_at DESC)',
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_admin_profile_audit_admin ON admin_profile_audit(admin_user_id, viewed_at DESC)',
    );
  } catch {}
  adminProfileAuditReady = true;
}

async function auditConversationView(
  env: Env,
  adminUser: { id: number; name?: string | null; email: string },
  targetUserId: number,
  action: string,
  conversationId: number | null,
): Promise<void> {
  try {
    await ensureAdminProfileAuditTable(env);
    await env.DB.prepare(
      `INSERT INTO admin_profile_audit (admin_user_id, viewed_user_id, conversation_id, action) VALUES (?, ?, ?, ?)`,
    ).bind(adminUser.id, targetUserId, conversationId, action).run();
  } catch (e) {
    console.error('[admin/audit] admin_profile_audit insert failed', (e as Error).message);
  }
  // Task #1 (DB) — also write the canonical row into admin_audit_log
  // with first-class viewed_user_id / conversation_id / viewed_at
  // columns so existing Trust-Center oversight + admin export reports
  // pick these up without a parallel ingestion path or JSON unwrapping.
  // Mirrors the same pair of values into filters_json for legacy
  // readers that haven't been updated to consume the dedicated cols.
  try {
    await ensureAdminAuditLogTable(env);
    const nowIso = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO admin_audit_log (admin_user_id, action, viewed_user_id, conversation_id, viewed_at, filters_json) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      adminUser.id,
      action,
      targetUserId,
      conversationId,
      nowIso,
      JSON.stringify({ target_user_id: targetUserId, conversation_id: conversationId, viewed_at: nowIso }),
    ).run();
  } catch (e) {
    console.error('[admin/audit] admin_audit_log insert failed', (e as Error).message);
  }
  try {
    const adminHash = await hashEmail(adminUser.email);
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    )
      .bind(
        action,
        `Admin ${adminUser.name || adminUser.email} viewed ${action} (target_user=${targetUserId}${conversationId ? `, conv=${conversationId}` : ''})`,
        adminHash,
        adminUser.id,
      )
      .run();
  } catch {}
}

// Task #34 — viewed-user notification on admin transcript view. Suppressed
// when an active investigation flag is set on the user row
// (`users.admin_view_suppressed = 1`). Best-effort: any failure here is
// logged and the request continues — the audit row is the authoritative
// trail; the inbox row is courtesy.
let _adminSuppressColReady = false;
async function ensureAdminViewSuppressColumn(env: Env): Promise<void> {
  if (_adminSuppressColReady) return;
  try {
    const info: any = await env.DB.prepare(`PRAGMA table_info(users)`).all();
    const have = new Set((info?.results || []).map((r: any) => r.name));
    if (!have.has('admin_view_suppressed')) {
      try { await env.DB.exec(`ALTER TABLE users ADD COLUMN admin_view_suppressed INTEGER DEFAULT 0`); }
      catch { /* duplicate-column race */ }
    }
    _adminSuppressColReady = true;
  } catch (e) {
    console.warn('[admin/notify] ensureAdminViewSuppressColumn failed', (e as Error).message);
  }
}

async function notifyTranscriptViewed(
  env: Env,
  viewedUserId: number,
  kind: 'onboarding' | 'advisor_list' | 'advisor_transcript',
): Promise<void> {
  try {
    await ensureAdminViewSuppressColumn(env);
    const row: any = await env.DB.prepare(
      `SELECT admin_view_suppressed FROM users WHERE id = ?`,
    ).bind(viewedUserId).first();
    if (Number(row?.admin_view_suppressed || 0) === 1) return;
    const { notify } = await import('../services/notify');
    const titles: Record<typeof kind, string> = {
      onboarding: 'An admin viewed your onboarding transcript',
      advisor_list: 'An admin viewed your advisor conversations',
      advisor_transcript: 'An admin viewed your advisor transcript',
    };
    await notify(env, {
      userId: viewedUserId,
      type: 'admin_transcript_view',
      title: titles[kind],
      body: 'A platform admin reviewed your Personal Advisor conversation history as part of standard support / compliance activity.',
      category: 'security',
      channels: ['in_app'],
    });
  } catch (e) {
    console.warn('[admin/notify] notifyTranscriptViewed failed', (e as Error).message);
  }
}

// Best-effort summary extractor: pulls the last assistant message
// (or first user prompt as a fallback) and trims to 200 chars.
function summariseConversation(messages: Array<{ role: string; content: string }>): string | null {
  if (!messages.length) return null;
  const lastAsst = [...messages].reverse().find(m => m.role === 'assistant' && m.content);
  const seed = lastAsst?.content || messages[0]?.content || '';
  const oneLine = seed.replace(/\s+/g, ' ').trim();
  if (!oneLine) return null;
  return oneLine.length > 200 ? `${oneLine.slice(0, 197)}…` : oneLine;
}

// GET /api/admin/users/:user_id/conversations/onboarding
// Returns the user's FIRST advisor session (week-1 / sign-up flow) with full
// message transcript. Mirrors the embedded `onboarding_conversation` block on
// /profile but is the discoverable, audited entry-point for the dedicated
// admin "Onboarding" tab.
admin.get('/users/:user_id/conversations/onboarding', async (c) => {
  const adminUser = await requireAdmin(c);
  const userId = parseInt(c.req.param('user_id'));
  if (!Number.isFinite(userId)) return c.json({ error: 'Invalid user_id' }, 400);

  const conv: any = await c.env.DB.prepare(
    `SELECT id, uid, persona, state, current_question_id, total_questions,
            answered_count, skipped_count, created_at, updated_at
       FROM advisor_conversations
      WHERE user_id = ?
      ORDER BY datetime(created_at) ASC, id ASC
      LIMIT 1`,
  ).bind(userId).first();
  if (!conv) {
    await auditConversationView(c.env, adminUser, userId, 'admin_viewed_onboarding_transcript', null);
    await notifyTranscriptViewed(c.env, userId, 'onboarding');
    return c.json({
      ok: true,
      conversation: null,
      messages: [],
      summary: null,
      completion_pct: 0,
      empty: true,
      empty_reason: 'never_completed',
    });
  }
  const r: any = await c.env.DB.prepare(
    `SELECT role, question_id, content, meta_json, created_at
       FROM advisor_messages
      WHERE conversation_id = ?
      ORDER BY id ASC
      LIMIT 1000`,
  ).bind(conv.id).all();
  const messages = (r?.results || []).map((m: any) => {
    const meta = m.meta_json ? safeParse(m.meta_json) : null;
    return {
      role: m.role,
      content: m.content,
      ts: m.created_at,
      question_id: m.question_id || null,
      model: meta?.model || meta?.provider_model || null,
      latency_ms: meta?.latency_ms ?? meta?.latency ?? null,
      tokens: meta?.tokens ?? meta?.tokens_used ?? null,
      written_to: meta?.written_to || null,
    };
  });
  const total = Number(conv.total_questions) || 0;
  const answered = Number(conv.answered_count) || 0;
  const completion_pct = total > 0 ? Math.round((answered / total) * 100) : 0;
  const summary = summariseConversation(messages);
  // Task #34 — empty_reason distinguishes "user never started the
  // onboarding chatbot" (never_completed) from "user has an active
  // session with no assistant turns yet" (in_progress). The conv-
  // not-found branch above already returns empty_reason='never_completed';
  // here we only fall into in_progress when the conversation is active
  // with no logged messages.
  const { empty, empty_reason } = classifyOnboardingEmpty(conv as any, messages.length);
  await auditConversationView(c.env, adminUser, userId, 'admin_viewed_onboarding_transcript', conv.id);
  await notifyTranscriptViewed(c.env, userId, 'onboarding');
  return c.json({
    ok: true,
    conversation: conv,
    messages,
    summary,
    completion_pct,
    empty,
    empty_reason,
  });
});

// Local helper — mirrors safeReadJSON without the frontend dependency.
function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}

// GET /api/admin/users/:user_id/conversations/advisor
// Returns the LIST of every advisor conversation the user has owned, newest
// first. No messages — just the per-row metadata so the admin UI can render
// a dropdown / sidebar of sessions to drill into.
admin.get('/users/:user_id/conversations/advisor', async (c) => {
  const adminUser = await requireAdmin(c);
  const userId = parseInt(c.req.param('user_id'));
  if (!Number.isFinite(userId)) return c.json({ error: 'Invalid user_id' }, 400);

  const limit = clampLimit(c.req.query('limit'), 50, 200);
  const offset = parseOffset(c.req.query('offset'));
  const search = (c.req.query('q') || '').trim().toLowerCase();
  const since = (c.req.query('since') || '').trim();
  const until = (c.req.query('until') || '').trim();
  const where: string[] = ['c.user_id = ?'];
  const args: any[] = [userId];
  if (since) { where.push('datetime(c.updated_at) >= datetime(?)'); args.push(since); }
  if (until) { where.push('datetime(c.updated_at) <= datetime(?)'); args.push(until); }
  args.push(limit, offset);
  const r: any = await c.env.DB.prepare(
    `SELECT c.id, c.uid, c.persona, c.state, c.current_question_id,
            c.total_questions, c.answered_count, c.skipped_count,
            c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM advisor_messages WHERE conversation_id = c.id) AS message_count,
            (SELECT COUNT(*) FROM advisor_answers
              WHERE conversation_id = c.id AND saved_to_table IS NOT NULL) AS write_count
       FROM advisor_conversations c
      WHERE ${where.join(' AND ')}
      ORDER BY datetime(c.updated_at) DESC, c.id DESC
      LIMIT ? OFFSET ?`,
  ).bind(...args).all();
  let conversations: any[] = r?.results || [];

  // Annotate per-conversation latency / token / model rollups by
  // scanning the most recent assistant meta_json. Cheap because we
  // limit to 1 row per conversation.
  for (const conv of conversations) {
    try {
      const last: any = await c.env.DB.prepare(
        `SELECT meta_json FROM advisor_messages
          WHERE conversation_id = ? AND role = 'assistant' AND meta_json IS NOT NULL
          ORDER BY id DESC LIMIT 1`,
      ).bind(conv.id).first();
      const meta = last?.meta_json ? safeParse(last.meta_json) : null;
      conv.last_model = meta?.model || meta?.provider_model || null;
      conv.last_latency_ms = meta?.latency_ms ?? meta?.latency ?? null;
      conv.last_tokens = meta?.tokens ?? meta?.tokens_used ?? null;
      const total = Number(conv.total_questions) || 0;
      const answered = Number(conv.answered_count) || 0;
      conv.completion_pct = total > 0 ? Math.round((answered / total) * 100) : 0;
    } catch {}
  }

  // In-memory text search across persona + state + uid (D1 LIKE on
  // text columns is cheap; we keep it client-side here so the same
  // payload powers the CSV export). Bounded by the LIMIT clause.
  if (search) {
    conversations = conversations.filter(c =>
      [c.persona, c.state, c.uid, c.last_model].some(v =>
        typeof v === 'string' && v.toLowerCase().includes(search),
      ),
    );
  }

  await auditConversationView(c.env, adminUser, userId, 'admin_listed_advisor_conversations', null);
  await notifyTranscriptViewed(c.env, userId, 'advisor_list');

  // CSV export branch — `?format=csv` returns a flat per-conversation
  // table suitable for spreadsheet review. PII-light: no message
  // content, only metadata.
  if ((c.req.query('format') || '').toLowerCase() === 'csv') {
    const header = ['id','uid','persona','state','created_at','updated_at','total_questions','answered_count','skipped_count','completion_pct','message_count','write_count','last_model','last_latency_ms','last_tokens'];
    const esc = (v: any) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = conversations.map(c => header.map(h => esc((c as any)[h])).join(','));
    const csv = [header.join(','), ...rows].join('\n');
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="advisor-conversations-${userId}.csv"`,
      },
    });
  }

  // Task #34 — surface a `total` count alongside the (already capped)
  // conversations array. Required by the admin user-detail modal so the
  // left-rail badge can show "12 conversations" without re-fetching.
  // Total counts ALL conversations matching the WHERE clause (modulo the
  // in-memory `search` filter, which is reflected in conversations.length
  // since the search is page-local by design).
  let total = conversations.length;
  try {
    const countArgs = args.slice(0, -2); // drop LIMIT + OFFSET
    const countRow: any = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM advisor_conversations c WHERE ${where.join(' AND ')}`,
    ).bind(...countArgs).first();
    if (countRow && Number.isFinite(Number(countRow.n))) total = Number(countRow.n);
  } catch (e) {
    console.warn('[admin/advisor-list] count query failed', (e as Error).message);
  }
  return c.json({ ok: true, conversations, total });
});

// GET /api/admin/users/:user_id/conversations/advisor/:conversation_id
// Returns the message transcript of one specific advisor conversation. The
// conversation_id is verified to belong to user_id before any messages are
// returned, preventing cross-user leakage via id guessing.
admin.get('/users/:user_id/conversations/advisor/:conversation_id', async (c) => {
  const adminUser = await requireAdmin(c);
  const userId = parseInt(c.req.param('user_id'));
  const convId = parseInt(c.req.param('conversation_id'));
  if (!Number.isFinite(userId) || !Number.isFinite(convId)) {
    return c.json({ error: 'Invalid id' }, 400);
  }
  const conv: any = await c.env.DB.prepare(
    `SELECT id, uid, persona, state, current_question_id, total_questions,
            answered_count, skipped_count, created_at, updated_at, user_id
       FROM advisor_conversations
      WHERE id = ?`,
  ).bind(convId).first();
  if (!conv || conv.user_id !== userId) {
    return c.json({ error: 'Conversation not found' }, 404);
  }
  const r: any = await c.env.DB.prepare(
    `SELECT role, question_id, content, meta_json, created_at
       FROM advisor_messages
      WHERE conversation_id = ?
      ORDER BY id ASC
      LIMIT 2000`,
  ).bind(convId).all();
  // Pull saved_to_* per question_id so the UI can render a "sparkle"
  // write indicator on each assistant message that landed a value.
  const ans: any = await c.env.DB.prepare(
    `SELECT question_id, saved_to_table, saved_to_column, saved_to_id, saved_status
       FROM advisor_answers WHERE conversation_id = ?`,
  ).bind(convId).all();
  const writeMap = new Map<string, any>();
  for (const a of (ans?.results || []) as any[]) {
    if (a.question_id) writeMap.set(a.question_id, {
      table: a.saved_to_table, column: a.saved_to_column,
      id: a.saved_to_id, status: a.saved_status,
    });
  }
  const messages = (r?.results || []).map((m: any) => {
    const meta = m.meta_json ? safeParse(m.meta_json) : null;
    const wrote = m.question_id ? (writeMap.get(m.question_id) || null) : null;
    return {
      role: m.role,
      content: m.content,
      ts: m.created_at,
      question_id: m.question_id || null,
      model: meta?.model || meta?.provider_model || null,
      latency_ms: meta?.latency_ms ?? meta?.latency ?? null,
      tokens: meta?.tokens ?? meta?.tokens_used ?? null,
      written_to: wrote,
    };
  });
  const total = Number(conv.total_questions) || 0;
  const answered = Number(conv.answered_count) || 0;
  const completion_pct = total > 0 ? Math.round((answered / total) * 100) : 0;
  const summary = summariseConversation(messages);
  await auditConversationView(c.env, adminUser, userId, 'admin_viewed_advisor_transcript', convId);
  await notifyTranscriptViewed(c.env, userId, 'advisor_transcript');
  return c.json({ ok: true, conversation: conv, messages, summary, completion_pct });
});

// Task #34 — POST /api/admin/users/:user_id/conversations/advisor/export
// Message-level CSV export across one or all advisor conversations for a
// user, optionally filtered by date window / persona / model. Body shape:
//   { from?: ISO, to?: ISO, persona?, model?, conversation_id?: number }
// CSV columns (per spec): ts, role, content, question_id, written_to,
// model, latency_ms. Bounded to 5000 messages to keep the worker memory
// envelope sane.
admin.post('/users/:user_id/conversations/advisor/export', async (c) => {
  const adminUser = await requireAdmin(c);
  const userId = parseInt(c.req.param('user_id'));
  if (!Number.isFinite(userId)) return c.json({ error: 'Invalid user_id' }, 400);
  const body: any = await c.req.json().catch(() => ({}));
  const from = typeof body?.from === 'string' ? body.from : '';
  const to = typeof body?.to === 'string' ? body.to : '';
  const persona = typeof body?.persona === 'string' ? body.persona.toLowerCase() : '';
  const model = typeof body?.model === 'string' ? body.model.toLowerCase() : '';
  const convFilter = Number.isFinite(Number(body?.conversation_id))
    ? Number(body.conversation_id)
    : null;

  const where: string[] = ['c.user_id = ?'];
  const args: any[] = [userId];
  if (convFilter != null) { where.push('c.id = ?'); args.push(convFilter); }
  if (persona) { where.push('LOWER(c.persona) = ?'); args.push(persona); }
  if (from) { where.push('datetime(m.created_at) >= datetime(?)'); args.push(from); }
  if (to) { where.push('datetime(m.created_at) <= datetime(?)'); args.push(to); }

  const r: any = await c.env.DB.prepare(
    `SELECT m.conversation_id, m.role, m.question_id, m.content, m.meta_json, m.created_at AS ts,
            c.persona
       FROM advisor_messages m
       JOIN advisor_conversations c ON c.id = m.conversation_id
      WHERE ${where.join(' AND ')}
      ORDER BY m.conversation_id ASC, m.id ASC
      LIMIT 5000`,
  ).bind(...args).all();
  const rows = (r?.results || []) as any[];

  // Build a writeMap so we can fill the `written_to` column. Single query
  // scoped to the conversations the message rows came from.
  const convIds = Array.from(new Set(rows.map((m) => m.conversation_id))).filter(Boolean);
  const writeMap = new Map<string, string>();
  if (convIds.length) {
    const placeholders = convIds.map(() => '?').join(',');
    const ans: any = await c.env.DB.prepare(
      `SELECT conversation_id, question_id, saved_to_table, saved_to_column
         FROM advisor_answers
        WHERE conversation_id IN (${placeholders}) AND saved_to_table IS NOT NULL`,
    ).bind(...convIds).all();
    for (const a of (ans?.results || []) as any[]) {
      if (!a.question_id) continue;
      const key = `${a.conversation_id}:${a.question_id}`;
      writeMap.set(key, `${a.saved_to_table}${a.saved_to_column ? '.' + a.saved_to_column : ''}`);
    }
  }

  const { csv, skippedByModel, rowCount } = serializeTranscriptCsv(
    rows as TranscriptRow[],
    writeMap as WriteMap,
    model,
  );

  await auditConversationView(
    c.env, adminUser, userId,
    'admin_exported_advisor_transcript',
    convFilter,
  );
  await notifyTranscriptViewed(c.env, userId, 'advisor_transcript');

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="advisor-transcript-${userId}-${stamp}.csv"`,
      'X-Export-Rows': String(rowCount),
      'X-Export-Skipped-Model': String(skippedByModel),
    },
  });
});

// POST /api/admin/maintenance/public-ids/backfill
// One-shot operator endpoint. Walks users in created_at order and
// assigns AXF-/AXP- ids to every founder/partner that doesn't yet
// have one. Idempotent — safe to re-run until counts return zero.
admin.post('/maintenance/public-ids/backfill', async (c) => {
  const adminUser = await requireAdmin(c);
  const limitParam = parseInt(String(c.req.query('limit') || '1000'));
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(5000, limitParam)) : 1000;
  const { backfillPublicIds } = await import('../services/publicIds');
  const result = await backfillPublicIds(c.env, limit);
  try {
    const adminHash = await hashEmail(adminUser.email);
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind(
      'admin_public_ids_backfill',
      `Backfill: assigned ${result.founders_assigned} founder + ${result.partners_assigned} partner public ids in ${result.cursor_ms}ms`,
      adminHash, adminUser.id,
    ).run();
  } catch {}
  return c.json({ ok: true, ...result });
});

// PATCH /api/admin/users/:user_id/access-level — admin grants or revokes
// "limited" access. Limited users can browse the platform without completing
// KYC but the worker rejects any signing attempts (esign /sign/:token).
// Body: { level: 'limited' | null }
admin.patch('/users/:user_id/access-level', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureProfileColumns(c.env);
  const userId = parseInt(c.req.param('user_id'));
  if (!Number.isFinite(userId)) return c.json({ error: 'Invalid user_id' }, 400);
  const body: any = await c.req.json().catch(() => ({}));
  const raw = body?.level;
  // Only `'limited'` and `null` (revoke) are accepted. We deliberately do
  // not expose a 'full' value here — full access is granted via the KYC
  // approve endpoint, which keeps a single source of truth.
  if (raw !== null && raw !== 'limited' && raw !== '') {
    return c.json({ error: "level must be 'limited' or null" }, 400);
  }
  const newLevel: string | null = raw === 'limited' ? 'limited' : null;

  const target: any = await c.env.DB.prepare(
    `SELECT id, email, name, role, access_level, kyc_status FROM users WHERE id = ?`
  ).bind(userId).first();
  if (!target) return c.json({ error: 'User not found' }, 404);
  if (target.role === 'admin') return c.json({ error: "Admins already have full access; access_level is a no-op for them" }, 400);
  if (target.access_level === newLevel) return c.json({ error: 'No change' }, 409);

  await c.env.DB.prepare(`UPDATE users SET access_level = ? WHERE id = ?`).bind(newLevel, userId).run();

  const action = newLevel === 'limited' ? 'access_limited_granted' : 'access_limited_revoked';
  const details = newLevel === 'limited'
    ? `Admin ${adminUser.name} granted limited access (browse-only, no signing) to ${target.name} (user_id=${target.id})`
    : `Admin ${adminUser.name} revoked limited access from ${target.name} (user_id=${target.id})`;
  try {
    // Epic 11 — actors are email_hash, never the plaintext email.
    const adminHash = await hashEmail(adminUser.email);
    const targetHash = await hashEmail(target.email);
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`
    ).bind(action, details, adminHash, adminUser.id).run();
    // Also log on the target so it appears in their own activity timeline.
    const userMsg = newLevel === 'limited'
      ? 'You were granted limited platform access by Axal compliance. You can browse but cannot sign legal agreements until KYC is complete.'
      : 'Your limited platform access was revoked by Axal compliance.';
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`
    ).bind(action, userMsg, targetHash, target.id).run();
  } catch {}

  return c.json({ access_level: newLevel, user_id: userId });
});

// POST /api/admin/users/:user_id/notes — admin updates internal notes.
admin.post('/users/:user_id/notes', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureProfileColumns(c.env);
  const userId = parseInt(c.req.param('user_id'));
  if (!Number.isFinite(userId)) return c.json({ error: 'Invalid user_id' }, 400);
  const body: any = await c.req.json().catch(() => ({}));
  const notes = String(body?.admin_notes ?? '').slice(0, 8000);

  const r: any = await c.env.DB.prepare(
    `UPDATE users SET admin_notes = ? WHERE id = ?`
  ).bind(notes, userId).run();
  if ((r?.meta?.changes || 0) < 1) return c.json({ error: 'User not found' }, 404);

  try {
    const adminHash = await hashEmail(adminUser.email);
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`
    ).bind('admin_notes_updated',
      `Admin ${adminUser.name} updated internal notes (${notes.length} chars)`,
      adminHash, adminUser.id).run();
  } catch {}

  return c.json({ ok: true });
});

// POST /api/admin/users/:user_id/resend-verification — re-send the email
// verification link for users who haven't completed verification.
// Task #7 — Spin-Out Lab cohort admission. Uses a sidecar table because
// users hit D1's 100-column ALTER TABLE limit (migration 154).
let spinoutAdmissionSchemaMigrated = false;
async function ensureSpinoutAdmissionColumns(env: Env): Promise<void> {
  if (spinoutAdmissionSchemaMigrated) return;
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS user_spinout_flags (
        user_id INTEGER PRIMARY KEY,
        spinout_lab_admitted INTEGER NOT NULL DEFAULT 0,
        spinout_lab_cohort TEXT,
        registration_product TEXT
      )`
    ).run();
  } catch {}
  spinoutAdmissionSchemaMigrated = true;
}

// POST /api/admin/users/:user_id/spinout-admit — admit a founder to the
// next Spin-Out Lab cohort. Sets the admitted flag + cohort label and
// sends the branded "You're in" email linking to /spinout-lab. Idempotent:
// re-admitting an already-admitted user just refreshes the cohort label
// and does NOT re-send the email.
admin.post('/users/:user_id/spinout-admit', async (c) => {
  const adminUser = await requireAdmin(c);
  const userId = parseInt(c.req.param('user_id'));
  if (!Number.isFinite(userId)) return c.json({ error: 'Invalid user_id' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { cohort?: unknown };
  const cohort = (typeof body.cohort === 'string' && body.cohort.trim()) || 'Cohort 3';

  await ensureSpinoutAdmissionColumns(c.env);
  const target: any = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, usf.spinout_lab_admitted, u.spinout_lab_active, u.is_incorporated
     FROM users u LEFT JOIN user_spinout_flags usf ON usf.user_id = u.id WHERE u.id = ?`
  ).bind(userId).first();
  if (!target) return c.json({ error: 'User not found' }, 404);
  if (target.role === 'admin') return c.json({ error: 'Admins cannot be admitted to the Lab' }, 400);
  if (Number(target.is_incorporated) === 1) {
    return c.json({ error: 'User is already incorporated — the Lab is a pre-incorporation sprint' }, 409);
  }

  const alreadyAdmitted = Number(target.spinout_lab_admitted) === 1;
  await c.env.DB.prepare(
    `INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted, spinout_lab_cohort)
     VALUES (?, 1, ?)
     ON CONFLICT(user_id) DO UPDATE SET spinout_lab_admitted = 1, spinout_lab_cohort = excluded.spinout_lab_cohort`
  ).bind(userId, cohort).run();

  let emailed = false;
  if (!alreadyAdmitted) {
    try {
      const { send } = await import('../services/email/send');
      const labUrl = `${(c.env.APP_URL || 'https://axal.vc').replace(/\/+$/, '')}/spinout-lab`;
      const r = await send(c.env, 'spinout_admitted', target.email, {
        name: target.name || 'there',
        cohort_label: cohort,
        lab_url: labUrl,
      }, { userId: target.id, ctaUrl: labUrl });
      emailed = !!r?.ok;
    } catch (e) {
      console.error('[admin/spinout-admit] email send failed', e);
    }
  }

  try {
    const adminHash = await hashEmail(adminUser.email);
    const targetHash = await hashEmail(target.email);
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`
    ).bind('spinout_lab_admitted',
      `Admin ${adminUser.name} admitted user_id=${target.id} (email_hash=${targetHash}) to Spin-Out Lab ${cohort}${alreadyAdmitted ? ' (already admitted — cohort refreshed, no email)' : emailed ? '' : ' (email send failed)'}`,
      adminHash, adminUser.id).run();
  } catch {}

  return c.json({ ok: true, cohort, already_admitted: alreadyAdmitted, emailed });
});

// Spin-Out Lab cohort applications — review queue + accept/refuse.
// GET  /spinout-applications           → pending first, newest first
// POST /spinout-applications/:id/decide {decision:'accepted'|'refused'}
//   accepted → sets admitted flags on the user + sends the spinout_admitted
//              email whose CTA links to /spinout-lab (workspace access)
//   refused  → sends the spinout_refused email encouraging a re-apply for
//              the next cohort
admin.get('/spinout-applications', async (c) => {
  await requireAdmin(c);
  let applications: unknown[] = [];
  try {
    const rs = await c.env.DB.prepare(
      `SELECT a.id, a.user_id, u.name, u.email, a.company_name, a.idea,
              a.incorporated, a.stage, a.jurisdiction, a.cohort, a.status,
              a.created_at, a.decided_at
       FROM spinout_applications a
       JOIN users u ON u.id = a.user_id
       ORDER BY CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END,
                a.created_at DESC
       LIMIT 200`,
    ).all();
    applications = rs.results ?? [];
  } catch { /* table not yet migrated → empty queue */ }
  return c.json({ applications });
});

admin.post('/spinout-applications/:app_id/decide', async (c) => {
  const adminUser = await requireAdmin(c);
  const appId = parseInt(c.req.param('app_id'));
  if (!Number.isFinite(appId)) return c.json({ error: 'Invalid application id' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { decision?: unknown; cohort?: unknown };
  const decision = (typeof body.decision === 'string' ? body.decision : '').trim().toLowerCase();
  if (decision !== 'accepted' && decision !== 'refused') {
    return c.json({ error: "decision must be 'accepted' or 'refused'" }, 400);
  }
  // Task #102 — optional cohort override on approval (defaults to the
  // cohort the founder applied to, matching prior behavior).
  const cohortOverride = (typeof body.cohort === 'string' ? body.cohort : '').trim().slice(0, 50);

  const app: any = await c.env.DB.prepare(
    `SELECT a.id, a.user_id, a.company_name, a.cohort, a.status,
            u.email, u.name, u.role, u.is_incorporated
     FROM spinout_applications a JOIN users u ON u.id = a.user_id
     WHERE a.id = ?`,
  ).bind(appId).first();
  if (!app) return c.json({ error: 'Application not found' }, 404);
  if (app.status !== 'pending') return c.json({ error: `Application already ${app.status}` }, 409);

  // Guarded update — WHERE status='pending' makes the decision atomic, so two
  // admins deciding at once can't both trigger emails/admission side effects.
  const upd = await c.env.DB.prepare(
    `UPDATE spinout_applications SET status = ?, decided_at = datetime('now') WHERE id = ? AND status = 'pending'`,
  ).bind(decision, appId).run();
  if ((upd.meta?.changes ?? 1) === 0) {
    return c.json({ error: 'Application was already decided' }, 409);
  }

  // Task #5 — keep the cycle pool (cohort_applicants) in lockstep with the
  // legacy decision so close/capacity counts and the activation job see the
  // same truth: accepted → 'approved' (the cron activates the workspace at
  // the cohort start), refused → 'rejected'. Tables may not exist yet in
  // older dev DBs — best-effort.
  try {
    await c.env.DB.prepare(
      `UPDATE cohort_applicants SET status = ?, decided_at = datetime('now'), decided_by = ?, decision_reason = 'Legacy admin decision'
        WHERE application_id = ? AND status NOT IN ('activated', 'rolled_forward')`,
    ).bind(decision === 'accepted' ? 'approved' : 'rejected', `admin:${adminUser.id}`, appId).run();
  } catch { /* cohort_applicants not yet migrated */ }

  const cohort = cohortOverride || app.cohort || 'Cohort 4';
  const appUrl = (c.env.APP_URL || 'https://axal.vc').replace(/\/+$/, '');
  let emailed = false;
  if (decision === 'accepted') {
    await ensureSpinoutAdmissionColumns(c.env);
    await c.env.DB.prepare(
      `INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted, spinout_lab_cohort)
       VALUES (?, 1, ?)
       ON CONFLICT(user_id) DO UPDATE SET spinout_lab_admitted = 1, spinout_lab_cohort = excluded.spinout_lab_cohort`,
    ).bind(app.user_id, cohort).run();
    try {
      const { send } = await import('../services/email/send');
      const labUrl = `${appUrl}/spinout-lab`;
      const r = await send(c.env, 'spinout_admitted', app.email, {
        name: app.name || 'there',
        cohort_label: cohort,
        lab_url: labUrl,
      }, { userId: app.user_id, ctaUrl: labUrl });
      emailed = !!r?.ok;
    } catch (e) {
      console.error('[admin/spinout-decide] accept email failed', e);
    }
  } else {
    // Next cohort label: "Cohort 4" → "Cohort 5"; fall back gracefully.
    const m = /^Cohort (\d+)$/.exec(cohort);
    const nextCohort = m ? `Cohort ${Number(m[1]) + 1}` : 'the next cohort';
    try {
      const { send } = await import('../services/email/send');
      const applyUrl = `${appUrl}/spinout-lab/apply`;
      const r = await send(c.env, 'spinout_refused', app.email, {
        name: app.name || 'there',
        company_name: app.company_name,
        cohort_label: cohort,
        next_cohort_label: nextCohort,
        apply_url: applyUrl,
      }, { userId: app.user_id, ctaUrl: applyUrl });
      emailed = !!r?.ok;
    } catch (e) {
      console.error('[admin/spinout-decide] refusal email failed', e);
    }
  }

  try {
    const adminHash = await hashEmail(adminUser.email);
    const targetHash = await hashEmail(app.email);
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind(`spinout_application_${decision}`,
      `Admin ${adminUser.name} ${decision} Spin-Out Lab application #${appId} for user_id=${app.user_id} (email_hash=${targetHash}, ${cohort})${emailed ? '' : ' (email send failed)'}`,
      adminHash, adminUser.id).run();
  } catch {}

  return c.json({ ok: true, status: decision, cohort: decision === 'accepted' ? cohort : null, emailed });
});

// Task #102 — Spin-Out Lab participants for the admin dashboard
// (/admin/spinout-lab): every admitted, active, or graduated founder with
// their full program data — week/day, milestone rows, derived unlocked
// tools, and the joined company/project. Dev parity:
// backend/app/api/routes/admin.py GET /admin/spinout-participants.
admin.get('/spinout-participants', async (c) => {
  await requireAdmin(c);

  const catalog = SPINOUT_MILESTONES.map((w) => ({
    week: w.week,
    required_all: w.requiredAll,
    required_any: w.requiredAny ?? [],
    unlocked_features: w.unlockedFeatures,
  }));

  const SPRINT_DAYS = 28;
  const parseTs = (s: string | null | undefined): number | null => {
    if (!s) return null;
    const ms = Date.parse(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z'));
    return Number.isFinite(ms) ? ms : null;
  };
  const daysSince = (startedAt: string | null | undefined): number => {
    const startMs = parseTs(startedAt);
    if (startMs == null) return 0;
    return Math.max(0, Math.floor((Date.now() - startMs) / 86_400_000));
  };

  await ensureSpinoutAdmissionColumns(c.env);
  let rows: any[] = [];
  try {
    const rs = await c.env.DB.prepare(
      `SELECT u.id, u.uid, u.name, u.email,
              usf.spinout_lab_admitted, usf.spinout_lab_cohort,
              u.spinout_lab_active, u.spinout_lab_week,
              u.spinout_lab_started_at, u.is_incorporated,
              p.name AS project_name, p.sector AS project_sector
       FROM users u
       LEFT JOIN user_spinout_flags usf ON usf.user_id = u.id
       LEFT JOIN projects p ON p.founder_id = u.founder_id
       WHERE usf.spinout_lab_admitted = 1
          OR u.spinout_lab_active = 1
          OR u.id IN (SELECT user_id FROM spinout_lab_milestones
                      WHERE milestone_key = 'incorporation_completed')
       ORDER BY u.spinout_lab_started_at ASC, u.id ASC, p.id ASC
       LIMIT 400`,
    ).all();
    rows = (rs.results ?? []) as any[];
  } catch {
    // tables predate the Lab migrations
    return c.json({ participants: [], catalog });
  }

  // Several projects per founder: keep the first row per user (same rule
  // as the public cohort tracker).
  const deduped: any[] = [];
  const seen = new Set<number>();
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    deduped.push(r);
  }

  const msMap = new Map<number, { key: string; week: number; completed_at: string }[]>();
  if (deduped.length > 0) {
    try {
      const placeholders = deduped.map(() => '?').join(',');
      const ms = await c.env.DB.prepare(
        `SELECT user_id, milestone_key, week, completed_at
         FROM spinout_lab_milestones
         WHERE user_id IN (${placeholders})
         ORDER BY week ASC, completed_at ASC`,
      ).bind(...deduped.map((r) => r.id)).all();
      for (const m of (ms.results ?? []) as any[]) {
        const list = msMap.get(m.user_id) ?? [];
        list.push({ key: m.milestone_key, week: Number(m.week), completed_at: m.completed_at });
        msMap.set(m.user_id, list);
      }
    } catch { /* milestones table missing → empty lists */ }
  }

  // Latest application per participant, fetched in ONE query (rows come
  // back newest-first per user; keep the first seen) — a per-row LIMIT 1
  // lookup here would be an N+1 against up to 400 participants. Mirrors
  // the dev backend's _latest_application shape.
  const appMap = new Map<number, any>();
  if (deduped.length > 0) {
    try {
      const placeholders = deduped.map(() => '?').join(',');
      const apps = await c.env.DB.prepare(
        `SELECT user_id, id, company_name, incorporated, stage, jurisdiction,
                cohort, status, created_at, decided_at
         FROM spinout_applications
         WHERE user_id IN (${placeholders})
         ORDER BY user_id ASC, created_at DESC, id DESC`,
      ).bind(...deduped.map((r) => r.id)).all();
      for (const a of (apps.results ?? []) as any[]) {
        if (!appMap.has(a.user_id)) {
          const { user_id: _uid, ...rest } = a;
          appMap.set(a.user_id, rest);
        }
      }
    } catch { /* table not yet migrated */ }
  }

  const participants = [];
  for (const r of deduped) {
    const milestones = msMap.get(r.id) ?? [];
    const completedKeys = new Set(milestones.map((m) => m.key));
    const active = Number(r.spinout_lab_active ?? 0) === 1;
    const graduated = completedKeys.has('incorporation_completed');
    const status = active ? 'active' : graduated ? 'graduated' : 'admitted';
    const week = status === 'graduated' ? 4 : Math.max(0, Math.min(4, Number(r.spinout_lab_week ?? 0)));
    let day: number | null = null;
    let daysRemaining: number | null = null;
    if (status === 'active' && r.spinout_lab_started_at) {
      day = Math.min(SPRINT_DAYS, daysSince(r.spinout_lab_started_at) + 1);
      daysRemaining = Math.max(0, SPRINT_DAYS - daysSince(r.spinout_lab_started_at));
    } else if (status === 'graduated' && r.spinout_lab_started_at) {
      const done = milestones.find((m) => m.key === 'incorporation_completed');
      const startMs = parseTs(r.spinout_lab_started_at);
      const doneMs = parseTs(done?.completed_at);
      if (startMs != null && doneMs != null) {
        day = Math.max(1, Math.floor((doneMs - startMs) / 86_400_000) + 1);
      }
    }
    const application: any = appMap.get(r.id) ?? null;
    participants.push({
      user_id: r.id,
      uid: r.uid ?? null,
      name: r.name ?? null,
      email: r.email,
      admitted: Number(r.spinout_lab_admitted ?? 0) === 1,
      cohort: r.spinout_lab_cohort ?? null,
      status,
      week,
      day,
      days_remaining: daysRemaining,
      started_at: r.spinout_lab_started_at ?? null,
      is_incorporated: Number(r.is_incorporated ?? 0) === 1,
      company_name: r.project_name ?? application?.company_name ?? null,
      sector: r.project_sector ?? null,
      milestones,
      unlocked_features: status !== 'admitted' ? unlockedFeaturesThrough(week) : [],
      application: application ?? null,
    });
  }
  return c.json({ participants, catalog });
});

admin.post('/users/:user_id/resend-verification', async (c) => {
  const adminUser = await requireAdmin(c);
  const userId = parseInt(c.req.param('user_id'));
  if (!Number.isFinite(userId)) return c.json({ error: 'Invalid user_id' }, 400);

  const target: any = await c.env.DB.prepare(
    `SELECT id, email, name, email_verified FROM users WHERE id = ?`
  ).bind(userId).first();
  if (!target) return c.json({ error: 'User not found' }, 404);
  if (target.email_verified) return c.json({ ok: true, already_verified: true });

  // Generate a fresh verification token + email it. The verify route in
  // routes/auth.ts consumes `verification_token`. We mint a 32-byte token
  // and a 24-hour TTL so the link doesn't immediately expire.
  // The /auth/verify-email handler hashes the incoming token and compares
  // against the hashed value in users.verification_token, so we must store
  // the HASH (not the raw token) and email the raw token in the link.
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const rawToken = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const tokenHash = await hashToken(rawToken);
  const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await c.env.DB.prepare(
    `UPDATE users SET verification_token = ?, verification_token_expires = ? WHERE id = ?`
  ).bind(tokenHash, expires, userId).run();

  // Best-effort email send via Gmail OAuth helper (already used elsewhere).
  // If creds aren't configured we still succeed at the DB write so the user
  // can be verified manually.
  let emailed = false;
  try {
    const { sendVerificationEmail } = await import('../services/email');
    const verifyUrl = `${c.env.APP_URL || 'https://axal.vc'}/verify-email?token=${rawToken}`;
    emailed = await sendVerificationEmail(c.env, target.email, target.name || '', verifyUrl);
  } catch (e: any) {
    console.error('[admin/resend-verification] email send failed', e);
  }

  try {
    // Epic 11 — actor is email_hash. Details references user_id and
    // target email_hash rather than the plaintext email so admin-only
    // log readers still see who-was-touched without storing the address.
    const adminHash = await hashEmail(adminUser.email);
    const targetHash = await hashEmail(target.email);
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`
    ).bind('admin_resent_verification',
      `Admin ${adminUser.name} re-sent verification email to user_id=${target.id} (email_hash=${targetHash})${emailed ? '' : ' (email send failed — token still rotated)'}`,
      adminHash, adminUser.id).run();
  } catch {}

  return c.json({ ok: true, already_verified: false, emailed });
});

// Task #6 — deploy-time TOTP remediation. Operators run this immediately
// after a deploy that ships the new auth_totp/auth_sms schema; it migrates
// every legacy base32 secret out of users.password_hash, sets
// password_reset_required, and emails each affected user a forced-reset
// link. Idempotent — repeated invocations over a clean DB are no-ops.
// Also wired into the daily 04:20 UTC cron as a backup.
admin.post('/maintenance/totp-remediation', async (c) => {
  await requireFactor(c, 'totp');
  await requireStepUp(c); // BLOCK-AUTH-03 — require a RECENT TOTP, not just a TOTP-minted session
  await requireAdmin(c);
  const result = await runTotpRemediation(c.env);
  return c.json({ ok: true, ...result });
});

admin.post('/impersonate/:userId', async (c) => {
  // Task #6 — impersonation is a high-risk step-up. The admin's current
  // session must have authenticated with TOTP (not SMS, not a recovery
  // code). requireFactor throws 'TOTP required' (→403) otherwise.
  await requireFactor(c, 'totp');
  await requireStepUp(c); // BLOCK-AUTH-03 — require a RECENT TOTP, not just a TOTP-minted session
  const adminUser = await requireAdmin(c);
  const userId = parseInt(c.req.param('userId'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'User not found' }, 404); }
  const target = rows[0];
  const token = await createJWT(c.env, target.id, target.email, target.role, adminUser.id);
  // Epic 11 — actor is email_hash, details references user_id only.
  const impAdminHash = await hashEmail(adminUser.email);
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('admin_impersonate', ${`Admin ${adminUser.name} impersonated user ${target.name} (user_id=${target.id})`}, ${impAdminHash}, ${adminUser.id})`;
  await sql.end();
  // Cohort Timing task — full session audit trail. `context` (optional
  // query param, e.g. 'cohort_review:week=2') records WHY the session was
  // opened; the session id is returned so the client can close it via
  // POST /impersonate-sessions/:id/end when exiting the founder view.
  let impersonationSessionId: number | null = null;
  try {
    const { ensureCohortTimingSchema } = await import('../services/cohortTiming');
    await ensureCohortTimingSchema(c.env);
    const ctx = (c.req.query('context') || '').slice(0, 200) || null;
    const ins = await c.env.DB.prepare(
      `INSERT INTO impersonation_sessions (admin_user_id, target_user_id, context) VALUES (?, ?, ?)`,
    ).bind(adminUser.id, target.id, ctx).run();
    impersonationSessionId = Number(ins.meta?.last_row_id ?? 0) || null;
  } catch (e) { console.warn('[admin/impersonate] session audit failed', e); }
  return c.json({ token, user: { id: target.id, email: target.email, name: target.name, role: target.role }, impersonation_session_id: impersonationSessionId });
});

// Close an impersonation session (audit end timestamp). Fired best-effort
// by the client when the admin exits the founder view; sessions left open
// simply show ended_at=null in the audit list.
admin.post('/impersonate-sessions/:id/end', async (c) => {
  const adminUser = await requireAdmin(c);
  const id = parseInt(c.req.param('id')) || 0;
  try {
    await c.env.DB.prepare(
      `UPDATE impersonation_sessions SET ended_at = datetime('now') WHERE id = ? AND admin_user_id = ? AND ended_at IS NULL`,
    ).bind(id, adminUser.id).run();
  } catch (e) { console.warn('[admin/impersonate-sessions] end failed', e); }
  return c.json({ ok: true });
});

admin.patch('/users/:userId/role', async (c) => {
  const adminUser = await requireAdmin(c);
  const userId = parseInt(c.req.param('userId'));
  // Frontend sends `?role=...` as a query parameter (matches the FastAPI
  // signature `def update_user_role(user_id, role: str, ...)`). Older clients
  // posted it in the JSON body; accept either so we don't break them.
  let role = c.req.query('role');
  if (!role) {
    try { role = (await c.req.json()).role; } catch {}
  }
  // Task #9 follow-up — 'exploring' is a valid destination role so admins
  // can move a user (e.g. a partner) back into the holding state for
  // re-review, from the same dropdown used for founder/partner/investor.
  if (!role || !['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'].includes(role)) {
    return c.json({ error: `Invalid role: ${role}` }, 400);
  }
  // Security policy: admin promotion is NOT allowed via this endpoint.
  // The only way to grant admin is via direct SQL against the D1 database.
  // Keeps the blast radius of a compromised admin session bounded — they
  // cannot mint new admins to entrench access.
  if (role === 'admin') {
    return c.json({
      error: 'Admin role can only be granted via direct database SQL (security policy).',
      code: 'admin_promotion_disabled',
    }, 403);
  }

  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'User not found' }, 404); }
  if (rows[0].id === adminUser.id) { await sql.end(); return c.json({ error: 'Cannot change your own role' }, 400); }
  // Same policy on the other side: an existing admin cannot be demoted via
  // this endpoint either. Use SQL. This prevents accidental lockout of the
  // last admin and prevents one admin from quietly silencing another.
  if (rows[0].role === 'admin') {
    await sql.end();
    return c.json({
      error: 'Existing admin role can only be changed via direct database SQL (security policy).',
      code: 'admin_demotion_disabled',
    }, 403);
  }
  // Task #9 follow-up — a user already in 'exploring' can only be moved to
  // founder/partner/investor/advisor through the binding-agreement-gated
  // /api/admin/exploring/users/:id/assign-role flow, never this generic
  // endpoint. Without this guard an admin could bypass the signed binding
  // agreement requirement simply by using the Users table dropdown instead
  // of the Exploring Users queue.
  if (String(rows[0].role).toLowerCase() === 'exploring' && role !== 'exploring') {
    await sql.end();
    return c.json({
      error: 'This user is in the exploring holding state. Assign their final role from the Exploring Users queue (requires a signed binding agreement).',
      code: 'use_exploring_assign_role',
    }, 409);
  }

  const oldRole = rows[0].role;
  if (role === 'exploring') await ensureExploringSchema(c.env);
  await sql`UPDATE users SET role = ${role} WHERE id = ${userId}`;

  // Task #9 follow-up — moving a user INTO 'exploring' resets any stale
  // assignment state from a prior review cycle so they reappear in the
  // Exploring Users queue needing fresh review (not shown as already
  // assigned). Suggested-role / binding-envelope history is left intact —
  // an admin resending the binding agreement overwrites it anyway.
  if (role === 'exploring') {
    try {
      await c.env.DB.prepare(
        `INSERT INTO user_role_review (user_id, updated_at) VALUES (?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET
           role_confirmed = 0,
           assigned_role = NULL,
           assigned_by_user_id = NULL,
           assigned_at = NULL,
           updated_at = datetime('now')`
      ).bind(userId).run();
    } catch (e) { console.error('[admin/role-change] exploring review reset failed', (e as Error).message); }
  }

  // Task #1 (DB) — when an admin promotes someone to founder/partner,
  // immediately allocate their public AXF-/AXP- id so it is visible
  // in the profile pane and ready for any contract send. Idempotent.
  try {
    if (role === 'founder') {
      const { assignFounderPublicId } = await import('../services/publicIds');
      await assignFounderPublicId(c.env, userId);
    } else if (role === 'partner') {
      const { assignPartnerPublicId } = await import('../services/publicIds');
      await assignPartnerPublicId(c.env, userId);
    }
  } catch (e) {
    console.error('[admin/role-change] public-id assign failed', (e as Error).message);
  }
  try { const { Jobs } = await import('../models/jobs'); await Jobs.enqueue(c.env, 'embed_entity', { type: 'partner', id: userId }); } catch {}
  // Task #3 (Y-1) — re-seed Trust Center obligations for the new role.
  // pruneStaleForRole=true marks obligations no longer required (e.g.
  // investor-only KYC after demotion to partner) as `waived` instead of
  // deleting them, preserving the audit trail.
  try {
    const { seedObligations } = await import('../services/trust');
    await seedObligations(c.env, userId, role, { pruneStaleForRole: true });
  } catch (e) { console.error('[admin] trust re-seed failed', e); }
  // Epic 11 — actor on both rows is email_hash, never the plaintext.
  const roleAdminHash = await hashEmail(adminUser.email);
  const roleTargetHash = await hashEmail(rows[0].email);
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('role_changed', ${`Admin ${adminUser.name} changed ${rows[0].name}'s role from ${oldRole} to ${role}`}, ${roleAdminHash}, ${adminUser.id})`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('your_role_changed', ${`Your role was changed from ${oldRole} to ${role} by ${adminUser.name}`}, ${roleTargetHash}, ${rows[0].id})`;
  await sql.end();
  return c.json({ message: `Role updated to ${role}`, user_id: userId, role });
});

admin.patch('/users/:userId/toggle-active', async (c) => {
  const adminUser = await requireAdmin(c);
  const userId = parseInt(c.req.param('userId'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'User not found' }, 404); }
  if (rows[0].id === adminUser.id) { await sql.end(); return c.json({ error: 'Cannot deactivate yourself' }, 400); }

  const newActive = !rows[0].is_active;
  await sql`UPDATE users SET is_active = ${newActive} WHERE id = ${userId}`;
  // Epic 11 — actor on both rows is email_hash, never the plaintext.
  const tgAdminHash = await hashEmail(adminUser.email);
  const tgTargetHash = await hashEmail(rows[0].email);
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('user_toggled', ${`Admin ${adminUser.name} ${newActive ? 'activated' : 'deactivated'} user ${rows[0].name}`}, ${tgAdminHash}, ${adminUser.id})`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('account_status_changed', ${`Your account was ${newActive ? 'activated' : 'deactivated'} by an Axal admin`}, ${tgTargetHash}, ${rows[0].id})`;
  await sql.end();
  return c.json({ message: `User ${newActive ? 'activated' : 'deactivated'}`, is_active: newActive });
});

// ---------------------------------------------------------------------------
// Task #7 (AM) — Project trash management. Founder DELETE soft-deletes the
// project (sets deleted_at); these admin-only endpoints surface the trash
// list and allow Restore / hard-delete actions. The 30-day cron sweep that
// physically purges old rows lives in services/projectTrash.ts.
// ---------------------------------------------------------------------------

admin.get('/projects/trash', async (c) => {
  await requireAdmin(c);
  const limit = clampLimit(c.req.query('limit'), 100, 200);
  const offset = parseOffset(c.req.query('offset'));
  const res: any = await c.env.DB.prepare(
    `SELECT p.id, p.uid, p.name, p.sector, p.stage, p.status, p.founder_id, p.deleted_at, p.created_at,
            f.name AS founder_name, f.email AS founder_email
       FROM projects p
       LEFT JOIN founders f ON f.id = p.founder_id
      WHERE p.deleted_at IS NOT NULL
      ORDER BY datetime(p.deleted_at) DESC
      LIMIT ? OFFSET ?`,
  ).bind(limit, offset).all();
  return c.json({ projects: res?.results || [] });
});

admin.post('/projects/:id/restore', async (c) => {
  const adminUser = await requireAdmin(c);
  const id = parseInt(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid project id' }, 400);
  const proj: any = await c.env.DB.prepare(
    `SELECT id, name, deleted_at FROM projects WHERE id = ?`,
  ).bind(id).first();
  if (!proj) return c.json({ error: 'Project not found' }, 404);
  if (!proj.deleted_at) return c.json({ ok: true, already_active: true });
  await c.env.DB.prepare(`UPDATE projects SET deleted_at = NULL WHERE id = ?`).bind(id).run();
  try {
    const adminHash = await hashEmail(adminUser.email);
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id, project_id) VALUES (?, ?, ?, ?, ?)`,
    ).bind('project_restored',
      `Admin ${adminUser.name} restored project ${proj.name} (id=${id})`,
      adminHash, adminUser.id, id).run();
  } catch {}
  return c.json({ ok: true, restored: true });
});

admin.delete('/projects/:id/hard-delete', async (c) => {
  const adminUser = await requireAdmin(c);
  const id = parseInt(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid project id' }, 400);
  const proj: any = await c.env.DB.prepare(
    `SELECT id, name FROM projects WHERE id = ?`,
  ).bind(id).first();
  if (!proj) return c.json({ error: 'Project not found' }, 404);
  const { hardDeleteProject } = await import('../services/projectTrash');
  try {
    await hardDeleteProject(c.env, id);
  } catch (e) {
    console.error('[admin/hard-delete] failed', id, (e as Error).message);
    return c.json({ error: 'Hard delete failed', detail: (e as Error).message }, 409);
  }
  try {
    const adminHash = await hashEmail(adminUser.email);
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind('project_hard_deleted',
      `Admin ${adminUser.name} hard-deleted project ${proj.name} (id=${id})`,
      adminHash, adminUser.id).run();
  } catch {}
  try { const { Jobs } = await import('../models/jobs'); await Jobs.enqueue(c.env, 'embed_delete', { type: 'project', id }); } catch {}
  return c.json({ ok: true, hard: true });
});

export default admin;
