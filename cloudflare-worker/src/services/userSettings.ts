/**
 * Task #20 — Phase B · Prompt 6 — Settings expansion (tabbed).
 *
 * Concrete row type + read/write helpers for the `user_settings` table
 * created in `cloudflare-worker/sql/migrations/002_user_settings.sql`.
 *
 * The settings router (routes/settings.ts) and the notify service
 * (services/notify.ts) both depend on this — keeping it in services/
 * avoids a circular import between routes/settings and services/notify.
 */
import type { Env } from '../types';

export type Theme = 'light' | 'dark' | 'system';
export type Density = 'comfy' | 'compact';
export type SidebarDefault = 'expanded' | 'collapsed';
export type Visibility = 'public' | 'network' | 'private';
export type DigestFrequency = 'off' | 'daily' | 'weekly';

export interface UserSettingsRow {
  user_id: number;
  timezone: string;
  locale: string;
  pronouns: string | null;
  profile_slug: string | null;
  visibility: Visibility;
  show_in_directory: number;
  discoverable: number;
  digest_frequency: DigestFrequency;
  notif_categories_email: string;
  notif_categories_inapp: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_tz: string | null;
  theme: Theme;
  density: Density;
  sidebar_default: SidebarDefault;
  feature_flags: string;
  updated_at: string;
}

const DEFAULT_ROW = {
  timezone: 'UTC',
  locale: 'en',
  pronouns: null as string | null,
  profile_slug: null as string | null,
  visibility: 'network' as Visibility,
  show_in_directory: 1,
  discoverable: 1,
  digest_frequency: 'weekly' as DigestFrequency,
  notif_categories_email: '{}',
  notif_categories_inapp: '{}',
  quiet_hours_start: null as string | null,
  quiet_hours_end: null as string | null,
  quiet_hours_tz: 'UTC' as string | null,
  theme: 'system' as Theme,
  density: 'comfy' as Density,
  sidebar_default: 'expanded' as SidebarDefault,
  feature_flags: '{}',
};

