#!/usr/bin/env node
/** D7145 checks each workflow job against the production credential inventory and enforces its environment. */
/** D7145: check every Actions workflow against the production credential inventory. */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INVENTORY = 'documentation/operations/production-credential-inventory.json';
const sameNames = (a, b) => a.length === b.length && a.every(name => b.includes(name));

/** Tokenize Actions expressions so a quoted example or a different context is never a secret read. */
function readExpression(expression, names, errors) {
  const tokens = expression.match(/'(?:[^']|'')*'|[a-z_][\w-]*|[^\s]/gi) ?? [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].toLowerCase() !== 'secrets' || tokens[i - 1] === '.') continue;
    const next = tokens[i + 1];
    if (next === '.' && /^[\w-]+$/.test(tokens[i + 2] ?? '')) {
      names.add(tokens[i + 2].toUpperCase());
    } else if (next === '[' && /^'[\w-]+'$/.test(tokens[i + 2] ?? '') && tokens[i + 3] === ']') {
      names.add(tokens[i + 2].slice(1, -1).toUpperCase());
    } else {
      errors.add('bulk or dynamic secrets access cannot be checked; name each secret');
    }
  }
}

/** Scan once so quoted braces and malformed expressions cannot cause regex backtracking. */
function readEmbeddedExpressions(value, names, errors) {
  let start = -1;
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    if (start === -1) {
      if (value[i] === '$' && value[i + 1] === '{' && value[i + 2] === '{') {
        start = i + 3;
        i += 2;
      }
      continue;
    }
    if (value[i] === "'") {
      if (quoted && value[i + 1] === "'") i++;
      else quoted = !quoted;
    } else if (!quoted && value[i] === '}' && value[i + 1] === '}') {
      readExpression(value.slice(start, i), names, errors);
      start = -1;
      i++;
    }
  }
  if (start !== -1) errors.add('unterminated Actions expression cannot be checked');
}

function secretReads(mapping, catalog) {
  const names = new Set();
  const errors = new Set();
  function visit(key, value) {
    if (typeof value === 'string') {
      if (key === 'if' && !value.includes('${{')) readExpression(value, names, errors);
      readEmbeddedExpressions(value, names, errors);
    } else if (value && typeof value === 'object') {
      for (const [child, item] of Object.entries(value)) visit(child, item);
    }
  }
  visit('', mapping);
  for (const name of names) {
    if (/^(FILE_)?DR_COPY_/.test(name) && !catalog.has(name)) errors.add(`add ${name} to the secret inventory`);
  }
  return { names: [...names].filter(name => catalog.has(name)), errors };
}

/** Only the two existing preview jobs can use the legacy token until #7146 lands. */
function legacyPreview(file, job, triggers, names) {
  return file === 'pr-preview.yml' && ['deploy', 'delete'].includes(job) &&
    sameNames(triggers, ['pull_request']) && sameNames(names, ['CLOUDFLARE_API_TOKEN']);
}

/**
 * D8416: read one workflow, or say where it cannot be read. Two PRs that each add the same key to
 * one job merge without a conflict, so the diagnostic names the file, line and column.
 */
function readWorkflow(file, source) {
  const document = parseDocument(source);
  const problems = document.errors.map(error => {
    const at = error.linePos?.[0];
    const where = at ? `${at.line}:${at.col}` : '?:?';
    const what = error.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '');
    const hint = error.code === 'DUPLICATE_KEY'
      ? ' (a merge can add the same key twice without a conflict; keep one)' : '';
    return `.github/workflows/${file}:${where}: ${error.code}: ${what}${hint}`;
  });
  if (problems.length) return { problems };
  const value = document.toJS();
  const jobs = value?.jobs;
  if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs) || value.on == null) {
    return { problems: [`.github/workflows/${file}:1:1: not a workflow: it needs an "on" trigger and a "jobs" mapping`] };
  }
  return { value };
}

/** Return diagnostics for workflow filename/source pairs; tests supply an in-memory repository. */
export function checkProductionCredentials(workflows, inventory) {
  const errors = [];
  const rows = new Map();
  const catalog = new Set(inventory.secrets);
  if (!catalog.size || !inventory.jobs.length) return ['production credential inventory is empty'];
  for (const row of inventory.jobs) {
    const key = `${row.workflow}/${row.job}`;
    if (rows.has(key)) errors.push(`${key}: duplicate inventory row`);
    rows.set(key, row);
  }
  for (const [file, source] of workflows) {
    const read = readWorkflow(file, source);
    if (read.problems) {
      errors.push(...read.problems);
      // Its jobs were not read, so its inventory rows are neither confirmed nor stale.
      for (const [key, row] of rows) if (row.workflow === file) rows.delete(key);
      continue;
    }
    const { jobs, on, ...settings } = read.value;
    const triggers = typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on);
    const isPr = triggers.some(trigger => ['pull_request', 'pull_request_target'].includes(trigger));
    const global = secretReads({ on, ...settings }, catalog);
    for (const reason of global.errors) errors.push(`${file}: ${reason}`);
    if (global.names.length) errors.push(`${file}: workflow-level secret access outside a job: ${global.names.join(', ')}`);
    for (const [job, definition] of Object.entries(jobs)) {
      const key = `${file}/${job}`;
      const { names, errors: readErrors } = secretReads(definition, catalog);
      for (const reason of readErrors) errors.push(`${key}: ${reason}`);
      if (definition.secrets === 'inherit') errors.push(`${key}: name reusable workflow secrets explicitly`);
      if (!names.length) continue;
      const preview = legacyPreview(file, job, triggers, names);
      if (isPr && !preview) errors.push(`${key}: pull request workflow reads ${names.join(', ')}`);
      const row = rows.get(key);
      if (!row) {
        errors.push(`${key}: missing credential inventory row`);
        continue;
      }
      rows.delete(key);
      if (!sameNames(names, row.secrets)) errors.push(`${key}: update inventory secrets (${names.join(', ')})`);
      if (!sameNames(triggers, row.triggers)) errors.push(`${key}: update inventory triggers (${triggers.join(', ')})`);
      const env = definition.environment;
      const actual = typeof env === 'object' && env ? env.name : env;
      // The disabled compute host already has its own protected preview environment (D4557).
      const computePreview = key === 'agent-compute-preview.yml/deploy_disabled_host' &&
        sameNames(triggers, ['workflow_dispatch']) && sameNames(names, ['CLOUDFLARE_API_TOKEN']);
      const allowed = preview ? [null] : computePreview ? ['agent-compute-preview'] : ['production', 'production-ops', 'production-backup', 'production-monitoring'];
      if (!allowed.includes(row.environment) || (actual ?? null) !== row.environment) {
        errors.push(`${key}: expected a literal ${allowed.includes(row.environment) ? row.environment : allowed.join(' or ')} environment`);
      }
    }
  }
  for (const key of rows.keys()) errors.push(`${key}: inventory job no longer reads a listed secret`);
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = join(ROOT, '.github/workflows');
  const workflows = readdirSync(directory).filter(file => /\.ya?ml$/i.test(file))
    .map(file => [file, readFileSync(join(directory, file), 'utf8')]);
  const issues = checkProductionCredentials(workflows, JSON.parse(readFileSync(join(ROOT, INVENTORY), 'utf8')));
  if (issues.length) {
    console.error(`✖ production-credentials:\n${issues.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ production-credentials: checked ${workflows.length} workflows`);
  }
}
