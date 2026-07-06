/**
 * Task #3 — Telegram draft aggregator.
 *
 * Produces ≥1 draft per active audience by sweeping audience-specific
 * signals over a configurable lookback window (default 7d). Aggregator
 * NEVER reads user-identifying details into draft bodies — public-channel
 * drafts use anonymised counts (k>=5); private-channel drafts may name
 * graduates/winners only when the user has opted in via
 * `user_promotion_consent` (the linter enforces this on send).
 *
 * Counter-table reads are wrapped in try/catch because the prod D1 has a
 * mix of applied/pending migrations (see replit.md). Missing tables
 * degrade to zero counts, never to a 500.
 */
import type { Env } from '../types';
import { escapeMd2 } from './telegramClient';
import { TELEGRAM_AUDIENCES, type TelegramAudience } from './telegramSchema';

const K_MIN = 5;

interface AggInput {
  periodDays: number;
  periodStart: string;
  periodEnd: string;
}

async function safeCount(env: Env, sql: string, ...binds: unknown[]): Promise<number> {
  try {
    const r = await env.DB.prepare(sql)
      .bind(...binds)
      .first<{ n: number }>();
    return Number(r?.n ?? 0);
  } catch {
    return 0;
  }
}

interface DraftPayload {
  audience: TelegramAudience;
  kind: string;
  title: string;
  body_md: string;          // already MarkdownV2-escaped
  payload: Record<string, unknown>;
}

/** Build draft for the public @axalvc channel — anonymised aggregate only. */
async function buildPublicDraft(env: Env, w: AggInput): Promise<DraftPayload> {
  const graduates = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM projects WHERE created_at >= ? AND created_at <= ?`,
    w.periodStart, w.periodEnd,
  );
  const partnerDeals = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM partner_deals WHERE created_at >= ? AND created_at <= ?`,
    w.periodStart, w.periodEnd,
  );
  // k-anonymity gate.
  const safeGrads = graduates >= K_MIN ? graduates : null;
  const safeDeals = partnerDeals >= K_MIN ? partnerDeals : null;

  const lines: string[] = [
    `*Axal weekly pulse*`,
    ``,
    `Last ${w.periodDays} days at the studio:`,
  ];
  if (safeGrads) lines.push(`• ${safeGrads} new ventures in motion`);
  if (safeDeals) lines.push(`• ${safeDeals} partner introductions made`);
  if (!safeGrads && !safeDeals) {
    lines.push(`• Quiet week — building heads-down\\.`);
  }
  lines.push(``);
  lines.push(`Follow the studio at axal\\.vc`);

  return {
    audience: 'public',
    kind: 'weekly_pulse',
    title: 'Weekly pulse',
    body_md: lines.join('\n'),
    payload: { graduates, partner_deals: partnerDeals, k_min: K_MIN, period_days: w.periodDays },
  };
}