let migrated = false;
export async function ensureUserSettings(env: Env): Promise<void> {
  if (migrated) return;
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER PRIMARY KEY,
        timezone TEXT DEFAULT 'UTC',
        locale TEXT DEFAULT 'en',
        pronouns TEXT,
        profile_slug TEXT UNIQUE,
        visibility TEXT DEFAULT 'network' CHECK (visibility IN ('public','network','private')),
        show_in_directory INTEGER DEFAULT 1,
        discoverable INTEGER DEFAULT 1,
        digest_frequency TEXT DEFAULT 'weekly',
        notif_categories_email TEXT DEFAULT '{}',
        notif_categories_inapp TEXT DEFAULT '{}',
        quiet_hours_start TEXT,
        quiet_hours_end TEXT,
        quiet_hours_tz TEXT DEFAULT 'UTC',
        theme TEXT DEFAULT 'system',
        density TEXT DEFAULT 'comfy',
        sidebar_default TEXT DEFAULT 'expanded',
        feature_flags TEXT DEFAULT '{}',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
    ).run();
    try {
      await env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS idx_user_settings_slug ON user_settings(profile_slug) WHERE profile_slug IS NOT NULL`,
      ).run();
    } catch {}
    migrated = true;
  } catch (e) {
    console.error('[user_settings] migration failed', e);
  }
}

export async function getUserSettings(env: Env, userId: number): Promise<UserSettingsRow> {
  await ensureUserSettings(env);
  const row = await env.DB.prepare(`SELECT * FROM user_settings WHERE user_id = ?`)
    .bind(userId).first<UserSettingsRow>();
  if (row) return row;
  return {
    user_id: userId,
    ...DEFAULT_ROW,
    updated_at: new Date().toISOString(),
  };
}

export interface UserSettingsPatch {
  timezone?: string;
  locale?: string;
  pronouns?: string | null;
  profile_slug?: string | null;
  visibility?: Visibility;
  show_in_directory?: boolean | number;
  discoverable?: boolean | number;
  digest_frequency?: DigestFrequency;
  notif_categories_email?: Record<string, boolean>;
  notif_categories_inapp?: Record<string, boolean>;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  quiet_hours_tz?: string | null;
  theme?: Theme;
  density?: Density;
  sidebar_default?: SidebarDefault;
  feature_flags?: Record<string, boolean>;
}

const ALLOWED_LOCALES = new Set(['en', 'fr', 'es', 'pt']);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function asInt(v: unknown): number {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v ? 1 : 0;
  return v ? 1 : 0;
}

export class SettingsValidationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Returns the column/value pairs that should be UPDATEd. Validates inputs. */
function buildUpdates(patch: UserSettingsPatch): Array<[string, unknown]> {
  const updates: Array<[string, unknown]> = [];
  const push = (col: string, val: unknown) => updates.push([col, val]);

  if (patch.timezone !== undefined) {
    const tz = String(patch.timezone || '').slice(0, 64);
    if (!tz) throw new SettingsValidationError('timezone cannot be empty');
    push('timezone', tz);
  }
  if (patch.locale !== undefined) {
    const loc = String(patch.locale || '').toLowerCase().slice(0, 8);
    if (!ALLOWED_LOCALES.has(loc)) throw new SettingsValidationError(`locale must be one of ${[...ALLOWED_LOCALES].join(', ')}`);
    push('locale', loc);
  }
  if (patch.pronouns !== undefined) {
    const v = patch.pronouns == null ? null : String(patch.pronouns).slice(0, 32);
    push('pronouns', v && v.trim() ? v.trim() : null);
  }
  if (patch.profile_slug !== undefined) {
    if (patch.profile_slug == null || patch.profile_slug === '') {
      push('profile_slug', null);
    } else {
      const slug = String(patch.profile_slug).toLowerCase().trim();
      if (!SLUG_RE.test(slug)) {
        throw new SettingsValidationError('profile_slug must be 2-40 chars, lowercase alphanumeric or hyphen');
      }
      push('profile_slug', slug);
    }
  }
  if (patch.visibility !== undefined) {
    if (!['public', 'network', 'private'].includes(patch.visibility)) {
      throw new SettingsValidationError('visibility must be public|network|private');
    }
    push('visibility', patch.visibility);
  }
  if (patch.show_in_directory !== undefined) push('show_in_directory', asInt(patch.show_in_directory));
  if (patch.discoverable !== undefined) push('discoverable', asInt(patch.discoverable));
  if (patch.digest_frequency !== undefined) {
    if (!['off', 'daily', 'weekly'].includes(patch.digest_frequency)) {
      throw new SettingsValidationError('digest_frequency must be off|daily|weekly');
    }
    push('digest_frequency', patch.digest_frequency);
  }
  if (patch.notif_categories_email !== undefined) {
    push('notif_categories_email', JSON.stringify(patch.notif_categories_email || {}).slice(0, 4000));
  }
  if (patch.notif_categories_inapp !== undefined) {
    push('notif_categories_inapp', JSON.stringify(patch.notif_categories_inapp || {}).slice(0, 4000));
  }
  if (patch.quiet_hours_start !== undefined) {
    const v = patch.quiet_hours_start;
    if (v != null && v !== '' && !HHMM_RE.test(String(v))) {
      throw new SettingsValidationError('quiet_hours_start must be HH:MM (24h) or null');
    }
    push('quiet_hours_start', v == null || v === '' ? null : String(v));
  }
  if (patch.quiet_hours_end !== undefined) {
    const v = patch.quiet_hours_end;
    if (v != null && v !== '' && !HHMM_RE.test(String(v))) {
      throw new SettingsValidationError('quiet_hours_end must be HH:MM (24h) or null');
    }
    push('quiet_hours_end', v == null || v === '' ? null : String(v));
  }
  if (patch.quiet_hours_tz !== undefined) {
    const v = patch.quiet_hours_tz == null ? null : String(patch.quiet_hours_tz).slice(0, 64);
    push('quiet_hours_tz', v && v.trim() ? v.trim() : null);
  }
  if (patch.theme !== undefined) {
    if (!['light', 'dark', 'system'].includes(patch.theme)) {
      throw new SettingsValidationError('theme must be light|dark|system');
    }
    push('theme', patch.theme);
  }
  if (patch.density !== undefined) {
    if (!['comfy', 'compact'].includes(patch.density)) {
      throw new SettingsValidationError('density must be comfy|compact');
    }
    push('density', patch.density);
  }
  if (patch.sidebar_default !== undefined) {
    if (!['expanded', 'collapsed'].includes(patch.sidebar_default)) {
      throw new SettingsValidationError('sidebar_default must be expanded|collapsed');
    }
    push('sidebar_default', patch.sidebar_default);
  }
  if (patch.feature_flags !== undefined) {
    push('feature_flags', JSON.stringify(patch.feature_flags || {}).slice(0, 4000));
  }

  return updates;
}

/**
 * Upsert user_settings row with the given partial. Throws
 * SettingsValidationError on bad input (caller maps to HTTP status) and
 * a plain Error('profile_slug already in use') on UNIQUE conflict.
 */
export async function upsertUserSettings(env: Env, userId: number, patch: UserSettingsPatch): Promise<UserSettingsRow> {
  await ensureUserSettings(env);
  const updates = buildUpdates(patch);
  if (updates.length === 0) return getUserSettings(env, userId);

  // Slug uniqueness pre-check (avoids leaking SQLite error messages).
  const slugUpdate = updates.find(([col]) => col === 'profile_slug');
  if (slugUpdate && slugUpdate[1] != null) {
    const taken = await env.DB.prepare(
      `SELECT user_id FROM user_settings WHERE profile_slug = ? AND user_id != ?`,
    ).bind(slugUpdate[1], userId).first<{ user_id: number }>();
    if (taken) throw new SettingsValidationError('profile_slug already in use', 409);
  }

  // INSERT OR IGNORE then UPDATE — D1 lacks ON CONFLICT … DO UPDATE for
  // arbitrary partial updates without listing every column. The two-step
  // pattern is what other ensureSchema/upsert routes in this worker use.
  await env.DB.prepare(`INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)`)
    .bind(userId).run();

  const setSql = updates.map(([col]) => `${col} = ?`).join(', ');
  const params = updates.map(([, v]) => v);
  await env.DB.prepare(
    `UPDATE user_settings SET ${setSql}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
  ).bind(...params, userId).run();

  return getUserSettings(env, userId);
}

