/**
 * Task #4 — X draft aggregator.
 *
 * Mirrors the Telegram per-audience aggregator but emits X-shaped drafts:
 *   - Plain text (NOT MarkdownV2 — X has no rich formatting)
 *   - Hashtags appended from the audience tag
 *   - Body split into a thread when > 280 chars (returns array of strings)
 *
 * task 434 / D301 — `safeCount` used to collapse "the table doesn't exist"
 * into a plain `0`; the founders and advisors drafts read two tables no
 * migration ever created (advisor_sessions, introductions), and the
 * advisors draft's only figure (partner_office_hours) never existed either.
 * `safeCount` now distinguishes a real count from an unreadable one, every
 * query reads a store that actually exists, and the advisors draft — with
 * nothing left to measure — is not drafted at all. See D301.
 */
import type { Env } from '../types';
import { splitIntoThread, tweetLength } from './xClient';

const K_MIN = 5;

const AUDIENCE_HASHTAGS: Record<string, string[]> = {
  public:    ['#VentureStudio', '#Startups', '#AxalNetwork'],
  founders:  ['#Founders', '#BuildInPublic'],
  investors: ['#VC', '#DealFlow'],
  advisors:   ['#StartupAdvisor'],
  partners:  ['#OperatingPartner'],
  alumni:    ['#AxalAlumni'],
};

export type XAudience = keyof typeof AUDIENCE_HASHTAGS;

/** Every count query in this file shares this one window predicate. */
const WINDOW = `datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)`;

type Count = { ok: true; n: number } | { ok: false; reason: string };

async function safeCount(env: Env, sql: string, ...binds: unknown[]): Promise<Count> {
  try {
    const r = await env.DB.prepare(sql).bind(...binds).first<{ n: number }>();
    return { ok: true, n: Number(r?.n ?? 0) };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message || 'read failed' };
  }
}

/**
 * Top-N sectors active in the window — emitted as additional hashtags
 * appended to the audience defaults. Degrades to [] on missing tables.
 */
async function safeTopSectors(env: Env, periodStart: string, periodEnd: string, limit = 3): Promise<string[]> {
  try {
    const rs = await env.DB.prepare(
      `SELECT sector, COUNT(*) AS n FROM projects
        WHERE sector IS NOT NULL AND sector <> ''
          AND ${WINDOW}
        GROUP BY sector ORDER BY n DESC LIMIT ?`,
    ).bind(periodStart, periodEnd, limit).all<{ sector: string; n: number }>();
    return (rs?.results || [])
      .map(r => String(r.sector || '').trim())
      .filter(Boolean)
      .map(s => '#' + s.replace(/[^A-Za-z0-9]+/g, ''))
      .filter(t => t.length > 1);
  } catch {
    return [];
  }
}

/**
 * Best-effort check whether a Market Intel chart is available for the
 * current period. Used to flip `needs_media` honestly instead of always
 * nagging the admin. Probes `market_intel_indexes` — the table the Market
 * Intel chart endpoints actually read (migration 030, and what
 * `routes/market_intel.ts` selects from). The earlier `market_intel_personas`
 * was named after nothing: no migration, no route and no service has ever
 * created it, so the `catch` below swallowed a "no such table" on every call
 * and this always answered false.
 */
async function safeHasMIChart(env: Env, periodStart: string): Promise<boolean> {
  try {
    const r = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM market_intel_indexes
       WHERE datetime(computed_at) >= datetime(?)`,
    ).bind(periodStart).first<{ n: number }>();
    return Number(r?.n ?? 0) > 0;
  } catch {
    return false;
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
  /** false only when every figure this draft could carry has no store behind it. */
  drafted: boolean;
  reason?: string;
}

interface BuildInput { periodDays: number; periodStart: string; periodEnd: string }

function append(body: string, tags: string[]): string {
  const tail = tags.join(' ');
  return `${body}\n\n${tail}`.trim();
}

async function buildPublicDraft(env: Env, w: BuildInput): Promise<XDraft> {
  const ventures = await safeCount(
    env, `SELECT COUNT(*) AS n FROM projects WHERE ${WINDOW}`, w.periodStart, w.periodEnd,
  );
  const deals = await safeCount(
    env, `SELECT COUNT(*) AS n FROM partner_deals WHERE ${WINDOW}`, w.periodStart, w.periodEnd,
  );
  const safeV = ventures.ok && ventures.n >= K_MIN ? ventures.n : null;
  const safeD = deals.ok && deals.n >= K_MIN ? deals.n : null;
  const lines = [`Axal weekly pulse — last ${w.periodDays}d:`];
  if (safeV) lines.push(`• ${safeV} new ventures in motion`);
  if (safeD) lines.push(`• ${safeD} partner introductions`);
  if (!ventures.ok) lines.push(`• New ventures — unreadable.`);
  if (!deals.ok) lines.push(`• Partner introductions — unreadable.`);
  if (ventures.ok && deals.ok && !safeV && !safeD) lines.push(`• Quiet week — heads down building.`);
  lines.push(``, `axal.vc`);
  const sectors = await safeTopSectors(env, w.periodStart, w.periodEnd);
  const hasMI = await safeHasMIChart(env, w.periodStart);
  const tags = [...AUDIENCE_HASHTAGS.public, ...sectors];
  const body = append(lines.join('\n'), tags);
  return {
    audience: 'public', kind: 'weekly_pulse', title: 'Weekly pulse',
    body, thread: splitIntoThread(body),
    hashtags: tags,
    needs_media: hasMI,
    payload: {
      ventures: ventures.ok ? ventures.n : null,
      deals: deals.ok ? deals.n : null,
      sectors, has_mi_chart: hasMI, k_min: K_MIN, period_days: w.periodDays,
    },
    drafted: true,
  };
}

async function buildFoundersDraft(env: Env, w: BuildInput): Promise<XDraft> {
  // "sessions" reads advisor_bookings — the store that actually exists.
  const sessions = await safeCount(
    env,
    `SELECT COUNT(*) AS n FROM advisor_bookings WHERE ${WINDOW} AND status != 'cancelled'`,
    w.periodStart, w.periodEnd,
  );
  // "intros" is rewritten to what investor_introductions records.
  const intros = await safeCount(
    env, `SELECT COUNT(*) AS n FROM investor_introductions WHERE ${WINDOW}`, w.periodStart, w.periodEnd,
  );
  const sessionsLine = sessions.ok ? `${sessions.n} advisor sessions booked` : 'advisor sessions booked — unreadable';
  const introsLine = intros.ok
    ? `${intros.n} introductions requested by investors`
    : 'investor-requested introductions — unreadable';
  const body = append(
    `Founders, this week at Axal:\n• ${sessionsLine}\n• ${introsLine}\n\nIf you're building, we want to meet you.`,
    AUDIENCE_HASHTAGS.founders,
  );
  return {
    audience: 'founders', kind: 'founders_digest', title: 'Founders digest',
    body, thread: splitIntoThread(body),
    hashtags: AUDIENCE_HASHTAGS.founders,
    needs_media: false,
    payload: {
      sessions: sessions.ok ? sessions.n : null,
      investor_introductions: intros.ok ? intros.n : null,
      period_days: w.periodDays,
    },
    drafted: true,
  };
}

