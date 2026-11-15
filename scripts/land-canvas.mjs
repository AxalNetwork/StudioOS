#!/usr/bin/env node
/**
 * #6312: lands an owner-approved Claude Design canvas, for the `land-canvas` skill.
 *
 *   node scripts/land-canvas.mjs --issue 4846 --name "Build v2" --from DIR [--write]
 *   node scripts/land-canvas.mjs --issue 4799 --folder network-workspace --from DIR [--write]
 *   node scripts/land-canvas.mjs --waiting 4846
 *
 * Pair mode reads `<name> Page.dc.html` and `<name>.dc.html` from DIR (the
 * files as the Artifact tool saved them), checks each SHA-256 against the
 * digests recorded on the issue, and with `--write` copies them into
 * `design/incoming/` as `<name> Page.dc.html` and `<name> · Boards.dc.html`.
 * Folder mode copies every file of a canvas whose files import each other by
 * name into `design/incoming/<folder>/`. It prints the board list and the
 * digests the decision file records. A digest mismatch stops it unless
 * `--accept-mismatch` is given (the owner approved a later revision, and the
 * decision file says so); a file the issue records no digest for, when it
 * records others, stops it unless `--accept-unrecorded`. Only digests written
 * by the owner, a member or a collaborator count. `--waiting N` lists the open blocked issues that
 * name #N, the ones to release after the canvas merges.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, sep, dirname } from 'node:path';
import { gh } from './coordinator.mjs';
import { landedName, parseDigests, compareDigests, boardsOf } from './lib/coordinator.mjs';

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const flag = name => process.argv.includes(`--${name}`);
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const INCOMING = 'design/incoming';

const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
/** The issue body and its comments, each marked trusted when written by the owner, a member or a collaborator. */
function sources(n) {
  const issue = gh('GET', `/issues/${n}`);
  const out = [{ body: issue.body || '', trusted: TRUSTED.has(issue.author_association), who: issue.user?.login }];
  for (let p = 1; p <= 20; p++) {
    const rows = gh('GET', `/issues/${n}/comments?per_page=100&page=${p}`);
    out.push(...rows.map(c => ({ body: c.body || '', trusted: TRUSTED.has(c.author_association), who: c.user?.login })));
    if (rows.length < 100) break;
  }
  return out;
}

const SAFE_NAME = /^[^/\\]+$/;
function waiting(n) {
  const q = encodeURIComponent(`repo:${process.env.COORDINATOR_REPO || 'AxalNetwork/StudioOS'} is:issue is:open label:state:blocked "#${n}"`);
  const r = gh('GET', `https://api.github.com/search/issues?q=${q}&per_page=100`);
  for (const i of r.items) console.log(`#${i.number}\t${i.labels.map(l => l.name).filter(l => /^(slot|state|needs)/.test(l)).join(' ')}\t${i.title}`);
  console.log(`${r.total_count} open blocked issue(s) name #${n}. Read each: release only those whose only blocker was this canvas.`);
}

function land() {
  const issue = Number(arg('issue')), from = arg('from'), name = arg('name'), folder = arg('folder');
  if (!issue || !from || !(name || folder)) throw new Error('need --issue, --from and --name or --folder');
  for (const v of [name, folder]) if (v !== undefined && (!SAFE_NAME.test(v) || v === '.' || v === '..')) throw new Error(`not a plain name: ${v}`);
  if (!existsSync(join(process.cwd(), INCOMING))) throw new Error('run from the repository root');
  const files = folder
    ? readdirSync(from, { withFileTypes: true }).filter(d => d.isFile() && !d.name.startsWith('.') && !/^landed-\d+\.json$/.test(d.name)).map(d => d.name)
    : [`${name} Page.dc.html`, `${name}.dc.html`];
  if (!files.length) throw new Error(`no files in ${from}`);
  const local = {};
  for (const f of files) {
    const p = join(from, f);
    if (!existsSync(p) || !statSync(p).isFile()) throw new Error(`missing ${p}: read it with the Artifact tool first`);
    local[f] = sha(p);
  }
  const src = sources(issue);
  const recorded = parseDigests(src);
  const ignored = src.filter(x => !x.trusted && /\b[0-9a-fA-F]{64}\b/.test(x.body)).map(x => x.who);
  if (ignored.length) console.log(`ignored digests from people who are not owner, member or collaborator: ${[...new Set(ignored)].join(', ')}`);
  const rows = compareDigests(local, recorded);
  for (const r of rows) console.log(`${r.result.padEnd(10)} ${r.sha}  ${r.file}${r.recorded && r.result === 'mismatch' ? `  (issue records ${r.recorded})` : ''}`);
  if (rows.some(r => r.result === 'mismatch' || r.result === 'conflict') && !flag('accept-mismatch')) throw new Error('digest mismatch or conflicting digests on the issue: confirm which revision the owner approved, then re-run with --accept-mismatch and say so in the decision file');
  // When the issue recorded digests at all, a file it has none for may be a different file.
  if (Object.keys(recorded).length && rows.some(r => r.result === 'unrecorded') && !flag('accept-unrecorded')) throw new Error('the issue records digests, but not for every file: check the names, then re-run with --accept-unrecorded');
  for (const f of files) {
    const html = f.endsWith('.html') ? readFileSync(join(from, f), 'utf8') : '';
    if (html && !html.includes('./support.js')) console.log(`warning: ${f} does not load ./support.js; the canvas will not render from design/incoming`);
    if (html && /<link[^>]+href="https?:\/\/(?!fonts\.googleapis\.com)/.test(html)) console.log(`warning: ${f} links a stylesheet outside Google Fonts`);
  }
  const boards = folder ? [] : boardsOf(readFileSync(join(from, `${name}.dc.html`), 'utf8'));
  if (boards.length) console.log(`boards: ${boards.map(b => b.id).join(', ')}`);
  const root = resolve(INCOMING) + sep;
  const targets = files.map(f => [f, folder ? join(INCOMING, folder, f) : join(INCOMING, landedName(f))]);
  for (const [, t] of targets) {
    if (!resolve(t).startsWith(root)) throw new Error(`${t} is outside ${INCOMING}`);
    if (existsSync(t) && !flag('overwrite')) throw new Error(`${t} exists; a new revision is a new decision, pass --overwrite only if the owner approved it`);
  }
  if (!flag('write')) { console.log('dry run: add --write to copy'); return; }
  if (folder) mkdirSync(join(INCOMING, folder), { recursive: true });
  for (const [f, t] of targets) copyFileSync(join(from, f), t);
  const summaryPath = join(dirname(resolve(from)), `landed-${issue}.json`);
  const summary = { issue, landed: targets.map(([f, t]) => ({ published: f, path: t, sha256: local[f], digest: rows.find(r => r.file === f).result })), boards };
  writeFileSync(summaryPath, JSON.stringify(summary, null, 1));
  console.log(`copied ${targets.length} file(s); summary for the decision file: ${summaryPath}`);
}

try {
  if (arg('waiting')) waiting(Number(arg('waiting')));
  else land();
} catch (e) { console.error(e.message); process.exit(1); }
