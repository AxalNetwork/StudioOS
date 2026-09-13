#!/usr/bin/env node
/**
 * Every `kind: 'handler'` zone action has a page that supplies its handler.
 *
 * WHY THIS EXISTS. `zoneActionBuilder.js` drops a handler action whose page did
 * not supply the callback:
 *
 *     const bound = typeof supplied === 'function' ? { onClick: supplied } : supplied;
 *     if (typeof bound?.onClick !== 'function') return null;
 *
 * That is right at runtime — a control that cannot do anything should not be
 * drawn — and it is silent. The registry says the op exists, the page forgot to
 * pass it, and the button simply is not there. No warning, no console message,
 * and nothing in the test suite: the table and the page each look correct in
 * isolation, and only their pairing is wrong.
 *
 * It is the same failure shape as the dead `service_offerings.partner_id` read —
 * two files that agree with themselves and not with each other — and it surfaces
 * to a customer identically: as a feature that was asked for and appears to be
 * missing. Four such reports arrived in one afternoon before this existed.
 *
 * WHAT IS AND IS NOT A FAILURE. An entry is satisfied when EVERY page that
 * renders that zone key passes its handler name. An entry no page renders at all
 * is also a failure — a registered op on an unreachable zone is dead weight, and
 * the registry is the only place that still claims it works.
 *
 * `unbuilt`, `export`, `to` and plain key-based entries are not checked here:
 * none of them depends on a page-supplied callback. `unbuilt` is deliberately
 * invisible and `zoneFilterBuilder.js` argues that case; `export` binds itself
 * from the `view` payload.
 *
 * THREE CALL SHAPES ARE ALL RESOLVED, and the first draft of this script got
 * that wrong in a way worth recording: it read `handlers: { … }` and the
 * `{ handlers }` shorthand, but not `handlers: opsHandlers` — a named object
 * declared above the call. Four live advisor ops were reported as dropped when
 * `SessionsZone.jsx` supplies every one of them. A checker that over-reports is
 * worse than none, because the first person to read it stops believing the rest.
 *
 * A FOURTH SHAPE CROSSES A PROP BOUNDARY, and missing it was the second round of
 * false positives. `/network/*` and `/research/*` are one component serving four
 * licences, so `zoneActionsByRole.js` picks the table and the workspace hands the
 * bound function DOWN as a prop:
 *
 *     <AskZone zoneActions={(rows, handlers) =>
 *       zoneActionsFor(role, 'research/ask', { handlers, view: … })} />
 *
 * The handler names are then supplied by the child, at `zoneActions(visible,
 * { newSession, savedAnswers })`. Reading only the workspace would report eight
 * live ops across four licences as dropped. So each `zoneActionsFor` binding is
 * followed to the JSX element that receives it, and that component's own file is
 * read for the names. The role there is a variable, so the binding counts for
 * every licence's table — which is exactly what `zoneActionsFor` does at runtime.
 *
 * WHERE IT STOPS, AND WHY IT SAYS SO. `/network/*` drills the bound function
 * through THREE components — `NetworkWorkspace` → `NetworkPage` →
 * `RelationshipsPanel` — and only the last supplies the names. Chasing arbitrary
 * prop depth is a program-analysis problem, not a grep, and a checker that guesses
 * at it produces exactly the over-reporting this file already had to correct
 * twice. So a binding whose immediate child passes `zoneActions` on again is
 * counted as NOT STATICALLY CHECKED and printed as a number, the way
 * `check-sqlite-columns.mjs` prints its raw-interpolated skips rather than
 * guessing through them. What is reported is what is certain.
 *
 * THE ROLE IS PART OF THE KEY. `network/relationships` exists in more than one
 * licence's table and is rendered by a different page in each, so a partner
 * entry must be checked against `partnerZoneActions(…)` calls only. Matching on
 * the zone key alone reported the partner ops as missing from the founder,
 * advisor and investor pages, which do not and should not supply them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'frontend', 'src');
const WORKSPACES = path.join(SRC, 'workspaces');

function walk(dir, ext) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, ext));
    else if (ext.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

/** `{ … }` starting at `open`, brace-matched, so a nested object cannot end it early. */
function block(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') { depth -= 1; if (depth === 0) return text.slice(open, i + 1); }
  }
  return null;
}

/** `[ … ]` starting at `open`, bracket-matched. */
function arrayBlock(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '[') depth += 1;
    else if (text[i] === ']') { depth -= 1; if (depth === 0) return text.slice(open, i + 1); }
  }
  return null;
}

