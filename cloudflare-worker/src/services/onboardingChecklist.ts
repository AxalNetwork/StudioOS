/**
 * Task #6 (IF) — Per-role onboarding checklist.
 *
 * Single source of truth for the 5 × 10 catalogue + lazy auto-detect.
 *
 * Design notes:
 *  - We do NOT wire bespoke hooks at every side-effect callsite (Stripe
 *    connect, calendar connect, OKR save, …). Instead `GET
 *    /api/onboarding/checklist` runs a batch of best-effort SELECTs to
 *    decide which items have effectively been satisfied, then flips
 *    them in `onboarding_checklist_progress` once. The dashboard fetches
 *    the checklist on mount so a brand-new user who completes Stripe in
 *    another tab will see the item flipped on the next dashboard load
 *    without us touching the Stripe provider code.
 *  - Every detect SELECT is wrapped in try/catch returning false because
 *    several auxiliary tables (`compliance_records`, `pairwise_ndas`,
 *    `match_scores`, `services_offerings`, etc.) may not exist on every
 *    deploy (older migrations or feature-gated). A missing table never
 *    fails the dashboard.
 *  - Item keys are NEVER renamed; new items append to the end of a role.
 */

import type { Env } from '../types';

export type ChecklistRole =
  | 'newFounder'
  | 'existingFounder'
  | 'investor'
  | 'operatingPartner'
  | 'mentor';

export interface ChecklistItem {
  key: string;
  label: string;
  description?: string;
  route: string;        // SPA path the row links to
  autoDetect: boolean;  // whether the lazy auto-detect tries to satisfy it
}

