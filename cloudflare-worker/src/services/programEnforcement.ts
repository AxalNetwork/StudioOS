/**
 * D985 (#2777, part 4 of #2376) — whether a branch may run a program's write.
 *
 * Each branch program route's grant-dependent write calls `programRefusal`
 * after its own admin gate and after `requireBranchNotSuspended`, and sends
 * the refusal when there is one. On HQ it is a no-op: a grant limits what a
 * branch runs, never an Administrator on HQ-held accounts (D981 §5, decision
 * 1, read from GR11 C; the owner may correct it).
 *
 * WHAT IT READS. The branch's dated copy of its licence's grants
 * (`branch_licence.program_grants_json`, D984, migration 554), the licence's
 * status and renewal on the same row, and the branch's own clock. One rule
 * for a grant's dates: part 1's `presentGrant`.
 *
 * WHAT REFUSES (403, naming the program):
 *   - no grant for the program (`not_held`), or none and HQ has the program
 *     switched off (`switched_off`);
 *   - the grant is paused (`paused`) or ended (`ended`);
 *   - the grant's own period has not started or has passed (`not_started`,
 *     `period_over`).
 *
 * WHAT DOES NOT, AND WHY:
 *   - a grant still waiting on its signed schedule or on the licence becoming
 *     active. The licence holds the grant (the issue's rule: "does not hold
 *     the grant, or holds it paused"); a suspended licence is the freeze's
 *     (`requireBranchNotSuspended`, 423), and the schedule is HQ's paperwork.
 *     D985 §3 puts this reading to the owner;
 *   - a copy HQ has not sent yet (no `branch_licence` row, or no programs on
 *     it). As the freeze reads an unpushed copy, a missing copy refuses
 *     nothing: inferring "not granted" from a row HQ has not written would stop
 *     every branch's programs between this deploy and HQ's next push.
 *
 * AN UNPARSEABLE COPY REFUSES (503): HQ sent something the branch cannot read,
 * so it cannot say the program is held.
 */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { parseProgramCopy, type ProgramCopy } from './licencePrograms';
import { programOf, presentGrant, type LicenceLite } from './programGrants';

/**
 * The program keys a branch route names. Product testing and the two not ready
 * are never a branch's; Learning's admin writes are Super Admin only, which
 * `requireSuperAdmin` refuses on a branch, and Referral partners has no branch
 * admin write, so neither has a write here to gate.
 */
export const ENFORCED_PROGRAMS = ['spinout-lab', 'mentor-cohorts', 'refer-and-earn', 'perks'] as const;
export type EnforcedProgram = typeof ENFORCED_PROGRAMS[number];

export const PROGRAM_NOT_GRANTED = 'program_not_granted';
export const PROGRAM_GRANTS_UNREADABLE = 'program_grants_unreadable';

export type ProgramRefusal = {
  status: 403 | 503;
  body: { detail: string; code: string; program_key: string; standing: string };
};

const nameOf = (key: string) => programOf(key)?.name ?? key;

/** The sentence for each standing that refuses. */
export function refusalSentence(key: string, standing: string): string {
  const name = nameOf(key);
  switch (standing) {
    case 'paused': return `HQ has paused ${name} for this studio. Nothing new starts until HQ resumes it.`;
    case 'ended': return `HQ has ended this studio's grant of ${name}. Ask HQ from the licence page to run it again.`;
    case 'not_started': return `This studio's grant of ${name} has not started yet. It starts on the date HQ set.`;
    case 'switched_off': return `HQ does not grant ${name} at the moment, so this studio cannot start anything in it.`;
    case 'period_over': return `This studio's grant of ${name} has run past its end date. Ask HQ from the licence page to extend it.`;
    default: return `This studio's licence does not hold ${name}. Ask HQ for it from the licence page.`;
  }
}

/** The standing of one program on a copy, by part 1's rule for its dates. */
export function standingOf(copy: ProgramCopy, licence: LicenceLite, key: string, today: string): string {
  const row = copy.grants.find((g) => String(g.program_key) === key);
  // A draft (D956) is HQ's: the studio reads it as no grant at all, as D984's page does.
  if (!row || row.state === 'draft') return copy.offered[key] === false ? 'switched_off' : 'not_held';
  if (row.state === 'paused') return 'paused';
  if (row.state === 'ended') return 'ended';
  if (row.state !== 'granted') return 'not_held';
  const g = presentGrant(row as Record<string, any>, licence, today);
  if (g.waiting_on.includes('ended_by_date')) return 'period_over';
  if (g.waiting_on.includes('start_date')) return 'not_started';
  return 'held';
}

/**
 * Null when the write may run; otherwise the refusal to send. Reads only on a
 * branch. Pass `today` in tests; the branch's own day otherwise.
 */
export async function programRefusal(env: Env, key: EnforcedProgram, today = new Date().toISOString().slice(0, 10)): Promise<ProgramRefusal | null> {
  if (!branchOf(env)) return null;
  let row: Record<string, any> | null;
  try {
    row = await env.DB.prepare(
      'SELECT licence_uid, licence_ref, brand_name, kind, status, renewal_at, program_grants_json FROM branch_licence WHERE id = 1',
    ).first();
  } catch (e) {
    // A branch_licence this deployment cannot read yet (an older schema) is the
    // freeze's posture: no claim from HQ, so no refusal.
    console.warn('[programs] branch_licence unreadable on a grant gate', (e as Error).message);
    return null;
  }
  if (!row || row.program_grants_json == null) return null;
  let copy: ProgramCopy | null;
  try { copy = parseProgramCopy(String(row.program_grants_json)); } catch { copy = null; }
  if (!copy) {
    return {
      status: 503,
      body: {
        detail: `Your programs could not be read, so ${nameOf(key)} cannot start anything new. That is not the same as not granted.`,
        code: PROGRAM_GRANTS_UNREADABLE, program_key: key, standing: 'unreadable',
      },
    };
  }
  const licence: LicenceLite = {
    id: 0, uid: String(row.licence_uid ?? ''), licence_ref: row.licence_ref ?? null, brand_name: row.brand_name ?? null,
    kind: row.kind ?? null, status: String(row.status ?? ''), renews_on: row.renewal_at ?? null,
  };
  const standing = standingOf(copy, licence, key, today);
  if (standing === 'held') return null;
  return { status: 403, body: { detail: refusalSentence(key, standing), code: PROGRAM_NOT_GRANTED, program_key: key, standing } };
}
