/**
 * D7119 (#7119): Wellness recommendations from a member's own choices.
 *
 * Inputs, and nothing else:
 *   - the kinds of support the member chose (SUPPORT_TYPES), their languages,
 *     price ceiling and formats, all from `wellbeing_preferences`;
 *   - only when the member turned topic consent on, the topics they chose on
 *     their own reflections, from the records that consent covers. Never the
 *     text they wrote, never their answers to the questions, never a booking.
 *
 * What a topic may do. A topic is a word the member picked, not a need. It can
 * suggest coaching, general nutrition support or mindfulness. It never adds
 * licensed therapy, registered dietetics or spiritual guidance: those come
 * only from the member choosing them. Within a kind the member chose, a topic
 * may rank one expert above another.
 *
 * Every suggestion says why ("Why this?"): what was used, and what was not.
 */
import type { Env } from '../../types';
import { EXPERT_CATEGORIES } from '../../data/expertCategories';
import { decryptString } from '../cryptoBox';

export type SupportType = 'therapy' | 'dietetics' | 'nutrition' | 'coaching' | 'mindfulness' | 'spiritual';

export const SUPPORT_TYPES: Record<SupportType, { label: string; categories: readonly string[]; inferable: boolean }> = {
  therapy: { label: 'Licensed therapy', categories: ['therapist_clinical', 'psychiatrist', 'sport_psychologist', 'relationship_counsellor'], inferable: false },
  dietetics: { label: 'Registered dietetics', categories: ['dietitian'], inferable: false },
  nutrition: { label: 'General nutrition support', categories: ['nutritionist'], inferable: true },
  coaching: {
    label: 'Coaching',
    categories: ['executive_coach', 'leadership_coach', 'burnout_specialist', 'stress_management_coach', 'sleep_coach', 'productivity_coach', 'habits_coach'],
    inferable: true,
  },
  mindfulness: { label: 'Mindfulness and grounding', categories: ['mindfulness_coach', 'breathwork_coach', 'yoga_teacher'], inferable: true },
  spiritual: { label: 'Spiritual guidance', categories: ['spiritual_philosophical_advisor'], inferable: false },
};
export const SUPPORT_TYPE_KEYS = Object.keys(SUPPORT_TYPES) as SupportType[];
export const FORMATS = ['one_to_one', 'group'] as const;
export type Format = typeof FORMATS[number];
export const TOPIC_SOURCES = ['day', 'week', 'month', 'earlier'] as const;
export type TopicSource = typeof TOPIC_SOURCES[number];
/** Topics are read from this many days back, and the most-named few are used. */
export const TOPIC_WINDOW_DAYS = 90;
export const TOPIC_LIMIT = 5;

export const NOT_USED = [
  'Anything you wrote in a reflection',
  'Your answers to the reflection questions',
  'Your bookings and who you booked',
] as const;

export function typeOfCategory(category: string): SupportType | null {
  for (const k of SUPPORT_TYPE_KEYS) if (SUPPORT_TYPES[k].categories.includes(category)) return k;
  return null;
}

export function categoryLabel(category: string): string {
  return EXPERT_CATEGORIES.find((c) => c.key === category)?.label ?? category;
}

export type Preferences = {
  support_types: SupportType[];
  languages: string[];
  timezone: string | null;
  price_max_cents: number | null;
  formats: Format[];
  suggestions: boolean;
  topic_consent: boolean;
  topic_sources: TopicSource[];
  topic_consent_at: string | null;
  revision: number;
  updated_at: string | null;
};

export const DEFAULT_PREFERENCES: Preferences = {
  support_types: [], languages: [], timezone: null, price_max_cents: null, formats: [],
  suggestions: true, topic_consent: false, topic_sources: [], topic_consent_at: null, revision: 0, updated_at: null,
};

/**
 * The topic categories a member's consented topics may use, given what they
 * chose: a topic counts when its kind is one they chose, or one a topic may
 * suggest. Anything else is dropped, and listed as not used.
 */
export function usableTopics(topics: string[], chosen: SupportType[]): { used: string[]; ignored: string[] } {
  const used: string[] = [];
  const ignored: string[] = [];
  for (const t of topics) {
    const type = typeOfCategory(t);
    if (type && (chosen.includes(type) || SUPPORT_TYPES[type].inferable)) used.push(t);
    else ignored.push(t);
  }
  return { used, ignored };
}

/** The expert categories a directory ranking may use: the chosen kinds', then the usable topics. */
export function wantedCategories(prefs: Preferences, topics: string[]): string[] {
  const out = new Set<string>();
  for (const t of usableTopics(topics, prefs.support_types).used) out.add(t);
  for (const k of prefs.support_types) for (const c of SUPPORT_TYPES[k].categories) out.add(c);
  return [...out];
}

export type Candidate = {
  id: number; uid: string; name: string; headline: string | null; verified: boolean;
  categories: string[]; languages: string[]; timezones: string[];
  first_session_free: boolean;
  services: Array<{ uid: string; title: string; duration_minutes: number; price_cents: number; currency: string }>;
  availability: 'windows' | 'external' | 'none';
};