// IMPORTANT: every `route` below MUST match a mounted SPA path in
// `frontend/src/App.jsx` AND be reachable for the role this catalogue
// targets (see the `guard([...])` role lists on each <Route>). The
// reviewer flagged route-drift on the first pass; routes here were
// normalised against App.jsx 2026-05-20.
export const CATALOG: Record<ChecklistRole, ChecklistItem[]> = {
  newFounder: [
    { key: 'nf.persona',    label: 'Complete persona chatbot',           route: '/onboarding/persona',         autoDetect: true },
    { key: 'nf.project',    label: 'Add your project',                   route: '/projects',                   autoDetect: true },
    { key: 'nf.discovery',  label: 'Log 3 customer-discovery interviews',route: '/customer-discovery',         autoDetect: true },
    { key: 'nf.okrs',       label: 'Add 3 quarterly OKRs',               route: '/build/roadmap',              autoDetect: true },
    { key: 'nf.calendar',   label: 'Connect Google or Outlook Calendar', route: '/calendar',                   autoDetect: true },
    { key: 'nf.brand',      label: 'Upload or generate brand basics',    route: '/build/brand',                autoDetect: true },
    { key: 'nf.deck',       label: 'Draft pitch deck (5+ slides)',       route: '/build/deck',                 autoDetect: true },
    // /scoring is gated to admin/partner/investor — founders run scoring
    // from the project detail page, so the row links to the project list.
    { key: 'nf.scoring',    label: 'Run your first scoring',             route: '/projects',                   autoDetect: true },
    { key: 'nf.mentor',     label: 'Book a mentor session',              route: '/mentors',                    autoDetect: true },
    { key: 'nf.team',       label: 'Invite a team member',               route: '/settings/account',           autoDetect: true },
  ],
  existingFounder: [
    { key: 'ef.persona',    label: 'Complete persona chatbot',           route: '/onboarding/persona',         autoDetect: true },
    // /integrations is partner/investor-only; founders manage connectors
    // via Settings → Integrations.
    { key: 'ef.stripe',     label: 'Connect Stripe (verify MRR)',        route: '/settings/integrations',      autoDetect: true },
    { key: 'ef.plaid',      label: 'Connect Plaid (verify cash)',        route: '/settings/integrations',      autoDetect: true },
    { key: 'ef.captable',   label: 'Connect or upload cap table',        route: '/build/captable',             autoDetect: true },
    { key: 'ef.financials', label: 'Populate financial model',           route: '/build/financials',           autoDetect: true },
    { key: 'ef.83b',        label: 'Confirm 83(b) status',               route: '/incorporate/83b',            autoDetect: true },
    { key: 'ef.ip',         label: 'Confirm IP assignments signed',      route: '/compliance',                 autoDetect: true },
    { key: 'ef.okrs',       label: 'Add 3 quarterly OKRs',               route: '/build/roadmap',              autoDetect: true },
    { key: 'ef.scoring',    label: 'Run scoring with verified evidence', route: '/projects',                   autoDetect: true },
    { key: 'ef.nda',        label: 'Send first NDA to an investor',      route: '/trust',                      autoDetect: true },
  ],
  investor: [
    { key: 'inv.persona',   label: 'Complete persona chatbot',           route: '/onboarding/persona',         autoDetect: true },
    { key: 'inv.kyc',       label: 'Complete KYC + Accreditation',       route: '/kyc',                        autoDetect: true },
    { key: 'inv.nda',       label: 'Sign Investor NDA with Axal',        route: '/trust',                      autoDetect: true },
    { key: 'inv.thesis',    label: 'Save your thesis + watchlist',       route: '/watchlist',                  autoDetect: true },
    { key: 'inv.crm',       label: 'Connect Affinity / HubSpot (optional)', route: '/integrations',            autoDetect: true },
    { key: 'inv.review',    label: 'Review 3 matched founders',          route: '/matches',                    autoDetect: true },
    { key: 'inv.intro',     label: 'Request your first intro',           route: '/matches',                    autoDetect: true },
    { key: 'inv.target',    label: 'Set deployment target + reserve %',  route: '/settings/profile',           autoDetect: true },
    { key: 'inv.dealroom',  label: 'Open your first deal-room',          route: '/deals',                      autoDetect: true },
    { key: 'inv.notifs',    label: 'Configure notifications',            route: '/settings/notifications',     autoDetect: true },
  ],
  operatingPartner: [
    { key: 'op.accept',     label: 'Accept partner invitation',          route: '/partner-portal',             autoDetect: true },
    { key: 'op.profile',    label: 'Complete profiling chatbot',         route: '/onboarding/persona',         autoDetect: true },
    { key: 'op.conflicts',  label: 'Disclose conflicts',                 route: '/partner-portal',             autoDetect: true },
    { key: 'op.deal_type',  label: 'Pick deal-type proposal + sign',     route: '/partner-portal',             autoDetect: true },
    // Task #2 — KYC is investor-only, so the partner KYB step no longer
    // deep-links to /kyc (which now renders a "not required" state for
    // non-investors). The item still tracks KYB completion; admins handle
    // KYB collection via the partner portal.
    { key: 'op.kyb',        label: 'Configure KYB documents',            route: '/partner-portal',             autoDetect: true },
    { key: 'op.service',    label: 'Add at least one service / offer',   route: '/services',                   autoDetect: true },
    { key: 'op.refs',       label: 'Provide 2 references',               route: '/settings/profile',           autoDetect: true },
    { key: 'op.referral',   label: 'Receive one-time referral code',     route: '/refer',                      autoDetect: true },
    { key: 'op.intro',      label: 'Make first qualified intro',         route: '/pipeline',                   autoDetect: true },
    { key: 'op.notifs',     label: 'Configure notifications',            route: '/settings/notifications',     autoDetect: true },
  ],
  // Mentors are NOT allowed on /onboarding/persona, /trust, or
  // /integrations per App.jsx guards — mentor onboarding stays inside
  // Settings + Office Hours.
  mentor: [
    { key: 'mt.persona',    label: 'Complete profiling chatbot',         route: '/settings/profile',           autoDetect: true },
    { key: 'mt.tags',       label: 'Add expertise tags + sectors + stages', route: '/settings/profile',        autoDetect: true },
    { key: 'mt.comp',       label: 'Pick comp model',                    route: '/mentors',                    autoDetect: true },
    { key: 'mt.calendar',   label: 'Connect Calendly or Google Calendar',route: '/calendar',                   autoDetect: true },
    { key: 'mt.refs',       label: 'Provide 2 references',               route: '/settings/profile',           autoDetect: true },
    { key: 'mt.nda',        label: 'Sign Mentor NDA + disclaimer',       route: '/settings/security',          autoDetect: true },
    { key: 'mt.capacity',   label: 'Set weekly capacity',                route: '/office-hours',               autoDetect: true },
    { key: 'mt.slots',      label: 'Surface availability slots',         route: '/office-hours',               autoDetect: true },
    { key: 'mt.booking',    label: 'Accept first session booking',       route: '/office-hours',               autoDetect: true },
    { key: 'mt.notifs',     label: 'Configure notifications',            route: '/settings/notifications',     autoDetect: true },
  ],
};

