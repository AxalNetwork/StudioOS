/** Read the branch's actual checkout ceiling calculation for Revenue (#5039). */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { readCeiling } from './promoRedemption';

export async function promoCeilingReadback(env: Env) {
  const branch = branchOf(env);
  if (!branch) throw new Error('Promotion read-back requires a branch');
  const now = Date.now();
  const ceiling = await readCeiling(env, now);
  return { branch, as_of: new Date(now).toISOString(), ceiling };
}
