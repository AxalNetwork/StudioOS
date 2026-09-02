#!/usr/bin/env node
/**
 * Money is stored as an integer number of cents.
 *
 * Two rules, both narrow enough to be facts rather than opinions:
 *
 *   1. A column named `*_cents` must be declared INTEGER. A REAL cents column
 *      is the worst of both worlds — the name promises exactness and the type
 *      does not deliver it.
 *   2. A NEW column holding an amount of currency must be named `*_cents` and
 *      declared INTEGER, or be recorded in the baseline as one of the legacy
 *      dollar columns.
 *
 * THE SECOND RULE IS FORWARD-LOOKING ON PURPOSE. This schema already speaks
 * both dialects: 31 `*_cents` columns (orders, syndicates, commissions,
 * payouts, liquidity, expert bookings, events) and about as many legacy REAL
 * dollar columns (LP commitments, capital calls, distributions, NAV, portfolio
 * holdings, cap-table prices). Converting the legacy half is a data migration
 * over live fiduciary records, not a lint fix, and it is not attempted here.
 * What this check buys is that the split stops growing: a new table cannot
 * quietly pick the float dialect.
 *
 * CLASSIFICATION IS THE HARD PART, and a regex over column names gets it
 * wrong in both directions. A first pass matched 138 "money-ish" columns and
 * was confidently wrong about a fifth of them: `score_snapshots.capital_total`
 * and its eight siblings are SCORES; `deals.management_fee_pct`,
 * `vc_funds.carried_interest` (0.20) and `vc_funds.management_fee` (0.02) are
 * FRACTIONS; `fx_rates.usd_rate` is an EXCHANGE RATE; `cap_table_vesting.
 * total_shares` is a COUNT. None of them is an amount of currency, and a check
 * that demanded cents of any of them would be demanding nonsense. So the
 * exclusions below are explicit and each carries its reason, rather than being
 * a cleverer pattern nobody can audit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'scripts/money-cents-baseline.json');

function walk(dir, exts) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

/** Column names that denote an amount of currency. */
const MONEY = /(^|_)(amount|price|cost|revenue|mrr|arr|burn|payout|commission|earnings|spend|budget|salary|proceeds|principal|valuation|commitment|contributed|called|distributed|nav|balance|market_cap|hourly_rate)(_|$)|_usd$|_cents$|_dollars$/i;

/**
 * Suffixes that turn a money word into something else entirely. `distributed_at`
 * is a timestamp, `principal_key` is a security principal, `revenue_range` and
 * `ticket_band` are labels, `revenue_info` is prose.
 *
 * `_bps` joins `_pct` and `_ratio` here: basis points are a RATE, and a rate is
 * definitionally not an amount of currency. `revenue_share_bps` — 3500 for a
 * 35% share — is the shape this rule wants encouraged, since an integer count
 * of basis points has the same exactness argument behind it that integer cents
 * do. Without this the guard would demand cents of a percentage.
 */
const NOT_AN_AMOUNT_SUFFIX = /_(at|key|id|range|band|info|notes|model|text|label|type|status|pct|percent|bps|ratio|multiple|count|currency)$/i;

/**
 * Names the pattern above catches that are not money. Each is here because it
 * was checked, not because it looked awkward.
 */
const NOT_MONEY = new Map([
  ['management_fee_pct', 'a percentage'],
  ['application_fee_pct', 'a percentage'],
  ['management_fee', 'a fraction — vc_funds defaults it to 0.02'],
  ['carried_interest', 'a fraction — vc_funds defaults it to 0.20'],
  ['usd_rate', 'an exchange rate, not an amount'],
  ['total_shares', 'a share count'],
  ['capital_total', 'a score component'],
  ['capital_burn_traction', 'a score component'],
  ['capital_cost_mvp', 'a score component'],
  ['capital_time_revenue', 'a score component'],
  ['market_total', 'a score component'],
  ['product_total', 'a score component'],
  ['team_total', 'a score component'],
  ['fit_total', 'a score component'],
  ['distribution_total', 'a score component'],
  ['total_score', 'a score'],
  ['revenue_model', 'prose describing a model'],
  ['revenue_notes', 'prose'],
  ['price_band', 'a band label, not an amount'],
  ['ticket_band', 'a band label'],
  ['budget_band', 'a band label'],
  ['amount_band', 'a band label'],
  ['cost_band', 'a band label'],
]);

export function isMoney(col) {
  const c = col.toLowerCase();
  if (NOT_MONEY.has(c)) return false;
  if (NOT_AN_AMOUNT_SUFFIX.test(c) && !/_cents$/.test(c)) return false;
  return MONEY.test(c);
}

/**
 * The float types. The rule is about NUMERIC storage of money: a TEXT column
 * named `revenue_range` or `cost_to_mvp` is a label or a sentence, not an
 * amount stored badly, and demanding cents of it would be demanding nonsense.
 */
const FLOATISH = /^(REAL|FLOAT|DOUBLE|NUMERIC|DECIMAL)$/;

