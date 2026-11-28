/**
 * D7118 (#7118): Wellness reflections. Each member has their own daily, weekly
 * and monthly reflections, kept apart and each editable on its own, mounted at
 * /api/wellbeing/reflections.
 *
 *   GET    /today?tz=Europe/Paris      today's day, week and month, each with the member's reflection or null
 *   GET    /?cadence=day|week|month    the member's history for one cadence, newest first
 *   GET    /earlier                    check-ins saved before reflections were split by cadence
 *   GET    /months/:month/summary      what the member recorded in a month (YYYY-MM), and nothing more
 *   GET    /export                     every reflection and earlier check-in, decrypted, as a JSON file
 *   GET    /:cadence/:period           one reflection
 *   PUT    /:cadence/:period           create or edit one reflection
 *   DELETE /:uid                       remove one reflection
 *   DELETE /earlier/:uid               remove one earlier check-in
 *
 * Who. Any signed-in member but an investor-only account, the same guard as
 * `/api/wellbeing/checkins`. Every read and write is scoped to the caller's own
 * user id: there is no route that names another member, and a uid that is not
 * the caller's answers 404, so it never confirms that it exists.
 *
 * Periods. `services/wellbeing/reflectionPeriods.ts`: the member's own calendar
 * in the zone their device sends. A saved row keeps its zone and its dates.
 *
 * Protection. Scores, text and topics are AES-GCM ciphertext. If the cipher is
 * unavailable the write is refused (503 `reflection_protection_unavailable`)
 * and nothing is stored: the client keeps the draft for a retry. There is no
 * plaintext fallback here, unlike the earlier check-in writer (Task #33). No
 * value is ever logged: a refusal logs the thrown error's text only.
 *
 * Retries and edits. A write carries `base_revision` (0 to create) and may
 * carry a `request_id`. The same request_id again returns the stored row
 * (`replayed: true`) without writing twice. A write from a stale revision is
 * refused 409 `reflection_changed` with the current revision, never applied
 * over a newer edit.
 *
 * Earlier check-ins. Rows in `wellbeing_daily_pulses` keep their own dates.
 * Some were daily, some weekly (D574), and the record does not say which, so
 * they are read as "earlier check-ins" and never filed as a day or a week.
 *
 * Retention. A reflection is kept until the member deletes it. Export and
 * deletion are the member's own; HQ has no route to either.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { holdsOnlyLicence } from '../services/accountLicences';
import { decryptString, encryptString } from '../services/cryptoBox';
import { refuse } from '../util/refusal';
import { clampLimit } from '../util/pagination';
import { DAILY_KEYS, weekSpan } from './wellbeing.helpers';
import { PULSE_FIELDS, holdingOf } from '../services/wellbeing/storageReview';
import wellbeing, { serializeDaily } from './wellbeing';
import {
  type Cadence, currentPeriods, datesBetween, isCadence, isDate, isTimezone, periodOf, periodProblem,
} from '../services/wellbeing/reflectionPeriods';

const reflections = new Hono<{ Bindings: Env }>();

export const TEXT_MAX = 4000;
export const TOPICS_MAX = 8;
export const TOPIC_MAX = 40;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const RETENTION = {
  rule: 'until_deleted',
  sentence: 'Your reflections are kept until you delete them. You can export them at any time.',
} as const;

type ReflectionRow = {
  id: number; uid: string; user_id: number; cadence: Cadence;
  period_start: string; period_end: string; timezone: string;
  scores_enc: string | null; text_enc: string | null; topics_enc: string | null;
  revision: number; last_request_id: string | null; created_at: string; updated_at: string;
};

type Scores = Partial<Record<typeof DAILY_KEYS[number], number>>;

/** The checked body of a write, or the first problem as a code. */
export function reflectionBody(body: any):
  | { ok: true; scores: Scores; text: string | null; topics: string[]; timezone: string; baseRevision: number; requestId: string | null }
  | { ok: false; code: string; message: string } {
  const b = body && typeof body === 'object' ? body : {};
  if (!isTimezone(b.timezone)) return { ok: false, code: 'invalid_timezone', message: 'Send the time zone you are writing from, e.g. Europe/Paris.' };
  const scores: Scores = {};
  if (b.scores != null) {
    if (typeof b.scores !== 'object' || Array.isArray(b.scores)) return { ok: false, code: 'invalid_scores', message: 'scores must be an object.' };
    for (const [k, v] of Object.entries(b.scores)) {
      if (!(DAILY_KEYS as readonly string[]).includes(k)) return { ok: false, code: 'invalid_scores', message: `${k} is not a reflection question.` };
      if (v == null || v === '') continue;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 5) return { ok: false, code: 'invalid_scores', message: `${k} must be a whole number from 1 to 5.` };
      scores[k as keyof Scores] = n;
    }
  }
  let text: string | null = null;
  if (b.text != null) {
    if (typeof b.text !== 'string') return { ok: false, code: 'invalid_text', message: 'text must be a string.' };
    if (b.text.length > TEXT_MAX) return { ok: false, code: 'text_too_long', message: `A reflection is at most ${TEXT_MAX} characters.` };
    text = b.text.trim() ? b.text : null;
  }
  const topics: string[] = [];
  if (b.topics != null) {
    if (!Array.isArray(b.topics)) return { ok: false, code: 'invalid_topics', message: 'topics must be a list.' };
    for (const t of b.topics) {
      if (typeof t !== 'string' || !t.trim() || t.trim().length > TOPIC_MAX) {
        return { ok: false, code: 'invalid_topics', message: `Each topic is a word or phrase of at most ${TOPIC_MAX} characters.` };
      }
      if (!topics.includes(t.trim())) topics.push(t.trim());
    }
    if (topics.length > TOPICS_MAX) return { ok: false, code: 'invalid_topics', message: `At most ${TOPICS_MAX} topics.` };
  }
  if (!Object.keys(scores).length && !text && !topics.length) {
    return { ok: false, code: 'reflection_empty', message: 'Answer a question, choose a topic or write something before saving.' };
  }
  const base = b.base_revision == null ? 0 : Number(b.base_revision);
  if (!Number.isInteger(base) || base < 0) return { ok: false, code: 'invalid_base_revision', message: 'base_revision must be 0 or the revision you edited.' };
  let requestId: string | null = null;
  if (b.request_id != null) {
    if (typeof b.request_id !== 'string' || !REQUEST_ID_RE.test(b.request_id)) {
      return { ok: false, code: 'invalid_request_id', message: 'request_id is up to 64 letters, digits, - or _.' };
    }
    requestId = b.request_id;
  }
  return { ok: true, scores, text, topics, timezone: b.timezone, baseRevision: base, requestId };
}

