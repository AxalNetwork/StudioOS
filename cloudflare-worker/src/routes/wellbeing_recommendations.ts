/**
 * D7119 (#7119): a member's Wellness preferences, and the suggestions made
 * from them.
 *
 *   GET    /api/wellbeing/preferences              the member's choices, or the defaults (nothing chosen, consent off)
 *   PUT    /api/wellbeing/preferences              change them; `base_revision` guards a stale copy
 *   POST   /api/wellbeing/preferences/reset        forget every choice, the consent and every dismissal
 *   GET    /api/wellbeing/recommendations          suggestions, each with "Why this?"
 *   POST   /api/wellbeing/recommendations/dismiss  { kind: 'expert', uid } — hide one suggestion
 *   DELETE /api/wellbeing/recommendations/dismiss/:kind/:uid   undo a dismissal
 *
 * Who. Any signed-in member but an investor-only account, as every Wellbeing
 * member route. Each row is the caller's own.
 *
 * Topic consent is off by default. With it off, nothing here reads a
 * reflection or a check-in (`consentedTopics` returns before any query).
 * With it on, only the topics the member chose on the records the consent
 * covers are read; never their text or their answers. Revoking it takes
 * effect on the next read: nothing derived from topics is stored.
 *
 * Who is suggested. Experts the directory lists: active, verified, not a
 * sample, not hidden, a complete profile (`GET /experts`'s own filter). Group
 * sessions are #7120's; until then a suggestion is 1:1 only and the answer
 * says that group sessions are not offered yet.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { holdsOnlyLicence } from '../services/accountLicences';
import { refuse } from '../util/refusal';
import wellbeing from './wellbeing';
import { SAMPLE_EXPERT_UID_PREFIX } from '../services/wellbeing/seedExperts';
import { isTimezone } from '../services/wellbeing/reflectionPeriods';
import {
  type Candidate, type Format, type Preferences, type SupportType, type TopicSource,
  FORMATS, NOT_USED, SUPPORT_TYPES, SUPPORT_TYPE_KEYS, TOPIC_SOURCES,
  consentedTopics, loadPreferences, recommend,
} from '../services/wellbeing/recommend';

const preferences = new Hono<{ Bindings: Env }>();
const recommendations = new Hono<{ Bindings: Env }>();

const LANG_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;
export const PRICE_MAX_CENTS = 10_000_00;

async function member(c: any) {
  const user = await requireAuth(c);
  if (holdsOnlyLicence(user, 'investor')) {
    return refuse(c, 403, { code: 'not_available_for_investors', message: 'Wellness is not available for investor accounts.' });
  }
  return user;
}

function publicPreferences(p: Preferences) {
  return {
    ...p,
    support_type_options: SUPPORT_TYPE_KEYS.map((k) => ({ key: k, label: SUPPORT_TYPES[k].label, suggested_from_topics: SUPPORT_TYPES[k].inferable })),
    topic_consent_scope: 'Only the topics you choose on a reflection. Never what you write, never your answers, never your bookings.',
  };
}

/** A checked change. A field left out keeps its value. */
export function preferenceChange(body: any, current: Preferences):
  | { ok: true; next: Preferences; baseRevision: number }
  | { ok: false; code: string; message: string } {
  const b = body && typeof body === 'object' ? body : {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
  const next: Preferences = { ...current };
  const list = (k: string, allowed: readonly string[], code: string) => {
    if (!Array.isArray(b[k]) || b[k].some((x: unknown) => typeof x !== 'string' || !allowed.includes(x))) {
      return { ok: false as const, code, message: `${k} must be a list of ${allowed.join(', ')}.` };
    }
    return { ok: true as const, value: [...new Set(b[k] as string[])] };
  };
  if (has('support_types')) {
    const r = list('support_types', SUPPORT_TYPE_KEYS, 'invalid_support_types');
    if (!r.ok) return r;
    next.support_types = r.value as SupportType[];
  }
  if (has('formats')) {
    const r = list('formats', FORMATS, 'invalid_formats');
    if (!r.ok) return r;
    next.formats = r.value as Format[];
  }
  if (has('topic_sources')) {
    const r = list('topic_sources', TOPIC_SOURCES, 'invalid_topic_sources');
    if (!r.ok) return r;
    next.topic_sources = r.value as TopicSource[];
  }
  if (has('languages')) {
    if (!Array.isArray(b.languages) || b.languages.length > 10 || b.languages.some((x: unknown) => typeof x !== 'string' || !LANG_RE.test(x))) {
      return { ok: false, code: 'invalid_languages', message: 'languages is a list of up to 10 language codes, e.g. en or fr.' };
    }
    next.languages = [...new Set((b.languages as string[]).map((x) => x.toLowerCase()))];
  }
  if (has('timezone')) {
    if (b.timezone !== null && !isTimezone(b.timezone)) return { ok: false, code: 'invalid_timezone', message: 'timezone is an IANA zone, e.g. Europe/Paris, or null.' };
    next.timezone = b.timezone;
  }
  if (has('price_max_cents')) {
    const v = b.price_max_cents;
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > PRICE_MAX_CENTS)) {
      return { ok: false, code: 'invalid_price_max', message: 'price_max_cents is a whole number of cents, or null for no limit.' };
    }
    next.price_max_cents = v;
  }
  if (has('suggestions')) {
    if (typeof b.suggestions !== 'boolean') return { ok: false, code: 'invalid_suggestions', message: 'suggestions is true or false.' };
    next.suggestions = b.suggestions;
  }
  if (has('topic_consent')) {
    if (typeof b.topic_consent !== 'boolean') return { ok: false, code: 'invalid_topic_consent', message: 'topic_consent is true or false.' };
    next.topic_consent = b.topic_consent;
  }
  if (next.topic_consent && !next.topic_sources.length) {
    return { ok: false, code: 'topic_sources_required', message: 'Choose which of your records the topics may come from.' };
  }
  const base = b.base_revision == null ? current.revision : Number(b.base_revision);
  if (!Number.isInteger(base) || base < 0) return { ok: false, code: 'invalid_base_revision', message: 'base_revision must be the revision you edited.' };
  return { ok: true, next, baseRevision: base };
}

