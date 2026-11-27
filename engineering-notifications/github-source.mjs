// D5664: read-only all-workflow/all-attempt Actions adapter; webhook families remain catalogued even without API scope.
import { normalizeEvent } from './events-v1.mjs';
export function actionsSource({ read, repository, start, gap }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository?.full_name || '')) throw new Error('repository_invalid');
  const root = `/repos/${repository.full_name}`;
  const canonical = async (kind, object) => {
    const event = await normalizeEvent({ kind, deliveryId: `rest:${kind}:${object.id}`, payload: { repository, [kind]: object }, source: 'github-rest' });
    event.deliveryId = `rest:${event.key}`;
    return event;
  };
  const enrich = async (event, accept) => {
    if (!event.ids.run || event.subject.type !== 'run') return;
    const attempts = Number(event.ids.attempt);
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 100) { await gap({ scope: 'actions', code: 'run_attempt_range_unverified', from: start, to: Date.now() }); return; }
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const run = await read(`${root}/actions/runs/${event.ids.run}/attempts/${attempt}`);
      await accept(await canonical('workflow_run', run));
      for (let page = 1; ; page++) {
        if (page > 100) throw new Error('source_shape_invalid');
        const data = await read(`${root}/actions/runs/${event.ids.run}/attempts/${attempt}/jobs?per_page=100&page=${page}`);
        if (!Array.isArray(data.jobs)) throw new Error('source_shape_invalid');
        for (const job of data.jobs) await accept(await canonical('workflow_job', { ...job, run_id: run.id, run_attempt: attempt, head_sha: run.head_sha, head_branch: run.head_branch, pull_requests: run.pull_requests }));
        if (data.jobs.length < 100) break;
      }
    }
  };
  return {
    scope: 'actions', start, enrich,
    async list({ start: from, end, page }) {
      const range = `${new Date(from).toISOString()}..${new Date(end).toISOString()}`;
      const data = await read(`${root}/actions/runs?per_page=100&page=${page}&created=${encodeURIComponent(range)}`);
      if (!Array.isArray(data.workflow_runs)) throw new Error('source_shape_invalid');
      return { total: data.total_count, items: await Promise.all(data.workflow_runs.map(run => canonical('workflow_run', run))) };
    },
    async recheck(event, accept) {
      if (!event.ids.run) return;
      const run = await read(`${root}/actions/runs/${event.ids.run}`), normalized = await canonical('workflow_run', run);
      await accept(normalized); await enrich(normalized, accept);
    },
  };
}
