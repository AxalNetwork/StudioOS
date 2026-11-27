/** D5618: only queue runs of the destroyed SHA in the three approved workflows may be cancelled. */
import type { Delivery, Run } from '../types.ts';
export const WORKFLOWS = ['ci.yml', 'migration-immutability.yml', 'gitleaks.yml'] as const;
export const queueBranch = (value: string) => /^gh-readonly-queue\/main\/[A-Za-z0-9_./-]+$/.test(value) && !value.includes('..');
export function cancellable(run: Run, sha: string): boolean {
  return run.event === 'merge_group' && run.head_sha === sha && /^[a-f0-9]{40}$/.test(sha)
    && Number.isSafeInteger(run.id) && run.id > 0 && run.status !== 'completed'
    && queueBranch(run.head_branch)
    && WORKFLOWS.some(w => run.path === `.github/workflows/${w}`);
}
export function destroyedTarget(event: Delivery): string | null {
  return event.event === 'merge_group' && event.action === 'destroyed' && ['dequeued','invalidated'].includes(event.reason ?? '')
    && event.headSha && /^[a-f0-9]{40}$/.test(event.headSha) ? event.headSha : null;
}