async function buildFoundersDraft(env: Env, w: AggInput): Promise<DraftPayload> {
  const advisorSessions = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM advisor_sessions WHERE created_at >= ? AND created_at <= ?`,
    w.periodStart, w.periodEnd,
  );
  const intros = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM introductions WHERE created_at >= ? AND created_at <= ?`,
    w.periodStart, w.periodEnd,
  );
  const matches = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM matches WHERE created_at >= ? AND created_at <= ?`,
    w.periodStart, w.periodEnd,
  );
  const lines: string[] = [
    `*Founders digest — last ${w.periodDays}d*`,
    ``,
    `• ${advisorSessions} advisor sessions booked`,
    `• ${intros} deal\\-room intros opened`,
    `• ${matches} new founder↔partner matches`,
    ``,
    `Open the studio dashboard for personal next steps\\.`,
  ];
  return {
    audience: 'founders',
    kind: 'founders_digest',
    title: 'Founders digest',
    body_md: lines.join('\n'),
    payload: { advisor_sessions: advisorSessions, intros, matches, period_days: w.periodDays },
  };
}

async function buildInvestorsDraft(env: Env, w: AggInput): Promise<DraftPayload> {
  const newDeals = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM deals WHERE created_at >= ? AND created_at <= ?`,
    w.periodStart, w.periodEnd,
  );
  const portfolioUpdates = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM portfolio_updates WHERE created_at >= ? AND created_at <= ?`,
    w.periodStart, w.periodEnd,
  );
  const lines: string[] = [
    `*Investor brief — last ${w.periodDays}d*`,
    ``,
    `• ${newDeals} new deals in pipeline`,
    `• ${portfolioUpdates} portfolio updates`,
    ``,
    `Sign in to view the full deal flow\\.`,
  ];
  return {
    audience: 'investors',
    kind: 'investor_brief',
    title: 'Investor brief',
    body_md: lines.join('\n'),
    payload: { new_deals: newDeals, portfolio_updates: portfolioUpdates, period_days: w.periodDays },
  };
}

async function buildAdvisorsDraft(env: Env, w: AggInput): Promise<DraftPayload> {
  const newMatches = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM advisor_sessions WHERE created_at >= ? AND created_at <= ?`,
    w.periodStart, w.periodEnd,
  );
  const requests = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM partner_office_hours WHERE created_at >= ? AND created_at <= ?`,
    w.periodStart, w.periodEnd,
  );
  const lines: string[] = [
    `*Advisors brief — last ${w.periodDays}d*`,
    ``,
    `• ${newMatches} sessions booked`,
    `• ${requests} office\\-hours requests`,
    ``,
    `Thank you for the time you give\\.`,
  ];
  return {
    audience: 'advisors',
    kind: 'advisors_brief',
    title: 'Advisors brief',
    body_md: lines.join('\n'),
    payload: { sessions: newMatches, requests, period_days: w.periodDays },
  };
}

async function buildPartnersDraft(env: Env, w: AggInput): Promise<DraftPayload> {
  const partnerDeals = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM partner_deals WHERE created_at >= ? AND created_at <= ?`,
    w.periodStart, w.periodEnd,
  );
  const rewards = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM refer_earn_payouts WHERE created_at >= ? AND created_at <= ?`,
    w.periodStart, w.periodEnd,
  );
  const lines: string[] = [
    `*Operating partners — last ${w.periodDays}d*`,
    ``,
    `• ${partnerDeals} new partner deals`,
    `• ${rewards} sourcing rewards posted`,
    ``,
    `Open the partner desk for active demand\\.`,
  ];
  return {
    audience: 'partners',
    kind: 'partners_brief',
    title: 'Operating partners brief',
    body_md: lines.join('\n'),
    payload: { partner_deals: partnerDeals, rewards, period_days: w.periodDays },
  };
}

async function buildAlumniDraft(_env: Env, w: AggInput): Promise<DraftPayload> {
  // Alumni feed is intentionally minimal — exits/milestones often unavailable.
  const lines: string[] = [
    `*Alumni roundup — last ${w.periodDays}d*`,
    ``,
    `The studio is shipping\\. Reply with any wins you want amplified\\.`,
  ];
  return {
    audience: 'alumni',
    kind: 'alumni_roundup',
    title: 'Alumni roundup',
    body_md: lines.join('\n'),
    payload: { period_days: w.periodDays },
  };
}

const BUILDERS: Record<TelegramAudience, (env: Env, w: AggInput) => Promise<DraftPayload>> = {
  public: buildPublicDraft,
  founders: buildFoundersDraft,
  investors: buildInvestorsDraft,
  advisors: buildAdvisorsDraft,
  partners: buildPartnersDraft,
  alumni: buildAlumniDraft,
};

export async function previewAudience(
  env: Env,
  audience: TelegramAudience,
  periodDays: number,
): Promise<DraftPayload> {
  const periodEnd = new Date().toISOString();
  const periodStart = new Date(Date.now() - periodDays * 86400_000).toISOString();
  return BUILDERS[audience](env, { periodDays, periodStart, periodEnd });
}

export async function previewAll(env: Env, periodDays: number): Promise<DraftPayload[]> {
  const out: DraftPayload[] = [];
  for (const a of TELEGRAM_AUDIENCES) {
    out.push(await BUILDERS[a](env, {
      periodDays,
      periodStart: new Date(Date.now() - periodDays * 86400_000).toISOString(),
      periodEnd: new Date().toISOString(),
    }));
  }
  return out;
}

/**
 * Run the aggregator and persist one DRAFT post per active audience that
 * has a channel mapped (chat_id present + enabled=1). Skips audiences
 * with no enabled channel so we never leave orphan drafts.
 */
export async function runAggregator(
  env: Env,
  adminId: number,
  periodDays: number,
): Promise<{ drafted: Array<{ audience: string; post_id: number }> }> {
  const periodEnd = new Date().toISOString();
  const periodStart = new Date(Date.now() - periodDays * 86400_000).toISOString();
  const drafted: Array<{ audience: string; post_id: number }> = [];

  // Pull the canonical channel per audience (lowest id wins on ties).
  const channels = await env.DB.prepare(
    `SELECT id, audience, slug FROM telegram_channels
      WHERE enabled = 1
      GROUP BY audience
      ORDER BY id ASC`,
  ).all<{ id: number; audience: string; slug: string }>();

  const byAudience = new Map<string, { id: number; slug: string }>();
  for (const c of channels.results || []) {
    if (!byAudience.has(c.audience)) byAudience.set(c.audience, { id: c.id, slug: c.slug });
  }

  for (const a of TELEGRAM_AUDIENCES) {
    const ch = byAudience.get(a);
    if (!ch) continue;
    const draft = await BUILDERS[a](env, { periodDays, periodStart, periodEnd });
    const ins = await env.DB.prepare(
      `INSERT INTO telegram_posts
         (channel_id, audience, status, title, body_md, source, source_kind, created_by)
         VALUES (?, ?, 'draft', ?, ?, 'aggregator', ?, ?)`,
    )
      .bind(ch.id, a, draft.title, draft.body_md, draft.kind, adminId)
      .run();
    const postId = Number((ins.meta as { last_row_id?: number })?.last_row_id || 0);
    if (postId) {
      drafted.push({ audience: a, post_id: postId });
      await env.DB.prepare(
        `INSERT INTO telegram_aggregations
           (audience, kind, payload_json, period_start, period_end, draft_post_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(a, draft.kind, JSON.stringify(draft.payload), periodStart, periodEnd, postId)
        .run();
    }
  }

  return { drafted };
}

// Re-export for the routes layer that needs to escape user-supplied
// fragments before persisting drafts.
export { escapeMd2 };
