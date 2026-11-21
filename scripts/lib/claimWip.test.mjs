import assert from 'node:assert/strict';
import test from 'node:test';
import { capBlockers, formatWip, parseWipCap, readOpenPulls, readWip } from './claimWip.mjs';
import { claimMessage } from './claims.mjs';

const labelsFile = '- name: "slot:S32"\n- name: "slot:S06"\n';
const now = new Date('2026-11-14T15:00:00Z');
const pull = (number, body, { draft = false, branch = '', state = 'PENDING', mergeable = 'MERGEABLE', needsSession = false } = {}) => ({
  number, body, headRefName: branch, isDraft: draft, mergeable,
  labels: { nodes: needsSession ? [{ name: 'needs-session' }] : [] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state } } }] },
});
const pulls = [
  pull(51, '## Objective\nCloses #1', { draft: true, needsSession: true }),
  pull(52, '', { branch: 'agent/codex/2-red', state: 'FAILURE' }),
  pull(53, 'Part of #1', { state: 'SUCCESS' }),
  pull(54, '', { mergeable: 'CONFLICTING' }),
  pull(55, 'Closes #2'),
];
const issue = number => ({ number, labels: [{ name: 'slot:S32' }] });
const response = (first, last) => ({ data: { repository: { first, last } } });

async function report(labels = labelsFile) {
  let calls = 0;
  const result = await readWip({
    now, labelsFile: labels, repo: 'owner/repo',
    graphql: async (query, vars) => {
      calls++;
      assert.match(query, /states:OPEN/);
      assert.deepEqual(vars, { owner: 'owner', name: 'repo' });
      return response({ nodes: pulls, totalCount: pulls.length, pageInfo: { hasNextPage: false } }, { nodes: pulls });
    },
    pages: async (_, path) => path.startsWith('issues?') ? [issue(1)]
      : [{ ref: 'refs/heads/claim/1', object: { sha: 'old' } }],
    api: async (method, path) => {
      assert.equal(method, 'GET');
      if (path === 'issues/2') return issue(2);
      assert.equal(path, 'git/commits/old');
      return { message: claimMessage({ issue: 1, agent: 'Codex', slot: 's32', session: '32', at: '2026-11-13T14:00:00Z' }) };
    },
  });
  assert.equal(calls, 1);
  return result;
}

test('report groups body and branch references, keeps unattributed PRs, and lists expired claims', async () => {
  assert.equal(formatWip(await report()), [
    '| Slot | Draft | Red | Conflicted | Green | Waiting | Non-green weight | Expired in-progress issues |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    '| S06 | — | — | — | — | — | 0 | — |',
    '| S32 | #51 | #52 | — | #53 | #55 | 3 | #1 |',
    '| unattributed | — | — | #54 | — | — | 1 | — |',
  ].join('\n'));
});

test('needs-session affects weight only when the label is configured; green never counts', async () => {
  const ordinary = (await report()).get('S32');
  const doubled = (await report(labelsFile + '- name: "needs-session"\n')).get('S32');
  assert.deepEqual(capBlockers(ordinary, parseWipCap(undefined)), []);
  assert.deepEqual(capBlockers(ordinary, 4), []);
  assert.deepEqual(capBlockers(ordinary, 3).map(pull => pull.number), [51, 52, 55]);
  assert.deepEqual(capBlockers(doubled, 4).map(pull => pull.number), [51, 52, 55]);
  for (const value of ['0', '-1', '1.5', 'abc', '9007199254740992']) assert.throws(() => parseWipCap(value));
});

test('the two GraphQL windows deduplicate overlaps and request the middle only when needed', async () => {
  const nodes = Array.from({ length: 201 }, (_, i) => ({ number: i + 1 }));
  const requests = [];
  const graphql = async (_, vars) => {
    requests.push(vars);
    const start = vars.cursor ? 100 : 0;
    return response({ totalCount: 201, nodes: nodes.slice(start, start + 100), pageInfo: { hasNextPage: true, endCursor: 'next' } },
      { nodes: nodes.slice(-100) });
  };
  assert.equal((await readOpenPulls(graphql, 'owner', 'repo')).length, 201);
  assert.deepEqual(requests, [{ owner: 'owner', name: 'repo' }, { owner: 'owner', name: 'repo', cursor: 'next' }]);
});
