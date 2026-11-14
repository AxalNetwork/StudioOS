/** Plan package composition through the existing Program Grants rules and writer (#5024). */
import type { Env } from '../types';
import { canonicalJson } from './licencePricing';
import { insertGrantStatement, programNamed, readDefaults, readinessRefusal, termsDiff, termsOf, validateTerms, type Terms } from './programGrants';
import { decisionGuard } from './decisionBatch';
import type { ProgramPackageWithItems } from './licencePackagesStore';

export type OfferedProgram = { program_key: string; position: number; metadata: Record<string, unknown> | null; terms: Terms };
export class PackageGrantInputError extends Error {}
export type GrantConflict = { program_key: string; code: string; message: string };
export type PackageGrantPlan = {
  program_key: string; position: number; metadata: Record<string, unknown> | null; terms: Terms;
  action: 'created' | 'retained'; grant_uid: string; terms_revision: number; existing_id: number | null;
};

/** Stable across review/retry, without allocating a different grant identity on every preview. */
export async function packageDigest(v: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(v)));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Freeze the offered operational terms; the package has no implicit per-program price allocation. */
export async function offeredPrograms(env: Env, a: {
  licenceId: number; pkg: ProgramPackageWithItems; startsOn: string; endsOn: string; terms?: unknown;
}): Promise<OfferedProgram[]> {
  if (a.terms != null && (typeof a.terms !== 'object' || Array.isArray(a.terms))) throw new PackageGrantInputError('Program terms must be an object keyed by included program.');
  const inputs = (a.terms ?? {}) as Record<string, unknown>;
  const included = a.pkg.items.filter((i) => i.included_by_default);
  if (!included.length) throw new PackageGrantInputError('A package offer must include at least one program.');
  if (Object.keys(inputs).some((k) => !included.some((i) => i.program_key === k))) throw new PackageGrantInputError('Terms name a program this package does not include.');
  const rows = (await env.DB.prepare('SELECT * FROM program_grants WHERE licence_id = ?').bind(a.licenceId).all<Record<string, any>>()).results || [];
  const defaults = await readDefaults(env);
  return included.map((item) => {
    const existing = rows.find((r) => r.program_key === item.program_key);
    const raw = inputs[item.program_key];
    const check = validateTerms(item.program_key, raw);
    if (!check.ok) throw new PackageGrantInputError(`${item.program_key}: ${check.errors.map((e) => `${e.field} ${e.message}`).join('; ')}`);
    if (['fee_cents', 'currency', 'starts_on', 'ends_on', 'ends_with_licence'].some((k) => k in check.terms)) {
      throw new PackageGrantInputError('Package dates and currency come from the offer. Per-program fees are retained or unallocated, never invented.');
    }
    const initial: Terms = existing ? termsOf(existing, item.program_key) : {
      ...(defaults.find((d) => d.program_key === item.program_key)?.terms ?? {}),
      starts_on: a.startsOn, ends_on: a.endsOn, ends_with_licence: 0, fee_cents: null, currency: a.pkg.currency,
    };
    const terms = { ...initial, ...check.terms };
    const valid = validateTerms(item.program_key, terms);
    if (!valid.ok) throw new PackageGrantInputError(`${item.program_key}: ${valid.errors.map((e) => `${e.field} ${e.message}`).join('; ')}`);
    return { program_key: item.program_key, position: item.position, metadata: item.metadata, terms };
  });
}

