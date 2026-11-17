/** D5682: review the public source inventory without touching a delivery destination. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Parser } from 'acorn';
import jsx from 'acorn-jsx';
import { APP_PATH, routeModuleFiles } from '../frontend/test/_routesSource.mjs';
import { parseRouteMap, routesIn } from './build-profile-routing.mjs';
import { readRouteMap } from './lib/routeMap.mjs';
import { inventory } from './lib/authInventory.mjs';
import { trackedByGit } from './lib/generatedOutput.mjs';
import { clientSectionHint } from '../cloudflare-worker/src/util/clientSection.ts';
import { ROLE_REDIRECTS, FORWARD_REDIRECTS, REDIRECT_ROUTES } from '../cloudflare-worker/src/services/redirectRoutes.ts';

const parser = Parser.extend(jsx());
// Build output, gitignored and never committed (D5612): a committed copy went
// stale whenever another branch landed a route first and failed the merge queue.
export const output = 'documentation/architecture/SECTION_COVERAGE.md';
const formerOutput = 'documentation/architecture/decisions/D5682-p2.md';
const shells = ['super_admin', 'admin', 'branch_admin', 'founder', 'investor', 'partner', 'advisor', 'exploring'];
const menuFiles = [
  'frontend/src/sidebarConfig.js',
  'frontend/src/lib/licenceSidebar.js',
  'frontend/src/lib/personas.js',
  'frontend/src/ui/phone/AccountSheet.jsx',
  'frontend/src/ui/phone/CompanySheet.jsx',
  'frontend/src/pages/account/companies/CompanySettingsTabs.jsx',
  'frontend/src/pages/SettingsPage.jsx',
  'frontend/src/pages/team/ProjectSettingsPage.jsx',
];
const producerFiles = [
  'cloudflare-worker/src/services/sectionCapacityDelivery.ts',
  'cloudflare-worker/src/services/sectionSlackPreview.ts',
  'cloudflare-worker/src/routes/client_error.ts',
];
const sharedPrefixes = new Set(['account', 'admin', 'branch', 'hq', 'my', 'trust']);
const privateGate = /\b(?:guard|hqOnly|RequireAuth|requireAuth|requireAdmin|PrivateRoute|ProtectedRoute)\b/;
const linkCredential = /:(?:token|inviteCode|shareToken|accessToken)(?:[/?]|$)/i;
const forwarding = /\b(?:Navigate|\w*Redirect\w*|\w*Forward\w*)\b/;
const digest = items => createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 16);
const code = node => JSON.stringify(node, (key, value) => ['start', 'end', 'raw'].includes(key) ? undefined : value);
const string = node => {
  const value = node?.type === 'JSXExpressionContainer' ? node.expression : node;
  if (value?.type === 'Literal' && typeof value.value === 'string') return value.value;
  if (value?.type === 'TemplateLiteral' && value.expressions.length === 0) return value.quasis[0].value.cooked;
  return null;
};
const nodeName = node => node?.name ?? node?.value;
const prop = (node, key) => node.attributes.find(attr => nodeName(attr.name) === key);
const setText = items => [...new Set(items)].sort().join(', ') || '—';

function walk(node, visit, parents = []) {
  if (!node?.type) return;
  visit(node, parents);
  const next = [...parents, node];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) walk(child, visit, next);
    else walk(value, visit, next);
  }
}

function syntax(source) {
  return parser.parse(source, { sourceType: 'module', ecmaVersion: 'latest' });
}

export function declaredRoutes(source, file) {
  const routes = [];
  walk(syntax(source), (node, parents) => {
    if (node.type !== 'JSXOpeningElement' || nodeName(node.name) !== 'Route') return;
    const path = prop(node, 'path');
    if (!path && !prop(node, 'index')) return; // layout, handled as ancestor evidence
    const enclosing = parents.filter(parent => parent.type === 'JSXElement' && nodeName(parent.openingElement.name) === 'Route');
    const frames = enclosing.map(parent => parent.openingElement).filter(parent => parent !== node);
    const parentPath = frames.map(parent => prop(parent, 'path')).filter(Boolean);
    const own = string(path?.value);
    let template = own;
    if (own !== null && own.startsWith('/')) template = own;
    else if (parentPath.every(parent => string(parent.value) !== null) && (!path || own !== null)) {
      template = ('/' + [...parentPath.map(parent => string(parent.value)), own].filter(Boolean).join('/')).replace(/\/{2,}/g, '/');
    }
    const element = code(prop(node, 'element')?.value) ?? '';
    const layout = frames.map(parent => code(prop(parent, 'element')?.value) ?? '').join(' ');
    const isForward = forwarding.test(element);
    const guarded = privateGate.test(element + layout);
    routes.push({ template, file, isForward, guarded, signature: [code(path?.value), element, layout] });
  });
  return routes;
}

export function family(path) {
  if (path === null) return '(dynamic expression)';
  if (path === '/' || path === '*') return path;
  const [first, second] = path.split('/').filter(Boolean);
  if (!first || /^[:*]/.test(first)) return '/:handle or wildcard';
  return '/' + (sharedPrefixes.has(first) && second && !/^[:*]/.test(second) ? first + '/' + second : first);
}

function probe(template) {
  // Do not manufacture a value for a global catch-all. Named nested
  // parameters use synthetic values so the classifier sees a concrete path.
  return template?.startsWith('/') && !/^\/[:*]/.test(template)
    ? template.replace(/:[^/?]+\?/g, 'sample').replace(/:[^/]+/g, 'sample').replace(/\*$/, 'sample')
    : null;
}

export function describeHints(template) {
  const path = probe(template);
  if (path === null) return { matches: [], gaps: [] };
  const contexts = [
    ...shells.map(shell => [shell, { shell }]),
    ['direct without shell', {}],
  ];
  if (path === '/trust/me' || path === '/account') {
    for (const shell of shells) contexts.push([shell + ' sidebar', { shell, sidebar: true }]);
  }
  if (path === '/due-diligence' || path.startsWith('/due-diligence/')) {
    contexts.push(
      ['founder with one eligible licence', { shell: 'founder', licences: ['advisor'] }],
      ['founder with ambiguous owner', { shell: 'founder', licences: ['advisor', 'partner'] }],
    );
  }
  if (path === '/account/portfolio') {
    contexts.push(['create company', {}, 'portfolio:create-company'], ['create project', {}, 'portfolio:create-project']);
  }
  const results = contexts.map(([name, ctx, scope]) => {
    const hint = clientSectionHint(path, ctx, scope);
    return [name, hint ? hint.profile + '/' + hint.section : null];
  });
  return { matches: results.filter(([, value]) => value), gaps: results.filter(([, value]) => !value).map(([name]) => name) };
}

export function menuFacts(source, file) {
  const links = new Set();
  const routing = [];
  const tree = syntax(source);
  walk(tree, (node, parents) => {
    if (file === APP_PATH && !parents.some(parent => ['UserDropdown', 'getSidebarGroups'].includes(parent.id?.name))) return;
    const key = nodeName(node.key ?? node.name);
    if (node.type === 'JSXAttribute' && ['to', 'href'].includes(key)) routing.push(code(node));
    if (node.type === 'Property' && ['to', 'href', 'match'].includes(key)) routing.push(code(node));
    if (node.type === 'ConditionalExpression' || node.type === 'IfStatement' || node.type === 'LogicalExpression') {
      routing.push(code(node.test ?? node.left));
    }
    const value = string(node);
    if (value?.startsWith('/') && !value.startsWith('//')) links.add(value);
  });
  return { paths: [...links].sort(), digest: digest(routing) };
}

const cell = value => String(value).replaceAll('|', '&#124;').replaceAll('\n', ' ');
const ref = file => '\`' + file.replace(/^frontend\/src\//, '') + '\`';
const line = (...cells) => '| ' + cells.map(cell).join(' | ') + ' |';
function add(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

export function buildCoverage(root = process.cwd()) {
  const read = file => readFileSync(resolve(root, file), 'utf8');
  const files = [APP_PATH, ...routeModuleFiles(root)];
  const menuSources = [APP_PATH, ...menuFiles];
  const routes = files.flatMap(file => declaredRoutes(read(file), file));
  const aliases = REDIRECT_ROUTES;
  const qualifiedAliases = new Set([...ROLE_REDIRECTS, ...FORWARD_REDIRECTS].map(alias => alias.path.split('?')[0]));
  const aliasPaths = new Set(aliases.filter(alias => !alias.role && !alias.forward && !alias.path.includes('?')).map(alias => alias.path));
  const menus = menuSources.map(file => ({ file, ...menuFacts(read(file), file) }));
  const catalogue = parseRouteMap(readRouteMap(root)).map(row => ({ canvas: row.canvas, live: routesIn(row.live), proposed: routesIn(row.proposed) }));
  const families = new Map();
  for (const route of routes) add(families, family(route.template), route);
  const access = new Map();
  for (const row of inventory(root)) add(access, row.family, row);
  return { aliases, aliasPaths, qualifiedAliases, catalogue, families, menus, access, producers: producerFiles.map(file => [file, digest(read(file))]) };
}

export function renderCoverage(model) {
  const { aliases, aliasPaths, qualifiedAliases, catalogue, families, menus, access, producers } = model;
  const mapByFamily = new Map();
  const menuByFamily = new Map();
  for (const row of catalogue) {
    for (const path of [...row.live, ...row.proposed]) add(mapByFamily, family(path), row.canvas);
  }
  for (const menu of menus) for (const path of menu.paths) add(menuByFamily, family(path), menu.file);
  const keys = new Set([...families.keys(), ...mapByFamily.keys(), ...menuByFamily.keys()]);
  const declarations = [...families.values()].flat();
  const literalTemplates = new Set(declarations.map(route => route.template).filter(path => path !== null));
  const rows = [
    '# Section reporting route coverage (#5682)',
    '',
    '<!-- Generated by scripts/build-section-coverage.mjs --write. Build output: never commit it (D5612). -->',
    '',
    'This inventory uses route templates and synthetic context. A diagnostic hint does not prove access, ownership, routing to Slack, or delivery. “Private fallback” means no section dispatch; the approved operator path is still pending. See [D5682](decisions/D5682.md) for policy and limits.',
    '',
    '### Frontend declarations',
    '',
    `${declarations.length} declarations, ${literalTemplates.size} distinct literal templates and ${families.size} declared families. Sources without a repository prefix are relative to \`frontend/src/\`.`,
    '',
    line('Family', 'Declarations', 'Diagnostic hints on guarded declarations', 'Fallback, exclusion or ambiguity', 'Source ownership', 'Catalogue canvases', 'Route signature'),
    line('---', '---:', '---', '---', '---', '---:', '---'),
  ];
  for (const key of [...keys].sort()) {
    const routes = families.get(key) ?? [];
    const matches = new Set();
    const counts = { alias: 0, qualified: 0, token: 0, noGate: 0, unresolved: 0, noHint: 0, context: 0 };
    for (const route of routes) {
      const qualified = qualifiedAliases.has(route.template);
      if (qualified) counts.qualified++;
      if (linkCredential.test(route.template ?? '')) counts.token++;
      else if ((!qualified && route.isForward) || aliasPaths.has(route.template)) counts.alias++;
      else if (probe(route.template) === null) counts.unresolved++;
      else if (!route.guarded) counts.noGate++;
      else {
        const hints = describeHints(route.template);
        const destinations = new Set(hints.matches.map(([, value]) => value));
        if (!destinations.size) counts.noHint++;
        else if (destinations.size > 1 || hints.gaps.length) counts.context++;
        for (const value of destinations) matches.add(value);
      }
    }
    const exceptions = [
      !routes.length && 'catalogue or navigation only: no declaration in this family; verify before use',
      counts.qualified && `${counts.qualified} role/query-dependent forward: verify final route`,
      counts.token && `${counts.token} credential-bearing template: exclude`,
      counts.alias && `${counts.alias} alias: exclude pre-redirect`,
      counts.noGate && `${counts.noGate} public, token or unproven gate: exclude`,
      counts.unresolved && `${counts.unresolved} wildcard or unresolved: exclude`,
      counts.noHint && `${counts.noHint} no hint: private fallback`,
      counts.context && `${counts.context} depend on profile, origin or scope`,
    ].filter(Boolean).join('; ') || '—';
    rows.push(line(key, routes.length, setText(matches), exceptions, setText([...routes.map(route => route.file), ...(menuByFamily.get(key) ?? [])].map(ref)), new Set(mapByFamily.get(key) ?? []).size, routes.length ? digest(routes) : '—'));
  }
  rows.push('', '### Navigation and catalogue', '',
    line('Source', 'Observed surface', 'Coverage gap or restriction', 'Signature'),
    line('---', '---', '---', '---'));
  for (const menu of menus) {
    rows.push(line(ref(menu.file), `${menu.paths.length} path literals; ${new Set(menu.paths.map(family)).size} families`,
      'Includes hints and route strings; menu conditions and dynamic targets need persona coverage.', digest([menu.paths, menu.digest])));
  }
  rows.push(line('Generated profile-routing inputs', `${catalogue.length} canvases from the route-map fragments`,
    'Catalogue mappings can name a proposed surface; use the declaration rows to establish registration.', digest(catalogue)));
  rows.push(line('Redirect registry', `${new Set(aliases.map(alias => alias.path)).size} source templates`,
    'Exclude legacy hits. Role and query forwards require a final-destination check.', digest(aliases)));
  const registered = [...access.values()].reduce((total, entries) => total + entries.length, 0);
  rows.push('', '### Worker families', '',
    `${registered} distinct method/path registrations across ${access.size} API families.`, '',
    'HTTP handlers do not provide authenticated producer or delivery evidence for a section. Each family below is excluded from route-based dispatch. A verified producer may assign its section independently.', '',
    line('Family', 'Method/path registrations', 'Static gate categories', 'Source ownership', 'Signature'),
    line('---', '---:', '---', '---', '---'));
  for (const [key, entries] of [...access].sort(([a], [b]) => a.localeCompare(b))) {
    rows.push(line(key, entries.length, setText(entries.map(row => row.gate)), setText(entries.map(row => row.file)),
      digest(entries.map(({ method, path, gate, file }) => [method, path, gate, file]))));
  }
  rows.push('', '### Producer evidence', '',
    line('Source', 'Disposition', 'Signature'),
    line('---', '---', '---'));
  const dispositions = [
    'Scheduled HQ D1-capacity opening and recovery → superadmin/platform; delivery requires staged enablement.',
    'Reserved preview transport; direct receipt is distinct from a producer canary.',
    'Anonymous diagnostic ingress; exclude from section dispatch.',
  ];
  producers.forEach(([file, signature], index) => rows.push(line(ref(file), dispositions[index], signature)));
  rows.push('', 'All other asynchronous jobs require explicit producer ownership and a separately verified destination. Production delivery is unverified.', '');
  return rows.join('\n');
}

/** Everything wrong with the generated table: empty when sound. Nothing is committed, so nothing can be stale. */
export function coverageProblems(root = process.cwd(), rendered = renderCoverage(buildCoverage(root))) {
  const problems = [];
  if (rendered !== renderCoverage(buildCoverage(root))) {
    problems.push(`${output} is not deterministic: two renders of the same sources differ`);
  }
  for (const file of [output, formerOutput]) {
    if (trackedByGit(root, file)) problems.push(`${file} is tracked by git; it is generated and never committed (D5612) — run: git rm --cached ${file}`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  switch (process.argv[2]) {
    case '--write': writeFileSync(output, renderCoverage(buildCoverage())); break;
    case '--check': {
      const problems = coverageProblems();
      for (const problem of problems) console.error(problem);
      if (problems.length) process.exitCode = 1;
      break;
    }
    case undefined: process.stdout.write(renderCoverage(buildCoverage())); break;
    default: throw new Error('Use --check or --write');
  }
}