export const TOTAL_ITEMS = 10;
export const CELEBRATION_THRESHOLD = 8;

/**
 * Resolve which catalog a given user gets. Falls back to newFounder for
 * unknown roles (admins included — admins see the founder checklist when
 * they sign in as themselves; impersonation surfaces the impersonated
 * user's role separately via the existing impersonation context).
 */
export function resolveRole(user: { role?: string | null }, primaryPersonaId?: string | null): ChecklistRole {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'investor') return 'investor';
  if (role === 'partner') return 'operatingPartner';
  if (role === 'mentor') return 'mentor';
  if (role === 'founder' || role === 'admin') {
    // Canonical persona IDs are `founder_new` / `founder_existing`
    // (see cloudflare-worker/src/personas.ts + frontend/src/lib/personas.js).
    // We also accept legacy aliases like `existing_founder` /
    // `existing-founder` defensively so an older row still routes correctly.
    const p = String(primaryPersonaId || '').toLowerCase();
    if (
      p === 'founder_existing' ||
      p.startsWith('existing_') ||
      p.includes('existing-founder') ||
      p.includes('existing_founder')
    ) return 'existingFounder';
    return 'newFounder';
  }
  return 'newFounder';
}

async function ensureSchema(env: Env): Promise<void> {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS onboarding_checklist_progress (
         user_id INTEGER NOT NULL,
         item_key TEXT NOT NULL,
         completed_at DATETIME,
         skipped_at DATETIME,
         source TEXT,
         PRIMARY KEY (user_id, item_key)
       )`,
    ).run();
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS onboarding_meta (
         user_id INTEGER PRIMARY KEY,
         tour_seen_at DATETIME,
         celebration_shown_at DATETIME,
         panel_collapsed INTEGER DEFAULT 0,
         updated_at DATETIME DEFAULT (datetime('now'))
       )`,
    ).run();
  } catch (e: any) {
    console.warn('[onboarding-checklist] ensureSchema:', e?.message);
  }
}

/** Best-effort SELECT — returns the first column of the first row as a
 * number, or 0 on any failure (missing table/column included). */
