/**
 * Task #4 — X draft aggregator.
 *
 * Mirrors the Telegram per-audience aggregator but emits X-shaped drafts:
 *   - Plain text (NOT MarkdownV2 — X has no rich formatting)
 *   - Hashtags appended from the audience tag
 *   - Body split into a thread when > 280 chars (returns array of strings)
 *
 * Counter reads are wrapped in try/catch — missing tables degrade to zero,
 * never to a 500 (matches replit.md pending-migrations posture).
 */
import type { Env } from '../types';
import { splitIntoThread, tweetLength } from './xClient';

const K_MIN = 5;

const AUDIENCE_HASHTAGS: Record<string, string[]> = {
  public:    ['#VentureStudio', '#Startups', '#AxalNetwork'],
  founders:  ['#Founders', '#BuildInPublic'],
  investors: ['#VC', '#DealFlow'],
  mentors:   ['#StartupMentor'],
  partners:  ['#OperatingPartner'],
  alumni:    ['#AxalAlumni'],
};

export type XAudience = keyof typeof AUDIENCE_HASHTAGS;

async function safeCount(env: Env, sql: string, ...binds: unknown[]): Promise<number> {
  try {
    const r = await env.DB.prepare(sql).bind(...binds).first<{ n: number }>();
    return Number(r?.n ?? 0);
  } catch {
    return 0;
  }
}

export interface XDraft {
  audience: XAudience;
  kind: string;
  title: string;
  body: string;                    // single string — thread split is derived
  thread: string[];                // 1+ tweets after splitIntoThread()
  hashtags: string[];
  needs_media: boolean;            // hint to admin: attach an MI-chart if available
  payload: Record<string, unknown>;
}

interface BuildInput { periodDays: number; periodStart: string; periodEnd: string }

function append(body: string, tags: string[]): string {
  const tail = tags.join(' ');
  return `${body}\n\n${tail}`.trim();
}

async function buildPublicDraft(env: Env, w: BuildInput): Promise<XDraft> {
  const ventures = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM projects WHERE created_at >= ? AND created_at <= ?`,
    w.periodStart, w.periodEnd,
  );
  const deals = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM partner_deals WHERE created_at >= ? AND created_at <= ?`,
    w.periodStart, w.periodEnd,
  );
  const safeV = ventures >= K_MIN ? ventures : null;
  const safeD = deals >= K_MIN ? deals : null;
  const lines = [`Axal weekly pulse — last ${w.periodDays}d:`];
  if (safeV) lines.push(`• ${safeV} new ventures in motion`);
  if (safeD) lines.push(`• ${safeD} partner introductions`);
  if (!safeV && !safeD) lines.push(`• Quiet week — heads down building.`);
  lines.push(``, `axal.vc`);
  const body = append(lines.join('\n'), AUDIENCE_HASHTAGS.public);
  return {
    audience: 'public', kind: 'weekly_pulse', title: 'Weekly pulse',
    body, thread: splitIntoThread(body),
    hashtags: AUDIENCE_HASHTAGS.public,
    needs_media: true,
    payload: { ventures, deals, k_min: K_MIN, period_days: w.periodDays },
  };
}

async function buildFoundersDraft(env: Env, w: BuildInput): Promise<XDraft> {
  const sessions = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM mentor_sessions WHERE created_at >= ? AND created_at <= ?`,
    w.periodStart, w.periodEnd,
  );
  const intros = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM introductions WHERE created_at >= ? AND created_at <= ?`,
    w.periodStart, w.periodEnd,
  );
  const body = append(
    `Founders, this week at Axal:\n• ${sessions} mentor sessions booked\n• ${intros} deal-room intros opened\n\nIf you're building, we want to meet you.`,
    AUDIENCE_HASHTAGS.founders,
  );
  return {
    audience: 'founders', kind: 'founders_digest', title: 'Founders digest',
    body, thread: splitIntoThread(body),
    hashtags: AUDIENCE_HASHTAGS.founders,
    needs_media: false,
    payload: { sessions, intros, period_days: w.periodDays },
  };
}

async function buildInvestorsDraft(env: Env, w: BuildInput): Promise<XDraft> {
  const newDeals = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM deals WHERE created_at >= ? AND created_at <= ?`,
    w.periodStart, w.periodEnd,
  );
  const body = append(
    `Investors — ${newDeals} new deals in the Axal pipeline this week. DM for diligence access.`,
    AUDIENCE_HASHTAGS.investors,
  );
  return {
    audience: 'investors', kind: 'investor_brief', title: 'Investor brief',
    body, thread: splitIntoThread(body),
    hashtags: AUDIENCE_HASHTAGS.investors,
    needs_media: true,
    payload: { new_deals: newDeals, period_days: w.periodDays },
  };
}

async function buildMentorsDraft(env: Env, w: BuildInput): Promise<XDraft> {
  const requests = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM partner_office_hours WHERE created_at >= ? AND created_at <= ?`,
    w.periodStart, w.periodEnd,
  );
  const body = append(
    `Shout-out to the Axal mentor bench — ${requests} office-hours requests fielded this week. Thank you.`,
    AUDIENCE_HASHTAGS.mentors,
  );
  return {
    audience: 'mentors', kind: 'mentors_brief', title: 'Mentors brief',
    body, thread: splitIntoThread(body),
    hashtags: AUDIENCE_HASHTAGS.mentors,
    needs_media: false,
    payload: { requests, period_days: w.periodDays },
  };
}

