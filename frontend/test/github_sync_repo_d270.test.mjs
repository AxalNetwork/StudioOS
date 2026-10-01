/**
 * D270 — the GitHub Sync panel shows the repository read-only.
 *
 * `GITHUB_REPO_OWNER` and `GITHUB_REPO_NAME` are wrangler.toml [vars]; every
 * deploy writes them back. The panel used to render both as inputs pre-filled
 * from display defaults and send them on every Save, so an admin's edit lasted
 * until the next deploy. Now the panel renders the values the Worker has, with
 * no control, and Save sends the token alone. The worker half — PUT refusing a
 * different owner or name and pushing only the token, DELETE leaving the
 * names alone — is cloudflare-worker/test/github_sync_repo_d270.test.ts.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/github_sync_repo_d270.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { GithubRepoReadOnly } from '../src/pages/AdminPage.jsx';

const PAGE = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/pages/AdminPage.jsx'), 'utf8'));
function panel(name) {
  const at = PAGE.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} is gone from AdminPage.jsx`);
  const next = PAGE.indexOf('\nfunction ', at + 1);
  return PAGE.slice(at, next > at ? next : PAGE.length);
}
const render = (cfg) => renderToStaticMarkup(React.createElement(GithubRepoReadOnly, { cfg }));
const between = (html, id) => {
  const at = html.indexOf(`data-testid="${id}"`);
  assert.ok(at >= 0, `${id} is not drawn`);
  return html.slice(html.indexOf('>', at) + 1, html.indexOf('</dd>', at));
};

test('D270: the panel renders the deployed owner and name as values, with no input', () => {
  const html = render({
    repo_owner: 'AxalNetwork', repo_name: 'StudioOS', repo_set_at: 'deploy',
    repo_note: 'The repository is set at deploy time: GITHUB_REPO_OWNER and GITHUB_REPO_NAME are [vars] in wrangler.toml.',
  });
  assert.match(between(html, 'github-sync-repo-owner'), /AxalNetwork/);
  assert.match(between(html, 'github-sync-repo-name'), /StudioOS/);
  assert.match(html, /set at deploy time/);
  assert.match(html, /wrangler\.toml/);
  assert.doesNotMatch(html, /<input|<textarea|<select|<button/, 'the repository became editable again');
});

test('D270: a value the Worker does not have reads "Not set", never a default', () => {
  const html = render({ repo_owner: null, repo_name: null });
  assert.match(between(html, 'github-sync-repo-owner'), /Not set/);
  assert.match(between(html, 'github-sync-repo-name'), /Not set/);
  assert.doesNotMatch(html, /AxalNetwork|StudioOS/, 'a default repository was drawn for a Worker that has none');
});

test('D270: the panel mounts the read-only block for everyone, and its only input is the token', () => {
  const gh = panel('GithubSyncPanel');
  const mount = gh.indexOf('<GithubRepoReadOnly cfg={cfg} />');
  assert.ok(mount > 0, 'the read-only repository block is not mounted');
  // Outside the holder gate: every admin reads the repository.
  const open = gh.lastIndexOf('<SecretWriteGate', mount);
  assert.ok(open < 0 || gh.lastIndexOf('</SecretWriteGate>', mount) > open, 'the repository is hidden behind the holder gate');
  // Editable inputs only: the webhook URL and a revealed secret are readOnly
  // copies, drawn for copying, not for editing.
  const editable = (gh.match(/<input\b[^>]*>/g) || []).filter((t) => !/\breadOnly\b/.test(t));
  const inputs = [...gh.matchAll(/<input\b/g)];
  assert.ok(inputs.length >= 1, 'no input found; the scan would pass on nothing');
  assert.equal(editable.length, 1, `the panel draws ${editable.length} editable inputs; only the token is editable`);
  assert.match(gh, /<input[^>]*value=\{token\}/);
  assert.doesNotMatch(gh, /setOwner|setRepo|default_repo_/, 'the owner/name editing state is back');
});

test('D270: every Save the panel sends carries no repository', () => {
  const gh = panel('GithubSyncPanel');
  // The whole call line, not `[^)]*`: the argument itself holds parentheses
  // (`token.trim()`), and a capture that stopped at the first one would never
  // read a repository sent after it. That was a recorded escape (D270).
  const sends = [...gh.matchAll(/api\.adminSaveGithubConfig\((.*)\);?\s*$/gm)].map((m) => m[1]);
  assert.ok(sends.length >= 2, `found ${sends.length} Save calls; the scan would pass on nothing`);
  for (const body of sends) {
    assert.doesNotMatch(body, /repo_owner|repo_name|owner|repo\b/, `a Save sends the repository: ${body}`);
  }
});
