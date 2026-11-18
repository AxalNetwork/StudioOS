/**
 * D7180 (#7180, D7046 and D7041) — the subject company of a competitor
 * analysis: the directory company (`research_company_directory.uid`) a
 * profile's "Set up competitor analysis →" link opened setup with, kept on
 * `competitor_analyses.subject_uid`.
 *
 * The uid is the only thing stored. Name, website, country and sector label
 * are read back from the directory on each read, so the subject card shows
 * what the directory records now and never a copy. A failed read is
 * Unreadable, never "no subject"; a uid the directory no longer holds is
 * Not found.
 */
import type { Env } from '../types';

/** Longest uid accepted. Directory uids are Wikidata Q-ids and Companies House numbers. */
export const SUBJECT_UID_MAX = 120;

/**
 * The request's `subject_uid`: a trimmed string, `null` when absent or blank.
 * Anything else (a number, an object, an over-long string) is `undefined`,
 * which the route refuses.
 */
export function parseSubjectUid(v: unknown): string | null | undefined {
  if (v == null) return null;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s) return null;
  return s.length > SUBJECT_UID_MAX ? undefined : s;
}

export type Subject =
  | { status: 'ok'; uid: string; name: string; website: string | null; country: string | null; sector: string | null }
  | { status: 'not_found'; uid: string }
  | { status: 'unreadable'; uid: string };

/** The directory company with this uid, as the subject card prints it. */
export async function readSubject(env: Env, uid: string): Promise<Subject> {
  try {
    const row = await env.DB.prepare(
      `SELECT uid, name, website, country, sector FROM research_company_directory WHERE uid = ?`,
    ).bind(uid).first<{ uid: string; name: string; website: string | null; country: string | null; sector: string | null }>();
    if (!row) return { status: 'not_found', uid };
    return {
      status: 'ok', uid: row.uid, name: row.name,
      website: row.website || null, country: row.country || null, sector: row.sector?.trim() || null,
    };
  } catch {
    return { status: 'unreadable', uid };
  }
}