/** table.column -> [{type, rel, line}] for every declared column. */
export function declaredColumns() {
  const typed = new Map();
  const push = (table, col, type, rel, line) => {
    const k = `${table.toLowerCase()}.${col.toLowerCase()}`;
    if (!typed.has(k)) typed.set(k, []);
    typed.get(k).push({ type: type.toUpperCase(), rel, line });
  };
  const files = walk(path.join(ROOT, 'cloudflare-worker/sql'), ['.sql'])
    .concat(walk(path.join(ROOT, 'cloudflare-worker/src'), ['.ts']));
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);
    // A table rebuild's SCRATCH table is not a new declaration. The SQLite
    // rebuild idiom creates the target shape under a temporary name, copies
    // rows in, drops the original and renames the temporary into the freed
    // name — so `service_offerings_new.price_usd` is `service_offerings`'s
    // own column mid-flight, not a fifty-third float money column. Counting
    // it as new asks the baseline to record a table name that exists for the
    // length of one migration and can never be converted, which is a ledger
    // entry that outlives the thing it records.
    const scratch = new Set(
      [...src.matchAll(/ALTER\s+TABLE\s+[`"[]?(\w+)[`"\]]?\s+RENAME\s+TO\s+[`"[]?(\w+)/gi)]
        .filter((m) => new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?[\`"\\[]?${m[1]}\\b`, 'i').test(src))
        .map((m) => m[1].toLowerCase()),
    );
    for (const m of src.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?(\w+)[`"\]]?\s*\(/gi)) {
      if (scratch.has(m[1].toLowerCase())) continue;
      let depth = 0, i = m.index + m[0].length - 1;
      const start = i + 1;
      for (; i < src.length; i += 1) {
        if (src[i] === '(') depth += 1;
        else if (src[i] === ')') { depth -= 1; if (depth === 0) break; }
      }
      if (depth !== 0) continue;
      const line = src.slice(0, start).split('\n').length;
      for (const decl of src.slice(start, i).replace(/--.*$/gm, '').split(/,(?![^(]*\))/)) {
        const c = /^\s*[`"[]?([a-z_]\w*)[`"\]]?\s+([A-Za-z]+)/.exec(decl);
        if (!c) continue;
        if (['primary', 'unique', 'foreign', 'check', 'constraint'].includes(c[1].toLowerCase())) continue;
        push(m[1], c[1], c[2], rel, line);
      }
    }
    for (const m of src.matchAll(/ALTER\s+TABLE\s+[`"[]?(\w+)[`"\]]?\s+ADD\s+(?:COLUMN\s+)?[`"[]?([a-z_]\w*)[`"\]]?\s+([A-Za-z]+)/gi)) {
      push(m[1], m[2], m[3], rel, src.slice(0, m.index).split('\n').length);
    }
  }
  return typed;
}

const INTEGERISH = /^(INTEGER|INT|BIGINT)$/;

/** Money columns stored as a float. */
export function floatMoney() {
  const bad = new Map();
  for (const [k, list] of declaredColumns()) {
    const col = k.split('.').slice(1).join('.');
    if (!isMoney(col)) continue;
    for (const d of list) {
      if (!FLOATISH.test(d.type)) continue;   // integer already, or not a stored amount
      if (!bad.has(k)) bad.set(k, []);
      bad.get(k).push(`${d.rel}:${d.line} (${d.type})`);
    }
  }
  return bad;
}

/** `*_cents` columns declared as anything but an integer — never acceptable. */
export function nonIntegerCents() {
  const bad = [];
  for (const [k, list] of declaredColumns()) {
    if (!/_cents$/.test(k)) continue;
    for (const d of list) if (!INTEGERISH.test(d.type)) bad.push(`${k}  ${d.type}  ${d.rel}:${d.line}`);
  }
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hardFail = nonIntegerCents();
  if (hardFail.length) {
    console.error('✖ check-money-cents: a *_cents column is not an integer:\n');
    for (const b of hardFail) console.error(`  ${b}`);
    console.error('\nThe name promises exact minor units. REAL does not deliver them.');
    process.exit(1);
  }

  const found = floatMoney();
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).columns ?? {};
  const added = [...found.keys()].filter((k) => !(k in baseline)).sort();
  const resolved = Object.keys(baseline).filter((k) => !found.has(k)).sort();

  if (added.length) {
    console.error('✖ check-money-cents: a money column that is not integer cents:\n');
    for (const k of added) {
      console.error(`  ${k}`);
      for (const w of [...new Set(found.get(k))]) console.error(`      ${w}`);
    }
    console.error('\nMoney is stored as an integer number of cents. Name the column');
    console.error('`<thing>_cents` and declare it INTEGER.');
    console.error('\nIf the column is not an amount of currency — a percentage, a rate, a');
    console.error('score, a count — add it to NOT_MONEY in scripts/check-money-cents.mjs');
    console.error('with the reason, rather than to the baseline.');
    process.exit(1);
  }

  if (resolved.length) {
    console.error('✖ check-money-cents: baseline entries that are no longer float money:\n');
    for (const k of resolved) console.error(`  ${k}`);
    console.error('\nDelete them from scripts/money-cents-baseline.json — a ledger of legacy');
    console.error('dollar columns is only worth reading if every line in it is still true.');
    process.exit(1);
  }

  const cents = [...declaredColumns().keys()].filter((k) => /_cents$/.test(k)).length;
  const n = Object.keys(baseline).length;
  console.log(
    `✓ check-money-cents: ${cents} cents columns, all integer; `
    + `${n} legacy dollar column${n === 1 ? '' : 's'} on record and not growing.`,
  );
}