preferences.get('/', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try {
    return c.json(publicPreferences(await loadPreferences(c.env, user.id)));
  } catch (e) {
    return refuse(c, 503, { code: 'preferences_unreadable', message: 'Your Wellness choices could not be read. This is not a claim that you have made none.', raw: e });
  }
});

preferences.put('/', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  let current: Preferences;
  try { current = await loadPreferences(c.env, user.id); } catch (e) {
    return refuse(c, 503, { code: 'preferences_not_saved', message: 'Your choices were not saved. Try again.', raw: e });
  }
  const v = preferenceChange(await c.req.json().catch(() => null), current);
  if (!v.ok) return refuse(c, 400, { code: v.code, message: v.message });
  if (v.baseRevision !== current.revision) {
    return refuse(c, 409, {
      code: 'preferences_changed', message: 'Your choices were changed somewhere else. Load them again before saving.',
      extra: { current_revision: current.revision },
    });
  }
  const n = v.next;
  // The consent's own date: when it was last turned on; cleared when it is off.
  const consentAt = n.topic_consent ? (current.topic_consent ? current.topic_consent_at : new Date().toISOString()) : null;
  const vals = [
    JSON.stringify(n.support_types), JSON.stringify(n.languages), n.timezone, n.price_max_cents, JSON.stringify(n.formats),
    n.suggestions ? 1 : 0, n.topic_consent ? 1 : 0, JSON.stringify(n.topic_consent ? n.topic_sources : []), consentAt,
  ];
  try {
    const res = current.revision === 0
      ? await c.env.DB.prepare(
        `INSERT INTO wellbeing_preferences
           (user_id, support_types_json, languages_json, timezone, price_max_cents, formats_json,
            suggestions, topic_consent, topic_sources_json, topic_consent_at, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
         ON CONFLICT (user_id) DO NOTHING`,
      ).bind(user.id, ...vals).run()
      : await c.env.DB.prepare(
        `UPDATE wellbeing_preferences
            SET support_types_json = ?, languages_json = ?, timezone = ?, price_max_cents = ?, formats_json = ?,
                suggestions = ?, topic_consent = ?, topic_sources_json = ?, topic_consent_at = ?,
                revision = revision + 1, updated_at = datetime('now')
          WHERE user_id = ? AND revision = ?`,
      ).bind(...vals, user.id, current.revision).run();
    if (!Number(res?.meta?.changes ?? 0)) {
      const now = await loadPreferences(c.env, user.id);
      return refuse(c, 409, {
        code: 'preferences_changed', message: 'Your choices were changed somewhere else. Load them again before saving.',
        extra: { current_revision: now.revision },
      });
    }
    return c.json(publicPreferences(await loadPreferences(c.env, user.id)));
  } catch (e) {
    return refuse(c, 503, { code: 'preferences_not_saved', message: 'Your choices were not saved. Try again.', raw: e });
  }
});

preferences.post('/reset', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM wellbeing_preferences WHERE user_id = ?').bind(user.id),
      c.env.DB.prepare('DELETE FROM wellbeing_recommendation_dismissals WHERE user_id = ?').bind(user.id),
    ]);
    return c.json(publicPreferences(await loadPreferences(c.env, user.id)));
  } catch (e) {
    return refuse(c, 503, { code: 'preferences_not_reset', message: 'Your choices were not reset. Try again.', raw: e });
  }
});