export type Reason = { kind: 'interest' | 'topic' | 'language' | 'format' | 'price'; label: string };

export type Recommendation = {
  kind: 'expert';
  uid: string; name: string; headline: string | null; verified: boolean;
  support_types: Array<{ key: SupportType; label: string }>;
  languages: string[]; timezones: string[];
  format: 'one_to_one';
  services: Candidate['services'];
  available: boolean; availability: Candidate['availability'];
  why: { used: Reason[]; not_used: string[] };
};

export type RecommendResult =
  | { state: 'off' }
  | { state: 'choose_interests'; items: [] }
  | { state: 'no_match' | 'ok'; items: Recommendation[]; excluded: { dismissed: number; language: number; price: number; format: number } };

const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());

export function recommend(
  candidates: Candidate[], prefs: Preferences, topics: string[], dismissed: Set<string>, limit = 6,
): RecommendResult {
  if (!prefs.suggestions) return { state: 'off' };
  const topicUse = usableTopics(topics, prefs.support_types);
  const topicTypes = new Set(topicUse.used.map((t) => typeOfCategory(t)!));
  const wanted = new Set<SupportType>([...prefs.support_types, ...topicTypes]);
  if (!wanted.size) return { state: 'choose_interests', items: [] };
  const excluded = { dismissed: 0, language: 0, price: 0, format: 0 };
  const wantsOneToOne = !prefs.formats.length || prefs.formats.includes('one_to_one');
  const langs = lower(prefs.languages);
  const scored: Array<{ rec: Recommendation; score: number }> = [];
  for (const e of candidates) {
    const types = [...wanted].filter((k) => SUPPORT_TYPES[k].categories.some((c) => e.categories.includes(c)));
    if (!types.length) continue;
    if (!wantsOneToOne) { excluded.format += 1; continue; }
    if (dismissed.has(`expert:${e.uid}`)) { excluded.dismissed += 1; continue; }
    const theirLangs = lower(e.languages);
    if (langs.length && theirLangs.length && !theirLangs.some((l) => langs.includes(l))) { excluded.language += 1; continue; }
    const prices = e.services.map((s) => s.price_cents).filter((n) => Number.isFinite(n));
    const cheapest = prices.length ? Math.min(...prices) : null;
    if (prefs.price_max_cents != null && !e.first_session_free && cheapest != null && cheapest > prefs.price_max_cents) {
      excluded.price += 1; continue;
    }
    const used: Reason[] = [];
    for (const k of types) {
      if (prefs.support_types.includes(k)) used.push({ kind: 'interest', label: `You chose ${SUPPORT_TYPES[k].label}` });
    }
    const topicHits = topicUse.used.filter((t) => e.categories.includes(t));
    for (const t of topicHits) used.push({ kind: 'topic', label: `You chose the topic “${categoryLabel(t)}” on a reflection` });
    if (langs.length && theirLangs.some((l) => langs.includes(l))) {
      used.push({ kind: 'language', label: `Works in ${theirLangs.filter((l) => langs.includes(l)).join(', ')}` });
    }
    if (prefs.formats.includes('one_to_one')) used.push({ kind: 'format', label: 'You asked for 1:1 sessions' });
    if (prefs.price_max_cents != null) used.push({ kind: 'price', label: 'Within the price you set' });
    const available = e.availability !== 'none';
    const score = types.filter((k) => prefs.support_types.includes(k)).length * 2 + topicHits.length + (available ? 0.5 : 0);
    scored.push({
      score,
      rec: {
        kind: 'expert', uid: e.uid, name: e.name, headline: e.headline, verified: e.verified,
        support_types: types.map((k) => ({ key: k, label: SUPPORT_TYPES[k].label })),
        languages: e.languages, timezones: e.timezones, format: 'one_to_one', services: e.services,
        available, availability: e.availability,
        why: { used, not_used: [...NOT_USED, ...(prefs.topic_consent ? [] : ['Topics on your reflections (you have not allowed this)'])] },
      },
    });
  }
  scored.sort((a, b) => Number(b.rec.available) - Number(a.rec.available) || b.score - a.score || a.rec.name.localeCompare(b.rec.name));
  const items = scored.slice(0, limit).map((s) => s.rec);
  return { state: items.length ? 'ok' : 'no_match', items, excluded };
}

// ---------------------------------------------------------------------------
// Reads the routes share
// ---------------------------------------------------------------------------

const parseList = (s: string | null | undefined): string[] => {
  try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
};

export async function loadPreferences(env: Env, userId: number): Promise<Preferences> {
  const r = await env.DB.prepare('SELECT * FROM wellbeing_preferences WHERE user_id = ?').bind(userId).first<any>();
  if (!r) return { ...DEFAULT_PREFERENCES };
  return {
    support_types: parseList(r.support_types_json).filter((k): k is SupportType => (SUPPORT_TYPE_KEYS as string[]).includes(k)),
    languages: parseList(r.languages_json),
    timezone: r.timezone ?? null,
    price_max_cents: r.price_max_cents == null ? null : Number(r.price_max_cents),
    formats: parseList(r.formats_json).filter((f): f is Format => (FORMATS as readonly string[]).includes(f)),
    suggestions: Number(r.suggestions) !== 0,
    topic_consent: Number(r.topic_consent) === 1,
    topic_sources: parseList(r.topic_sources_json).filter((s): s is TopicSource => (TOPIC_SOURCES as readonly string[]).includes(s)),
    topic_consent_at: r.topic_consent_at ?? null,
    revision: Number(r.revision),
    updated_at: r.updated_at ?? null,
  };
}