async function num(env: Env, sql: string, ...binds: any[]): Promise<number> {
  try {
    const row = await env.DB.prepare(sql).bind(...binds).first<any>();
    if (!row) return 0;
    const v = Object.values(row)[0] as any;
    const n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Per-item autodetect predicates. Return `true` when the side-effect has
 * already been observed. Each predicate must be cheap (a single COUNT
 * query at most) — the suite runs on every dashboard load.
 */
async function detect(env: Env, userId: number, key: string, primaryPersonaId?: string | null): Promise<boolean> {
  switch (key) {
    // ----- persona (all roles) -----
    case 'nf.persona':
    case 'ef.persona':
    case 'inv.persona':
    case 'mt.persona':
    case 'op.profile':
      return (await num(env, `SELECT COUNT(*) FROM user_personas WHERE user_id = ? AND is_primary = 1`, userId)) > 0;

    // ----- newFounder side-effects -----
    case 'nf.project':
      return (await num(env,
        `SELECT COUNT(*) FROM projects p
           JOIN founders f ON f.id = p.founder_id
           JOIN users u ON u.founder_id = f.id
          WHERE u.id = ? AND (p.deleted_at IS NULL)`, userId)) > 0;
    case 'nf.discovery':
      return (await num(env,
        `SELECT COUNT(*) FROM discovery_interviews di
           JOIN projects p ON p.id = di.project_id
           JOIN founders f ON f.id = p.founder_id
           JOIN users u ON u.founder_id = f.id
          WHERE u.id = ?`, userId)) >= 3;
    case 'nf.okrs':
    case 'ef.okrs':
      return (await num(env,
        `SELECT COUNT(*) FROM roadmap_okrs r
           JOIN projects p ON p.id = r.project_id
           JOIN founders f ON f.id = p.founder_id
           JOIN users u ON u.founder_id = f.id
          WHERE u.id = ?`, userId)) >= 3;
    case 'nf.calendar':
    case 'mt.calendar':
      // any of: google_calendar / microsoft_calendar / calendly active integration, or legacy google_oauth tokens row
      if ((await num(env,
        `SELECT COUNT(*) FROM integrations
          WHERE user_id = ? AND status = 'active'
            AND provider_key IN ('google_calendar','microsoft_calendar','calendly','google','outlook')`,
        userId)) > 0) return true;
      return (await num(env, `SELECT COUNT(*) FROM google_oauth_tokens WHERE user_id = ?`, userId)) > 0;
    case 'nf.brand':
      return (await num(env,
        `SELECT COUNT(*) FROM landing_pages l
           JOIN projects p ON p.id = l.project_id
           JOIN founders f ON f.id = p.founder_id
           JOIN users u ON u.founder_id = f.id
          WHERE u.id = ?`, userId)) > 0;
    case 'nf.deck':
      return (await num(env,
        `SELECT COUNT(*) FROM pitch_decks d
           JOIN projects p ON p.id = d.project_id
           JOIN founders f ON f.id = p.founder_id
           JOIN users u ON u.founder_id = f.id
          WHERE u.id = ?`, userId)) > 0;
    case 'nf.scoring':
    case 'ef.scoring':
      return (await num(env,
        `SELECT COUNT(*) FROM score_snapshots s
           JOIN projects p ON p.id = s.project_id
           JOIN founders f ON f.id = p.founder_id
           JOIN users u ON u.founder_id = f.id
          WHERE u.id = ?`, userId)) > 0;
    case 'nf.mentor':
      return (await num(env, `SELECT COUNT(*) FROM expert_bookings WHERE founder_user_id = ?`, userId)) > 0;
    case 'nf.team':
      return (await num(env, `SELECT COUNT(*) FROM founder_invites WHERE inviter_user_id = ?`, userId)) > 0;

    // ----- existingFounder side-effects -----
    case 'ef.stripe':
      return (await num(env,
        `SELECT COUNT(*) FROM integrations WHERE user_id = ? AND provider_key = 'stripe' AND status = 'active'`,
        userId)) > 0;
    case 'ef.plaid':
      return (await num(env,
        `SELECT COUNT(*) FROM integrations WHERE user_id = ? AND provider_key = 'plaid' AND status = 'active'`,
        userId)) > 0;
    case 'ef.captable':
      if ((await num(env,
        `SELECT COUNT(*) FROM integrations WHERE user_id = ? AND provider_key = 'carta' AND status = 'active'`,
        userId)) > 0) return true;
      // either captable_holders or cap_table_holders
      if ((await num(env,
        `SELECT COUNT(*) FROM captable_holders ch
           JOIN projects p ON p.id = ch.project_id
           JOIN founders f ON f.id = p.founder_id
           JOIN users u ON u.founder_id = f.id WHERE u.id = ?`, userId)) > 0) return true;
      return (await num(env,
        `SELECT COUNT(*) FROM cap_table_holders ch
           JOIN projects p ON p.id = ch.project_id
           JOIN founders f ON f.id = p.founder_id
           JOIN users u ON u.founder_id = f.id WHERE u.id = ?`, userId)) > 0;
    case 'ef.financials':
      return (await num(env, `SELECT COUNT(*) FROM financial_models WHERE user_id = ?`, userId)) > 0;
    case 'ef.83b':
      return (await num(env,
        `SELECT COUNT(*) FROM compliance_records WHERE user_id = ? AND (LOWER(type) LIKE '%83b%' OR LOWER(record_type) LIKE '%83b%')`,
        userId)) > 0;
    case 'ef.ip':
      return (await num(env,
        `SELECT COUNT(*) FROM compliance_records WHERE user_id = ? AND (LOWER(type) LIKE '%ip%' OR LOWER(record_type) LIKE '%ip%')`,
        userId)) > 0;
    case 'ef.nda':
    case 'inv.nda':
    case 'mt.nda':
      if ((await num(env, `SELECT COUNT(*) FROM esign_envelopes WHERE created_by = ?`, userId)) > 0) return true;
      return (await num(env, `SELECT COUNT(*) FROM pairwise_ndas WHERE user_a = ? OR user_b = ?`, userId, userId)) > 0;

    // ----- investor side-effects -----
    case 'inv.kyc':
      return (await num(env,
        `SELECT COUNT(*) FROM kyc_records WHERE user_id = ? AND LOWER(status) IN ('approved','passed','verified')`,
        userId)) > 0;
    case 'inv.thesis':
      return (await num(env,
        `SELECT COUNT(*) FROM investor_profiles WHERE user_id = ? AND thesis IS NOT NULL AND thesis <> ''`,
        userId)) > 0;
    case 'inv.crm':
      return (await num(env,
        `SELECT COUNT(*) FROM integrations WHERE user_id = ?
            AND status = 'active'
            AND provider_key IN ('affinity','hubspot','salesforce')`,
        userId)) > 0;
    case 'inv.review':
      return (await num(env, `SELECT COUNT(*) FROM match_scores WHERE investor_user_id = ?`, userId)) >= 3;
    case 'inv.intro':
      return (await num(env, `SELECT COUNT(*) FROM investor_introductions WHERE investor_user_id = ?`, userId)) > 0;
    case 'inv.target':
      return (await num(env,
        `SELECT COUNT(*) FROM investor_profiles
          WHERE user_id = ? AND (deployment_target_cents IS NOT NULL OR reserve_percent IS NOT NULL)`,
        userId)) > 0;
    case 'inv.dealroom':
      return (await num(env, `SELECT COUNT(*) FROM investor_dealroom_members WHERE investor_user_id = ?`, userId)) > 0;
    case 'inv.notifs':
    case 'op.notifs':
    case 'mt.notifs':
      return (await num(env, `SELECT COUNT(*) FROM user_preferences WHERE user_id = ?`, userId)) > 0;

    // ----- operatingPartner side-effects -----
    case 'op.accept':
      return (await num(env,
        `SELECT COUNT(*) FROM partner_invitations
          WHERE (accepted_user_id = ? OR LOWER(email) = (SELECT LOWER(email) FROM users WHERE id = ?))
            AND (redeemed_at IS NOT NULL OR status = 'accepted')`,
        userId, userId)) > 0;
    case 'op.conflicts':
      return (await num(env,
        `SELECT COUNT(*) FROM partner_profiles WHERE user_id = ? AND conflicts_disclosed_at IS NOT NULL`,
        userId)) > 0;
    case 'op.deal_type':
      return (await num(env,
        `SELECT COUNT(*) FROM partner_deals WHERE partner_user_id = ? AND signed_at IS NOT NULL`,
        userId)) > 0;
    case 'op.kyb':
      return (await num(env,
        `SELECT COUNT(*) FROM kyc_records WHERE user_id = ? AND (LOWER(kind) = 'kyb' OR LOWER(record_type) = 'kyb')`,
        userId)) > 0;
    case 'op.service':
      return (await num(env, `SELECT COUNT(*) FROM services_offerings WHERE owner_user_id = ?`, userId)) > 0
          || (await num(env, `SELECT COUNT(*) FROM service_offerings WHERE user_id = ?`, userId)) > 0;
    case 'op.refs':
      return (await num(env, `SELECT COUNT(*) FROM references_records WHERE user_id = ?`, userId)) >= 2;
    case 'op.referral':
      return (await num(env, `SELECT COUNT(*) FROM referral_invites WHERE owner_user_id = ?`, userId)) > 0;
    case 'op.intro':
      return (await num(env,
        `SELECT COUNT(*) FROM investor_introductions WHERE source_user_id = ? OR introducer_user_id = ?`,
        userId, userId)) > 0;

    // ----- mentor side-effects -----
    case 'mt.tags':
      return (await num(env,
        `SELECT COUNT(*) FROM experts WHERE user_id = ? AND tags IS NOT NULL AND tags <> '' AND tags <> '[]'`,
        userId)) > 0;
    case 'mt.comp':
      return (await num(env,
        `SELECT COUNT(*) FROM experts WHERE user_id = ? AND comp_model IS NOT NULL AND comp_model <> ''`,
        userId)) > 0;
    case 'mt.refs':
      return (await num(env, `SELECT COUNT(*) FROM references_records WHERE user_id = ?`, userId)) >= 2;
    case 'mt.capacity':
      return (await num(env,
        `SELECT COUNT(*) FROM experts WHERE user_id = ? AND weekly_capacity > 0`,
        userId)) > 0;
    case 'mt.slots':
      return (await num(env, `SELECT COUNT(*) FROM mentor_slots WHERE user_id = ?`, userId)) > 0;
    case 'mt.booking':
      return (await num(env,
        `SELECT COUNT(*) FROM expert_bookings WHERE expert_user_id = ? AND LOWER(status) IN ('confirmed','completed')`,
        userId)) > 0;
  }
  return false;
}

export interface ChecklistRow extends ChecklistItem {
  completed_at: string | null;
  skipped_at: string | null;
  source: string | null;
  status: 'completed' | 'skipped' | 'pending';
}

export interface ChecklistResponse {
  role: ChecklistRole;
  total: number;                   // always 10
  completed: number;
  pending: number;
  skipped: number;
  items: ChecklistRow[];
  next: ChecklistRow[];            // next 3 pending in catalog order
  meta: {
    tour_seen_at: string | null;
    celebration_shown_at: string | null;
    panel_collapsed: boolean;
    should_celebrate: boolean;     // 8/10 reached AND celebration_shown_at is null
  };
}

export async function loadChecklist(
  env: Env,
  user: { id: number; role?: string | null },
  primaryPersonaId?: string | null,
): Promise<ChecklistResponse> {
  await ensureSchema(env);
  const role = resolveRole(user, primaryPersonaId);
  const items = CATALOG[role];

  // Pull existing rows for this user.
  let existing: Record<string, { completed_at: string | null; skipped_at: string | null; source: string | null }> = {};
  try {
    const rows = await env.DB.prepare(
      `SELECT item_key, completed_at, skipped_at, source FROM onboarding_checklist_progress WHERE user_id = ?`,
    ).bind(user.id).all<any>();
    for (const r of rows.results || []) {
      existing[r.item_key] = {
        completed_at: r.completed_at || null,
        skipped_at: r.skipped_at || null,
        source: r.source || null,
      };
    }
  } catch { /* table missing — ensureSchema retry happens above */ }

  // Lazy auto-detect: for each item not yet completed/skipped, run its
  // detector once and write the row if it passes.
  const toUpsert: Array<{ key: string }> = [];
  for (const it of items) {
    const cur = existing[it.key];
    if (cur?.completed_at || cur?.skipped_at) continue;
    if (!it.autoDetect) continue;
    let satisfied = false;
    try { satisfied = await detect(env, user.id, it.key, primaryPersonaId); }
    catch (e: any) { console.warn('[onboarding-checklist] detect', it.key, e?.message); }
    if (satisfied) toUpsert.push({ key: it.key });
  }
  if (toUpsert.length > 0) {
    for (const u of toUpsert) {
      try {
        await env.DB.prepare(
          `INSERT INTO onboarding_checklist_progress (user_id, item_key, completed_at, source)
             VALUES (?, ?, datetime('now'), 'auto')
             ON CONFLICT(user_id, item_key) DO UPDATE SET
               completed_at = COALESCE(onboarding_checklist_progress.completed_at, excluded.completed_at),
               source = COALESCE(onboarding_checklist_progress.source, excluded.source)`,
        ).bind(user.id, u.key).run();
        existing[u.key] = { completed_at: new Date().toISOString(), skipped_at: null, source: 'auto' };
      } catch (e: any) {
        console.warn('[onboarding-checklist] upsert', u.key, e?.message);
      }
    }
  }

  // Meta row.
  let meta: any = null;
  try {
    meta = await env.DB.prepare(
      `SELECT tour_seen_at, celebration_shown_at, panel_collapsed FROM onboarding_meta WHERE user_id = ?`,
    ).bind(user.id).first<any>();
  } catch { /* */ }

  const rows: ChecklistRow[] = items.map((it) => {
    const e = existing[it.key];
    const completed = !!e?.completed_at;
    const skipped = !!e?.skipped_at;
    return {
      ...it,
      completed_at: e?.completed_at || null,
      skipped_at: e?.skipped_at || null,
      source: e?.source || null,
      status: completed ? 'completed' : skipped ? 'skipped' : 'pending',
    };
  });

  const completedCount = rows.filter((r) => r.status === 'completed').length;
  const skippedCount = rows.filter((r) => r.status === 'skipped').length;
  const pendingCount = rows.filter((r) => r.status === 'pending').length;
  const next = rows.filter((r) => r.status === 'pending').slice(0, 3);

  const shouldCelebrate = completedCount >= CELEBRATION_THRESHOLD && !meta?.celebration_shown_at;

  return {
    role,
    total: TOTAL_ITEMS,
    completed: completedCount,
    pending: pendingCount,
    skipped: skippedCount,
    items: rows,
    next,
    meta: {
      tour_seen_at: meta?.tour_seen_at || null,
      celebration_shown_at: meta?.celebration_shown_at || null,
      panel_collapsed: Number(meta?.panel_collapsed || 0) === 1,
      should_celebrate: shouldCelebrate,
    },
  };
}

export async function markItem(
  env: Env,
  userId: number,
  itemKey: string,
  action: 'complete' | 'skip' | 'reset',
): Promise<void> {
  await ensureSchema(env);
  if (action === 'reset') {
    await env.DB.prepare(
      `DELETE FROM onboarding_checklist_progress WHERE user_id = ? AND item_key = ?`,
    ).bind(userId, itemKey).run();
    return;
  }
  const completedAt = action === 'complete' ? "datetime('now')" : 'NULL';
  const skippedAt = action === 'skip' ? "datetime('now')" : 'NULL';
  await env.DB.prepare(
    `INSERT INTO onboarding_checklist_progress (user_id, item_key, completed_at, skipped_at, source)
       VALUES (?, ?, ${completedAt}, ${skippedAt}, 'manual')
       ON CONFLICT(user_id, item_key) DO UPDATE SET
         completed_at = excluded.completed_at,
         skipped_at = excluded.skipped_at,
         source = excluded.source`,
  ).bind(userId, itemKey).run();
}

export async function resetAll(env: Env, userId: number): Promise<void> {
  await ensureSchema(env);
  await env.DB.prepare(`DELETE FROM onboarding_checklist_progress WHERE user_id = ?`).bind(userId).run();
  // Also clear celebration so it can re-fire after reset, but keep tour_seen
  // unless the user explicitly re-runs it from Settings.
  await env.DB.prepare(
    `INSERT INTO onboarding_meta (user_id, celebration_shown_at, updated_at)
       VALUES (?, NULL, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET celebration_shown_at = NULL, updated_at = datetime('now')`,
  ).bind(userId).run();
}

export async function setMeta(
  env: Env,
  userId: number,
  patch: { tour_seen?: boolean; celebration_shown?: boolean; panel_collapsed?: boolean; rerun_tour?: boolean },
): Promise<void> {
  await ensureSchema(env);
  const fields: string[] = [];
  const binds: any[] = [];
  const insertCols: string[] = ['user_id'];
  const insertVals: string[] = ['?'];
  const insertBinds: any[] = [userId];

  if (patch.tour_seen != null) {
    const v = patch.tour_seen ? "datetime('now')" : 'NULL';
    fields.push(`tour_seen_at = ${v}`);
    insertCols.push('tour_seen_at'); insertVals.push(v);
  }
  if (patch.rerun_tour) {
    fields.push(`tour_seen_at = NULL`);
    insertCols.push('tour_seen_at'); insertVals.push('NULL');
  }
  if (patch.celebration_shown != null) {
    const v = patch.celebration_shown ? "datetime('now')" : 'NULL';
    fields.push(`celebration_shown_at = ${v}`);
    insertCols.push('celebration_shown_at'); insertVals.push(v);
  }
  if (patch.panel_collapsed != null) {
    fields.push(`panel_collapsed = ?`);
    binds.push(patch.panel_collapsed ? 1 : 0);
    insertCols.push('panel_collapsed'); insertVals.push('?');
    insertBinds.push(patch.panel_collapsed ? 1 : 0);
  }
  if (fields.length === 0) return;

  fields.push(`updated_at = datetime('now')`);

  // SQLite UPSERT — we have to build INSERT + ON CONFLICT DO UPDATE with
  // matching positional binds.
  const sql = `
    INSERT INTO onboarding_meta (${insertCols.join(', ')})
    VALUES (${insertVals.join(', ')})
    ON CONFLICT(user_id) DO UPDATE SET ${fields.join(', ')}
  `;
  // bind order: insertBinds first, then update binds
  await env.DB.prepare(sql).bind(...insertBinds, ...binds).run();
}
