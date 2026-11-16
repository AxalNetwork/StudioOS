// #6481. Submit one already-admitted PR to its native GitHub merge queue.
const ENQUEUE = `
  mutation FeedQueue($pullRequestId: ID!, $expectedHeadOid: GitObjectID!) {
    enqueuePullRequest(input: {
      pullRequestId: $pullRequestId, expectedHeadOid: $expectedHeadOid, jump: false
    }) {
      mergeQueueEntry {
        id
        jump
        pullRequest { id number headRefOid }
      }
    }
  }`;

/**
 * An unconfirmed write may already have taken effect. The caller must reconcile
 * it with the queue before taking another action or making a budget available.
 * Only pass the installation token to this writer; it never accepts a URL.
 */
export async function enqueueCandidate({ number, pullRequestId, expectedHeadOid }, { appToken, fetchImpl = fetch }) {
  if (!Number.isSafeInteger(number) || number < 1 ||
      typeof pullRequestId !== 'string' || !pullRequestId.trim() ||
      typeof expectedHeadOid !== 'string' || !/^[0-9a-f]{40}$/.test(expectedHeadOid)) {
    throw new TypeError('Queue entry requires a PR number, node ID and full head SHA.');
  }
  if (typeof appToken !== 'string' || !appToken.trim()) throw new TypeError('Missing queue App token.');

  const attempt = { number, expectedHeadOid };
  let response, body;
  try {
    response = await fetchImpl('https://api.github.com/graphql', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${appToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: ENQUEUE, variables: { pullRequestId, expectedHeadOid } }),
    });
    if (!response.ok) {
      const refused = [401, 403, 404].includes(response.status);
      return { ...attempt, status: refused ? 'refused' : 'unconfirmed', reason: `GitHub HTTP ${response.status}` };
    }
    body = await response.json();
  } catch {
    return { ...attempt, status: 'unconfirmed', reason: 'No complete GitHub response.' };
  }

  if (body?.errors?.length) {
    // A resolver error while reading the returned entry can follow a successful
    // mutation. Only an explicit refusal of the mutation itself is conclusive.
    const denied = body.data?.enqueuePullRequest === null && Array.isArray(body.errors) &&
      body.errors.every(error => error?.path?.length === 1 && error.path[0] === 'enqueuePullRequest' &&
        ['FORBIDDEN', 'NOT_FOUND', 'UNPROCESSABLE'].includes(error.type));
    return { ...attempt, status: denied ? 'refused' : 'unconfirmed', reason: 'GitHub returned a queue mutation error.' };
  }
  const entry = body?.data?.enqueuePullRequest?.mergeQueueEntry;
  const pr = entry?.pullRequest;
  if (typeof entry?.id !== 'string' || !entry.id || entry.jump !== false ||
      pr?.id !== pullRequestId || pr.number !== number || pr.headRefOid !== expectedHeadOid) {
    return { ...attempt, status: 'unconfirmed', reason: 'Queue entry did not confirm the requested PR and head.' };
  }
  return { ...attempt, status: 'queued', entryId: entry.id };
}