/** The experts `GET /experts` lists, with their active services and whether they offer times. */
export async function eligibleCandidates(env: Env): Promise<Candidate[]> {
  const rs = await env.DB.prepare(
    `SELECT * FROM experts
      WHERE is_active = 1 AND substr(uid, 1, ?) <> ? AND verified = 1
        AND COALESCE(hidden_by_admin, 0) = 0 AND COALESCE(profile_completion_pct, 0) >= 70`,
  ).bind(SAMPLE_EXPERT_UID_PREFIX.length, SAMPLE_EXPERT_UID_PREFIX).all<any>();
  const experts = rs.results || [];
  if (!experts.length) return [];
  const ids = JSON.stringify(experts.map((e: any) => e.id));
  const svc = await env.DB.prepare(
    `SELECT expert_id, uid, title, duration_minutes, price_cents, currency FROM expert_services
      WHERE is_active = 1 AND expert_id IN (SELECT value FROM json_each(?)) ORDER BY expert_id, sort_order, id`,
  ).bind(ids).all<any>();
  const av = await env.DB.prepare(
    `SELECT expert_id, COUNT(*) AS n FROM expert_availability
      WHERE expert_id IN (SELECT value FROM json_each(?)) GROUP BY expert_id`,
  ).bind(ids).all<any>();
  const services = new Map<number, Candidate['services']>();
  for (const s of svc.results || []) {
    const l = services.get(Number(s.expert_id)) ?? [];
    l.push({ uid: s.uid, title: s.title, duration_minutes: Number(s.duration_minutes), price_cents: Number(s.price_cents), currency: s.currency });
    services.set(Number(s.expert_id), l);
  }
  const windows = new Set((av.results || []).filter((r: any) => Number(r.n) > 0).map((r: any) => Number(r.expert_id)));
  const arr = (s: string | null) => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
  return experts.map((e: any) => ({
    id: Number(e.id), uid: e.uid, name: e.name, headline: e.headline ?? null, verified: !!e.verified,
    categories: arr(e.categories_json), languages: arr(e.languages_json), timezones: arr(e.timezones_json),
    first_session_free: !!e.first_session_free,
    services: services.get(Number(e.id)) ?? [],
    availability: windows.has(Number(e.id)) ? 'windows' : (e.calendly_url || e.booking_url) ? 'external' : 'none',
  }));
}

recommendations.get('/', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  let prefs: Preferences;
  try { prefs = await loadPreferences(c.env, user.id); } catch (e) {
    return refuse(c, 503, { code: 'recommendations_unreadable', message: 'Suggestions could not be read. This is not a claim that none match.', raw: e });
  }
  const base = {
    suggestions: prefs.suggestions,
    topic_consent: prefs.topic_consent,
    group_sessions: { offered: false, reason: 'Group sessions are not bookable yet.' },
    not_used: NOT_USED,
  };
  if (!prefs.suggestions) return c.json({ ...base, state: 'off', items: [] });
  try {
    const topics = await consentedTopics(c.env, user.id, prefs);
    const dismissedRows = await c.env.DB.prepare(
      'SELECT target_kind, target_uid FROM wellbeing_recommendation_dismissals WHERE user_id = ?',
    ).bind(user.id).all<{ target_kind: string; target_uid: string }>();
    const dismissed = new Set((dismissedRows.results || []).map((r) => `${r.target_kind}:${r.target_uid}`));
    const out = recommend(await eligibleCandidates(c.env), prefs, topics, dismissed);
    return c.json({ ...base, ...out, dismissed_count: dismissed.size });
  } catch (e) {
    return refuse(c, 503, { code: 'recommendations_unreadable', message: 'Suggestions could not be read. This is not a claim that none match.', raw: e });
  }
});

recommendations.post('/dismiss', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const b = await c.req.json().catch(() => null) as any;
  if (b?.kind !== 'expert' && b?.kind !== 'session') return refuse(c, 400, { code: 'invalid_kind', message: 'kind is expert or session.' });
  if (typeof b?.uid !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(b.uid)) return refuse(c, 400, { code: 'invalid_uid', message: 'uid names the suggestion.' });
  await c.env.DB.prepare(
    `INSERT INTO wellbeing_recommendation_dismissals (user_id, target_kind, target_uid) VALUES (?, ?, ?)
     ON CONFLICT (user_id, target_kind, target_uid) DO NOTHING`,
  ).bind(user.id, b.kind, b.uid).run();
  return c.json({ dismissed: true, kind: b.kind, uid: b.uid });
});

recommendations.delete('/dismiss/:kind/:uid', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  await c.env.DB.prepare(
    'DELETE FROM wellbeing_recommendation_dismissals WHERE user_id = ? AND target_kind = ? AND target_uid = ?',
  ).bind(user.id, c.req.param('kind'), c.req.param('uid')).run();
  return c.json({ dismissed: false });
});

export { preferences, recommendations };
export default recommendations;

// Both mount above the legacy `/api/wellbeing` router, the more specific path
// first; that router answers nothing under either path.
export const mount: RouteMount[] = [
  { path: '/api/wellbeing/preferences', router: preferences, before: [wellbeing] },
  { path: '/api/wellbeing/recommendations', router: recommendations, before: [wellbeing] },
];
