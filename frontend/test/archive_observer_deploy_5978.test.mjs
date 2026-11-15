import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/archive-observer-deploy.yml', 'utf8');

test('archive observer deployment requires main and explicit owner enablement', () => {
  assert.match(workflow, /push:\n    branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request|merge_group/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main' && vars\.ARCHIVE_OBSERVER_DEPLOY_ENABLED == 'true'/);
  assert.match(workflow, /persist-credentials: false/);
  const actions = [...workflow.matchAll(/uses: ([^\s]+)/g)].map((match) => match[1]);
  assert.equal(actions.length, 2);
  for (const action of actions) assert.match(action, /^actions\/(?:checkout|setup-node)@[a-f\d]{40}$/);
});

test('type-check and dry run precede deployment of only the archive observer config', () => {
  const commands = [...workflow.matchAll(/^\s+run: .*\/\.bin\/(.*)$/gm)].map((match) => match[1]);
  assert.deepEqual(commands, [
    'tsc --noEmit -p cloudflare-archive-observer/tsconfig.json',
    'wrangler deploy --dry-run --config cloudflare-archive-observer/wrangler.jsonc',
    'wrangler deploy --config cloudflare-archive-observer/wrangler.jsonc',
  ]);
  assert.match(workflow, /secrets\.ARCHIVE_OBSERVER_CLOUDFLARE_API_TOKEN/);
  assert.doesNotMatch(workflow, /d1 migrations|secrets\.CLOUDFLARE_API_TOKEN/);
});
