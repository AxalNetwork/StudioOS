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

type DigestSector = {
  sector: string;
  composite: number | null;
  prior: number | null;
  delta: number | null;
  citations: CitationLite[];
};

interface RenderedDigest { subject: string; body: string; html: string }

function escapeHtml(s: string): string {
  return (s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}

/** Plain-text body — kept as the multipart/alternative fallback so
 *  text-only mail clients render correctly. */
function renderDigestText(args: {
  cadence: Cadence;
  sectors: DigestSector[];
  unsubscribeUrl: string;
  preferencesUrl: string;
}): string {
  const { cadence, sectors, unsubscribeUrl, preferencesUrl } = args;
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
      for (const c of s.citations.slice(0, 3)) {
        lines.push(`   • ${c.metric_key} — ${c.citation_url}`);
      }
    }
    lines.push('');
  }
  lines.push(`Manage cadence per sector: ${preferencesUrl}`);
  // Task #32 — the unsubscribe link now lands on a confirmation page
  // whose primary action is PAUSE (1w / 1m / indefinitely). Removing
  // every pinned sector is still available there as a deliberate
  // secondary action.
  lines.push(`Pause or unsubscribe from sector digests: ${unsubscribeUrl}`);
  lines.push('');
  lines.push('— Axal StudioOS');
  return lines.join('\n');
}

/** Render a designed HTML email matching the rest of Axal's
 *  transactional template (header logo + sector cards + delta chips +
 *  citation rows + footer). All values are HTML-escaped — sector names
 *  come from a fixed registry, but citation URLs/metric keys are
 *  third-party data and could contain markup. */
