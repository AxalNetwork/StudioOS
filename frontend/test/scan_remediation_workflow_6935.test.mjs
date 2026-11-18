// Ensure future workflow edits keep remediation privileges out of the scanner's PR jobs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflows = new URL('../../.github/workflows/', import.meta.url)
const read = name => readFileSync(new URL(name + '.yml', workflows), 'utf8')

test('only successful uploads from main can request reconciliation, with a fixed dispatch target', () => {
  for (const [scanner, job] of [['codeql', 'analyze'], ['semgrep', 'scan']]) {
    const workflow = read(scanner)
    const [scannerJobs, dispatch] = workflow.split('\n  remediate:\n')
    assert.doesNotMatch(scannerJobs, /actions: write|SCAN_REMEDIATION_APP_PRIVATE_KEY/)
    assert.ok(dispatch.includes('needs: [visibility, ' + job + ']'))
    assert.match(dispatch, /github\.repository == 'AxalNetwork\/StudioOS' && github\.event_name == 'push' &&\s+github\.ref == 'refs\/heads\/main' && needs\.visibility\.outputs\.upload == 'always'/)
    assert.doesNotMatch(dispatch, /always\(|failure\(|cancelled\(|uses:|secrets\./)
    assert.deepEqual(dispatch.match(/^      [\w-]+: (?:read|write)$/gm), ['      actions: write'])
    assert.match(dispatch, /repos\/AxalNetwork\/StudioOS\/actions\/workflows\/scan-remediation\.yml\/dispatches -f ref=main$/m)
  }
})

test('reconciliation runs the trusted main revision only and keeps its token out of git', () => {
  const workflow = read('scan-remediation')
  const triggers = workflow.split('\non:\n')[1].split('\npermissions:')[0]
  assert.deepEqual(triggers.match(/^  \w+:$/gm), ['  schedule:', '  workflow_dispatch:'])
  assert.match(workflow, /if: github\.repository == 'AxalNetwork\/StudioOS' && github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}\n          persist-credentials: false/)
  assert.match(workflow, /group: studioos-code-scanning-remediation\n      cancel-in-progress: false/)
  assert.match(workflow, /GH_TOKEN: \$\{\{ steps\.app\.outputs\.token \|\| github\.token \}\}/)
  assert.match(workflow, /SCAN_ALERT: \$\{\{ inputs\.alert \}\}/)
  assert.match(workflow, /run: node scripts\/scan-remediation\/run\.mjs/)
})