async function decryptJson<T>(env: Env, blob: string | null, fallback: T): Promise<{ value: T; readable: boolean }> {
  if (!blob) return { value: fallback, readable: true };
  try {
    const s = await decryptString(env, blob);
    if (s == null) return { value: fallback, readable: false };
    return { value: JSON.parse(s) as T, readable: true };
  } catch {
    return { value: fallback, readable: false };
  }
}

/**
 * A row as its author reads it. A field that cannot be decrypted is null and
 * `readable` is false: never an empty reflection.
 */
export async function serializeReflection(env: Env, r: ReflectionRow) {
  const [scores, text, topics] = await Promise.all([
    decryptJson<Scores>(env, r.scores_enc, {}),
    decryptJson<string | null>(env, r.text_enc, null),
    decryptJson<string[]>(env, r.topics_enc, []),
  ]);
  const readable = scores.readable && text.readable && topics.readable;
  return {
    uid: r.uid, cadence: r.cadence, period_start: r.period_start, period_end: r.period_end, timezone: r.timezone,
    scores: scores.readable ? scores.value : null,
    text: text.readable ? text.value : null,
    topics: topics.readable ? topics.value : null,
    readable,
    revision: Number(r.revision), created_at: r.created_at, updated_at: r.updated_at,
  };
}

/**
 * An earlier check-in, labelled for what it is and filed as neither a day nor
 * a week. `held` says how it is stored (D7118 part 4): `encrypted`,
 * `not_encrypted` (the Task #33 writer kept plaintext when encryption failed)
 * or `partly_unreadable` (ciphertext that no longer opens), so the page never
 * puts "Stored encrypted" over a check-in that is not.
 */
