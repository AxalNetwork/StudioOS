/**
 * Task #33 — wellbeing route helpers extracted for unit testing.
 *
 * Pure functions for body validation + the encryption-with-plaintext
 * fallback wrapper. Keeping these out of `wellbeing.ts` lets the unit
 * test in `cloudflare-worker/test/wellbeing_post.test.mjs` import them
 * directly without needing to slice anchors out of the route file.
 */
import { encryptString } from '../services/cryptoBox';

export const CHECKIN_KEYS = ['stress', 'sleep', 'support', 'decisions', 'energy'] as const;
export type CheckinKey = typeof CHECKIN_KEYS[number];

export const DAILY_KEYS = ['mood', 'stress', 'sleep', 'energy', 'focus', 'social'] as const;
export type DailyKey = typeof DAILY_KEYS[number];

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export type ValidationFail = { ok: false; fields: Record<string, string> };

export function validateCheckinBody(body: any):
  | { ok: true; answers: Record<CheckinKey, number>; notes: string | null }
  | ValidationFail {
  const fields: Record<string, string> = {};
  const out = {} as Record<CheckinKey, number>;
  for (const k of CHECKIN_KEYS) {
    const raw = body?.[k];
    if (raw == null || raw === '') { fields[k] = `${k} is required`; continue; }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      fields[k] = `${k} must be an integer 1..5`;
    } else {
      out[k] = n;
    }
  }
  const rawNotes = body?.notes ?? null;
  let notes: string | null = null;
  if (rawNotes != null) {
    if (typeof rawNotes !== 'string') fields.notes = 'notes must be a string';
    else if (rawNotes.length > 4000) fields.notes = 'notes must be ≤ 4000 characters';
    else notes = rawNotes;
  }
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, answers: out, notes };
}

export function validateDailyBody(body: any):
  | {
      ok: true;
      values: Record<DailyKey, number | null>;
      free_text: string | null;
      tags: string[];
      day: string;
    }
  | ValidationFail {
  const fields: Record<string, string> = {};
  const values: Record<DailyKey, number | null> = {
    mood: null, stress: null, sleep: null, energy: null, focus: null, social: null,
  };
  // `connection` is the task-spec alias for `social`; `mood_1to10`,
  // `stress_1to10` etc. are the legacy frontend field names from the
  // earlier wellbeing form. We accept either spelling on input.
  const aliased = { ...(body || {}) };
  if (aliased.social == null && aliased.connection != null) aliased.social = aliased.connection;
  for (const k of DAILY_KEYS) {
    const legacy = `${k}_1to10`;
    if (aliased[k] == null && aliased[legacy] != null) aliased[k] = aliased[legacy];
  }
  if (aliased.social == null && aliased.connection_1to10 != null) aliased.social = aliased.connection_1to10;

  let provided = 0;
  for (const k of DAILY_KEYS) {
    const raw = aliased?.[k];
    if (raw == null || raw === '') continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      fields[k] = `${k} must be an integer 1..5`;
    } else {
      values[k] = n;
      provided += 1;
    }
  }
  if (!provided && !Object.keys(fields).length) {
    fields.mood = 'At least one slider value is required';
  }

  const rawText = body?.free_text ?? null;
  let free_text: string | null = null;
  if (rawText != null) {
    if (typeof rawText !== 'string') fields.free_text = 'free_text must be a string';
    else if (rawText.length > 4000) fields.free_text = 'free_text must be ≤ 4000 characters';
    else free_text = rawText;
  }

  let tags: string[] = [];
  if (body?.tags != null) {
    if (!Array.isArray(body.tags)) {
      fields.tags = 'tags must be an array of strings';
    } else if (body.tags.length > 8) {
      fields.tags = 'tags must contain at most 8 entries';
    } else {
      const bad = body.tags.find((x: any) => typeof x !== 'string' || x.length > 40);
      if (bad !== undefined) fields.tags = 'each tag must be a string ≤ 40 characters';
      else tags = body.tags as string[];
    }
  }

  const day = String(body?.day || todayUTC()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fields.day = 'day must be YYYY-MM-DD';

  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, values, free_text, tags, day };
}

/**
 * Encrypt a value if a key is configured, otherwise fall back to plaintext.
 * Caller writes `enc` to the `*_enc` column and `plain` to the `*_plain`
 * column. When `fellBack === true`, a warn-level log is emitted so an
 * operator can spot the misconfiguration in production tail.
 */
export type EncResult<T> = { enc: string | null; plain: T | null; fellBack: boolean };
/**
 * Encrypt a value with the at-rest column cipher, or fall back to
 * persisting plaintext in the `*_plain` backstop column if encryption
 * fails for any reason (missing key, runtime error, …). Per Task #33,
 * the wellbeing form must always be able to save — a missing key is
 * an operator problem, not a user-facing 500. Every fallback emits a
 * warn log so it shows up in `wrangler tail`.
 */
export async function encryptOrFallback<T extends string | number>(
  env: { AXAL_ENCRYPTION_SECRET?: string; JWT_SECRET?: string },
  value: T | null,
): Promise<EncResult<T>> {
  if (value == null) return { enc: null, plain: null, fellBack: false };
  try {
    const enc = await encryptString(env, String(value));
    return { enc, plain: null, fellBack: false };
  } catch (e: any) {
    console.warn('[wellbeing] encryption fallback to plaintext:', String(e?.message || e));
    return { enc: null, plain: value, fellBack: true };
  }
}