async function buildInvestorsDraft(env: Env, w: BuildInput): Promise<XDraft> {
  const newDeals = await safeCount(
    env, `SELECT COUNT(*) AS n FROM deals WHERE ${WINDOW}`, w.periodStart, w.periodEnd,
  );
  const sectors = await safeTopSectors(env, w.periodStart, w.periodEnd);
  const hasMI = await safeHasMIChart(env, w.periodStart);
  const tags = [...AUDIENCE_HASHTAGS.investors, ...sectors];
  const dealsLine = newDeals.ok ? `${newDeals.n} new deals` : 'unreadable deal count';
  const body = append(
    `Investors — ${dealsLine} in the Axal pipeline this week. DM for diligence access.`,
    tags,
  );
  return {
    audience: 'investors', kind: 'investor_brief', title: 'Investor brief',
    body, thread: splitIntoThread(body),
    hashtags: tags,
    needs_media: hasMI,
    payload: { new_deals: newDeals.ok ? newDeals.n : null, sectors, has_mi_chart: hasMI, period_days: w.periodDays },
    drafted: true,
  };
}

async function buildAdvisorsDraft(_env: Env, w: BuildInput): Promise<XDraft> {
  // The only figure this draft ever carried, "office-hours requests", read
  // partner_office_hours — a table no migration has ever created. No other
  // store backs an X advisors figure, so there is nothing left to draft.
  return {
    audience: 'advisors', kind: 'advisors_brief', title: 'Advisors brief',
    body: '', thread: [],
    hashtags: AUDIENCE_HASHTAGS.advisors,
    needs_media: false,
    payload: { period_days: w.periodDays },
    drafted: false,
    reason: 'no measured store backs an X advisors figure (partner_office_hours was never built)',
  };
}

async function buildPartnersDraft(env: Env, w: BuildInput): Promise<XDraft> {
  const deals = await safeCount(
    env, `SELECT COUNT(*) AS n FROM partner_deals WHERE ${WINDOW}`, w.periodStart, w.periodEnd,
  );
  const dealsLine = deals.ok ? `${deals.n} new deals` : 'an unreadable count of deals';
  const body = append(
    `Operating partners moved ${dealsLine} through the Axal desk this week.`,
    AUDIENCE_HASHTAGS.partners,
  );
  return {
    audience: 'partners', kind: 'partners_brief', title: 'Operating partners brief',
    body, thread: splitIntoThread(body),
    hashtags: AUDIENCE_HASHTAGS.partners,
    needs_media: false,
    payload: { deals: deals.ok ? deals.n : null, period_days: w.periodDays },
    drafted: true,
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
    drafted: true,
  };
}

const BUILDERS: Record<XAudience, (env: Env, w: BuildInput) => Promise<XDraft>> = {
  public: buildPublicDraft,
  founders: buildFoundersDraft,
  investors: buildInvestorsDraft,
  advisors: buildAdvisorsDraft,
  partners: buildPartnersDraft,
  alumni: buildAlumniDraft,
};

export const X_AUDIENCES: XAudience[] = ['public', 'founders', 'investors', 'advisors', 'partners', 'alumni'];

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
 * Run aggregator and persist one DRAFT post per audience whose draft has at
 * least one measured figure (`drafted !== false`). Posts default to
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
    if (!d.drafted) continue;
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
