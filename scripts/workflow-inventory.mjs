/**
 * #5976: Generate or check the workflow trigger and required-check inventory from the committed Actions YAML.
 * #9054: the generated table also carries each workflow's GITHUB_TOKEN permissions (workflow level and every job
 * that grants a write scope), and `--check` also fails when the hand-written purpose table below the generated block
 * has no row for a workflow file, a row for a file that does not exist, or two rows for one file.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REQUIRED } from './lib/requiredChecks.mjs';
import { branchFilterMatches } from './lib/literalMatch.mjs';

const requireWorker = createRequire(new URL('../cloudflare-worker/package.json', import.meta.url));
const { parse } = requireWorker('yaml');
const workflows = new URL('../.github/workflows/', import.meta.url);
const readme = new URL('README.md', workflows);
const start = '<!-- workflow-inventory:start -->';
const end = '<!-- workflow-inventory:end -->';
const primary = ['pull_request', 'merge_group', 'push'];
const columns = ['pull_request', 'pull_request_target', 'merge_group', 'push', 'schedule'];

function checkMap(name) {
  const source = readFileSync(new URL('../frontend/test/merge_queue_ci_4107.test.mjs', import.meta.url), 'utf8');
  const head = `const ${name} = Object.freeze({`;
  const at = source.indexOf(head);
  const close = at < 0 ? -1 : source.indexOf('});', at + head.length);
  const literal = close < 0 ? undefined : source.slice(at + head.length, close);
  if (literal === undefined) throw new Error(`Missing ${name} check map`);
  const pairs = [...literal.matchAll(/(?:'([^']+)'|([\w-]+)):\s*'([^']+)'/g)];
  if (!pairs.length || literal.replace(/(?:'[^']+'|[\w-]+):\s*'[^']+'/g, '').replace(/[\s,]/g, '')) {
    throw new Error(`Unexpected ${name} check map syntax`);
  }
  return Object.fromEntries(pairs.map(([, quoted, bare, file]) => [quoted ?? bare, file]));
}

export function eventRules(on) {
  if (typeof on === 'string') return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map(event => [event, null]));
  return on ?? {};
}

export function jobState(condition, event) {
  if (condition === undefined) return 'runs';
  if (condition === false) return 'excluded';
  if (condition === true) return 'runs';
  const expression = String(condition).trim().replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  const plain = /^github\.event_name\s*(==|!=)\s*(['"])([a-z_]+)\2$/.exec(expression);
  if (!plain) return 'conditional';
  const equal = event === plain[3];
  return equal === (plain[1] === '==') ? 'runs' : 'excluded';
}

function matchesMain(pattern) {
  return branchFilterMatches(pattern, 'main');
}

export function mainPush(rules) {
  if (!rules) return 'runs';
  if (rules.tags && !rules.branches && !rules['branches-ignore']) return 'excluded';
  let state = rules.branches ? 'excluded' : 'runs';
  for (const pattern of rules.branches ?? rules['branches-ignore'] ?? []) {
    const negate = pattern.startsWith('!');
    const matches = matchesMain(negate ? pattern.slice(1) : pattern);
    if (matches === null) state = 'conditional';
    else if (matches) state = negate || rules['branches-ignore'] ? 'excluded' : 'runs';
  }
  return state;
}

export function loadInventory(directory = workflows) {
  return readdirSync(directory).filter(file => /\.ya?ml$/.test(file)).sort().map(file => {
    const source = readFileSync(new URL(file, directory), 'utf8');
    const data = parse(source);
    const events = eventRules(data?.on);
    if (!Object.keys(events).length || !data?.jobs) throw new Error(`Missing triggers or jobs in ${file}`);
    return {
      file, name: data.name ?? file, events, permissions: data.permissions,
      jobs: Object.entries(data.jobs).map(([id, job]) => ({
        id, name: job.name ?? id, condition: job.if, permissions: job.permissions,
        reusable: Boolean(job.uses),
        eventSteps: JSON.stringify(job.steps ?? job.with ?? {}).includes('github.event')
          || JSON.stringify(job.steps ?? {}).includes('GITHUB_EVENT_NAME'),
      })),
    };
  });
}

const cell = value => String(value).replaceAll('|', '&#124;').replaceAll('\n', ' ');
function runsOn(workflow, job, event) {
  if (!Object.hasOwn(workflow.events, event)) return 'excluded';
  const rule = event === 'push' ? mainPush(workflow.events.push) : 'runs';
  const condition = jobState(job.condition, event);
  if (rule === 'excluded' || condition === 'excluded') return 'excluded';
  return rule === 'conditional' || condition === 'conditional' ? 'conditional' : 'runs';
}

/**
 * #9054: a `permissions:` value as the scopes it grants write on. `undefined` is not set (the repository default
 * applies), `{}` grants nothing, and the `read-all` / `write-all` shorthands are kept as written.
 */