async function buildPartnersDraft(env: Env, w: BuildInput): Promise<XDraft> {
  const deals = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM partner_deals WHERE created_at >= ? AND created_at <= ?`,
    w.periodStart, w.periodEnd,
  );
  const body = append(
    `Operating partners moved ${deals} new deals through the Axal desk this week.`,
    AUDIENCE_HASHTAGS.partners,
  );
  return {
    audience: 'partners', kind: 'partners_brief', title: 'Operating partners brief',
    body, thread: splitIntoThread(body),
    hashtags: AUDIENCE_HASHTAGS.partners,
    needs_media: false,
    payload: { deals, period_days: w.periodDays },
  };
}

async function buildAlumniDraft(_env: Env, w: BuildInput): Promise<XDraft> {
  const body = append(
    `Alumni roundup — ${w.periodDays}d at the studio. Reply with wins worth amplifying.`,
    AUDIENCE_HASHTAGS.alumni,
  );
  return {
    audience: 'alumni', kind: 'alumni_roundup', title: 'Alumni roundup',
    body, thread: splitIntoThread(body),
    hashtags: AUDIENCE_HASHTAGS.alumni,
    needs_media: false,
    payload: { period_days: w.periodDays },
  };
}

const BUILDERS: Record<XAudience, (env: Env, w: BuildInput) => Promise<XDraft>> = {
  public: buildPublicDraft,
  founders: buildFoundersDraft,
  investors: buildInvestorsDraft,
  mentors: buildMentorsDraft,
  partners: buildPartnersDraft,
  alumni: buildAlumniDraft,
};

export const X_AUDIENCES: XAudience[] = ['public', 'founders', 'investors', 'mentors', 'partners', 'alumni'];

export async function previewXAll(env: Env, periodDays: number): Promise<XDraft[]> {
  const periodEnd = new Date().toISOString();
  const periodStart = new Date(Date.now() - periodDays * 86400_000).toISOString();
  const out: XDraft[] = [];
  for (const a of X_AUDIENCES) {
    out.push(await BUILDERS[a](env, { periodDays, periodStart, periodEnd }));
  }
  return out;
}

export async function previewXAudience(env: Env, audience: XAudience, periodDays: number): Promise<XDraft> {
  const periodEnd = new Date().toISOString();
  const periodStart = new Date(Date.now() - periodDays * 86400_000).toISOString();
  return BUILDERS[audience](env, { periodDays, periodStart, periodEnd });
}

/**
 * Run aggregator and persist one DRAFT post per audience. Posts default to
 * `account_id = ?` — the caller must pass the canonical X account id (the
 * @axalvc connection). Thread continuations are persisted as additional
 * `x_posts` rows with `thread_continuation_of` pointing at the head.
 */
export async function runXAggregator(env: Env, opts: {
  adminId: number;
  accountId: number;
  periodDays: number;
}): Promise<{ drafted: Array<{ audience: string; post_id: number; thread_size: number }> }> {
  const drafted: Array<{ audience: string; post_id: number; thread_size: number }> = [];
  const drafts = await previewXAll(env, opts.periodDays);
  for (const d of drafts) {
    const head = d.thread[0];
    const ins = await env.DB.prepare(
      `INSERT INTO x_posts (account_id, status, body, hashtags, source, source_kind, thread_position, created_by)
         VALUES (?, 'draft', ?, ?, 'aggregator', ?, 0, ?) RETURNING id`,
    ).bind(opts.accountId, head, d.hashtags.join(','), d.kind, opts.adminId).first<{ id: number }>();
    const headId = Number(ins?.id || 0);
    if (!headId) continue;
    for (let i = 1; i < d.thread.length; i++) {
      await env.DB.prepare(
        `INSERT INTO x_posts (account_id, status, body, hashtags, source, source_kind, thread_continuation_of, thread_position, created_by)
           VALUES (?, 'draft', ?, ?, 'aggregator', ?, ?, ?, ?)`,
      ).bind(opts.accountId, d.thread[i], d.hashtags.join(','), d.kind, headId, i, opts.adminId).run();
    }
    drafted.push({ audience: d.audience, post_id: headId, thread_size: d.thread.length });
  }
  return { drafted };
}

export { tweetLength };