/**
 * Every `kind: 'handler'` entry in the four registries.
 * → [{ role, zone, handler, file, line }]
 */
export function registeredHandlers() {
  const out = [];
  for (const file of walk(WORKSPACES, ['ZoneActions.js'])) {
    const role = path.basename(file).replace('ZoneActions.js', '');
    const text = fs.readFileSync(file, 'utf8');
    // Zone keys are quoted and followed by an array literal: `'pipeline/leads': [`
    for (const m of text.matchAll(/'([a-z0-9-]+\/[a-z0-9-]+)':\s*\[/g)) {
      const arr = arrayBlock(text, m.index + m[0].length - 1);
      if (!arr) continue;
      for (const h of arr.matchAll(/kind:\s*'handler'\s*,\s*handler:\s*'([A-Za-z0-9_$]+)'/g)) {
        out.push({
          role,
          zone: m[1],
          handler: h[1],
          file: path.relative(ROOT, file),
          line: text.slice(0, m.index + h.index).split('\n').length,
        });
      }
      // The two orders are equally valid JS and both appear in the tree.
      for (const h of arr.matchAll(/handler:\s*'([A-Za-z0-9_$]+)'\s*,\s*kind:\s*'handler'/g)) {
        out.push({
          role,
          zone: m[1],
          handler: h[1],
          file: path.relative(ROOT, file),
          line: text.slice(0, m.index + h.index).split('\n').length,
        });
      }
    }
  }
  return out;
}

/**
 * Every page call: which zone key it renders and which handler names it supplies.
 * → Map<zoneKey, Array<{ file, supplied: Set<string> }>>
 */
/** Handler names out of an object literal's top level. */
function keysOf(obj) {
  const out = new Set();
  let depth = 0;
  for (let i = 0; i < obj.length; i += 1) {
    const c = obj[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (depth === 1) {
      const k = /^[\s,]*([A-Za-z0-9_$]+)\s*[:,}]/.exec(obj.slice(i));
      if (k) { out.add(k[1]); i += k[0].length - 2; }
    }
  }
  return out;
}

/** Every `zoneActions(…)` call in a child file, and the names it supplies. */
function suppliedBy(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = new Set();
  // `zoneActions(rows, { a, b })` and `zoneActions(kind, rows, { a, b })`
  for (const c of text.matchAll(/zoneActions\(/g)) {
    const open = text.indexOf('{', c.index);
    const close = text.indexOf(')', c.index);
    if (open < 0 || (close >= 0 && close < open)) continue;
    const obj = block(text, open);
    if (obj) for (const k of keysOf(obj)) out.add(k);
  }
  // `zoneActions(rows, handlers)` — a named object declared in the child.
  for (const c of text.matchAll(/zoneActions\([^)]*?,\s*([A-Za-z0-9_$]+)\s*\)/g)) {
    const decl = new RegExp(`const\\s+${c[1]}\\s*=\\s*\\{`).exec(text);
    if (!decl) continue;
    const obj = block(text, decl.index + decl[0].length - 1);
    if (obj) for (const k of keysOf(obj)) out.add(k);
  }
  return out;
}

/**
 * Every binding of a zone key to the handler names some page supplies for it.
 * → Map<`role:zone`, Array<{ file, supplied, deferred }>>
 *
 * Both call forms are treated the same, because they differ only in which table
 * they reach: `<role>ZoneActions('key', …)` names the licence in the callee,
 * `zoneActionsFor(role, 'key', …)` passes it as a value and so counts for all
 * four. What matters either way is where `handlers` comes from — an object in
 * this file, or a parameter filled in by a child.
 */
export function callSites() {
  const sites = new Map();
  const byName = new Map();
  for (const f of walk(SRC, ['.jsx'])) byName.set(path.basename(f, '.jsx'), f);

  const record = (roles, zone, entry) => {
    for (const role of roles) {
      const key = `${role}:${zone}`;
      if (!sites.has(key)) sites.set(key, []);
      sites.get(key).push(entry);
    }
  };

  for (const file of walk(SRC, ['.jsx'])) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    const calls = [
      ...[...text.matchAll(/([a-z]+)ZoneActions\(\s*'([a-z0-9-]+\/[a-z0-9-]+)'\s*,\s*\{/g)]
        .map((m) => ({ m, roles: [m[1]], zone: m[2], optsAt: m.index + m[0].length - 1 })),
      ...[...text.matchAll(/zoneActionsFor\(\s*[A-Za-z0-9_$]+\s*,\s*'([a-z0-9-]+\/[a-z0-9-]+)'\s*,\s*\{/g)]
        .map((m) => ({ m, roles: ['founder', 'investor', 'partner', 'advisor'], zone: m[1], optsAt: m.index + m[0].length - 1 })),
    ];
    for (const call of calls) {
      const opts = block(text, call.optsAt);
      if (!opts) continue;
      const inline = /handlers:\s*\{/.exec(opts);
      if (inline) {
        const obj = block(opts, inline.index + inline[0].length - 1);
        record(call.roles, call.zone, { file: rel, supplied: obj ? keysOf(obj) : new Set(), deferred: false });
        continue;
      }
      const named = /handlers:\s*([A-Za-z0-9_$]+)\s*[,}]/.exec(opts);
      const shorthand = /[{,]\s*handlers\s*[,}]/.test(opts);
      if (!named && !shorthand) {
        record(call.roles, call.zone, { file: rel, supplied: new Set(), deferred: false });
        continue;
      }
      const varName = named ? named[1] : 'handlers';
      const decl = new RegExp(`const\\s+${varName}\\s*=\\s*\\{`).exec(text);
      if (decl) {
        const obj = block(text, decl.index + decl[0].length - 1);
        record(call.roles, call.zone, { file: rel, supplied: obj ? keysOf(obj) : new Set(), deferred: false });
        continue;
      }
      // No declaration here: `handlers` is a parameter the CHILD fills in.
      // Follow one hop to the JSX element receiving the bound function.
      const tags = [...text.slice(0, call.m.index).matchAll(/<([A-Z][A-Za-z0-9_]*)\b/g)];
      const child = tags.length ? tags[tags.length - 1][1] : null;
      const childFile = child ? byName.get(child) : null;
      if (!childFile) {
        record(call.roles, call.zone, { file: `${rel} → <${child || '?'}>`, supplied: new Set(), deferred: true });
        continue;
      }
      const ctext = fs.readFileSync(childFile, 'utf8');
      record(call.roles, call.zone, {
        file: path.relative(ROOT, childFile),
        supplied: suppliedBy(childFile),
        // The child drills it further still — below what this can read.
        deferred: /zoneActions=\{/.test(ctext),
      });
    }
  }
  return sites;
}

export const coverage = { checked: 0, deferred: 0 };

export function unsuppliedHandlers() {
  const sites = callSites();
  const bad = [];
  coverage.checked = 0;
  coverage.deferred = 0;
  for (const entry of registeredHandlers()) {
    const pages = sites.get(`${entry.role}:${entry.zone}`) || [];
    if (!pages.length) { coverage.checked += 1; bad.push({ ...entry, why: 'no page renders this zone key' }); continue; }
    // Supplied anywhere in the chain counts; deferred pages are not evidence
    // either way, so a key reached only through them is left unchecked.
    if (pages.some((p) => p.supplied.has(entry.handler))) { coverage.checked += 1; continue; }
    if (pages.every((p) => p.deferred)) { coverage.deferred += 1; continue; }
    coverage.checked += 1;
    const missing = pages.filter((p) => !p.supplied.has(entry.handler) && !p.deferred);
    bad.push({ ...entry, why: `not supplied by ${missing.map((p) => p.file).join(', ')}` });
  }
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = registeredHandlers();
  const bad = unsuppliedHandlers();
  if (bad.length) {
    console.error('\n❌ Zone actions registered as handlers that no page supplies:\n');
    for (const b of bad) {
      console.error(`  ${b.role} ${b.zone} → ${b.handler}()`);
      console.error(`      ${b.file}:${b.line} — ${b.why}`);
    }
    console.error(`\n${bad.length} of ${all.length} handler actions render NOTHING at runtime.`);
    console.error(`
zoneActionBuilder.js drops a handler action whose callback the page did not
supply, silently — so the registry claims an op the customer cannot see.

Either supply the handler on the page that renders that zone, or remove the
entry (or make it 'unbuilt' with the reason nothing performs it yet).
`);
    process.exit(1);
  }
  console.log(
    `✓ check-zone-handlers: ${coverage.checked} of ${all.length} handler actions across `
    + `${new Set(all.map((h) => h.role)).size} licences are supplied by the page that renders them `
    + `(${coverage.deferred} not statically checked — bound through a component that drills the `
    + `prop further; see this file's header).`,
  );
}
