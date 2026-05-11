/**
 * Task #30 — Weekly/monthly Market-Intel watchlist digest.
 *
 * Cron-driven job that walks `market_intel_watchlist`, groups pinned
 * sectors per user, computes composite delta vs the prior period, picks
 * up new citations since the user's last send, and emails the digest.
 *
 * Cadence windows (UTC, simple — does not honour user_settings.timezone
 * because the watchlist row doesn't carry tz; the existing per-user
 * notification digest already handles tz-aware sends for transactional
 * emails):
 *   • weekly  → Monday 09:00 UTC
 *   • monthly → 1st of month 09:00 UTC
 *
 * Idempotency: rows are stamped with `last_sent_at` + `last_period_key`
 * after a confirmed email send, so a second cron tick in the same hour
 * is a no-op.
 *
 * Unsubscribe: each digest carries a per-user HMAC token resolving to
 * `/api/market-intel-public/unsubscribe?u=<id>&t=<sig>` (mounted public,
 * no auth) which deletes ALL of that user's watchlist rows. Users can
 * also manage cadence per-sector inside the app at /market-intelligence.
 */
import type { Env } from '../../types';
import { sendNotificationEmail } from '../email';
import { periodKey } from './scoring';
import { ensureMarketIntelSchema } from './schema';

export type Cadence = 'weekly' | 'monthly';

interface WatchRow {
  id: number;
  user_id: number;
  sector: string;
  geo: string;
  cadence: Cadence;
  last_sent_at: string | null;
  last_period_key: string | null;
  last_composite: number | null;
  email: string;
}
interface IndexValue { value: number; period_key: string }
interface CitationLite { sector: string; metric_key: string; metric_value: number; ts: string; citation_url: string }