function renderDigestHtml(args: {
  cadence: Cadence;
  sectors: DigestSector[];
  unsubscribeUrl: string;
  preferencesUrl: string;
}): string {
  const { cadence, sectors, unsubscribeUrl, preferencesUrl } = args;
  const window = cadence === 'weekly' ? 'last week' : 'last month';

  const sectorCards = sectors.map((s) => {
    const composite = s.composite == null ? '—' : s.composite.toFixed(1);
    // Delta chip — green up / red down / neutral grey when no prior.
    let chip = '';
    if (s.delta != null && s.prior != null) {
      const up = s.delta > 0;
      const flat = s.delta === 0;
      const bg = flat ? '#f3f4f6' : up ? '#ecfdf5' : '#fef2f2';
      const fg = flat ? '#374151' : up ? '#047857' : '#b91c1c';
      const arrow = flat ? '→' : up ? '▲' : '▼';
      const sign = s.delta > 0 ? '+' : '';
      chip = `<span style="display:inline-block;background:${bg};color:${fg};font-size:12px;font-weight:600;padding:3px 8px;border-radius:999px;letter-spacing:.01em;">${arrow} ${sign}${s.delta.toFixed(1)} vs ${s.prior.toFixed(1)}</span>`;
    } else {
      chip = `<span style="display:inline-block;background:#f3f4f6;color:#6b7280;font-size:12px;font-weight:500;padding:3px 8px;border-radius:999px;">no prior period yet</span>`;
    }

    const citeRows = s.citations.length === 0
      ? `<tr><td style="padding:8px 0;font-size:12px;color:#9ca3af;font-style:italic;">No new citations this period.</td></tr>`
      : s.citations.slice(0, 3).map((c) => {
          // Only render http(s) citation URLs as anchors. Anything
          // else (javascript:, data:, mailto:, missing scheme) shows
          // as plain escaped text to avoid funnelling untrusted
          // third-party data into a clickable link.
          const safeHref = /^https?:\/\//i.test(c.citation_url || '') ? c.citation_url : '';
          const label = escapeHtml(c.metric_key);
          const urlText = escapeHtml(c.citation_url || '');
          return `
          <tr><td style="padding:6px 0;border-top:1px solid #f3f4f6;">
            ${safeHref
              ? `<a href="${escapeHtml(safeHref)}" style="color:#2563eb;text-decoration:none;font-size:13px;font-weight:500;">${label}</a>`
              : `<span style="color:#374151;font-size:13px;font-weight:500;">${label}</span>`}
            <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${urlText}</div>
          </td></tr>`;
        }).join('');

    return `
      <tr><td style="padding:0 0 14px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;">
          <tr><td style="padding:16px 18px 12px;">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="vertical-align:middle;">
                <div style="font-size:11px;color:#7c3aed;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Sector</div>
                <div style="font-size:16px;color:#111827;font-weight:700;margin-top:2px;">${escapeHtml(s.sector)}</div>
              </td>
              <td align="right" style="vertical-align:middle;">
                <div style="font-size:11px;color:#9ca3af;font-weight:500;text-transform:uppercase;letter-spacing:.06em;">Composite</div>
                <div style="font-size:22px;color:#111827;font-weight:700;line-height:1.1;">${composite}</div>
              </td>
            </tr></table>
            <div style="margin-top:8px;">${chip}</div>
          </td></tr>
          <tr><td style="padding:6px 18px 16px;">
            <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">New citations</div>
            <table width="100%" cellpadding="0" cellspacing="0">${citeRows}</table>
          </td></tr>
        </table>
      </td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your ${cadence} sector digest</title></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;">
  <tr><td style="padding:0 0 20px;">
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;padding-right:10px;">
        <img src="https://axal.vc/axal-mark.png" alt="Axal VC" width="36" height="36" style="display:block;border:0;border-radius:8px;" />
      </td>
      <td style="vertical-align:middle;">
        <span style="font-size:18px;font-weight:700;color:#111827;letter-spacing:-0.01em;">Axal Market Intel</span>
        <div style="font-size:11px;color:#9ca3af;margin-top:2px;">Your ${escapeHtml(cadence)} sector digest</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:0 0 18px;">
    <h1 style="font-size:20px;font-weight:700;color:#111827;margin:0 0 6px;letter-spacing:-0.02em;">${sectors.length} sector${sectors.length === 1 ? '' : 's'} you're watching</h1>
    <p style="font-size:14px;color:#6b7280;margin:0;line-height:1.55;">Here's how the sectors you've pinned moved over the ${window}, with the freshest citations we picked up since your last digest.</p>
  </td></tr>
  ${sectorCards}
  <tr><td style="padding:8px 0 0;">
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:16px 18px;">
      <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">
        <a href="${escapeHtml(preferencesUrl)}" style="color:#7c3aed;font-weight:600;text-decoration:none;">Manage cadence per sector →</a>
      </p>
      <p style="margin:0;color:#9ca3af;font-size:12px;">
        Want a quiet week? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline;">Pause or unsubscribe</a> — pausing keeps your pinned sectors saved.
      </p>
    </div>
    <p style="font-size:11px;color:#9ca3af;margin:18px 0 0;text-align:center;">— Axal StudioOS</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function renderDigestBody(args: {
  cadence: Cadence;
  sectors: DigestSector[];
  unsubscribeUrl: string;
  preferencesUrl: string;
}): RenderedDigest {
  const { cadence, sectors } = args;
  const subject = `[Axal] Your ${cadence} sector digest — ${sectors.length} sector${sectors.length === 1 ? '' : 's'}`;
  return {
    subject,
    body: renderDigestText(args),
    html: renderDigestHtml(args),
  };
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
    // Task #32 — skip users whose digest pause window is still active.
    // `mi_digest_paused_until` is an ISO timestamp (NULL = not paused;
    // sentinel '9999-12-31T00:00:00Z' = paused indefinitely). Comparing
    // as strings is safe because all stored values are zero-padded
    // ISO-8601 UTC, which sorts lexicographically the same as
    // chronologically. The pause is self-clearing once the timestamp
    // passes — no cron tick needed to "resume".
    const nowIso = now.toISOString();
    const r: any = await env.DB.prepare(
      `SELECT w.id, w.user_id, w.sector, w.geo, w.cadence,
              w.last_sent_at, w.last_period_key, w.last_composite, u.email
         FROM market_intel_watchlist w
         JOIN users u ON u.id = w.user_id
        WHERE w.cadence IN (${placeholders})
          AND u.email IS NOT NULL AND u.email != ''
          AND (u.mi_digest_paused_until IS NULL
               OR u.mi_digest_paused_until <= ?)
        ORDER BY w.user_id, w.sector
        LIMIT 5000`,
    ).bind(...cadences, nowIso).all();
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
  // CodeQL js/polynomial-redos: avoid `\/+$` regex on uncontrolled APP_URL.
  let _i = appUrl.length;
  while (_i > 0 && appUrl.charCodeAt(_i - 1) === 47) _i--;
  const root = _i === appUrl.length ? appUrl : appUrl.slice(0, _i);
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
    const { subject, body, html } = renderDigestBody({
      cadence, sectors: sectorPayload, unsubscribeUrl, preferencesUrl,
    });

    // Task #33 — designed HTML body with sector cards, plain text
    // retained as the multipart/alternative fallback.
    const ok = await sendNotificationEmail(env, email, subject, body, { html });
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
