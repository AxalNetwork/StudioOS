/**
 * D984 (#2775, part 3 of #2376) — the programs a licence's Administrator
 * reads: `GET /api/licence/mine/programs` (`routes/licence_programs.ts`), and
 * the dated copy HQ pushes to the licence's branch (migration 554).
 *
 *   programCopy      what HQ sends: the licence's grant rows and which
 *                    programs HQ grants at all. Rides the licence push.
 *   parseProgramCopy the branch's reading of that copy.
 *   studioPrograms   the nine programs as the studio reads them (GR7), from
 *                    the rows, the licence and the day.
 *   unlinkedPrograms the answer for an account no licence binds (GR11 C).
 *
 * ONE RULE FOR IN FORCE. `presentGrant` (part 1, `services/programGrants.ts`)
 * decides it on HQ's grid, and the same function decides it here, on HQ from
 * the store and on a branch from the copy. The copy carries rows, not
 * verdicts, because in force turns on the day the page is read.
 *
 * WHAT THE STUDIO DOES NOT READ. Who at HQ set a grant (`set_by_user_id`) is
 * HQ's record, and the defaults' money and capacity are HQ's starting point
 * for a grant not made; neither is copied or answered. What a program with no
 * row reads is the defaults' one word on it: HQ grants it ("Not recorded",
 * as D981 §3 says, never "Not granted") or HQ has it switched off.
 */
import type { Env } from '../types';
import { PROGRAMS, TERM_KEYS, presentGrant, programOf, readDefaults, type LicenceLite } from './programGrants';
import { legalWaitingByProgram } from './agreementPolicies';

/** The grant columns the copy carries, and the studio reads. */
export const COPY_COLUMNS = [
  'uid', 'program_key', 'state', ...TERM_KEYS,
  'schedule_contract_uid', 'schedule_signed_at', 'terms_revision', 'signed_revision', 'note', 'paused_at', 'ended_at', 'set_at',
  // D5052: not a column. HQ computes it from the licence's frozen agreement policy (`programCopy`): 1 while a
  // required agreement is unsigned, 0 when not, null when HQ did not compute it.
  'legal_waiting',
];

type HqService = { program_key: string; description: string; package_name: string; package_version: number; starts_on: string; ends_on: string };
export type ProgramCopy = { grants: Array<Record<string, unknown>>; offered: Record<string, boolean>; hq_services?: HqService[] };

/** Commercial terms copied from accepted offers. Earlier receipts may have no services. */
async function acceptedHqServices(env: Env, licenceUid: string): Promise<HqService[]> {
  try {
    const read = await env.DB.prepare(
      `SELECT json_extract(s.value, '$.program_key') AS program_key, json_extract(s.value, '$.description') AS description,
              o.package_name, o.package_version, o.starts_on, o.ends_on
         FROM licence_package_offers o, json_each(o.acceptance_json, '$.hq_services') s
        WHERE o.licence_uid = ? AND o.state = 'accepted' AND json_type(o.acceptance_json, '$.hq_services') = 'array'
          AND s.type = 'object'
        ORDER BY o.starts_on DESC, o.created_at DESC, o.uid, s.key`,
    ).bind(licenceUid).all<HqService>();
    return read.results.filter((s) => typeof s.program_key === 'string' && typeof s.description === 'string');
  } catch (e) {
    // A ledger from before the offer migration has no commercial receipts to copy.
    if (/no such table: (?:main\.)?licence_package_offers\b/i.test(String(e))) return [];
    throw e;
  }
}

/** The copy of one licence's programs, read fresh from HQ's store. Throws when a read fails. */
export async function programCopy(env: Env, licenceId: number): Promise<ProgramCopy> {
  // A draft (D956) is HQ's, so it is not sent: the studio reads Not granted until HQ grants it.
  const rows = ((await env.DB.prepare("SELECT * FROM program_grants WHERE licence_id = ? AND state <> 'draft' ORDER BY id")
    .bind(licenceId).all<Record<string, unknown>>()).results || [])
    .map((row) => Object.fromEntries(COPY_COLUMNS.map((k) => [k, row[k] ?? null])));
  // D5052 (#5052): each grant carries whether the licence's frozen agreement policy still holds it out of force,
  // so a branch never reads a program as in force while its required agreement is unsigned. A read that fails
  // throws, and the push reports the section unreadable (#4686) rather than sending grants without it.
  const licence = await env.DB.prepare('SELECT id, uid, licence_ref, brand_name, kind, status, renews_on FROM territory_licences WHERE id = ?')
    .bind(licenceId).first<LicenceLite & { id: number }>();
  if (licence && rows.length) {
    const waiting = await legalWaitingByProgram(env, licence, new Date().toISOString().slice(0, 10));
    for (const row of rows) row.legal_waiting = waiting.get(String(row.program_key)) ?? 0;
  }
  // Carry registry labels only for this licence's recorded grants. Older copies can use the grant key.
  if (licence && rows.some((row) => !programOf(String(row.program_key)))) {
    const labels = await env.DB.prepare(
      `SELECT p.key, p.name, p.grp FROM programs p
       JOIN program_grants g ON g.program_key = p.key
       WHERE g.licence_id = ? AND g.state <> 'draft' AND (p.licence_uid IS NULL OR p.licence_uid = ?)`,
    ).bind(licenceId, licence.uid).all<{ key: string; name: string; grp: string }>();
    const byKey = new Map(labels.results.map((p) => [p.key, p]));
    for (const row of rows) {
      const key = String(row.program_key);
      const label = byKey.get(key);
      if (!programOf(key) && label) {
        row.program_name = label.name;
        row.program_group = label.grp;
      }
    }
  }
  const offered = Object.fromEntries((await readDefaults(env)).map((d) => [d.program_key, d.grantable]));
  const services = licence ? await acceptedHqServices(env, licence.uid) : [];
  return { grants: rows, offered, ...(services.length ? { hq_services: services } : {}) };
}

