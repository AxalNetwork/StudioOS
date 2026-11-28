/**
 * #8523 — the reader behind scripts/build-stripe-inventory.mjs: every `stripeCall()` in the Worker with its
 * method, Stripe path, whether it moves money, and whether it sends an idempotency key and from what.
 *
 * Reading rules, all static (no Stripe call, no network):
 *   · A call is `stripeCall(env, path, body, opts)`, with a type argument allowed. The definition is skipped.
 *   · `method` is the `method:` literal in `opts`; absent means POST, as `stripeCall` does.
 *   · `path` is the second argument when it is a string or template literal, `${…}` collapsed to `:x`; else
 *     null (a dynamic path, read from a variable).
 *   · A POST moves money when its path matches MONEY_PATHS below: a create that takes money, a refund, a
 *     transfer, a payout, a credit note, a confirm or capture or pay, a balance entry, or a change to a
 *     subscription (a proration can bill).
 *   · `key` is the text of `idempotencyKey:` in `opts`, or null. Its `source` is
 *       none      no key;
 *       random    the key text holds a random or clock value (randomUUID, Math.random, Date.now), so a retry
 *                 sends a different key and Stripe cannot dedupe it. (A client's per-press `nonce` is not
 *                 random: it is the same on a retry of that press.);
 *       param     a bare member the function was handed (`opts.idempotencyKey`): the caller's choice, which
 *                 the reader cannot follow, so a money-moving call with one needs an allowlist reason;
 *       stable    anything else: built from the order, the invoice, the user, the period. A bare local
 *                 identifier is read through its `const` in the same file and classified by that.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Stripe paths a POST to which moves money. `x` stands for any id segment. */
export const MONEY_PATHS = [
  /^\/(checkout\/sessions|subscriptions|subscription_items|subscription_schedules|invoices|invoiceitems|quotes|payment_intents|payment_links|charges)$/,
  /^\/(refunds|transfers|payouts|credit_notes|topups)$/,
  /^\/(payment_intents|charges)\/[^/]+\/(confirm|capture|cancel|increment_authorization)$/,
  /^\/invoices\/[^/]+\/(pay|finalize|void|mark_uncollectible)$/,
  /^\/(subscriptions|subscription_items|subscription_schedules)\/[^/]+(\/cancel|\/release)?$/,
  /^\/customers\/[^/]+\/balance_transactions$/,
  /^\/transfers\/[^/]+\/reversals$/,
  /^\/charges\/[^/]+\/refund$/,
];

const RANDOM = /\b(?:randomUUID|getRandomValues|Math\.random|Date\.now)\b|new Date\(\)/;

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(n) ? [p] : [];
  });
}

/** The path with `${…}` collapsed to `:x` and its query string and trailing slash removed. */
export function normalizePath(path) {
  if (path === null) return null;
  return path.split('?')[0].replace(/\$\{[^}]*\}/g, ':x').replace(/\/+$/, '') || '/';
}

export function movesMoney(method, path) {
  if (method !== 'POST' || path === null) return false;
  const p = normalizePath(path).replace(/:x/g, 'x');
  return MONEY_PATHS.some((re) => re.test(p));
}

export function sourceOf(keyText) {
  if (keyText === null) return 'none';
  if (RANDOM.test(keyText)) return 'random';
  if (/^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*$/.test(keyText)) return 'param';
  return 'stable';
}

/** A bare identifier key read through the nearest `const name = …;` above the call in the same file. */
function resolveLocal(src, upTo, name) {
  const re = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  let last = null; let m;
  const head = src.slice(0, upTo);
  while ((m = re.exec(head))) if (m[1] === name) last = m;
  if (!last) return null;
  const rest = src.slice(last.index + last[0].length, last.index + last[0].length + 600);
  const end = rest.search(/;\s*\n/);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

/** The top-level arguments of the call whose `(` ends just before `start`. */
function argsAt(src, start) {
  const args = []; let depth = 1; let i = start; let argStart = start; let quote = null;
  for (; i < src.length && depth > 0; i += 1) {
    const ch = src[i];
    if (quote) { if (ch === '\\') { i += 1; continue; } if (ch === quote) quote = null; continue; }
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) { depth -= 1; if (depth === 0) break; }
    else if (ch === ',' && depth === 1) { args.push(src.slice(argStart, i).trim()); argStart = i + 1; }
  }
  args.push(src.slice(argStart, i).trim());
  return args;
}

