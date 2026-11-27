/**
 * D9071 (#9071): distinct published people per published organization in the shared Network directory, by
 * affiliation status, for the people-first Organizations directory (D7680, NPO-01 and NPO-03).
 *
 * The member-visible rule is `services/networkDirectory.ts`'s: an entry counts only while it is published and
 * not withdrawn, and an affiliation only while it is not withdrawn. A person counts once per organization
 * however many affiliations or sources name them: current if any affiliation there is current, else former if
 * any is former, else status not recorded (an undated affiliation is never assumed current). Nothing here reads
 * an account link, a private source cell, an overlay or a review item; the answer is counts, never names.
 */
import type { Env } from '../types';
import { DirectoryRefusal } from './networkDirectory';

export const COUNT_UIDS_MAX = 50;
const UID = /^[A-Za-z0-9_.:-]{1,200}$/;

/** `uids=a,b,c` as a de-duplicated list of 1 to 50 well-formed references; anything else is refused. */
export function countUids(raw: string | null | undefined): string[] {
  const list = [...new Set(String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean))];
  if (!list.length) throw new DirectoryRefusal(400, 'uids_required', 'Name at least one organization.');
  if (list.length > COUNT_UIDS_MAX) throw new DirectoryRefusal(400, 'too_many_uids', `Ask for at most ${COUNT_UIDS_MAX} organizations at a time.`);
  if (list.some((u) => !UID.test(u))) throw new DirectoryRefusal(400, 'invalid_uid', 'That is not a directory reference.');
  return list;
}

export type PeopleCount = { people: number; current: number; former: number; unknown: number };

/**
 * `{ counts: { [uid]: PeopleCount } }` for each named uid that is a visible organization. A uid that is not
 * (unpublished, withdrawn, a person, unknown) is left out, so the answer says nothing about whether it exists.
 */
export async function organizationPeopleCounts(env: Env, uids: string[]) {
  const json = JSON.stringify(uids);
  const orgs = (await env.DB.prepare(
    `SELECT o.uid FROM network_directory_entries o
      WHERE o.uid IN (SELECT value FROM json_each(?)) AND o.kind = 'organization'
        AND o.publication_status = 'published' AND o.verification_status <> 'withdrawn'`,
  ).bind(json).all<{ uid: string }>()).results ?? [];
  const counts: Record<string, PeopleCount> = {};
  for (const o of orgs) counts[o.uid] = { people: 0, current: 0, former: 0, unknown: 0 };
  if (!orgs.length) return { counts };
  const rows = (await env.DB.prepare(
    `SELECT org, SUM(st = 'current') AS current, SUM(st = 'former') AS former, SUM(st = 'unknown') AS unknown, COUNT(*) AS people
       FROM (
         SELECT a.organization_uid AS org, a.person_uid,
                CASE WHEN MAX(a.is_current = 1) = 1 THEN 'current'
                     WHEN MAX(a.is_current = 0) = 1 THEN 'former'
                     ELSE 'unknown' END AS st
           FROM network_directory_affiliations a
           JOIN network_directory_entries p ON p.uid = a.person_uid
          WHERE a.organization_uid IN (SELECT value FROM json_each(?))
            AND a.verification_status <> 'withdrawn'
            AND p.kind = 'person' AND p.publication_status = 'published' AND p.verification_status <> 'withdrawn'
          GROUP BY a.organization_uid, a.person_uid
       )
      GROUP BY org`,
  ).bind(json).all<any>()).results ?? [];
  for (const r of rows) {
    if (!counts[r.org]) continue;
    counts[r.org] = { people: Number(r.people), current: Number(r.current), former: Number(r.former), unknown: Number(r.unknown) };
  }
  return { counts };
}
