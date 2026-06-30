#!/usr/bin/env node
/**
 * Tail-consumer topology guard.
 *
 * Prevents the production "Handler does not export a tail() function." error
 * flood from ever recurring via a repo change. That incident was caused by a
 * REVERSE tail-consumer binding (studioos-tail -> studioos): the consumer
 * worker was wired as a producer, so Cloudflare invoked `studioos.tail()`,
 * which the main worker does not export (it only exports fetch()/scheduled()).
 *
 * Producer -> consumer wiring is owned ENTIRELY by the root `wrangler.toml`.
 * The `studioos` (producer) worker declares `studioos-tail` under BOTH
 * `[[tail_consumers]]` (top-level / plain `wrangler deploy`) and
 * `[[env.production.tail_consumers]]` (the `--env production` path) — kept in
 * lockstep because Wrangler envs do NOT inherit binding tables. The
 * `studioos-tail` (consumer) worker must NEVER declare a tail consumer.
 *
 * This guard FAILS the build when:
 *   1. cloudflare-worker-tail/wrangler.toml declares ANY tail_consumers table
 *      (the consumer must never act as a producer), or
 *   2. root wrangler.toml does NOT declare `service = "studioos-tail"` under
 *      BOTH [[tail_consumers]] AND [[env.production.tail_consumers]].
 *
 * Wired into `npm run test:drift`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_WRANGLER = path.join(ROOT, 'wrangler.toml');
const TAIL_WRANGLER = path.join(ROOT, 'cloudflare-worker-tail', 'wrangler.toml');

const CONSUMER_SERVICE = 'studioos-tail';

// Strip a TOML line comment (`#` to EOL) while respecting quoted strings, so a
// `#` inside a value isn't mistaken for a comment and a commented-out
// `# [[tail_consumers]]` note isn't mistaken for a real table header.
function stripComment(line) {
  let inStr = false;
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === quote) inStr = false;
    } else if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
    } else if (c === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

// Parse a TOML file into ordered sections keyed by their table-header name (the
// text between the brackets, e.g. "tail_consumers" or
// "env.production.tail_consumers"). Comments and blank lines are ignored.
function parseSections(text) {
  const sections = [];
  let current = { name: null, body: [] };
  for (const raw of text.split('\n')) {
    const line = stripComment(raw).trimEnd();
    const header = line.trim().match(/^\[\[?\s*([^[\]]+?)\s*\]\]?$/);
    if (header) {
      sections.push(current);
      current = { name: header[1].trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  sections.push(current);
  return sections;
}

function isTailConsumerTable(name) {
  return name === 'tail_consumers' || /(^|\.)tail_consumers$/.test(name);
}

function sectionDeclaresService(section, service) {
  const re = new RegExp(`^\\s*service\\s*=\\s*["']${service}["']\\s*$`);
  return section.body.some((l) => re.test(l));
}

function readFileOrExit(file) {
  if (!fs.existsSync(file)) {
    console.error(
      `\u2716 check-tail-consumer: expected file not found: ${path.relative(ROOT, file)}`,
    );
    process.exit(2);
  }
  return fs.readFileSync(file, 'utf8');
}

const errors = [];

// (1) The consumer worker must declare NO tail-consumer table at all.
{
  const sections = parseSections(readFileOrExit(TAIL_WRANGLER));
  const offending = sections.filter((s) => s.name && isTailConsumerTable(s.name));
  if (offending.length) {
    errors.push(
      `cloudflare-worker-tail/wrangler.toml declares a tail-consumer table ` +
        `([[${offending[0].name}]]). The consumer worker must NEVER be a tail ` +
        `producer — a reverse binding makes Cloudflare invoke studioos.tail() ` +
        `(which doesn't exist), flooding observability with errors. Remove it.`,
    );
  }
}

// (2) The root (producer) config must declare studioos-tail under BOTH the
//     top-level and the production tail-consumer tables, in lockstep.
{
  const sections = parseSections(readFileOrExit(ROOT_WRANGLER));
  const top = sections.find((s) => s.name === 'tail_consumers');
  const prod = sections.find((s) => s.name === 'env.production.tail_consumers');

  if (!top || !sectionDeclaresService(top, CONSUMER_SERVICE)) {
    errors.push(
      `wrangler.toml is missing the top-level [[tail_consumers]] block with ` +
        `service = "${CONSUMER_SERVICE}". The live (plain \`wrangler deploy\`) ` +
        `producer binding depends on it.`,
    );
  }
  if (!prod || !sectionDeclaresService(prod, CONSUMER_SERVICE)) {
    errors.push(
      `wrangler.toml is missing [[env.production.tail_consumers]] with ` +
        `service = "${CONSUMER_SERVICE}". Wrangler envs do NOT inherit binding ` +
        `tables, so the \`--env production\` deploy needs its own copy in lockstep.`,
    );
  }
}

if (errors.length) {
  console.error('\u2716 check-tail-consumer: tail-consumer topology is unsafe:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  '\u2713 check-tail-consumer: producer wiring in lockstep; consumer declares no tail consumers.',
);