export function writeScopes(permissions) {
  if (permissions === undefined || permissions === null) return 'unset';
  if (permissions === 'read-all' || permissions === 'write-all') return permissions;
  if (typeof permissions !== 'object' || Array.isArray(permissions)) throw new Error(`Unexpected permissions: ${JSON.stringify(permissions)}`);
  return Object.entries(permissions).filter(([, level]) => level === 'write').map(([scope]) => scope).sort();
}

/** #9054: the Token permissions cell: the workflow-level grant, then each job whose own grant writes anything. */
export function permissionsCell(workflow) {
  const describe = (scopes) => typeof scopes === 'string' ? `\`${scopes}\`` : scopes.length ? `write: ${scopes.join(', ')}` : 'read only';
  const top = writeScopes(workflow.permissions);
  const head = top === 'unset' ? 'not set (repository default)'
    : typeof top !== 'string' && !Object.keys(workflow.permissions).length ? 'none (`{}`)' : describe(top);
  const lines = [`workflow: ${head}`];
  for (const job of workflow.jobs) {
    const scopes = writeScopes(job.permissions);
    if (scopes === 'write-all' || (Array.isArray(scopes) && scopes.length)) lines.push(`\`${cell(job.id)}\` ${describe(scopes)}`);
  }
  return lines.join('<br>');
}

export function renderInventory(inventory, required = REQUIRED, shadow = checkMap('SHADOW')) {
  function jobsIn(workflow, event) {
    if (!Object.hasOwn(workflow.events, event)) return '—';
    if (event === 'push' && mainPush(workflow.events.push) === 'excluded') return 'other refs only';
    return workflow.jobs.flatMap(job => {
      const state = runsOn(workflow, job, event);
      if (state === 'excluded') return [];
      const context = shadow[job.name] === workflow.file ? 'shadow'
        : primary.includes(event) && required[job.name] === workflow.file ? 'required context' : 'advisory';
      return [`${cell(job.name)} (${context}${state === 'conditional' ? ', conditional' : ''})`];
    }).join('<br>') || 'no eligible jobs';
  }
  const rows = inventory.map(workflow => {
    const others = Object.keys(workflow.events).filter(event => !columns.includes(event));
    const extra = others.map(event => `\`${event}\` · ${jobsIn(workflow, event)}`).join('<br>') || '—';
    return `| \`${workflow.file}\` | ${cell(workflow.name)} | ${columns.map(event => jobsIn(workflow, event)).join(' | ')} | ${extra} | ${permissionsCell(workflow)} |`;
  });
  const queue = inventory.filter(workflow => Object.hasOwn(workflow.events, 'merge_group')).map(workflow => `\`${workflow.file}\``);
  const candidates = inventory.flatMap(workflow => workflow.jobs.flatMap(job => {
    const events = primary.filter(event => runsOn(workflow, job, event) !== 'excluded');
    if (events.length < 2) return [];
    const conditional = events.filter(event => runsOn(workflow, job, event) === 'conditional');
    const notes = [
      conditional.length ? `conditional on ${conditional.join(', ')}` : '',
      job.eventSteps ? 'steps reference event data' : '',
      job.reusable ? 'reusable workflow' : '',
    ].filter(Boolean);
    return [`- \`${workflow.file}\` / ${cell(job.name)} · ${events.join(', ')}${notes.length ? ` (${notes.join('; ')})` : ''}`];
  }));
  return [
    '| Workflow file | Workflow | pull_request | pull_request_target | merge_group | push to main | schedule | Other events | Token permissions |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    `Workflows that listen for \`merge_group\` (${queue.length}): ${queue.join(', ') || 'none'}.`,
    '',
    '### Jobs shared across events',
    '',
    'These jobs share a YAML definition across the listed events. Workflow filters, matrix expansion and step conditions still apply. This list proposes no removals.',
    '',
    ...candidates,
  ].join('\n');
}

