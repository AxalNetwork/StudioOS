/** D7259: `scanBatchIssue.mjs`: the public batch shows only its opaque id, tracker numbers and alert links, and parses back exactly. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { BATCH_TITLE, batchTitle, parseBatch, renderBatchBody } from './scanBatchIssue.mjs'

const repo = { owner: 'AxalNetwork', repo: 'StudioOS' }

test('a batch body round trips its members and resolved members and nothing else', () => {
  const body = renderBatchBody({ ...repo, id: '0a1b2c3d', members: [{ tracker: 502, alert: 2 }, { tracker: 501, alert: 1 }],
    resolved: [{ tracker: 503, alert: 3 }] })
  const issue = { title: batchTitle('0a1b2c3d'), body }
  assert.deepEqual(parseBatch(issue, repo), { id: '0a1b2c3d', members: [{ tracker: 502, alert: 2 }, { tracker: 501, alert: 1 }],
    resolved: [{ tracker: 503, alert: 3 }] })
  assert.match(issue.title, BATCH_TITLE)
  const links = [...body.matchAll(/\]\(([^)]+)\)/g)].map(([, href]) => href)
  assert.deepEqual(links, [2, 1, 3].map(n => 'https://github.com/AxalNetwork/StudioOS/security/code-scanning/' + n),
    'the only links are the members\' protected alerts, in the given order')
  assert.match(body, /Do not write `Closes`/)
  assert.match(renderBatchBody({ ...repo, id: '0a1b2c3d', members: [] }), /## Members\n\nNone open\./)
})

test('only exact member lines for this repository, under the right heading, with a matching alert link count', () => {
  const line = (t, a, link = a, where = 'AxalNetwork/StudioOS') =>
    `- #${t} · [alert #${a}](https://github.com/${where}/security/code-scanning/${link})`
  const body = ['<!-- studioos-scan-remediation-batch:0a1b2c3d -->', line(400, 9), '## Members', line(501, 1), line(502, 2, 3),
    line(503, 3, 3, 'other/repo'), '  ' + line(504, 4), line(501, 1), '## Notes', line(505, 5)].join('\n')
  assert.deepEqual(parseBatch({ title: batchTitle('0a1b2c3d'), body }, repo).members, [{ tracker: 501, alert: 1 }])
  assert.equal(parseBatch({ title: batchTitle('ffffffff'), body }, repo), null, 'the marker must carry the title id')
  assert.equal(parseBatch({ title: 'Remediation batch 0a1b2c3d', body }, repo), null)
  assert.throws(() => batchTitle('js/xss'), /Invalid batch id/)
  assert.throws(() => renderBatchBody({ ...repo, id: '0a1b2c3d', members: [{ tracker: 1, alert: 1 }], resolved: [{ tracker: 1, alert: 1 }] }), /Duplicate/)
})