async function serializeEarlier(env: Env, row: any) {
  const [s, holding] = await Promise.all([serializeDaily(env, row), holdingOf(env, row, PULSE_FIELDS)]);
  return {
    kind: 'earlier_checkin' as const,
    uid: s.uid, day: s.day, week_start: weekSpan(s.day).start,
    label: 'Earlier check-in',
    note: 'Saved before daily, weekly and monthly reflections were kept apart. It keeps its own date and is not counted as a day or a week.',
    scores: Object.fromEntries(DAILY_KEYS.map((k) => [k, (s as any)[k] ?? null]).filter(([, v]) => v != null)),
    text: s.free_text, topics: s.tags, saved_at: s.created_at,
    held: holding.held,
  };
}

async function member(c: any) {
  const user = await requireAuth(c);
  if (holdsOnlyLicence(user, 'investor')) {
    return refuse(c, 403, { code: 'not_available_for_investors', message: 'Wellness reflections are not available for investor accounts.' });
  }
  return user;
}

function unreadable(c: any, raw: unknown) {
  return refuse(c, 503, {
    code: 'reflections_unreadable',
    message: 'Your reflections could not be read. This is not a claim that you have none.',
    raw,
  });
}

async function rowAt(env: Env, userId: number, cadence: Cadence, start: string) {
  return env.DB.prepare(
    'SELECT * FROM wellbeing_reflections WHERE user_id = ? AND cadence = ? AND period_start = ?',
  ).bind(userId, cadence, start).first<ReflectionRow>();
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

reflections.get('/today', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const tz = c.req.query('tz') || 'UTC';
  if (!isTimezone(tz)) return refuse(c, 400, { code: 'invalid_timezone', message: 'Send the time zone you are in, e.g. Europe/Paris.' });
  const p = currentPeriods(new Date(), tz);
  try {
    const out: Record<string, unknown> = { today: p.today, timezone: tz };
    for (const cadence of ['day', 'week', 'month'] as const) {
      const row = await rowAt(c.env, user.id, cadence, p[cadence].start);
      out[cadence] = {
        period_start: p[cadence].start, period_end: p[cadence].end,
        reflection: row ? await serializeReflection(c.env, row) : null,
      };
    }
    return c.json(out);
  } catch (e) {
    return unreadable(c, e);
  }
});

reflections.get('/', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const cadence = c.req.query('cadence');
  if (!isCadence(cadence)) return refuse(c, 400, { code: 'invalid_cadence', message: 'cadence must be day, week or month.' });
  const limit = clampLimit(c.req.query('limit'), 30, 200);
  try {
    const rs = await c.env.DB.prepare(
      `SELECT * FROM wellbeing_reflections WHERE user_id = ? AND cadence = ?
        ORDER BY period_start DESC LIMIT ?`,
    ).bind(user.id, cadence, limit).all<ReflectionRow>();
    const items = await Promise.all((rs.results || []).map((r) => serializeReflection(c.env, r)));
    return c.json({ cadence, reflections: items, retention: RETENTION });
  } catch (e) {
    return unreadable(c, e);
  }
});

reflections.get('/earlier', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const limit = clampLimit(c.req.query('limit'), 30, 200);
  try {
    const rs = await c.env.DB.prepare(
      'SELECT * FROM wellbeing_daily_pulses WHERE user_id = ? ORDER BY day DESC LIMIT ?',
    ).bind(user.id, limit).all<any>();
    const items = await Promise.all((rs.results || []).map((r) => serializeEarlier(c.env, r)));
    return c.json({ earlier: items });
  } catch (e) {
    return refuse(c, 503, { code: 'earlier_checkins_unreadable', message: 'Your earlier check-ins could not be read. This is not a claim that you have none.', raw: e });
  }
});

/**
 * What the member recorded in one month, cited and never filled in: the days
 * that have a reflection (the rest are absent, not zero), the weeks that
 * touch the month, the month's own reflection, and how many recorded days
 * named each topic. No score is averaged or rated.
 */