/**
 * Returns true if `now` (UTC) falls inside the user's quiet hours window
 * (interpreted in their `quiet_hours_tz`). Caller checks this before
 * sending push/realtime notifications.
 *
 * Handles wraparound (e.g. start=22:00, end=07:00).
 */
export function isInQuietHours(row: Pick<UserSettingsRow, 'quiet_hours_start' | 'quiet_hours_end' | 'quiet_hours_tz'>, now: Date = new Date()): boolean {
  const start = row.quiet_hours_start;
  const end = row.quiet_hours_end;
  if (!start || !end || !HHMM_RE.test(start) || !HHMM_RE.test(end)) return false;
  if (start === end) return false;
  const tz = row.quiet_hours_tz || 'UTC';
  // Compute "now" as HH:MM in the user's timezone via Intl.DateTimeFormat.
  let localHM: string;
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    const parts = fmt.formatToParts(now);
    const h = parts.find(p => p.type === 'hour')?.value || '00';
    const m = parts.find(p => p.type === 'minute')?.value || '00';
    localHM = `${h}:${m}`;
  } catch {
    // Bad tz — fall back to UTC rather than silently never quieting.
    const h = String(now.getUTCHours()).padStart(2, '0');
    const m = String(now.getUTCMinutes()).padStart(2, '0');
    localHM = `${h}:${m}`;
  }
  if (start < end) {
    return localHM >= start && localHM < end;
  }
  // Wraparound (e.g. 22:00 -> 07:00).
  return localHM >= start || localHM < end;
}
