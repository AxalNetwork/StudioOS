/**
 * D1003 (#2818) — the two RPC halves of a subsidiary's segment suggestion,
 * kept out of `rpc/index.ts` so they can be tested (that file imports
 * `cloudflare:workers`). The behaviour is `services/segmentSuggestions.ts`'s.
 *
 *   BranchEntrypoint.segmentSuggestion(code, input)   HQ stores a subsidiary's suggestion
 *   HqEntrypoint.applySegmentSuggestionAnswer(answer) a subsidiary takes HQ's decision
 *
 * A BINDING DOES NOT IDENTIFY ITS CALLER (see `rpc/index.ts`), so HQ checks
 * the code names a provisioned subsidiary, as `recordEscalation` does. A
 * suggestion carries no secret: what a forged call could do is file a
 * suggestion HQ reads and declines, the escalation's category.
 */
import type { Env } from '../types';
import { BRANCH_CODE_RE } from '../util/branch';
import { applyAnswer, recordFromBranch } from '../services/segmentSuggestions';

export async function recordSegmentSuggestion(env: Env, callerCode: string, input: Record<string, unknown>) {
  const code = String(callerCode ?? '').trim().toLowerCase();
  if (!BRANCH_CODE_RE.test(code)) throw new Error('segmentSuggestion: the caller must name a valid subsidiary code');
  const deployed = await env.DB.prepare('SELECT 1 AS x FROM licence_deployments WHERE code = ?').bind(code).first();
  if (!deployed) throw new Error(`segmentSuggestion: ${code} is not a provisioned subsidiary`);
  return recordFromBranch(env, code, input || {});
}

export function applySegmentSuggestionAnswer(env: Env, answer: Record<string, unknown>) {
  return applyAnswer(env, answer || {});
}