/** YYYY-MM string for the UTC month `monthsBack` months prior to `d`. */
function priorMonthKey(d: Date, monthsBack = 1): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() - monthsBack;
  const dt = new Date(Date.UTC(y, m, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * ISO-week period key (YYYY-Www) used for weekly idempotency stamping.
 * Two sends in the same ISO week hit the same key, so a same-week retry
 * is a no-op while next Monday's send picks up a fresh key. Monthly
 * cadence keeps using `periodKey()` (YYYY-MM).
 */
export function isoWeekKey(d: Date): string {
  // Standard ISO 8601 week calc: Thursday of the same week defines the year.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (t.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  t.setUTCDate(t.getUTCDate() - dayNum + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - firstThu.getTime()) / 86_400_000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Cadence-aware period key: weekly → ISO week, monthly → YYYY-MM. */
export function cadencePeriodKey(cadence: Cadence, d: Date): string {
  return cadence === 'weekly' ? isoWeekKey(d) : periodKey(d);
}

/** True at the cron tick that matches the cadence's send window (UTC). */
export function isDigestWindow(cadence: Cadence, now: Date): boolean {
  if (now.getUTCHours() !== 9 || now.getUTCMinutes() !== 0) return false;
  if (cadence === 'weekly') return now.getUTCDay() === 1; // Monday
  if (cadence === 'monthly') return now.getUTCDate() === 1;
  return false;
}

/** HMAC-SHA256 signing helper used for the unsubscribe token. */
async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function unsubSecret(env: Env): string {
  return env.SCORING_HMAC_SECRET || env.AXAL_ENCRYPTION_SECRET || env.JWT_SECRET || 'dev-only-unsub-secret';
}

export async function buildUnsubscribeToken(env: Env, userId: number): Promise<string> {
  return hmacSign(unsubSecret(env), `mi-watchlist-unsub:${userId}`);
}

export async function verifyUnsubscribeToken(env: Env, userId: number, token: string): Promise<boolean> {
  if (!token) return false;
  const expected = await buildUnsubscribeToken(env, userId);
  // Constant-time compare.
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

/** Render the per-user email body. Plain text — sendNotificationEmail
 *  wraps it in a minimal `<p>` HTML envelope. */
function renderDigestBody(args: {
  cadence: Cadence;
  sectors: Array<{
    sector: string;
    composite: number | null;
    prior: number | null;
    delta: number | null;
    citations: CitationLite[];
  }>;
  unsubscribeUrl: string;
  preferencesUrl: string;
}): { subject: string; body: string } {
  const { cadence, sectors, unsubscribeUrl, preferencesUrl } = args;
  const subject = `[Axal] Your ${cadence} sector digest — ${sectors.length} sector${sectors.length === 1 ? '' : 's'}`;
  const lines: string[] = [];
  lines.push(`Here's how the sectors you're watching moved over the last ${cadence === 'weekly' ? 'week' : 'month'}.`);
  lines.push('');
  for (const s of sectors) {
    const composite = s.composite == null ? '—' : s.composite.toFixed(1);
    let deltaStr = '';
    if (s.delta != null && s.prior != null) {
      const sign = s.delta > 0 ? '+' : '';
      deltaStr = ` (${sign}${s.delta.toFixed(1)} vs prior ${s.prior.toFixed(1)})`;
    } else {
      deltaStr = ' (no prior period yet)';
    }
    lines.push(`▸ ${s.sector}: composite ${composite}${deltaStr}`);
    if (s.citations.length === 0) {
      lines.push('   No new citations this period.');
    } else {
      const top = s.citations.slice(0, 3);
      for (const c of top) {
        lines.push(`   • ${c.metric_key} — ${c.citation_url}`);
      }
    }
    lines.push('');
  }
  lines.push(`Manage cadence per sector: ${preferencesUrl}`);
  lines.push(`Unsubscribe from all sector digests: ${unsubscribeUrl}`);
  lines.push('');
  lines.push('— Axal StudioOS');
  return { subject, body: lines.join('\n') };
}

/**
 * Walk the watchlist, send digests where the cadence window matches and
 * the row hasn't already been sent this period, stamp `last_sent_at` on
 * confirmed delivery only.
 *
 * Returns a small summary for cron logging.
 */
export async function sendMarketIntelDigests(
  env: Env,
  now: Date = new Date(),
): Promise<{ scanned: number; users: number; sent: number; rows: number; failed: number }> {
  const cadences: Cadence[] = [];
  if (isDigestWindow('weekly', now)) cadences.push('weekly');
  if (isDigestWindow('monthly', now)) cadences.push('monthly');
  if (cadences.length === 0) return { scanned: 0, users: 0, sent: 0, rows: 0, failed: 0 };

  // Resilience for partially migrated environments — the cron may fire
  // before `031_market_intel_watchlist_digest.sql` has been applied
  // remotely. Lazily ensure the table + columns so the SELECT below
  // doesn't blow up on a fresh dev D1 either.
  try { await ensureMarketIntelSchema(env); }
  catch (e) { console.warn('[mi digest] ensureSchema failed', e); }

  const placeholders = cadences.map(() => '?').join(',');
  let rows: WatchRow[] = [];
  try {
    const r: any = await env.DB.prepare(
      `SELECT w.id, w.user_id, w.sector, w.geo, w.cadence,
              w.last_sent_at, w.last_period_key, w.last_composite, u.email
         FROM market_intel_watchlist w
         JOIN users u ON u.id = w.user_id
        WHERE w.cadence IN (${placeholders})
          AND u.email IS NOT NULL AND u.email != ''
        ORDER BY w.user_id, w.sector
        LIMIT 5000`,
    ).bind(...cadences).all();
    rows = (r?.results || []) as WatchRow[];
  } catch (e) {
    console.warn('[mi digest] watchlist load failed', e);
    return { scanned: 0, users: 0, sent: 0, rows: 0, failed: 0 };
  }
  if (rows.length === 0) return { scanned: 0, users: 0, sent: 0, rows: 0, failed: 0 };

  // Composite indexes are stored monthly. Use them as the source of
  // truth for "current composite" (latest period) and as the fallback
  // baseline for the very first send when no `last_composite` snapshot
  // exists yet. Subsequent sends report `current - last_composite` so
  // weekly cadence reflects a true week-over-week movement.
  const currentMonthKey = periodKey(now);
  const priorMonth = priorMonthKey(now, 1);

  // Group by (user, cadence). A user with both weekly and monthly rows
  // gets two separate emails — they're describing different windows.
  // Idempotency is cadence-aware: weekly uses ISO week (YYYY-Www),
  // monthly uses YYYY-MM. Without that split, one weekly send in a
  // month would suppress every subsequent weekly send that month.
  const groups = new Map<string, WatchRow[]>();
  for (const r of rows) {
    const periodForRow = cadencePeriodKey(r.cadence, now);
    if (r.last_period_key === periodForRow) continue; // already sent this cadence period
    const key = `${r.user_id}:${r.cadence}`;
    const arr = groups.get(key) || [];
    arr.push(r);
    groups.set(key, arr);
  }
  if (groups.size === 0) return { scanned: rows.length, users: 0, sent: 0, rows: 0, failed: 0 };

  const appUrl = (env as { APP_URL?: string }).APP_URL || '';
  const root = appUrl.replace(/\/+$/, '');
  const preferencesUrl = `${root}/market-intelligence`;

  let sent = 0, failed = 0, totalRows = 0, users = 0;

  for (const [, group] of groups) {
    users += 1;
    const userId = group[0].user_id;
    const cadence = group[0].cadence;
    const email = group[0].email;
    const stampPeriod = cadencePeriodKey(cadence, now);
    // Citation watermark — "new since last send" is the spec. Fall back
    // to the cadence window only when this row has never been sent
    // (or we lost the timestamp) so first-time digests still have
    // content. Using last_sent_at means delayed/retried sends correctly
    // pick up everything they missed.
    const cadenceFloorMs = cadence === 'weekly' ? 7 * 86_400_000 : 30 * 86_400_000;
    const cadenceFloor = new Date(now.getTime() - cadenceFloorMs).toISOString();

    // Pull the per-sector current composite (latest monthly period) so
    // we always show the freshest known number. Prior baseline is each
    // row's own `last_composite` snapshot when present, otherwise the
    // monthly prior-period composite from market_intel_indexes.
    const sectorList = group.map((g) => g.sector);
    const sectorPlaceholders = sectorList.map(() => '?').join(',');
    let indexRows: Array<{ sector: string; period_key: string; value: number }> = [];
    try {
      const r: any = await env.DB.prepare(
        `SELECT sector, period_key, value
           FROM market_intel_indexes
          WHERE dimension = 'composite' AND geo = 'global'
            AND sector IN (${sectorPlaceholders})
            AND period_key IN (?, ?)`,
      ).bind(...sectorList, currentMonthKey, priorMonth).all();
      indexRows = (r?.results || []) as Array<{ sector: string; period_key: string; value: number }>;
    } catch (e) {
      console.warn('[mi digest] index load failed', e);
    }
    const indexBy = new Map<string, { current: IndexValue | null; prior: IndexValue | null }>();
    for (const s of sectorList) indexBy.set(s, { current: null, prior: null });
    for (const ir of indexRows) {
      const slot = indexBy.get(ir.sector);
      if (!slot) continue;
      if (ir.period_key === currentMonthKey) slot.current = { value: ir.value, period_key: ir.period_key };
      else if (ir.period_key === priorMonth) slot.prior = { value: ir.value, period_key: ir.period_key };
    }

    // Pull top citations per sector. Watermark = MAX(last_sent_at,
    // cadenceFloor) so we never look further back than one cadence
    // window even if a row has been silent for months. One query per
    // sector keeps the LIMIT semantics simple — sector counts per user
    // are small (typically 1–10 pinned sectors).
    const sectorPayload: Array<{
      sector: string; composite: number | null; prior: number | null; delta: number | null; citations: CitationLite[];
    }> = [];
    const newComposites: Array<{ id: number; composite: number | null }> = [];
    for (const w of group) {
      const watermark = (w.last_sent_at && w.last_sent_at > cadenceFloor)
        ? w.last_sent_at
        : cadenceFloor;
      let citations: CitationLite[] = [];
      try {
        const cr: any = await env.DB.prepare(
          `SELECT sector, metric_key, metric_value, ts, citation_url
             FROM market_intel_rows
            WHERE sector = ?
              AND ts > ?
              AND citation_url IS NOT NULL
              AND citation_url != ''
            ORDER BY ts DESC
            LIMIT 5`,
        ).bind(w.sector, watermark).all();
        citations = (cr?.results || []) as CitationLite[];
      } catch (e) {
        console.warn('[mi digest] citations load failed', { sector: w.sector, e });
      }
      const slot = indexBy.get(w.sector) || { current: null, prior: null };
      const composite = slot.current?.value ?? null;
      // Prefer the per-row snapshot from the previous send (true
      // weekly-prior baseline). Fall back to monthly prior period when
      // no snapshot exists yet (very first send for this row).
      const prior = w.last_composite != null ? w.last_composite : (slot.prior?.value ?? null);
      const delta = (composite != null && prior != null)
        ? Math.round((composite - prior) * 10) / 10
        : null;
      sectorPayload.push({ sector: w.sector, composite, prior, delta, citations });
      newComposites.push({ id: w.id, composite });
    }

    const unsubToken = await buildUnsubscribeToken(env, userId);
    const unsubscribeUrl = `${root}/api/market-intel-public/unsubscribe?u=${userId}&t=${unsubToken}`;
    const { subject, body } = renderDigestBody({
      cadence, sectors: sectorPayload, unsubscribeUrl, preferencesUrl,
    });

    const ok = await sendNotificationEmail(env, email, subject, body);
    if (!ok) {
      failed += 1;
      console.warn('[mi digest] email failed; leaving rows un-stamped for retry', { userId, cadence });
      continue;
    }
    // Stamp every row in the group as sent for this cadence period and
    // snapshot its current composite so the next send can compute a
    // true prior-period delta. Per-row UPDATE because last_composite
    // differs per sector — batched in a single D1 batch() for one
    // network round-trip.
    try {
      const stamps = newComposites.map((nc) =>
        env.DB.prepare(
          `UPDATE market_intel_watchlist
              SET last_sent_at = ?, last_period_key = ?, last_composite = ?
            WHERE id = ?`,
        ).bind(now.toISOString(), stampPeriod, nc.composite, nc.id),
      );
      if (stamps.length > 0) await env.DB.batch(stamps);
      sent += 1;
      totalRows += group.length;
    } catch (e) {
      // Email already went out — but the stamp didn't land. Surface
      // this as a failure (NOT a success) so operators see it in the
      // cron log and can investigate the duplicate-send risk window
      // (next cron tick at the same cadence slot will resend).
      failed += 1;
      console.error('[mi digest] stamp UPDATE failed AFTER email sent — duplicate-send risk on next cron tick', { userId, cadence, e });
    }
  }

  return { scanned: rows.length, users, sent, rows: totalRows, failed };
}
