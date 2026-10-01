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
 * task 434 / D301 — `safeCount` used to collapse both "genuinely zero" and
 * "the table doesn't exist" into the same `0`, so five of these queries
 * (advisor_sessions, introductions, matches, partner_office_hours,
 * refer_earn_payouts — none of which any migration ever created) posted a
 * confident zero every single week. `safeCount` now distinguishes a real
 * count from an unreadable one, and every query here reads a store that
 * actually exists. See D301 for the full account, including the one
 * `datetime()` window predicate (D162's blind spot: a bare string
 * comparison against an ISO bind drops every row from the window's first
 * day, because ' ' < 'T' and the stored timestamp has no 'T').
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

/** Every count query in this file shares this one window predicate. */
const WINDOW = `datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)`;

type Count = { ok: true; n: number } | { ok: false; reason: string };

async function safeCount(env: Env, sql: string, ...binds: unknown[]): Promise<Count> {
  try {
    const r = await env.DB.prepare(sql)
      .bind(...binds)
      .first<{ n: number }>();
    return { ok: true, n: Number(r?.n ?? 0) };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message || 'read failed' };
  }
}

interface DraftPayload {
  audience: TelegramAudience;
  kind: string;
  title: string;
  body_md: string;          // already MarkdownV2-escaped
  payload: Record<string, unknown>;
  /** false only when every figure line this draft could carry has no store behind it. */
  drafted: boolean;
  reason?: string;
}

/** Build draft for the public @axalvc channel — anonymised aggregate only. */
async function buildPublicDraft(env: Env, w: AggInput): Promise<DraftPayload> {
  const graduates = await safeCount(
    env, `SELECT COUNT(*) AS n FROM projects WHERE ${WINDOW}`, w.periodStart, w.periodEnd,
  );
  const partnerDeals = await safeCount(
    env, `SELECT COUNT(*) AS n FROM partner_deals WHERE ${WINDOW}`, w.periodStart, w.periodEnd,
  );
  // k-anonymity gate — only over a SUCCESSFUL read; a failed read is never
  // treated as "below k" and must never let "Quiet week" print.
  const safeGrads = graduates.ok && graduates.n >= K_MIN ? graduates.n : null;
  const safeDeals = partnerDeals.ok && partnerDeals.n >= K_MIN ? partnerDeals.n : null;

  const lines: string[] = [
    `*Axal weekly pulse*`,
    ``,
    `Last ${w.periodDays} days at the studio:`,
  ];
  if (safeGrads) lines.push(`• ${safeGrads} new ventures in motion`);
  if (safeDeals) lines.push(`• ${safeDeals} partner introductions made`);
  if (!graduates.ok) lines.push(`• New ventures — Unreadable\\.`);
  if (!partnerDeals.ok) lines.push(`• Partner introductions — Unreadable\\.`);
  if (graduates.ok && partnerDeals.ok && !safeGrads && !safeDeals) {
    lines.push(`• Quiet week — building heads-down\\.`);
  }
  lines.push(``);
  lines.push(`Follow the studio at axal\\.vc`);

  return {
    audience: 'public',
    kind: 'weekly_pulse',
    title: 'Weekly pulse',
    body_md: lines.join('\n'),
    payload: {
      graduates: graduates.ok ? graduates.n : null,
      partner_deals: partnerDeals.ok ? partnerDeals.n : null,
      k_min: K_MIN,
      period_days: w.periodDays,
    },
    drafted: true,
  };
}