export function withInventory(markdown, generated) {
  const begin = markdown.indexOf(start);
  const finish = markdown.indexOf(end);
  if (begin < 0 || finish <= begin || markdown.indexOf(start, begin + start.length) >= 0 || markdown.indexOf(end, finish + end.length) >= 0) {
    throw new Error('Expected one generated workflow inventory block in the README');
  }
  return markdown.slice(0, begin + start.length) + '\n\n' + generated + '\n\n' + markdown.slice(finish);
}

/**
 * #9054: the workflow files the hand-written purpose table names, one entry per row, in order. That table is the one
 * canonical place for a workflow's purpose, triggers and secrets: it starts on the line after the generated block's
 * end marker and runs to the first line that is not a table row. Each body row's first cell is the file in backticks.
 */
export function handTableFiles(markdown) {
  const at = markdown.indexOf(end);
  if (at < 0) throw new Error('Expected one generated workflow inventory block in the README');
  const lines = markdown.slice(at + end.length).replace(/^\n/, '').split('\n');
  const rows = [];
  for (const line of lines) {
    if (!line.startsWith('|')) break;
    rows.push(line);
  }
  if (rows.length < 2 || !/^\|(?:\s*-+\s*\|)+\s*$/.test(rows[1])) throw new Error('Expected the purpose table right after the generated block');
  return rows.slice(2).map((row, index) => {
    const file = /^\|\s*`([^`]+)`\s*\|/.exec(row)?.[1];
    if (!file) throw new Error(`Purpose table row ${index + 1} does not start with a workflow file in backticks`);
    return file;
  });
}

/** #9054: every workflow has exactly one purpose row, and every row names a workflow that exists. */
export function handTableProblems(markdown, files) {
  const named = handTableFiles(markdown);
  const problems = [];
  for (const file of files) {
    const count = named.filter(name => name === file).length;
    if (count === 0) problems.push(`${file} has no row in the purpose table`);
    else if (count > 1) problems.push(`${file} has ${count} rows in the purpose table`);
  }
  for (const name of new Set(named)) if (!files.includes(name)) problems.push(`the purpose table has a row for ${name}, which is not a workflow file`);
  return problems;
}

/**
 * The command line: no option prints the generated block, `--write` rewrites it in the README, `--check` fails on a
 * drifted block or a purpose-table problem. `directory` and `readmeUrl` let a test run it on fixture workflows.
 * Returns the exit code.
 */
export function run(mode, { directory = workflows, readmeUrl = readme, log = console.log, error = console.error } = {}) {
  const inventory = loadInventory(directory);
  const generated = renderInventory(inventory);
  if (mode === undefined) { log(generated); return 0; }
  if (mode !== '--check' && mode !== '--write') throw new Error(`Unknown option: ${mode}`);
  let code = 0;
  const current = readFileSync(readmeUrl, 'utf8');
  const updated = withInventory(current, generated);
  if (mode === '--write') writeFileSync(readmeUrl, updated);
  if (mode === '--check' && current !== updated) {
    error(`Workflow inventory has drifted in ${fileURLToPath(readmeUrl)}. Run node scripts/workflow-inventory.mjs --write.`);
    code = 1;
  }
  // #9054: `--write` cannot write a purpose row, so it names what is missing; `--check` fails on it.
  const problems = handTableProblems(updated, inventory.map(workflow => workflow.file));
  for (const problem of problems) error(`Purpose table: ${problem}. Add or fix its row by hand in ${fileURLToPath(readmeUrl)}.`);
  if (problems.length && mode === '--check') code = 1;
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run(process.argv[2]);
}