reflections.get('/months/:month/summary', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const month = c.req.param('month');
  if (!/^\d{4}-\d{2}$/.test(month) || !isDate(`${month}-01`)) {
    return refuse(c, 400, { code: 'invalid_month', message: 'The month is written YYYY-MM.' });
  }
  const span = periodOf('month', `${month}-01`);
  try {
    const rs = await c.env.DB.prepare(
      `SELECT * FROM wellbeing_reflections
        WHERE user_id = ? AND period_start <= ? AND period_end >= ?
        ORDER BY period_start ASC`,
    ).bind(user.id, span.end, span.start).all<ReflectionRow>();
    const rows = await Promise.all((rs.results || []).map((r) => serializeReflection(c.env, r)));
    const days = rows.filter((r) => r.cadence === 'day');
    const weeks = rows.filter((r) => r.cadence === 'week');
    const monthRow = rows.find((r) => r.cadence === 'month' && r.period_start === span.start) ?? null;
    const topicDays = new Map<string, number>();
    for (const d of days) for (const t of d.topics || []) topicDays.set(t, (topicDays.get(t) || 0) + 1);
    const cite = (r: typeof rows[number]) => ({ uid: r.uid, period_start: r.period_start, period_end: r.period_end, topics: r.topics, readable: r.readable });
    return c.json({
      month, period_start: span.start, period_end: span.end,
      days_in_month: datesBetween(span.start, span.end).length,
      days_recorded: days.length,
      days: days.map(cite),
      weeks: weeks.map(cite),
      month_reflection: monthRow ? cite(monthRow) : null,
      topics: [...topicDays].map(([topic, n]) => ({ topic, days: n })).sort((a, b) => b.days - a.days || a.topic.localeCompare(b.topic)),
    });
  } catch (e) {
    return unreadable(c, e);
  }
});

reflections.get('/export', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try {
    const rs = await c.env.DB.prepare(
      'SELECT * FROM wellbeing_reflections WHERE user_id = ? ORDER BY cadence, period_start',
    ).bind(user.id).all<ReflectionRow>();
    const earlier = await c.env.DB.prepare(
      'SELECT * FROM wellbeing_daily_pulses WHERE user_id = ? ORDER BY day',
    ).bind(user.id).all<any>();
    const body = {
      exported_at: new Date().toISOString(),
      retention: RETENTION,
      reflections: await Promise.all((rs.results || []).map((r) => serializeReflection(c.env, r))),
      earlier_checkins: await Promise.all((earlier.results || []).map((r) => serializeEarlier(c.env, r))),
    };
    return new Response(JSON.stringify(body, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="wellness-reflections.json"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return unreadable(c, e);
  }
});

reflections.get('/:cadence/:period', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const cadence = c.req.param('cadence');
  const period = c.req.param('period');
  if (!isCadence(cadence)) return refuse(c, 400, { code: 'invalid_cadence', message: 'cadence must be day, week or month.' });
  if (!isDate(period)) return refuse(c, 400, { code: 'invalid_period', message: 'The period must be a date written YYYY-MM-DD.' });
  try {
    const row = await rowAt(c.env, user.id, cadence, period);
    if (!row) return refuse(c, 404, { code: 'reflection_not_found', message: 'There is no reflection for this period yet.' });
    return c.json(await serializeReflection(c.env, row));
  } catch (e) {
    return unreadable(c, e);
  }
});

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function changed(c: any, current: ReflectionRow | null) {
  return refuse(c, 409, {
    code: 'reflection_changed',
    message: 'This reflection was changed somewhere else. Your words are kept here; load the latest version before saving again.',
    extra: { current_revision: current ? Number(current.revision) : null },
  });
}