async function buildFoundersDraft(env: Env, w: AggInput): Promise<DraftPayload> {
  // "sessions booked" reads advisor_bookings — the store that actually
  // exists — excluding cancelled (a no_show was still booked).
  const sessions = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM advisor_bookings WHERE ${WINDOW} AND status != 'cancelled'`,
    w.periodStart, w.periodEnd,
  );
  // "intros opened" is rewritten to what investor_introductions actually
  // records: an investor asking to be introduced to a founder.
  const intros = await safeCount(
    env, `SELECT COUNT(*) AS n FROM investor_introductions WHERE ${WINDOW}`, w.periodStart, w.periodEnd,
  );
  const lines: string[] = [
    `*Founders digest — last ${w.periodDays}d*`,
    ``,
    sessions.ok ? `• ${sessions.n} advisor sessions booked` : `• Advisor sessions booked — Unreadable\\.`,
    intros.ok
      ? `• ${intros.n} introductions requested by investors`
      : `• Investor\\-requested introductions — Unreadable\\.`,
    ``,
    `Open the studio dashboard for personal next steps\\.`,
  ];
  return {
    audience: 'founders',
    kind: 'founders_digest',
    title: 'Founders digest',
    body_md: lines.join('\n'),
    payload: {
      advisor_sessions: sessions.ok ? sessions.n : null,
      investor_introductions: intros.ok ? intros.n : null,
      period_days: w.periodDays,
    },
    drafted: true,
  };
}

async function buildInvestorsDraft(env: Env, w: AggInput): Promise<DraftPayload> {
  const newDeals = await safeCount(
    env, `SELECT COUNT(*) AS n FROM deals WHERE ${WINDOW}`, w.periodStart, w.periodEnd,
  );
  const portfolioUpdates = await safeCount(
    env, `SELECT COUNT(*) AS n FROM portfolio_updates WHERE ${WINDOW}`, w.periodStart, w.periodEnd,
  );
  const lines: string[] = [
    `*Investor brief — last ${w.periodDays}d*`,
    ``,
    newDeals.ok ? `• ${newDeals.n} new deals in pipeline` : `• New deals in pipeline — Unreadable\\.`,
    portfolioUpdates.ok ? `• ${portfolioUpdates.n} portfolio updates` : `• Portfolio updates — Unreadable\\.`,
    ``,
    `Sign in to view the full deal flow\\.`,
  ];
  return {
    audience: 'investors',
    kind: 'investor_brief',
    title: 'Investor brief',
    body_md: lines.join('\n'),
    payload: {
      new_deals: newDeals.ok ? newDeals.n : null,
      portfolio_updates: portfolioUpdates.ok ? portfolioUpdates.n : null,
      period_days: w.periodDays,
    },
    drafted: true,
  };
}

async function buildAdvisorsDraft(env: Env, w: AggInput): Promise<DraftPayload> {
  // "sessions booked" is the same real store as the founders draft.
  const sessions = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM advisor_bookings WHERE ${WINDOW} AND status != 'cancelled'`,
    w.periodStart, w.periodEnd,
  );
  // "office-hours requests" had no store (partner_office_hours never
  // existed) and is dropped rather than rewritten — nothing else measures it.
  const lines: string[] = [
    `*Advisors brief — last ${w.periodDays}d*`,
    ``,
    sessions.ok ? `• ${sessions.n} sessions booked` : `• Sessions booked — Unreadable\\.`,
    ``,
    `Thank you for the time you give\\.`,
  ];
  return {
    audience: 'advisors',
    kind: 'advisors_brief',
    title: 'Advisors brief',
    body_md: lines.join('\n'),
    payload: { sessions: sessions.ok ? sessions.n : null, period_days: w.periodDays },
    drafted: true,
  };
}

async function buildPartnersDraft(env: Env, w: AggInput): Promise<DraftPayload> {
  const partnerDeals = await safeCount(
    env, `SELECT COUNT(*) AS n FROM partner_deals WHERE ${WINDOW}`, w.periodStart, w.periodEnd,
  );
  // "sourcing rewards posted" had no store (refer_earn_payouts never
  // existed) and is dropped: the refer-and-earn feature has no payout ledger.
  const lines: string[] = [
    `*Operating partners — last ${w.periodDays}d*`,
    ``,
    partnerDeals.ok ? `• ${partnerDeals.n} new partner deals` : `• New partner deals — Unreadable\\.`,
    ``,
    `Open the partner desk for active demand\\.`,
  ];
  return {
    audience: 'partners',
    kind: 'partners_brief',
    title: 'Operating partners brief',
    body_md: lines.join('\n'),
    payload: { partner_deals: partnerDeals.ok ? partnerDeals.n : null, period_days: w.periodDays },
    drafted: true,
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
    drafted: true,
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
 * has a channel mapped (chat_id present + enabled=1) AND whose draft has at
 * least one measured figure. Skips audiences with no enabled channel, and
 * skips a draft with `drafted: false`, so we never leave orphan drafts or
 * post a brief with nothing to say.
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
    if (!draft.drafted) continue;
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
