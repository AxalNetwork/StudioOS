#!/usr/bin/env node
/**
 * build-profile-routing — derive the profile routing map and the page
 * inventory instead of hand-maintaining them.
 *
 * WHY THIS IS GENERATED AND NOT WRITTEN
 *
 * The integration brief asks for a `profile-routing-map.md` and a
 * `page-inventory.md`: canvas → role workspace → nav section → surface type →
 * entry point → confidence. Every one of those facts already exists in the
 * repository, in two files that are themselves kept honest by other guards:
 *
 *   • `documentation/architecture/ROUTE_MAP.md` — one row per canvas, with the
 *     persona, the proposed route, the route that is actually live, the worker
 *     files behind it, and the CURRENT/UPGRADE/NEW/… status.
 *   • `frontend/src/sidebarConfig.js` — the single source of truth for which
 *     role sees which destination, under which collapsible group.
 *
 * Hand-copying those into a third document creates a third thing to keep in
 * sync, and this repository has already paid for that mistake three times in
 * one day: a deploy runbook that hardcoded a migration range, a cutover doc
 * that hardcoded a route-table size, and a production doc that cited a line
 * number. Each was true when written and a lie within a week. So the routing
 * map is a projection of the two sources, regenerated on demand and checked by
 * `frontend/test/profile_routing_fresh.test.mjs` — if ROUTE_MAP or the sidebar
 * changes and this is not re-run, the build fails.
 *
 * Only the columns that genuinely cannot be derived are hand-held, and they
 * live in ONE small table below (`SURFACE_OVERRIDES`) rather than scattered
 * through prose.
 *
 * Usage:  node scripts/build-profile-routing.mjs [--check]
 *   (no flag)  rewrite the two generated documents
 *   --check    exit 1 if either document is out of date, printing the drift
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const ROUTE_MAP = 'documentation/architecture/ROUTE_MAP.md';
const SIDEBAR = 'frontend/src/sidebarConfig.js';
const OUT_ROUTING = 'documentation/architecture/PROFILE_ROUTING.md';
const OUT_INVENTORY = 'documentation/architecture/PAGE_INVENTORY.md';

/* ------------------------------------------------------------------ *
 * 1. ROUTE_MAP.md → one record per canvas
 * ------------------------------------------------------------------ */

const HEADER = /^\| Canvas \| Persona \| Proposed route \| Live route today \|/;

export function parseRouteMap(src) {
  const out = [];
  let inTable = false;
  for (const line of src.split('\n')) {
    if (HEADER.test(line)) { inTable = true; continue; }
    if (!inTable) continue;
    if (/^\|\s*---/.test(line)) continue;
    if (!line.startsWith('| ')) { inTable = false; continue; }
    // Cells are ' | '-delimited. Notes cells contain no bare ' | ' — every
    // pipe inside them is inside backticks — so a plain split is sound, but
    // guard the arity anyway: a malformed row must fail loudly, not silently
    // shift every column one to the left.
    const cells = line.replace(/^\|\s?/, '').replace(/\s?\|$/, '').split(' | ');
    if (cells.length < 7) {
      throw new Error(`ROUTE_MAP row has ${cells.length} cells, expected >= 7:\n  ${line.slice(0, 120)}`);
    }
    out.push({
      canvas: cells[0].trim(),
      persona: cells[1].trim(),
      proposed: cells[2].trim(),
      live: cells[3].trim(),
      backend: cells[4].trim(),
      status: cells[5].trim(),
      notes: cells.slice(6).join(' | ').trim(),
    });
  }
  return out;
}

