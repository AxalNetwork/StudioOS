/**
 * #6467: the test helper every landing-bot workflow's test calls. `assertWorkflow(path)` reads the workflow file
 * and throws when it
 *   1. passes the App token to a dispatch call (an App token starts workflows on its own; dispatch with GITHUB_TOKEN),
 *   2. dispatches a workflow outside `dispatchable` (rules.mjs), or one it cannot name, or
 *   3. names an App or model secret anywhere but a job in the `landing-bot` or `repair` environment.
 *
 * It reads YAML by indentation, with no parser, and fails closed: what it cannot place (a dispatch target written
 * as an expression, a secret above `jobs:`) is a problem, not a pass.
 */
import { readFileSync } from 'node:fs';
import { dispatchable as DISPATCHABLE } from './rules.mjs';

export const ENVIRONMENTS = Object.freeze(['landing-bot', 'repair']);
export const APP_SECRET = /\bsecrets\.(LANDING_BOT_APP_[A-Z0-9_]+)\b/g;
export const MODEL_SECRET = /\bsecrets\.((?:ANTHROPIC|OPENAI|GEMINI|GOOGLE_AI|LANDING_BOT_MODEL)_[A-Z0-9_]*)\b/g;

const indent = (line) => line.length - line.trimStart().length;
const meaningful = (line) => line.trim() !== '' && !line.trimStart().startsWith('#');
const unquote = (s) => String(s ?? '').trim().replace(/^['"]|['"]$/g, '');
const base = (p) => unquote(p).replace(/^\.\//, '').split('/').pop();

/** Top-level text outside `jobs:`, and each job's id, environment and steps. */
export function parseJobs(text) {
  const lines = String(text).split('\n');
  const top = [];
  const jobs = [];
  let inJobs = false;
  let job = null;
  let jobIndent = null;
  for (const line of lines) {
    if (!meaningful(line)) { if (job) job.lines.push(line); continue; }
    const ind = indent(line);
    if (ind === 0) {
      inJobs = /^jobs:\s*$/.test(line);
      job = null; jobIndent = null;
      if (!inJobs) top.push(line);
      continue;
    }
    if (!inJobs) { top.push(line); continue; }
    if (jobIndent === null) jobIndent = ind;
    if (ind === jobIndent) {
      const m = /^\s*([\w-]+):\s*$/.exec(line);
      job = { id: m ? m[1] : line.trim(), lines: [] };
      jobs.push(job);
      continue;
    }
    if (job) job.lines.push(line);
  }
  for (const j of jobs) {
    j.environment = environmentOf(j.lines);
    j.steps = stepsOf(j.lines);
  }
  return { top: top.join('\n'), jobs };
}

function environmentOf(lines) {
  const keyIndent = Math.min(...lines.filter(meaningful).map(indent));
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (indent(l) !== keyIndent) continue;
    const m = /^\s*environment:\s*(.*)$/.exec(l);
    if (!m) continue;
    if (unquote(m[1])) return unquote(m[1]);
    for (let k = i + 1; k < lines.length && (!meaningful(lines[k]) || indent(lines[k]) > keyIndent); k++) {
      const n = /^\s*name:\s*(.+)$/.exec(lines[k]);
      if (n) return unquote(n[1]);
    }
    return null;
  }
  return null;
}

function stepsOf(lines) {
  const steps = [];
  let cur = null;
  let stepIndent = null;
  let inSteps = false;
  let stepsKeyIndent = null;
  for (const l of lines) {
    if (!meaningful(l)) { if (cur) cur.push(l); continue; }
    const ind = indent(l);
    if (/^\s*steps:\s*$/.test(l)) { inSteps = true; stepsKeyIndent = ind; stepIndent = null; continue; }
    if (!inSteps) continue;
    if (ind <= stepsKeyIndent) { inSteps = false; cur = null; continue; }
    if (/^\s*-\s/.test(l) && (stepIndent === null || ind === stepIndent)) {
      stepIndent = ind;
      cur = [l];
      steps.push(cur);
      continue;
    }
    if (cur) cur.push(l);
  }
  return steps.map((s) => s.join('\n'));
}

/** The dispatch targets a step names; an expression or unnamed target is `null`. */
export function dispatchTargets(step) {
  const out = [];
  for (const m of step.matchAll(/\bgh\s+workflow\s+run\s+([^\s\\]+)/g)) out.push(m[1].includes('${{') ? null : base(m[1]));
  for (const m of step.matchAll(/\/actions\/workflows\/([^/\s'"]+)\/dispatches/g)) out.push(m[1].includes('${{') ? null : base(m[1]));
  if (/createWorkflowDispatch\s*\(/.test(step)) {
    const ids = [...step.matchAll(/workflow_id\s*:\s*([^,}\n]+)/g)].map((m) => m[1]);
    if (!ids.length) out.push(null);
    for (const id of ids) out.push(/^\s*['"][\w.-]+['"]\s*$/.test(id) ? base(id) : null);
  }
  return out;
}

/** Problems with one workflow's text; an empty list means it passes. */
export function checkWorkflow(text, { dispatchable = DISPATCHABLE, environments = ENVIRONMENTS } = {}) {
  const problems = [];
  const allowed = new Set(dispatchable.map(base));
  const { top, jobs } = parseJobs(text);
  const secretsIn = (s) => [...s.matchAll(APP_SECRET), ...s.matchAll(MODEL_SECRET)].map((m) => m[1]);

  for (const name of secretsIn(top)) problems.push(`secret ${name} is named outside a job, so outside the ${environments.join(' or ')} environment`);

  for (const job of jobs) {
    const body = job.lines.join('\n');
    if (!environments.includes(job.environment)) {
      for (const name of new Set(secretsIn(body))) problems.push(`job ${job.id}: secret ${name} outside the ${environments.join(' or ')} environment (environment: ${job.environment ?? 'none'})`);
    }
    const appTokenSteps = job.steps
      .filter((s) => /uses:\s*actions\/create-github-app-token@/.test(s))
      .map((s) => /^\s*-?\s*id:\s*([\w-]+)/m.exec(s.replace(/^\s*-\s/, '  '))?.[1])
      .filter(Boolean);
    for (const step of job.steps) {
      const targets = dispatchTargets(step);
      if (!targets.length) continue;
      for (const t of targets) {
        if (t === null) problems.push(`job ${job.id}: a dispatch whose workflow cannot be read`);
        else if (!allowed.has(t)) problems.push(`job ${job.id}: dispatches ${t}, which is not in dispatchable`);
      }
      // Plain string checks, no RegExp built from the file: a step id is [\w-]+, and a near-miss only adds a problem.
      const usesApp = /\bsecrets\.LANDING_BOT_APP_/.test(step) || appTokenSteps.some((id) => step.includes(`steps.${id}.outputs.token`));
      if (usesApp) problems.push(`job ${job.id}: passes the App token to a dispatch call`);
    }
  }
  return problems;
}

export function checkWorkflowFile(path, opts) {
  return checkWorkflow(readFileSync(path, 'utf8'), opts);
}

/** Throws with every problem, for a test to call: `assertWorkflow('.github/workflows/landing-bot-keeper.yml')`. */
export function assertWorkflow(path, opts) {
  const problems = checkWorkflowFile(path, opts);
  if (problems.length) throw new Error(`${path}:\n- ${problems.join('\n- ')}`);
  return true;
}