reflections.put('/:cadence/:period', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const cadence = c.req.param('cadence');
  if (!isCadence(cadence)) return refuse(c, 400, { code: 'invalid_cadence', message: 'cadence must be day, week or month.' });
  const v = reflectionBody(await c.req.json().catch(() => null));
  if (!v.ok) return refuse(c, 400, { code: v.code, message: v.message });
  const today = currentPeriods(new Date(), v.timezone).today;
  const period = c.req.param('period');
  const problem = periodProblem(cadence, period, today);
  if (problem) return refuse(c, 400, problem);
  const span = periodOf(cadence, period);

  let existing: ReflectionRow | null;
  try {
    existing = await rowAt(c.env, user.id, cadence, span.start);
  } catch (e) {
    return refuse(c, 503, { code: 'reflection_not_saved', message: 'Your reflection was not saved. Your words are kept here; try again.', raw: e });
  }
  if (existing && v.requestId && existing.last_request_id === v.requestId) {
    return c.json({ ...(await serializeReflection(c.env, existing)), replayed: true, stored_encrypted: true }, 200);
  }
  if (existing ? existing.revision !== v.baseRevision : v.baseRevision !== 0) return changed(c, existing);

  let enc: { scores: string | null; text: string | null; topics: string | null };
  try {
    enc = {
      scores: Object.keys(v.scores).length ? await encryptString(c.env, JSON.stringify(v.scores)) : null,
      text: v.text ? await encryptString(c.env, JSON.stringify(v.text)) : null,
      topics: v.topics.length ? await encryptString(c.env, JSON.stringify(v.topics)) : null,
    };
  } catch (e) {
    return refuse(c, 503, {
      code: 'reflection_protection_unavailable',
      message: 'Your reflection was not saved, because it could not be stored encrypted. Your words are kept here; try again later.',
      raw: e,
    });
  }

  try {
    if (!existing) {
      const uid = crypto.randomUUID().replace(/-/g, '');
      const res = await c.env.DB.prepare(
        `INSERT INTO wellbeing_reflections
           (uid, user_id, cadence, period_start, period_end, timezone, scores_enc, text_enc, topics_enc,
            revision, last_request_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))
         ON CONFLICT (user_id, cadence, period_start) DO NOTHING`,
      ).bind(uid, user.id, cadence, span.start, span.end, v.timezone, enc.scores, enc.text, enc.topics, v.requestId).run();
      if (!Number(res?.meta?.changes ?? 0)) return changed(c, await rowAt(c.env, user.id, cadence, span.start));
    } else {
      const res = await c.env.DB.prepare(
        `UPDATE wellbeing_reflections
            SET scores_enc = ?, text_enc = ?, topics_enc = ?, revision = revision + 1,
                last_request_id = ?, updated_at = datetime('now')
          WHERE id = ? AND user_id = ? AND revision = ?`,
      ).bind(enc.scores, enc.text, enc.topics, v.requestId, existing.id, user.id, existing.revision).run();
      if (!Number(res?.meta?.changes ?? 0)) return changed(c, await rowAt(c.env, user.id, cadence, span.start));
    }
    const saved = await rowAt(c.env, user.id, cadence, span.start);
    if (!saved) throw new Error('reflection row missing after write');
    return c.json({ ...(await serializeReflection(c.env, saved)), stored_encrypted: true, created: !existing }, existing ? 200 : 201);
  } catch (e) {
    return refuse(c, 503, { code: 'reflection_not_saved', message: 'Your reflection was not saved. Your words are kept here; try again.', raw: e });
  }
});

reflections.delete('/earlier/:uid', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const res = await c.env.DB.prepare(
    'DELETE FROM wellbeing_daily_pulses WHERE uid = ? AND user_id = ?',
  ).bind(c.req.param('uid'), user.id).run();
  if (!Number(res?.meta?.changes ?? 0)) return refuse(c, 404, { code: 'checkin_not_found', message: 'No such check-in.' });
  return c.json({ deleted: true });
});

reflections.delete('/:uid', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const res = await c.env.DB.prepare(
    'DELETE FROM wellbeing_reflections WHERE uid = ? AND user_id = ?',
  ).bind(c.req.param('uid'), user.id).run();
  if (!Number(res?.meta?.changes ?? 0)) return refuse(c, 404, { code: 'reflection_not_found', message: 'No such reflection.' });
  return c.json({ deleted: true });
});

export default reflections;

// Mounted just above the legacy `/api/wellbeing` router, the more specific
// path first. That router answers nothing under `/reflections` either way.
export const mount: RouteMount = { path: '/api/wellbeing/reflections', router: reflections, before: [wellbeing] };