/** Pull every `/route` token out of a ROUTE_MAP route cell. */
export function routesIn(cell) {
  const found = [];
  for (const m of cell.matchAll(/`([^`]+)`/g)) {
    for (const tok of m[1].split(/[,·\s]+/)) {
      if (tok.startsWith('/')) found.push(tok.replace(/[.,;)]+$/, ''));
    }
  }
  return [...new Set(found)];
}

/* ------------------------------------------------------------------ *
 * 2. sidebarConfig.js → role → [{ group, label, to, match[] }]
 * ------------------------------------------------------------------ *
 * Parsed as text, not imported: the module pulls in lucide-react icons, and
 * every other test in frontend/test/ reads it as a string for the same
 * reason. Comment lines are dropped first so a commented-out destination
 * (there is one — the X broadcaster) is not reported as a live nav entry.
 */
export function parseSidebar(src) {
  const raw = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  // An item object may wrap across lines, and `match:` is usually the part
  // that wraps. Reading only the first line silently produced an empty match
  // list for every wrapped row — which is how /build/team, owned by Grow, was
  // reported under Build. Join each `{ to: …` line to the lines that follow
  // until its closing brace, so the whole object is parsed.
  const lines = [];
  for (let i = 0; i < raw.length; i += 1) {
    let line = raw[i];
    if (/\{\s*to:\s*'/.test(line)) {
      while (!/\}\s*,?\s*$/.test(line.trim()) && i + 1 < raw.length) {
        i += 1;
        line = `${line.trimEnd()} ${raw[i].trim()}`;
      }
    }
    lines.push(line);
  }
  const roles = {};
  let role = null, group = null;
  for (const line of lines) {
    const r = line.match(/^\s{2}([a-z_]+):\s*\[/);
    if (r) { role = r[1]; roles[role] = []; group = null; continue; }
    if (!role) continue;
    const g = line.match(/\{\s*key:\s*'([^']+)',\s*label:\s*'([^']*)'/);
    if (g) { group = g[2] || 'Headerless'; continue; }
    const it = line.match(/\{\s*to:\s*'([^']+)'[^}]*?label:\s*'([^']+)'/);
    if (it && group) {
      const mm = line.match(/match:\s*\[([^\]]*)\]/);
      const match = mm ? [...mm[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
      roles[role].push({ group, label: it[2], to: it[1], match });
    }
  }
  return roles;
}

/* ------------------------------------------------------------------ *
 * 3. Persona free-text → the workspaces this repo actually ships
 * ------------------------------------------------------------------ *
 * The brief names five workspaces. This codebase ships SIX role sidebars
 * (`SIDEBAR_GROUPS` keys) because Partner/Operator is a real, separately
 * onboarded licence — see ASSUMPTIONS_LOG.md A2. Three further buckets are
 * not workspaces at all and are labelled as such rather than being forced
 * into one: shell components, surfaces shared across workspaces, and
 * pre-login public pages.
 */
const WORKSPACES = [
  ['Founder', 'founder'],
  ['Advisor', 'advisor'],
  ['LP / Investor', 'investor'],
  ['Partner / Operator', 'partner'],
  ['Subsidiary Admin', 'admin'],
  ['Super Admin', 'super_admin'],
  ['Shell (all workspaces)', null],
  ['Shared (multi-workspace)', null],
  ['Public (pre-login)', null],
  ['Unassigned — no persona in ROUTE_MAP', null],
];
const SIDEBAR_ROLE = new Map(WORKSPACES);

export function workspacesFor(persona) {
  const p = persona.toLowerCase();
  const hits = new Set();
  if (/founder/.test(p)) hits.add('Founder');
  if (/advisor/.test(p)) hits.add('Advisor');
  if (/investor|\blp\b/.test(p)) hits.add('LP / Investor');
  if (/partner/.test(p)) hits.add('Partner / Operator');
  if (/super-admin/.test(p)) hits.add('Super Admin');
  // "admin" alone means the territory licensee console; "admin (GP)" and
  // "admin (internal)" are HQ, so they go to Super Admin as well.
  if (/(^|[^-])\badmin\b/.test(p)) {
    hits.add(/\((gp|internal)\)/.test(p) ? 'Super Admin' : 'Subsidiary Admin');
  }
  if (/chrome/.test(p)) hits.add('Shell (all workspaces)');
  if (/shared/.test(p)) hits.add('Shared (multi-workspace)');
  if (/public/.test(p)) hits.add('Public (pre-login)');
  // A blank persona cell is not an oversight to paper over — the one row that
  // has one is a known stale duplicate ROUTE_MAP recommends deleting. Name the
  // bucket so it reads as a finding rather than a gap in this generator.
  if (!hits.size) hits.add('Unassigned — no persona in ROUTE_MAP');
  return [...hits];
}

/* ------------------------------------------------------------------ *
 * 4. Surface type
 * ------------------------------------------------------------------ *
 * The brief's rule: FULL PAGE by default for dashboards, tables, reporting,
 * settings, workflows, approvals, contracts and analytics; modal or drawer
 * only for a confirmation, a short form, a quick review, or an accept/decline.
 * That default is right for all but a handful of canvases, so the default is
 * applied and only the exceptions are written down.
 */
const SURFACE_OVERRIDES = new Map([
  ['Send for Signature', ['Full page + 5-step wizard', 'The send flow is a page (`/legal/send`), not a modal: step 3 requires reviewing every AI-filled merge field before a human confirms, which does not fit a drawer.']],
  ['Emails', ['Templates (no surface)', 'Transactional email bodies rendered by the worker. Not a route.']],
  ['Fund Brief One-Pager', ['Full page + print stylesheet', 'Read as a document and printed; the print layout is the point.']],
  ['Quarterly Report', ['Full page + print stylesheet', 'Same: an LP reads and files it.']],
  ['Graduation Certificate', ['Full page + print stylesheet', 'Issued artefact.']],
  ['System Sheet', ['Reference (no surface)', 'The token census. Shipped as the Tailwind `@theme` block, not a page.']],
  ['GP Application Review', ['Full page + review drawer', 'The queue is a page; a single application opens in a drawer for the accept/decline, which is exactly the brief’s drawer case.']],
]);

export function surfaceFor(rec, liveRoutes) {
  const o = SURFACE_OVERRIDES.get(rec.canvas);
  if (o) return o[0];
  if (/chrome/i.test(rec.persona)) return 'Embedded rail';
  if (rec.status === 'OUT OF SCOPE') return 'Full page (Spin-Out Lab — frozen)';
  if (liveRoutes.length) return 'Full page';
  return 'Full page (proposed)';
}

/* ------------------------------------------------------------------ *
 * 5. Join + render
 * ------------------------------------------------------------------ */

function navFor(roles, roleKey, liveRoutes) {
  if (!roleKey || !roles[roleKey]) return null;
  for (const route of liveRoutes) {
    for (const item of roles[roleKey]) {
      if (item.to === route) return item;
    }
  }
  // `match` is the complete statement of what a row owns, and an explicit
  // claim outranks every row's implicit `to` prefix — one row's `to` can be a
  // prefix of paths another row owns (`/build` is the Build overview, while
  // `/build/discovery` is Validate's and `/build/team` is Grow's). Same rule
  // as `manualActive` in ui/SidebarNav.jsx, so the doc reports the row that
  // actually highlights.
  for (const route of liveRoutes) {
    for (const item of roles[roleKey]) {
      if (item.match.some((m) => route === m || route.startsWith(m + '/'))) return item;
    }
  }
  for (const route of liveRoutes) {
    for (const item of roles[roleKey]) {
      if (!item.match.length && route.startsWith(item.to + '/')) return item;
    }
  }
  return null;
}

function confidenceFor(rec, liveRoutes, nav) {
  if (rec.status === 'OUT OF SCOPE') return 'High';
  if (liveRoutes.length && nav) return 'High';
  if (liveRoutes.length) return 'Medium';
  return 'Low';
}

// ROUTE_MAP.md is itself a markdown table, so its cells arrive with pipes the
// author already escaped by hand — `/pipeline/screening\|commit\|transactions`.
// Escaping that again produced `\\|`: GFM reads `\\` as an escaped backslash and
// then treats the pipe as a REAL column separator, which silently split four
// rows of the generated table into 11-13 cells against a 9-cell header.
//
// Normalise first, then escape exactly once. Idempotent, so a source cell that
// is already bare and one that is pre-escaped both come out as `\|` — one
// literal pipe, no stray backslash, column count intact.
//
// Escaping the backslashes instead (Copilot Autofix #444) repairs the column
// count but leaves the reader looking at `screening\|commit` — the source's own
// escape leaking into the rendered page.
const esc = (s) => String(s).replace(/\\\|/g, '|').replace(/\|/g, '\\|');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function build() {
  const recs = parseRouteMap(read(ROUTE_MAP));
  const roles = parseSidebar(read(SIDEBAR));

  const rows = [];
  for (const rec of recs) {
    let live = routesIn(rec.live);
    const proposed = routesIn(rec.proposed);
    // "same" / "same set" means the live cell repeats the proposed one.
    if (!live.length && /\bsame\b/.test(rec.live)) live = proposed;
    for (const ws of workspacesFor(rec.persona)) {
      const nav = navFor(roles, SIDEBAR_ROLE.get(ws), live.length ? live : proposed);
      rows.push({
        workspace: ws,
        canvas: rec.canvas,
        status: rec.status,
        route: live.length ? live : proposed,
        navSection: nav ? nav.group : (live.length ? '— (no nav entry)' : '— (not routed)'),
        trigger: nav ? `Sidebar → ${nav.group} → ${nav.label}` : (live.length ? 'Deep link / in-page action' : 'Not reachable yet'),
        surface: surfaceFor(rec, live),
        confidence: confidenceFor(rec, live, nav),
      });
    }
  }
  rows.sort((a, b) => {
    const oa = WORKSPACES.findIndex(([n]) => n === a.workspace);
    const ob = WORKSPACES.findIndex(([n]) => n === b.workspace);
    return (oa < 0 ? 99 : oa) - (ob < 0 ? 99 : ob) || a.canvas.localeCompare(b.canvas);
  });

  return { recs, roles, rows };
}

const STAMP = `<!-- GENERATED by scripts/build-profile-routing.mjs — do not hand-edit.
     Sources: ${ROUTE_MAP} + ${SIDEBAR}.
     Re-run: node scripts/build-profile-routing.mjs -->`;

function renderRouting({ recs, rows }) {
  const byWs = new Map();
  for (const r of rows) {
    if (!byWs.has(r.workspace)) byWs.set(r.workspace, []);
    byWs.get(r.workspace).push(r);
  }
  const L = [];
  L.push(STAMP, '');
  L.push('# PROFILE_ROUTING.md — canvas → workspace → nav section → surface');
  L.push('');
  L.push('The routing map the integration brief asks for, projected from the two');
  L.push('files that already hold the facts: `ROUTE_MAP.md` (canvas → route → backend');
  L.push('→ status) and `frontend/src/sidebarConfig.js` (role → group → destination).');
  L.push('Nothing here is typed by hand, so nothing here can disagree with them.');
  L.push('');
  L.push('**Read `ROUTE_MAP.md` first.** It is the authority on *what shipped* from');
  L.push('each canvas and why. This document answers a different question: *who sees');
  L.push('it, where in their nav, and how do they get there.*');
  L.push('');
  L.push(`**Corpus:** ${recs.length} canonical canvases at \`design/canvases/\`, listed`);
  L.push(`${rows.length} times below — a canvas serving two workspaces appears under both.`);
  L.push('');
  L.push('## Column meanings');
  L.push('');
  L.push('| Column | Derived from |');
  L.push('| --- | --- |');
  L.push('| Workspace | ROUTE_MAP `Persona`, normalised to the six shipped role sidebars plus three non-workspace buckets |');
  L.push('| Route | ROUTE_MAP `Live route today`, falling back to `Proposed route` where nothing is live |');
  L.push('| Nav section | The `SIDEBAR_GROUPS` group whose item matches that route for that role |');
  L.push('| Surface | The brief’s full-page default, with the exceptions listed in the generator |');
  L.push('| Entry point | The sidebar path, or how the surface is reached when it has no nav row |');
  L.push('| Confidence | High = live route reachable from that role’s nav. Medium = live route, no nav row. Low = not routed. |');
  L.push('');
  for (const [ws, list] of byWs) {
    L.push(`## ${ws} — ${plural(list.length, 'canvas', 'canvases')}`);
    L.push('');
    L.push('| Canvas | Route | Nav section | Surface | Entry point | Status | Confidence |');
    L.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of list) {
      const route = r.route.length ? r.route.map((x) => `\`${x}\``).join(' · ') : '—';
      L.push(`| ${esc(r.canvas)} | ${esc(route)} | ${esc(r.navSection)} | ${esc(r.surface)} | ${esc(r.trigger)} | ${esc(r.status)} | ${r.confidence} |`);
    }
    L.push('');
  }
  const conf = { High: 0, Medium: 0, Low: 0 };
  rows.forEach((r) => { conf[r.confidence]++; });
  L.push('## Confidence tally');
  L.push('');
  L.push('| Confidence | Rows | Meaning |');
  L.push('| --- | ---: | --- |');
  L.push(`| High | ${conf.High} | Live route, reachable from that workspace’s sidebar. |`);
  L.push(`| Medium | ${conf.Medium} | Live route, but no sidebar row for that role — reached by deep link or an in-page action. |`);
  L.push(`| Low | ${conf.Low} | Not routed. Proposed route only. |`);
  L.push('');
  L.push('A Medium row is not a defect. Detail pages (`/deals/:id`), print artefacts');
  L.push('and wizards are reached from the surface above them by design; the brief’s');
  L.push('own rule is that a nav row is for a destination, not for every screen.');
  L.push('');
  return L.join('\n');
}