/**
 * The member's own most-named topics, only from the sources their consent
 * covers, from the last TOPIC_WINDOW_DAYS. With consent off this reads no
 * record at all and answers []. Only the topics column is decrypted.
 */
export async function consentedTopics(env: Env, userId: number, prefs: Preferences, now = new Date()): Promise<string[]> {
  if (!prefs.topic_consent || !prefs.topic_sources.length) return [];
  const since = new Date(now.getTime() - TOPIC_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const counts = new Map<string, number>();
  const add = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const t of list) if (typeof t === 'string' && t) counts.set(t, (counts.get(t) || 0) + 1);
  };
  const cadences = prefs.topic_sources.filter((s) => s !== 'earlier');
  if (cadences.length) {
    const rs = await env.DB.prepare(
      `SELECT topics_enc FROM wellbeing_reflections
        WHERE user_id = ? AND topics_enc IS NOT NULL AND period_end >= ?
          AND cadence IN (SELECT value FROM json_each(?))`,
    ).bind(userId, since, JSON.stringify(cadences)).all<{ topics_enc: string }>();
    for (const r of rs.results || []) {
      try { add(JSON.parse((await decryptString(env, r.topics_enc)) || '[]')); } catch { /* unreadable: not used */ }
    }
  }
  if (prefs.topic_sources.includes('earlier')) {
    const rs = await env.DB.prepare(
      'SELECT tags_enc, tags_plain FROM wellbeing_daily_pulses WHERE user_id = ? AND day >= ?',
    ).bind(userId, since).all<{ tags_enc: string | null; tags_plain: string | null }>();
    for (const r of rs.results || []) {
      let tags: unknown = null;
      if (r.tags_enc) { try { tags = JSON.parse((await decryptString(env, r.tags_enc)) || '[]'); } catch { tags = null; } }
      if (!Array.isArray(tags) && r.tags_plain) { try { tags = JSON.parse(r.tags_plain); } catch { tags = null; } }
      add(tags);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOPIC_LIMIT).map(([t]) => t);
}

// ---------------------------------------------------------------------------
// D7120 — group sessions as suggestions
// ---------------------------------------------------------------------------

export type SessionCandidate = {
  kind: 'session'; uid: string; title: string; language: string;
  support_type: { key: string; label: string }; state: string; seats_left: number;
  [k: string]: unknown;
};

/**
 * Upcoming group sessions that fit the member's choices, by the same rules as
 * experts: a kind they chose or a consented topic may suggest, their language,
 * group in their formats (or no format chosen), not dismissed. A full session
 * is kept, marked unavailable, so "no seats" is said rather than hidden.
 */
export function recommendSessions(sessions: SessionCandidate[], prefs: Preferences, topics: string[], dismissed: Set<string>) {
  if (!prefs.suggestions) return { items: [], excluded: { dismissed: 0, language: 0, format: 0 } };
  const topicUse = usableTopics(topics, prefs.support_types);
  const topicTypes = new Set(topicUse.used.map((t) => typeOfCategory(t)!));
  const wanted = new Set<string>([...prefs.support_types, ...topicTypes]);
  const excluded = { dismissed: 0, language: 0, format: 0 };
  const wantsGroup = !prefs.formats.length || prefs.formats.includes('group');
  const langs = lower(prefs.languages);
  const items: Array<SessionCandidate & { available: boolean; why: { used: Reason[]; not_used: string[] } }> = [];
  for (const s of sessions) {
    if (!wanted.has(s.support_type.key)) continue;
    if (!wantsGroup) { excluded.format += 1; continue; }
    if (dismissed.has(`session:${s.uid}`)) { excluded.dismissed += 1; continue; }
    if (langs.length && !langs.includes(s.language.toLowerCase())) { excluded.language += 1; continue; }
    const type = s.support_type.key as SupportType;
    const used: Reason[] = [];
    if (prefs.support_types.includes(type)) used.push({ kind: 'interest', label: `You chose ${SUPPORT_TYPES[type].label}` });
    for (const t of topicUse.used) {
      if (typeOfCategory(t) === type && !prefs.support_types.includes(type)) {
        used.push({ kind: 'topic', label: `You chose the topic “${categoryLabel(t)}” on a reflection` });
      }
    }
    if (langs.length) used.push({ kind: 'language', label: `Held in ${s.language}` });
    if (prefs.formats.includes('group')) used.push({ kind: 'format', label: 'You asked for group sessions' });
    items.push({
      ...s, available: s.state === 'open',
      why: { used, not_used: [...NOT_USED, ...(prefs.topic_consent ? [] : ['Topics on your reflections (you have not allowed this)'])] },
    });
  }
  return { items, excluded };
}
