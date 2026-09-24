#!/usr/bin/env node
/**
 * A timestamp is never compared as a bare column (D124, D125).
 *
 * THE BUG THIS EXISTS FOR. SQLite has no date type. A timestamp is TEXT and a
 * comparison is a lexicographic string compare, so two formats that look alike
 * do not compare alike:
 *
 *     new Date(...).toISOString()   ->  2026-09-16T10:41:47.120Z
 *     CURRENT_TIMESTAMP / 'now'     ->  2026-09-16 10:56:47
 *
 * Position 10 decides it: 'T' (0x54) beats ' ' (0x20). So while the DATE halves
 * match, an ISO string is ALWAYS the greater one — and a TTL written that way
 * does not expire until the UTC date rolls over, up to ~24 hours late. It went
 * the other way too: an ISO `start_at` compared bare listed meetings that had
 * already finished as upcoming.
 *
 * WHY A LEXICAL RULE RATHER THAN "CHECK THE WRITER". Whether a given site is
 * broken depends on the format its column is WRITTEN in, which a scanner cannot
 * see — and three of the columns the audit found are unvalidated passthroughs of
 * caller JSON, so their format is not even decided in this repo. Normalising the
 * stored value makes the writer's format stop mattering, so the rule that can be
 * checked is also the rule that is correct: wrap the column.
 *
 * WHY THERE IS NO ALLOWLIST, and why that was worth four extra edits. The audit
 * found 75 comparison sites carrying FIVE idioms, three of them correct by
 * different means. Four sites were already correct because their writers emit
 * SQL format — they were converted anyway, so this file needs no ledger of
 * exceptions. `scripts/check-inline-project-pickers.mjs` shows what the other
 * shape costs: a baseline that has to be curated, and that goes stale.
 *
 * WHAT IT DOES NOT CATCH, stated so nobody reads a green run as more than it is.
 * A column compared against a BOUND PARAMETER (`created_at >= ?`) is the same
 * defect and is invisible here, because the format lives at the bind site. That
 * is how `rpc/branchOps.ts` came to drop every row dated on a quarter's first
 * day. Finding those needs the bind traced, which is a different tool.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(process.cwd(), 'cloudflare-worker/src');
const NAME = 'check-timestamp-comparisons';
const problems = [];

/** Columns whose whole purpose is to be compared against the clock. */
// D135 — `respond_by` joins them the same commit its table is created in
// (migration 264, `admin_notices`). A deadline swept against the clock is
// exactly what this guard exists for, and the list has no allowlist to fall
// back on: a column outside it is a column nobody is watching. Adding the name
// here and the column there in one commit is what keeps that true — the
// alternative is a guard that covers everything except the newest instance.
// `due_at` joined the list with D143, in the same change that gave
// `hq_escalations.due_at` its first reader. It is the sharpest instance the list
// has: the column is written from JavaScript as ISO-8601 (`rpc/hqOps.ts`) while
// `created_at` and `updated_at` on the SAME row default to `datetime('now')`, so
// one table carries both formats and a bare comparison against the clock is
// wrong in a way that only shows when a UTC date rolls over.
// `occurred_at` joined with D200, in the commit that creates
// `security_events.occurred_at` (migration 282). The retention sweep, the
// WHEN-guarded delete seal and both counts on the Security page compare it
// against the clock, so it belongs on the list the day it has a comparison.
// `attempted_at` joined with D204, in the commit that gives
// `tickets.github_sync_attempted_at` (migration 273) its first comparison
// against the clock — HQ Support's mirror strip counts the last 24 hours of
// attempts. The name is matched as a suffix, so it covers that column without
// naming its table.
// `scheduled_for` joined with D250, in the commit that gives it its first
// comparison: the scheduled-post sweep reads Telegram and X rows due by the
// tick's minute. The column has held ISO strings, SQL strings and strings
// with an offset, so it is exactly the column this guard exists for.
const TTL_COLUMN = '(?:expires_at|valid_until|confirm_expires_at|starts_at|start_at|respond_by|due_at|occurred_at|attempted_at|scheduled_for)';
// D250 — A COLUMN COMPARED AGAINST A BOUND CLOCK. The sweep binds its clock as
// `?`, so the clock-literal pattern below could never see a bare comparison
// of `scheduled_for`. For the columns listed here the guard also refuses a
// bare `?` comparand. The list is deliberately narrow: widening it to every
// TTL column would flag 16 existing comparisons against bound values whose
// format each call site controls, and those are not this change's to re-open.
const BOUND_CLOCK_COLUMN = '(?:scheduled_for)';
const BARE_BOUND = new RegExp(`(?<!datetime\\()\\b[a-z_]*\\.?${BOUND_CLOCK_COLUMN}\\s*[<>]=?\\s*\\?`);
// A bare column on the left of a comparison against the clock. The negative
// lookbehind lets `datetime(expires_at)` through and nothing else.
const BARE_TTL = new RegExp(
  `(?<!datetime\\()\\b[a-z_]*\\.?${TTL_COLUMN}\\s*[<>]=?\\s*(?:CURRENT_TIMESTAMP|datetime\\('now)`,
);
// CURRENT_TIMESTAMP is fine as a DEFAULT and as a SET value; never as a comparand.
const CT_COMPARED = /(?:[<>]=?\s*CURRENT_TIMESTAMP|CURRENT_TIMESTAMP\s*[<>]=?)/;

/** A comment line cannot be SQL, and this file's own prose must not trip it. */
const isComment = (line) => /^\s*(?:\/\/|\/\*|\*)/.test(line);

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.isFile() || !/\.ts$/.test(e.name)) continue;
    let src;
    try {
      src = readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    const rel = p.slice(resolve(process.cwd()).length + 1);
    src.split('\n').forEach((line, i) => {
      if (isComment(line)) return;
      if (CT_COMPARED.test(line)) {
        problems.push(`${rel}:${i + 1}  CURRENT_TIMESTAMP is compared — use datetime(column) vs datetime('now')`);
      } else if (BARE_BOUND.test(line)) {
        problems.push(`${rel}:${i + 1}  a timestamp column is compared bare against a bound clock — wrap both: datetime(${BARE_BOUND.exec(line)[0].split(/\s*[<>]/)[0].trim()}) <= datetime(?)`);
      } else if (BARE_TTL.test(line)) {
        problems.push(`${rel}:${i + 1}  a timestamp column is compared bare — wrap it: datetime(${BARE_TTL.exec(line)[0].split(/\s*[<>]/)[0].trim()})`);
      }
    });
  }
}

walk(ROOT);

if (problems.length) {
  console.error(`✖ ${NAME}: ${problems.length} timestamp comparison(s) read a bare column.`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  SQLite compares timestamps as TEXT and an ISO string sorts ABOVE a');
  console.error("  space-separated one on the same date, so a bare comparison does not");
  console.error('  mean what it says. Normalise the STORED column — wrapping only the');
  console.error("  right-hand side in datetime('now') changes nothing. See D124/D125.");
  process.exit(1);
}
console.log(`✓ ${NAME}: every timestamp comparison normalises its column.`);