/** The value of `idempotencyKey:` up to the next top-level comma or closing brace. */
function idempotencyKeyText(opts) {
  const m = /(?:^|[{,\s])idempotencyKey\s*:\s*/.exec(opts);
  if (!m) return /[{,]\s*idempotencyKey\s*[,}]/.test(opts) ? 'idempotencyKey' : null;
  let depth = 0; let quote = null; const start = m.index + m[0].length; let i = start;
  for (; i < opts.length; i += 1) {
    const ch = opts[i];
    if (quote) { if (ch === '\\') { i += 1; continue; } if (ch === quote) quote = null; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) { if (depth === 0) break; depth -= 1; }
    else if (ch === ',' && depth === 0) break;
  }
  return opts.slice(start, i).trim();
}

/** Every `stripeCall` in `files` ([{ rel, src }]) as an inventory row. */
export function readCalls(files) {
  const out = [];
  for (const { rel, src } of files) {
    const re = /\bstripeCall(?:<[^(]*?>)?\(/g;
    let m;
    while ((m = re.exec(src))) {
      if (/function\s+$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue; // the definition
      const args = argsAt(src, m.index + m[0].length);
      const lit = /^(['`])((?:\\.|(?!\1)[\s\S])*)\1$/.exec(args[1] ?? '');
      const opts = args[3] ?? '';
      const method = /\bmethod:\s*'(GET|DELETE|POST)'/.exec(opts)?.[1] ?? 'POST';
      let keyText = opts ? idempotencyKeyText(opts) : null;
      let via = null;
      if (keyText !== null && /^[A-Za-z_$][\w$]*$/.test(keyText)) {
        const resolved = resolveLocal(src, m.index, keyText);
        if (resolved !== null) { via = keyText; keyText = resolved; }
      }
      const path = lit ? lit[2] : null;
      out.push({
        file: rel, line: src.slice(0, m.index).split('\n').length, method,
        path: normalizePath(path), dynamicPath: path === null,
        moneyMoving: movesMoney(method, path), key: keyText === null ? null : keyText.replace(/\s+/g, ' ').slice(0, 160), via, source: sourceOf(keyText),
      });
    }
  }
  return out;
}

export function readFiles(srcDir) {
  return walk(srcDir).map((p) => ({ rel: relative(srcDir, p).split('\\').join('/'), src: readFileSync(p, 'utf8') }));
}

/**
 * Other Stripe clients: a `fetch(` whose URL is built from the Stripe API or Connect host. They send no
 * idempotency key; the inventory records them so a money-moving POST through one is not invisible.
 */
export function readRawClients(files) {
  const out = [];
  for (const { rel, src } of files) {
    if (!/api\.stripe\.com|connect\.stripe\.com|STRIPE_API|STRIPE_CONNECT/.test(src)) continue;
    const re = /\bfetch\(\s*(`[^`]*`|'[^']*'|[A-Za-z_$][\w$.]*)/g;
    let m;
    while ((m = re.exec(src))) {
      const url = m[1];
      if (!/stripe\.com|STRIPE_API|STRIPE_CONNECT/.test(url)) continue;
      const args = argsAt(src, m.index + m[0].indexOf('(') + 1);
      const method = /\bmethod:\s*'(GET|DELETE|POST)'/.exec(args[1] ?? '')?.[1] ?? 'GET';
      const path = url.replace(/^[`']|[`']$/g, '').replace(/^\$\{STRIPE_(?:API|CONNECT)\}/, '').replace(/^https:\/\/[a-z.]+stripe\.com(?:\/v1)?/, '').replace(/\$\{[^}]*\}/g, ':x');
      out.push({ file: rel, line: src.slice(0, m.index).split('\n').length, method, path: path || '/', moneyMoving: movesMoney(method, path.replace(/^\/v1/, '') || '/') });
    }
  }
  return out;
}

/** The most calls and money-moving calls the reader must find, so an empty or mis-pointed scan cannot pass. */
export const FLOOR = { calls: 100, moneyMoving: 15 };

/**
 * The guard. `allowlist` is [{ file, path, count, reason }]: the money-moving POSTs that send no stable key on
 * purpose, `count` of them to `path` in `file`. Returns the problems, empty when the tree is clean.
 *   · a money-moving POST with no key, a random key, or a key the reader cannot follow (`param`), and no entry;
 *   · a POST to a path the reader cannot read (a variable), since it cannot be classified;
 *   · an allowlist entry with no reason, one that matches no unkeyed call, or whose count is wrong (stale);
 *   · a raw Stripe client (fetch) POST to a money-moving path, which sends no key at all;
 *   · fewer calls than FLOOR.
 */
export function checkInventory({ calls, rawClients = [] }, allowlist) {
  const errors = [];
  if (calls.length < FLOOR.calls) errors.push(`only ${calls.length} stripeCall sites found; the floor is ${FLOOR.calls}, so the scan is broken`);
  if (calls.filter((c) => c.moneyMoving).length < FLOOR.moneyMoving) errors.push(`fewer than ${FLOOR.moneyMoving} money-moving calls found; the scan is broken`);
  const unkeyed = calls.filter((c) => c.moneyMoving && c.source !== 'stable');
  const used = new Map();
  for (const c of unkeyed) {
    const entry = allowlist.find((a) => a.file === c.file && a.path === c.path);
    if (entry) { used.set(entry, (used.get(entry) ?? 0) + 1); continue; }
    const why = c.source === 'none' ? 'sends no idempotency key'
      : c.source === 'random' ? `sends a random or clock key (${c.key}), which a retry does not repeat`
        : `takes its key from its caller (${c.key}), which this check cannot follow`;
    errors.push(`${c.file}:${c.line} POST ${c.path} moves money and ${why}. Derive a key from the order, invoice, user or period (util/stripeKey.ts), or add it to the allowlist in scripts/build-stripe-inventory.mjs with the reason.`);
  }
  for (const c of calls.filter((c) => c.method === 'POST' && c.dynamicPath)) {
    errors.push(`${c.file}:${c.line} POST to a path read from a variable: the check cannot tell whether it moves money. Pass the path as a literal.`);
  }
  for (const a of allowlist) {
    if (!a.reason || String(a.reason).trim().length < 20) errors.push(`allowlist ${a.file} ${a.path}: a reason is required`);
    const n = used.get(a) ?? 0;
    if (n === 0) errors.push(`allowlist ${a.file} ${a.path}: no unkeyed money-moving call matches any more; remove the entry`);
    else if (n !== a.count) errors.push(`allowlist ${a.file} ${a.path}: lists ${a.count} call(s) but ${n} are unkeyed; update the entry`);
  }
  for (const r of rawClients.filter((r) => r.moneyMoving && r.method === 'POST')) {
    errors.push(`${r.file}:${r.line} a raw Stripe client POSTs to ${r.path}, which moves money and sends no key. Use stripeCall with a key.`);
  }
  return errors;
}