function renderInventory({ recs, roles, rows }) {
  const L = [];
  L.push(STAMP, '');
  L.push('# PAGE_INVENTORY.md — every destination each workspace can reach');
  L.push('');
  L.push('The nav side of the same projection. `PROFILE_ROUTING.md` walks the');
  L.push('canvases; this walks the sidebar, so a destination that ships with no');
  L.push('canvas behind it still shows up here.');
  L.push('');
  const order = ['founder', 'advisor', 'investor', 'partner', 'admin', 'exploring'];
  const known = order.filter((k) => roles[k]);
  for (const k of Object.keys(roles)) if (!known.includes(k)) known.push(k);
  for (const role of known) {
    const items = roles[role];
    const groups = [...new Set(items.map((i) => i.group))];
    L.push(`## \`${role}\` — ${plural(items.length, 'destination')} in ${plural(groups.length, 'group')}`);
    L.push('');
    L.push('| Group | Label | Route | Canvas behind it |');
    L.push('| --- | --- | --- | --- |');
    for (const it of items) {
      const owners = rows
        .filter((r) => SIDEBAR_ROLE.get(r.workspace) === role && r.route.includes(it.to))
        .map((r) => r.canvas);
      const covered = owners.length
        ? [...new Set(owners)].join(', ')
        : '— (no canvas; shipped ahead of the design corpus)';
      L.push(`| ${esc(it.group)} | ${esc(it.label)} | \`${it.to}\` | ${esc(covered)} |`);
    }
    L.push('');
  }
  const uncovered = [];
  for (const role of known) {
    for (const it of roles[role]) {
      const hit = rows.some((r) => SIDEBAR_ROLE.get(r.workspace) === role && r.route.includes(it.to));
      if (!hit) uncovered.push(`${role} · ${it.group} · ${it.label} (\`${it.to}\`)`);
    }
  }
  L.push('## Destinations with no canvas');
  L.push('');
  L.push(`${uncovered.length} of the ${known.reduce((n, r) => n + roles[r].length, 0)} sidebar rows above are not claimed`);
  L.push('by any row in `ROUTE_MAP.md`. That is expected — the platform predates the');
  L.push('design corpus and not every shipped surface was redesigned — but the list is');
  L.push('worth keeping visible, because it is also where a canvas would be *missing*');
  L.push('rather than merely absent.');
  L.push('');
  for (const u of uncovered) L.push(`- ${u}`);
  L.push('');
  L.push(`**Canvas corpus:** ${recs.length}. **Workspace assignments:** ${rows.length}.`);
  L.push('');
  return L.join('\n');
}

/* ------------------------------------------------------------------ */

export function outputs() {
  const model = build();
  return [
    [OUT_ROUTING, renderRouting(model)],
    [OUT_INVENTORY, renderInventory(model)],
  ];
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const [path, text] of outputs()) {
    let current = null;
    try { current = read(path); } catch { /* first run */ }
    if (current === text) { if (!check) console.log(`  unchanged  ${path}`); continue; }
    if (check) {
      stale++;
      console.error(`STALE: ${path} does not match its sources.`);
      console.error('       Re-run: node scripts/build-profile-routing.mjs');
    } else {
      writeFileSync(resolve(ROOT, path), text);
      console.log(`  ${current === null ? 'created  ' : 'rewrote  '}  ${path}`);
    }
  }
  if (check && stale) process.exit(1);
  if (check) console.log('profile routing docs are current.');
}
