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
import { PROGRAMS, TERM_KEYS, presentGrant, readDefaults, type LicenceLite } from './programGrants';

/** The grant columns the copy carries, and the studio reads. */
export const COPY_COLUMNS = [
  'uid', 'program_key', 'state', ...TERM_KEYS,
  'schedule_contract_uid', 'schedule_signed_at', 'note', 'paused_at', 'ended_at', 'set_at',
];

export type ProgramCopy = { grants: Array<Record<string, unknown>>; offered: Record<string, boolean> };

/** The copy of one licence's programs, read fresh from HQ's store. Throws when a read fails. */
export async function programCopy(env: Env, licenceId: number): Promise<ProgramCopy> {
  const rows = ((await env.DB.prepare('SELECT * FROM program_grants WHERE licence_id = ? ORDER BY id')
    .bind(licenceId).all<Record<string, unknown>>()).results || [])
    .map((row) => Object.fromEntries(COPY_COLUMNS.map((k) => [k, row[k] ?? null])));
  const offered = Object.fromEntries((await readDefaults(env)).map((d) => [d.program_key, d.grantable]));
  return { grants: rows, offered };
}

/** A pushed copy, or null when its shape is not one HQ sends. */
export function parseProgramCopy(raw: string): ProgramCopy | null {
  const v = JSON.parse(raw);
  if (!v || typeof v !== 'object' || !Array.isArray(v.grants) || !v.offered || typeof v.offered !== 'object') return null;
  return { grants: v.grants, offered: v.offered };
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

const entry = (p: (typeof PROGRAMS)[number], standing: Standing, grant: Record<string, unknown> | null) =>
  ({ program_key: p.key, name: p.name, group: p.group, standing, ...WORDS[standing], grant });

/**
 * The nine programs, in the canvas's order, as the licence's Administrator
 * reads them. A grant row is presented by part 1's rule; a program with no
 * row reads the defaults' word, and a missing word reads as Not recorded.
 */
export function studioPrograms(copy: ProgramCopy, licence: LicenceLite, today: string) {
  const byKey = new Map(copy.grants.map((g) => [String(g.program_key), g]));
  return PROGRAMS.map((p) => {
    if (p.readiness === 'hq') return entry(p, 'hq_only', null);
    if (p.readiness === 'notready') return entry(p, 'not_offered', null);
    const row = byKey.get(p.key);
    if (!row) return entry(p, copy.offered[p.key] === false ? 'switched_off' : 'not_recorded', null);
    const { set_by_user_id: _by, licence_uid: _l, ...grant } = presentGrant(row as Record<string, any>, licence, today);
    const standing: Standing = grant.state === 'granted' ? (grant.in_force ? 'in_force' : 'granted') : grant.state;
    return entry(p, standing, grant);
  });
}

export const UNLINKED_REASON = 'Your account is not linked to a licence. On HQ-held accounts, HQ runs every program.';

/** GR11 C: an account no licence binds runs on HQ, where HQ runs every program (D981 §5, decision 1). */
export function unlinkedPrograms() {
  return PROGRAMS.map((p) => entry(p, 'hq_runs', null));
}
