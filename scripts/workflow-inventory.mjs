import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  const literal = source.match(new RegExp(`const ${name} = Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\);`))?.[1];
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
  if (/[^\w/.*?-]/.test(pattern)) return null;
  const regex = pattern.split(/(\*\*|\*|\?)/).map(part => ({
    '**': '.*', '*': '[^/]*', '?': '?',
  }[part] ?? part.replaceAll('.', '\\.'))).join('');
  try { return new RegExp(`^${regex}$`).test('main'); } catch { return null; }
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
      file, name: data.name ?? file, events,
      jobs: Object.entries(data.jobs).map(([id, job]) => ({
        id, name: job.name ?? id, condition: job.if,
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

export function renderInventory(inventory, required = checkMap('REQUIRED'), shadow = checkMap('SHADOW')) {
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
    return `| \`${workflow.file}\` | ${cell(workflow.name)} | ${columns.map(event => jobsIn(workflow, event)).join(' | ')} | ${extra} |`;
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
    '| Workflow file | Workflow | pull_request | pull_request_target | merge_group | push to main | schedule | Other events |',
    '|---|---|---|---|---|---|---|---|',
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const generated = renderInventory(loadInventory());
  const mode = process.argv[2];
  if (mode === '--check' || mode === '--write') {
    const current = readFileSync(readme, 'utf8');
    const updated = withInventory(current, generated);
    if (mode === '--write') writeFileSync(readme, updated);
    if (mode === '--check' && current !== updated) {
      console.error(`Workflow inventory has drifted in ${fileURLToPath(readme)}. Run node scripts/workflow-inventory.mjs --write.`);
      process.exitCode = 1;
    }
  } else if (mode === undefined) console.log(generated);
  else throw new Error(`Unknown option: ${mode}`);
}
