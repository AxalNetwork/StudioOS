// D5664: bounded GET-only work/check/delivery/claim snapshot recovery; irrecoverable transitions remain explicit gaps.
import { normalizeEvent } from './events-v1.mjs';
import { parseClaim, isExpired } from '../scripts/lib/claims.mjs';
export async function reconcileSnapshots({ read, ledger, repository, until = Date.now(), bootstrapMs = 3_600_000 }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository?.full_name || '')) throw new Error('repository_invalid');
  const root = `/repos/${repository.full_name}`, cursor = ledger.cursor('snapshots'), since = cursor ? Math.max(0, cursor - 300_000) : Math.max(0, until - bootstrapMs);
  const iso = ms => new Date(ms).toISOString(), gap = (scope, code) => ledger.recordGap({ scope, code, from: since, to: until });
  const emit = async (kind, payload) => {
    const event = await normalizeEvent({ kind, payload: { repository, ...payload }, source: 'github-rest', observedAt: iso(until), deliveryId: 'rest:snapshot' });
    event.deliveryId = `rest:${event.key}`; await ledger.append(event); return event;
  };
  const list = async (path, key, visit, { sorted = false } = {}) => {
    for (let page = 1; page <= 100; page++) {
      const data = await read(`${root}/${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`), rows = key ? data[key] : data;
      if (!Array.isArray(rows)) throw new Error('source_shape_invalid');
      for (const value of rows) await visit(value);
      if (rows.length < 100 || sorted && Date.parse(rows.at(-1).updated_at || rows.at(-1).created_at || '') < since) return;
    }
    throw new Error('snapshot_pagination_incomplete');
  };
  const commits = new Set(), activePRs = new Map(); let complete = true;
  const scope = async (name, fn) => {
    try { await fn(); }
    catch (error) { complete = false; gap(name, ['permission_revoked', 'rate_limited', 'snapshot_pagination_incomplete'].includes(error.message) ? error.message : 'snapshot_source_unavailable'); }
  };
  await scope('work', async () => {
    const visitPR = async pr => {
      if (!Number.isSafeInteger(pr.number) || pr.number < 1) throw new Error('source_shape_invalid');
      if (pr.head?.sha && /^[a-f0-9]{40}$/.test(pr.head.sha)) commits.add(pr.head.sha);
      activePRs.set(pr.number, pr); await emit('pull_request', { pull_request: pr, action: pr.state });
    };
    await list('pulls?state=all&sort=updated&direction=desc', null, visitPR, { sorted: true });
    // Recheck old open PRs independently of the update cursor.
    await list('pulls?state=open&sort=updated&direction=desc', null, visitPR);
    for (const pr of activePRs.values()) {
      await list(`pulls/${pr.number}/reviews`, null, review => emit('pull_request_review', { pull_request: pr, review, action: 'submitted' }));
      await list(`pulls/${pr.number}/comments?sort=updated&direction=desc`, null, comment => emit('pull_request_review_comment', { pull_request: pr, comment, action: 'observed' }), { sorted: true });
    }
    await list(`issues?state=all&sort=updated&direction=desc&since=${encodeURIComponent(iso(since))}`, null, issue => issue.pull_request ? undefined : emit('issues', { issue, action: issue.state }), { sorted: true });
    await list(`issues/comments?since=${encodeURIComponent(iso(since))}&sort=updated&direction=desc`, null, comment => {
      let number;
      try { const url = new URL(comment.issue_url); if (url.hostname === 'api.github.com' && url.pathname.startsWith(`${root}/issues/`)) number = Number(url.pathname.slice(`${root}/issues/`.length)); } catch { /* unknown correlation retained */ }
      return emit('issue_comment', { comment, ...(Number.isSafeInteger(number) && number > 0 ? { issue: { number } } : {}), action: 'observed' });
    }, { sorted: true });
    gap('work', 'missed_review_thread_resolution_requires_retained_feed');
  });
  await scope('delivery', async () => {
    await list('releases', null, release => emit('release', { release, action: release.draft ? 'draft' : release.published_at ? 'published' : 'observed' }));
    const deployments = new Map();
    for (let after = 0; ; ) { const page = ledger.history(after, 1000); if (!page.length) break; for (const e of page) { after = e.sequence; if (e.ids.deployment) deployments.set(e.ids.deployment, { id: e.ids.deployment, environment: e.environment }); } }
    await list('deployments', null, async deployment => { deployments.set(String(deployment.id), deployment); await emit('deployment', { deployment, action: 'observed' }); }, { sorted: true });
    for (const deployment of deployments.values()) {
      if (!/^[1-9]\d{0,18}$/.test(String(deployment.id))) throw new Error('source_shape_invalid');
      await list(`deployments/${deployment.id}/statuses`, null, deployment_status => emit('deployment_status', { deployment, deployment_status, action: 'observed' }));
    }
    await list('git/matching-refs/heads/main', null, ref => { if (/^[a-f0-9]{40}$/.test(ref.object?.sha || '')) { commits.add(ref.object.sha); return emit('push', { ref: ref.ref, after: ref.object.sha }); } });
    await list('git/matching-refs/tags/', null, ref => emit('create', { ref: ref.ref, ref_type: 'tag' }));
    await list('git/matching-refs/heads/gh-readonly-queue/main/', null, ref => emit('merge_group', { ref: ref.ref, merge_group: { head_sha: ref.object?.sha, base_ref: 'refs/heads/main' }, action: 'observed' }));
    gap('delivery', 'destroyed_groups_transient_refs_approvals_need_retained_feed');
  });
  await scope('checks', async () => {
    for (const commit of commits) {
      await list(`commits/${commit}/check-runs?filter=all`, 'check_runs', check_run => emit('check_run', { check_run, action: check_run.status }));
      await list(`commits/${commit}/statuses`, null, status => emit('status', { ...status, sha: commit, action: 'observed' }));
    }
    gap('checks', 'orphan_external_check_commits_outside_feed_unknown');
  });
  await scope('claims', async () => {
    await list('git/matching-refs/heads/claim/', null, async ref => {
      const match = /^refs\/heads\/claim\/([1-9]\d*)$/.exec(ref.ref || '');
      if (!match || !/^[a-f0-9]{40}$/.test(ref.object?.sha || '')) { gap('claims', 'claim_metadata_invalid'); return; }
      const commit = await read(`${root}/git/commits/${ref.object.sha}`), claim = parseClaim(commit.message);
      if (!claim || claim.issue !== Number(match[1])) { gap('claims', 'claim_metadata_invalid'); return; }
      const expired = isExpired(claim, until), expiresAt = iso(Date.parse(claim.at) + claim.ttlHours * 3_600_000);
      await emit('claim', { claim: { issue: claim.issue, slot: claim.slot, session: claim.session, state: expired ? 'expired_still_held' : 'held', expiresAt, updated_at: expired ? expiresAt : claim.at } });
    });
    gap('claims', 'missed_release_or_competing_claims_need_retained_feed');
  });
  // The security reader is deliberately absent from this installation boundary.
  gap('security', 'separate_approved_scope_not_verified');
  gap('snapshots', 'poll_cannot_reconstruct_intermediate_transitions');
  if (complete) ledger.checkpoint('snapshots', until);
  return { complete, since, until, ...ledger.counts() };
}
