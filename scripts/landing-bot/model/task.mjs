// #6473: the model runner's task file and hard caps, validated before any model or command runs.
/**
 * A caller (the conflict resolver, main repair, red-PR repair) describes one
 * job for the model runner as a task file:
 *
 *   { "version": 1,
 *     "instructions": "what to fix, in prose",
 *     "allowed_files": ["frontend/src/lib/x.js", ...],   // the only files a patch may touch
 *     "verify": [["npm", "ci", "--ignore-scripts"], ["node", "--test", "frontend/test/x.test.mjs"]],
 *     "data": { "ci-log.txt": "...", "pr-title.txt": "..." },  // untrusted text, shown to the model as data
 *     "max_turns": 20, "max_minutes": 15, "max_rounds": 3 }
 *
 * The caps are clamped to HARD, which only an edit of this file (a T2 change
 * the owner lands) can raise. A caller asking for more gets HARD, not more.
 */
import { pathGuard } from '../rules.mjs';

export const HARD = Object.freeze({
  turns: 30,          // model calls per round, across providers
  minutes: 20,        // wall clock per edit round
  rounds: 3,          // one edit, then at most 2 more after a failed verify
  files: 40,          // allowed_files entries
  verifyCommands: 6,
  verifyMinutes: 20,  // per verify round, all commands together
  instructionsChars: 8_000,
  dataBytes: 200_000, // all data files together
  taskBytes: 300_000,
});

/** The programs a verify command may start. Arguments are passed without a shell. */
export const VERIFY_PROGRAMS = Object.freeze(['node', 'npm', 'npx']);

const DATA_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const intIn = (v, max, fallback) => (Number.isSafeInteger(v) && v >= 1 ? Math.min(v, max) : fallback);

/** A repository-relative path a patch may touch: no traversal, no `.git`, no absolute or odd characters. */
export function safeRelativePath(p) {
  if (typeof p !== 'string' || !p || p.length > 300) return false;
  if (p.startsWith('/') || p.startsWith('-') || p.includes('\\') || p.includes('\0')) return false;
  if (/[\u0000-\u001f\u007f]/.test(p)) return false;
  const parts = p.split('/');
  return parts.every((s) => s && s !== '.' && s !== '..') && parts[0] !== '.git' && !parts.includes('.git');
}

/**
 * Parse and validate a task. Returns `{ task, errors }`; `task` is null when
 * there is any error. Every allowed file must also clear the landing bot's
 * `pathGuard` (protected paths, anything merge-policy.mjs rates T2).
 */
export function parseTask(input) {
  const errors = [];
  let raw = input;
  if (typeof input === 'string') {
    if (Buffer.byteLength(input) > HARD.taskBytes) return { task: null, errors: [`the task is larger than ${HARD.taskBytes} bytes`] };
    try { raw = JSON.parse(input); } catch { return { task: null, errors: ['the task is not JSON'] }; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { task: null, errors: ['the task is not an object'] };
  if (raw.version !== 1) errors.push('version must be 1');

  const instructions = typeof raw.instructions === 'string' ? raw.instructions.trim() : '';
  if (!instructions) errors.push('instructions are empty');
  if (instructions.length > HARD.instructionsChars) errors.push(`instructions are longer than ${HARD.instructionsChars} characters`);

  const allowed = Array.isArray(raw.allowed_files) ? raw.allowed_files : null;
  if (!allowed || !allowed.length) errors.push('allowed_files is empty');
  else if (allowed.length > HARD.files) errors.push(`allowed_files has more than ${HARD.files} entries`);
  else {
    for (const p of allowed) if (!safeRelativePath(p)) errors.push(`allowed file ${JSON.stringify(String(p).slice(0, 80))} is not a safe relative path`);
    if (new Set(allowed).size !== allowed.length) errors.push('allowed_files repeats a path');
    if (allowed.every(safeRelativePath)) {
      const guard = pathGuard(allowed.map((path) => ({ path })));
      for (const r of guard.refused) errors.push(`allowed file ${r.path} is refused: ${r.reason}`);
    }
  }

  const verify = Array.isArray(raw.verify) ? raw.verify : null;
  if (!verify || !verify.length) errors.push('verify has no command');
  else if (verify.length > HARD.verifyCommands) errors.push(`verify has more than ${HARD.verifyCommands} commands`);
  else {
    verify.forEach((argv, i) => {
      if (!Array.isArray(argv) || !argv.length || !argv.every((a) => typeof a === 'string' && a.length <= 300 && !a.includes('\0'))) {
        errors.push(`verify command ${i + 1} is not a list of strings`);
      } else if (!VERIFY_PROGRAMS.includes(argv[0])) {
        errors.push(`verify command ${i + 1} starts ${JSON.stringify(argv[0])}; only ${VERIFY_PROGRAMS.join(', ')} may run`);
      }
    });
  }

  const data = raw.data ?? {};
  if (typeof data !== 'object' || Array.isArray(data)) errors.push('data must be an object of name to text');
  else {
    let bytes = 0;
    for (const [name, text] of Object.entries(data)) {
      if (!DATA_NAME.test(name)) errors.push(`data name ${JSON.stringify(name.slice(0, 80))} is not a plain file name`);
      if (typeof text !== 'string') errors.push(`data ${name} is not text`);
      else bytes += Buffer.byteLength(text);
    }
    if (bytes > HARD.dataBytes) errors.push(`data is larger than ${HARD.dataBytes} bytes`);
  }

  if (errors.length) return { task: null, errors };
  return {
    task: Object.freeze({
      version: 1,
      instructions,
      allowed_files: Object.freeze([...allowed]),
      verify: Object.freeze(verify.map((a) => Object.freeze([...a]))),
      data: Object.freeze({ ...data }),
      max_turns: intIn(raw.max_turns, HARD.turns, HARD.turns),
      max_minutes: intIn(raw.max_minutes, HARD.minutes, HARD.minutes),
      max_rounds: intIn(raw.max_rounds, HARD.rounds, HARD.rounds),
    }),
    errors: [],
  };
}

/** A branch of this repository the runner may check out: a plain ref name, never an expression or option. */
export function safeRef(ref) {
  return typeof ref === 'string' && ref.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) &&
    !ref.includes('..') && !ref.endsWith('/') && !ref.endsWith('.lock') && !ref.includes('//');
}
