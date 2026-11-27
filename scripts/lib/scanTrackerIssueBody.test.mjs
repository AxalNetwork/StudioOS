/** D7283: private export arguments, local file modes, failure handling, coordinate rejection and finding-payload non-disclosure. Uses a local CLI stub without network access. */
// D7283: exercise public tracker privacy and its local export command without contacting GitHub.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { trackerIssueBody } from './scanTrackerIssueBody.mjs'

const coordinates = { owner: 'AxalNetwork', repo: 'StudioOS', defaultBranch: 'main', number: 42 }
const command = body => /```sh\n([\s\S]*?)\n```/.exec(body)?.[1]

test('public tracker content uses only coordinates and requires a private receipt and main scan', () => {
  const body = trackerIssueBody(coordinates)
  const hostile = { ...coordinates, rule: { id: 'PRIVATE_RULE_SENTINEL' },
    most_recent_instance: { location: { path: 'PRIVATE_PATH_SENTINEL' }, message: 'PRIVATE_MESSAGE_SENTINEL' },
    token: 'PRIVATE_TOKEN_SENTINEL' }
  Object.defineProperty(hostile, 'description', { enumerable: true, get() { throw Error('private field read') } })
  assert.equal(trackerIssueBody(hostile), body)
  assert.ok(body.startsWith('<!-- studioos-scan-remediation:42 -->\n'))
  assert.deepEqual([...body.matchAll(/\]\(([^)]+)\)/g)].map(([, href]) => href),
    ['https://github.com/AxalNetwork/StudioOS/security/code-scanning/42'])
  assert.match(body, /Default queue: `slot:S21`/)
  assert.match(body, /HTTP 403, retain `state:blocked`/)
  assert.match(body, /Code scanning alerts: read/)
  assert.match(body, /assigned session must confirm it can read the handoff before the access blocker is cleared/)
  assert.match(body, /Group owned alerts that share a root cause/)
  assert.match(body, /alert and its `main` instance as `fixed`/)
  assert.match(body, /Keep finding details in Code Scanning or the private handoff/)
})

test('invalid coordinates cannot inject Markdown, a shell command, or another repository', () => {
  for (const [key, invalid] of [
    ['owner', 'AxalNetwork/other'], ['owner', '-option'], ['owner', 'owner\nINJECTED'],
    ['owner', 'x'.repeat(40)], ['owner', null],
    ['repo', '../other'], ['repo', '..'], ['repo', '.'], ['repo', 'repo](https://other.invalid)'],
    ['repo', 'repo;touch INJECTED'], ['repo', 'x'.repeat(101)], ['repo', {}],
    ['defaultBranch', 'main\nINJECTED'], ['defaultBranch', 'main`id`'],
    ['defaultBranch', "main'$(touch INJECTED)'"], ['defaultBranch', 'main;id'],
    ['defaultBranch', '-main'], ['defaultBranch', '/main'], ['defaultBranch', 'main/'],
    ['defaultBranch', 'main.'], ['defaultBranch', 'heads//main'], ['defaultBranch', 'heads/../main'],
    ['defaultBranch', 'release..candidate'],
    ['defaultBranch', 'heads/.hidden'], ['defaultBranch', 'main.lock'], ['defaultBranch', 'heads.lock/main'],
    ['defaultBranch', 'x'.repeat(256)], ['defaultBranch', undefined],
    ['number', '42'], ['number', 0], ['number', -1], ['number', 1.5],
    ['number', Number.MAX_SAFE_INTEGER + 1], ['number', NaN], ['number', Infinity],
  ]) {
    assert.throws(() => trackerIssueBody({ ...coordinates, [key]: invalid }),
      { message: 'Invalid tracker coordinates' }, key)
  }
  const valid = trackerIssueBody({ ...coordinates, owner: 'axal-network', repo: 'Studio_OS.test', defaultBranch: 'release/2026.11-1' })
  assert.match(valid, /refs\/heads\/release\/2026\.11-1/)
})

function exportFixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-export test-'))
  try {
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    const argsFile = join(dir, 'arguments.json')
    writeFileSync(join(bin, 'gh'), `#!${process.execPath}\n` +
      "import { writeFileSync } from 'node:fs';\n" +
      "writeFileSync(process.env.TEST_ARGS, JSON.stringify(process.argv.slice(2)));\n" +
      "process.stdout.write(process.env.TEST_PAYLOAD || '');\n" +
      "process.exit(Number(process.env.TEST_EXIT || '0'));\n", { mode: 0o700 })
    return run({ dir, argsFile, env: { PATH: bin + ':/usr/bin:/bin', TMPDIR: dir,
      TEST_ARGS: argsFile, GH_HOST: 'unrelated.invalid' } })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('generated command uses literal GET coordinates and saves evidence privately without printing it', () => {
  exportFixture(({ argsFile, env }) => {
    const body = trackerIssueBody({ ...coordinates, repo: 'Studio_OS.test', defaultBranch: 'release/2026.11-1' })
    const payload = '{"rule_id":"PRIVATE_RULE_SENTINEL","location":{"path":"PRIVATE_PATH_SENTINEL"}}\n'
    const result = spawnSync('/bin/sh', ['-c', command(body)], { env: { ...env, TEST_PAYLOAD: payload }, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const args = JSON.parse(readFileSync(argsFile, 'utf8'))
    assert.deepEqual(args.slice(0, -1), ['api', '--hostname', 'github.com', '--paginate', '--method', 'GET',
      'repos/AxalNetwork/Studio_OS.test/code-scanning/alerts', '-f', 'state=open',
      '-f', 'ref=refs/heads/release/2026.11-1', '-f', 'per_page=100', '--jq'])
    assert.match(args.at(-1), /select\(\.number == 42 and \.state == "open" and \.most_recent_instance\.ref == "refs\/heads\/release\/2026\.11-1" and \.most_recent_instance\.state == "open"\)/)
    for (const field of ['rule_id: .rule.id', 'tool: .tool.name', 'location: .most_recent_instance.location',
      'message: .most_recent_instance.message.text', 'alert_url: .html_url',
      'commit_sha: .most_recent_instance.commit_sha', 'retrieved_at: (now | todateiso8601)']) assert.ok(args.at(-1).includes(field), field)
    const file = /^Private export: (.+)\n$/.exec(result.stdout)?.[1]
    assert.ok(file?.endsWith('/alert-42.json'))
    assert.equal(readFileSync(file, 'utf8'), payload)
    assert.equal(statSync(dirname(file)).mode & 0o777, 0o700)
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_RULE_SENTINEL|PRIVATE_PATH_SENTINEL/)
  })
})

test('failed or empty exports cannot report a successful private handoff', () => {
  for (const [payload, exit] of [['', '0'], ['PRIVATE_PARTIAL_RESULT', '22']]) {
    exportFixture(({ env }) => {
      const result = spawnSync('/bin/sh', ['-c', command(trackerIssueBody(coordinates))],
        { env: { ...env, TEST_PAYLOAD: payload, TEST_EXIT: exit }, encoding: 'utf8' })
      assert.notEqual(result.status, 0)
      assert.doesNotMatch(result.stdout + result.stderr, /Private export:|PRIVATE_PARTIAL_RESULT/)
    })
  }
})
