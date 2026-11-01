/**
 * D1484 part 2 (#3978, of #3723) — a member's calendar source settings.
 *
 * Migration 708: `calendar_source_prefs` (shown and colour per source) and
 * `calendar_settings` (`copy_target`). Every read and write is the member's own
 * row, `WHERE user_id = ?` bound: there is no staff widening.
 *
 * A missing row means "shown, in its family's colour", and absence is never
 * written as a default row. Only the page read honours these settings: `.ics`,
 * the subscription feeds and the provider push ignore them.
 */
import type { Env } from '../../types';
import { SOURCES, SOURCE_FAMILIES, SOURCE_KINDS, type SourceFamily } from './registry';

/** Palette tokens, never hex; the page maps each to a light and a dark value. */
export const COLOURS = ['violet', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'slate'] as const;
export type Colour = typeof COLOURS[number];
export const COPY_TARGETS = ['all', 'google', 'microsoft', 'none'] as const;
export type CopyTarget = typeof COPY_TARGETS[number];

export const FAMILY_LABELS: Readonly<Record<SourceFamily, string>> = Object.freeze({
  meetings: 'Meetings', events: 'Events', validate: 'Validate', grow: 'Grow', deadlines: 'Deadlines',
  raise: 'Raise', tasks: 'Tasks', learning: 'Learning', external: 'From other calendars',
});

export const isSourceKey = (v: unknown): v is string => typeof v === 'string' && (SOURCE_KINDS as readonly string[]).includes(v);
export const isColour = (v: unknown): v is Colour => typeof v === 'string' && (COLOURS as readonly string[]).includes(v);
export const isCopyTarget = (v: unknown): v is CopyTarget => typeof v === 'string' && (COPY_TARGETS as readonly string[]).includes(v);

export type SourcePref = { shown: boolean; colour: Colour | null };
const rowsOf = (r: any): any[] => (Array.isArray(r?.results) ? r.results : []);

/** The member's own changed sources, by key. */
export async function readSourcePrefs(env: Env, userId: number): Promise<Map<string, SourcePref>> {
  const rows = rowsOf(await env.DB.prepare(
    'SELECT source_key, shown, colour FROM calendar_source_prefs WHERE user_id = ?1',
  ).bind(userId).all());
  return new Map(rows.map((r) => [String(r.source_key), { shown: Number(r.shown) === 1, colour: isColour(r.colour) ? r.colour : null }]));
}

/**
 * The kinds the member has hidden, for the page read. A store that cannot be
 * read hides nothing: the page shows every source rather than failing.
 */
export async function hiddenKinds(env: Env, userId: number): Promise<string[]> {
  try {
    const prefs = await readSourcePrefs(env, userId);
    return SOURCE_KINDS.filter((k) => prefs.get(k)?.shown === false);
  } catch (e) {
    console.warn('[calendar] source prefs unreadable', { outcome: 'hidden_none' });
    return [];
  }
}

export async function readCopyTarget(env: Env, userId: number): Promise<CopyTarget> {
  const row = (await env.DB.prepare('SELECT copy_target FROM calendar_settings WHERE user_id = ?1').bind(userId).first()) as any;
  return isCopyTarget(row?.copy_target) ? row.copy_target : 'all';
}

export type SourceView = { key: string; family: SourceFamily; module: string; label: string; shown: boolean; colour: Colour | null; page_only: boolean };

function viewOf(key: string, pref: SourcePref | undefined): SourceView {
  const s = SOURCES[key as keyof typeof SOURCES];
  return { key, family: s.family, module: s.module, label: s.label, shown: pref?.shown ?? true, colour: pref?.colour ?? null, page_only: s.page_only };
}

/** `GET /api/calendar/sources`: the families, every source with the member's settings, and `copy_target`. */
export async function sourcesRead(env: Env, userId: number) {
  const prefs = await readSourcePrefs(env, userId);
  return {
    families: SOURCE_FAMILIES.map((key) => ({ key, label: FAMILY_LABELS[key] })),
    sources: SOURCE_KINDS.map((k) => viewOf(k, prefs.get(k))),
    copy_target: await readCopyTarget(env, userId),
  };
}

/**
 * Write one source's settings. Only the fields given change; the other keeps
 * its stored value, or its default. The caller has validated both.
 */
export async function writeSourcePref(env: Env, userId: number, key: string, patch: { shown?: boolean; colour?: Colour | null }): Promise<SourceView> {
  const was = (await readSourcePrefs(env, userId)).get(key);
  const next: SourcePref = {
    shown: patch.shown ?? was?.shown ?? true,
    colour: patch.colour !== undefined ? patch.colour : (was?.colour ?? null),
  };
  await env.DB.prepare(
    `INSERT INTO calendar_source_prefs (user_id, source_key, shown, colour, updated_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))
     ON CONFLICT (user_id, source_key) DO UPDATE SET shown = excluded.shown, colour = excluded.colour, updated_at = excluded.updated_at`,
  ).bind(userId, key, next.shown ? 1 : 0, next.colour).run();
  return viewOf(key, next);
}

/** Whether the member has a Google or Microsoft calendar connected. */
export async function providerConnected(env: Env, userId: number, provider: 'google' | 'microsoft'): Promise<boolean> {
  const q = provider === 'google'
    ? 'SELECT 1 AS ok FROM google_oauth_tokens WHERE user_id = ?1'
    : 'SELECT 1 AS ok FROM microsoft_oauth_tokens WHERE user_id = ?1';
  try {
    return !!(await env.DB.prepare(q).bind(userId).first());
  } catch {
    return false;
  }
}

export async function writeCopyTarget(env: Env, userId: number, target: CopyTarget): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO calendar_settings (user_id, copy_target, updated_at) VALUES (?1, ?2, datetime('now'))
     ON CONFLICT (user_id) DO UPDATE SET copy_target = excluded.copy_target, updated_at = excluded.updated_at`,
  ).bind(userId, target).run();
}