/** Conflicts are returned for review; no existing grant is ended, regranted or repriced here. */
export async function reviewPackageGrants(env: Env, a: {
  offerUid: string; licenceId: number; renewsOn: string | null; startsOn: string; endsOn: string; currency: string; programs: OfferedProgram[]; today: string;
}): Promise<{ plans: PackageGrantPlan[]; conflicts: GrantConflict[]; rows: Record<string, any>[] }> {
  const rows = (await env.DB.prepare('SELECT * FROM program_grants WHERE licence_id = ? ORDER BY program_key').bind(a.licenceId).all<Record<string, any>>()).results || [];
  const defaults = await readDefaults(env);
  const conflicts: GrantConflict[] = [];
  const plans: PackageGrantPlan[] = [];
  for (const item of a.programs) {
    const existing = rows.find((r) => r.program_key === item.program_key);
    const problem = (code: string, message: string) => conflicts.push({ program_key: item.program_key, code, message });
    const program = await programNamed(env, item.program_key);
    if (!program) { problem('unknown_program', 'This program is no longer in the registry.'); continue; }
    if (existing) {
      if (existing.state !== 'granted') { problem('grant_state_conflict', `The existing grant is ${existing.state}. Resolve it through Program Grants first.`); continue; }
      if (existing.fee_cents != null && existing.currency !== a.currency) {
        problem('grant_currency_conflict', 'The retained program price is in another or unrecorded currency. Review those economics explicitly; no FX conversion is inferred.'); continue;
      }
      const end = existing.ends_on || (Number(existing.ends_with_licence) === 1 ? a.renewsOn : null);
      const openEnded = existing.ends_on == null && Number(existing.ends_with_licence) === 0 && existing.ends_with_licence != null;
      if (!existing.starts_on || existing.starts_on > a.startsOn || (!openEnded && (!end || end < a.endsOn))) {
        problem('grant_dates_conflict', 'The existing grant does not record coverage for the whole package term. Review its dates in Program Grants.'); continue;
      }
      if (a.startsOn > a.today && existing.starts_on <= a.today && (!end || end >= a.today)) {
        problem('scheduled_existing_grant', 'A future package cannot change a currently held program’s legal policy early. Wait for its start or use the scheduled lifecycle workflow.'); continue;
      }
      const diff = termsDiff(termsOf(existing, item.program_key), item.terms)
        .filter((d) => !['starts_on', 'ends_on', 'ends_with_licence'].includes(d.key));
      if (diff.length) { problem('grant_terms_conflict', `Existing terms differ (${diff.map((d) => d.key).join(', ')}). Resolve them explicitly in Program Grants.`); continue; }
      plans.push({ ...item, terms: termsOf(existing, item.program_key), action: 'retained', grant_uid: existing.uid,
        terms_revision: Number(existing.terms_revision ?? 1), existing_id: Number(existing.id) });
    } else {
      const defaultsRow = defaults.find((d) => d.program_key === item.program_key);
      const blocked = program.nine ? readinessRefusal(item.program_key) : 'This program requires an explicit studio approval and grant before it can be bundled.';
      if (blocked || !defaultsRow?.grantable) { problem('not_grantable', blocked || 'HQ has disabled new grants for this program.'); continue; }
      plans.push({ ...item, action: 'created', grant_uid: `pkg_${(await packageDigest([a.offerUid, item.program_key])).slice(0, 32)}`,
        terms_revision: 1, existing_id: null });
    }
  }
  return { plans, conflicts, rows };
}

/** Statements join the caller's acceptance batch and its decision guard. */
export function packageGrantStatements(env: Env, a: {
  licenceId: number; offerUid: string; actorId: number; reason: string; at: string; plans: PackageGrantPlan[];
}): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (const p of a.plans) {
    if (p.action === 'retained') {
      statements.push(env.DB.prepare(`INSERT INTO decision_guard (decision_won)
        VALUES (CASE WHEN EXISTS (SELECT 1 FROM program_grants WHERE id = ? AND uid = ? AND state = 'granted' AND terms_revision = ?) THEN 1 ELSE 0 END)`)
        .bind(p.existing_id, p.grant_uid, p.terms_revision));
    } else {
      statements.push(env.DB.prepare(`INSERT INTO decision_guard (decision_won)
        VALUES (CASE WHEN EXISTS (SELECT 1 FROM program_grant_defaults WHERE program_key = ? AND grantable = 1) THEN 1 ELSE 0 END)`).bind(p.program_key));
      statements.push(insertGrantStatement(env, { uid: p.grant_uid, licenceId: a.licenceId, programKey: p.program_key,
        terms: p.terms, note: `Included in Axal VC package offer ${a.offerUid}; no separate program fee allocated.`, actorId: a.actorId, at: a.at }));
      statements.push(decisionGuard(env));
    }
    statements.push(env.DB.prepare(`INSERT INTO licence_events (licence_id, event, detail_json, note, actor_user_id, created_at)
      VALUES (?, 'program_changed', ?, ?, ?, ?)`).bind(a.licenceId,
      JSON.stringify({ action: p.action === 'created' ? 'granted' : 'package_linked', program_key: p.program_key,
        grant_uid: p.grant_uid, package_offer_uid: a.offerUid, terms_revision: p.terms_revision, reason: a.reason }), a.reason, a.actorId, a.at));
  }
  return statements;
}