/** A pushed copy, or null when its shape is not one HQ sends. */
export function parseProgramCopy(raw: string): ProgramCopy | null {
  const v = JSON.parse(raw);
  if (!v || typeof v !== 'object' || !Array.isArray(v.grants) || !v.offered || typeof v.offered !== 'object') return null;
  if (v.hq_services !== undefined && !Array.isArray(v.hq_services)) return null;
  return { grants: v.grants, offered: v.offered, ...(v.hq_services ? { hq_services: v.hq_services } : {}) };
}

export type Standing = 'in_force' | 'granted' | 'paused' | 'ended' | 'not_recorded' | 'switched_off' | 'hq_only' | 'not_offered' | 'hq_runs';

const WORDS: Record<Standing, { word: string; line: string }> = {
  in_force: { word: 'In force', line: 'Your studio runs this program on the terms below.' },
  granted: { word: 'Granted, not in force yet', line: 'HQ granted this program. It starts once everything it waits on is done.' },
  paused: { word: 'Paused', line: 'HQ paused this program. Nothing new starts until HQ resumes it.' },
  ended: { word: 'Ended', line: 'HQ ended this grant.' },
  not_recorded: { word: 'Not recorded', line: 'HQ has not recorded a grant for this program yet.' },
  switched_off: { word: 'Not offered', line: 'HQ does not grant this program at the moment.' },
  hq_only: { word: 'Runs at HQ', line: 'HQ keeps this program.' },
  not_offered: { word: 'Not offered yet', line: 'This program is not ready to grant.' },
  hq_runs: { word: 'HQ runs it', line: 'On HQ-held accounts, HQ runs every program.' },
};

type ProgramIdentity = { key: string; name: string; group: string | null };

const entry = (p: ProgramIdentity, standing: Standing, grant: Record<string, unknown> | null, custom = false) =>
  ({ program_key: p.key, name: p.name, group: p.group, standing, ...WORDS[standing], grant, ...(custom ? { custom: true } : {}) });

/**
 * The nine programs, in the canvas's order, as the licence's Administrator
 * reads them. A grant row is presented by part 1's rule; a program with no
 * row reads the defaults' word, and a missing word reads as Not recorded.
 */
export function studioPrograms(copy: ProgramCopy, licence: LicenceLite, today: string) {
  const byKey = new Map(copy.grants.map((g) => [String(g.program_key), g]));
  function issued(p: ProgramIdentity, row: Record<string, unknown>, custom = false) {
    const { set_by_user_id: _by, licence_uid: _l, ...grant } = presentGrant(row, licence, today);
    const standing: Standing = grant.state === 'granted' ? (grant.in_force ? 'in_force' : 'granted') : grant.state as 'paused' | 'ended';
    return entry(p, standing, grant, custom);
  }
  const programs = PROGRAMS.map((p) => {
    if (p.readiness === 'hq') return entry(p, 'hq_only', null);
    if (p.readiness === 'notready') return entry(p, 'not_offered', null);
    const row = byKey.get(p.key);
    if (!row || row.state === 'draft') return entry(p, copy.offered[p.key] === false ? 'switched_off' : 'not_recorded', null);
    return issued(p, row);
  });
  for (const [key, row] of byKey) {
    if (programOf(key) || !['granted', 'paused', 'ended'].includes(String(row.state))) continue;
    const name = typeof row.program_name === 'string' ? row.program_name : key;
    const group = typeof row.program_group === 'string' ? row.program_group : null;
    programs.push(issued({ key, name, group }, row, true));
  }
  return programs;
}

export const UNLINKED_REASON = 'Your account is not linked to a licence. On HQ-held accounts, HQ runs every program.';

/** GR11 C: an account no licence binds runs on HQ, where HQ runs every program (D981 §5, decision 1). */
export function unlinkedPrograms() {
  return PROGRAMS.map((p) => entry(p, 'hq_runs', null));
}
