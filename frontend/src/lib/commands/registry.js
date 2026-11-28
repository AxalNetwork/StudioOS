/**
 * D9276 (#9276): every command Eadwyn's composer may offer, generated from the
 * cycles' own modules (`pages/cycles/modules.js`, the list each
 * `pages/cycles/defs/*.jsx` draws) and each module's Add forms
 * (`pages/cycles/forms.js`, a form's `key`, `cta` and fields), plus five
 * shortcuts. Nothing here fetches, writes or renders.
 *
 * An entry is one of three kinds:
 *   - a module: `/<section>/<module>` opens the module page;
 *   - an action: `/<section>/<module><action>` opens that module's Add form at
 *     its own address (`/<section>/<module>/new`, `?form=<key>` for a later
 *     one, D695) in the open project;
 *   - a shortcut: `/record`, `/task`, `/ticket`, `/team`, `/explain`.
 *
 * The hand-written part is `ACTIONS`: the stable action id, label and alias of
 * each form, keyed `<section>/<module>#<form key>`. A label may change without
 * its id. `buildRegistry` reports a form with no row (`missing`) and a row with
 * no form (`stale`); `frontend/test/eadwyn_commands_9276.test.mjs` fails on
 * either, so a new form cannot land without its command.
 *
 * SEEING AN ENTRY GRANTS NOTHING. `roles` and `labRoles` mirror the module
 * routes' guards in `App.jsx` (the test holds them equal), so the composer
 * never offers what the page would refuse; the module's Worker writer still
 * decides every write. An entry's address is built here from its own fields,
 * never from what was typed.
 */
import { MODULES } from '../../pages/cycles/modules.js';
import { formsFor as liveFormsFor } from '../../pages/cycles/forms.js';

/** The handlers an entry may name. #9278 draws each; nothing here runs one. */
export const HANDLERS = ['form', 'navigate', 'record', 'team', 'ticket', 'task', 'explain'];
/** The scope an entry needs: a venture (`project`), a company, or none. */
export const SCOPES = ['project', 'company', 'none'];
/** What the composer can do with an entry today (the coverage map's columns). */
export const COVERAGE = ['navigable', 'explainable', 'draftable', 'executable', 'unavailable'];

/** Each cycle's title, in the order the sections are listed. */
export const SECTIONS = { validate: 'Validate', build: 'Build', raise: 'Raise', grow: 'Grow' };

/**
 * Who may open each cycle's module pages, as `App.jsx` guards
 * `/<cycle>/:slug` and `/<cycle>/:slug/new`: `roles`, and whether the guard is
 * `labRoles([...])`, which also admits an active Spin-Out Lab member's own role.
 */
export const SECTION_GUARDS = {
  validate: { roles: ['admin', 'founder'], labRoles: true },
  build: { roles: ['admin', 'founder'], labRoles: true },
  raise: { roles: ['admin', 'founder'], labRoles: true },
  grow: { roles: ['admin', 'founder'], labRoles: false },
};

/**
 * Each Add form's command: `action` is the stable id typed after the module
 * (`/validate/ideal-customer-profile<create-segment>`), `label` what the
 * member reads, `alias` the short form (`/segment`).
 */
export const ACTIONS = {
  'validate/problem-discovery#theme': { action: 'create-theme', label: 'Create pain theme', alias: 'theme' },
  'validate/ideal-customer-profile#segment': { action: 'create-segment', label: 'Create customer segment', alias: 'segment' },
  'validate/market-intelligence#competitor': { action: 'add-competitor', label: 'Add competitor', alias: 'competitor' },
  'validate/demand-signals#signal': { action: 'record-signal', label: 'Record demand signal', alias: 'signal' },
  'validate/experiments#hypothesis': { action: 'create-hypothesis', label: 'Create hypothesis', alias: 'hypothesis' },
  'validate/verdict#decision': { action: 'record-decision', label: 'Record a verdict decision', alias: 'decision' },
  'build/solution-design#feature': { action: 'add-feature', label: 'Add feature', alias: 'feature' },
  'build/prototype-mvp#must-have': { action: 'add-must-have', label: 'Add MVP must-have', alias: 'must-have' },
  'build/product-roadmap#item': { action: 'add-roadmap-item', label: 'Add roadmap item', alias: 'roadmap-item' },
  'build/founding-team#founder': { action: 'add-founder', label: 'Add founder', alias: 'founder' },
  'build/company-creation#filing': { action: 'add-filing', label: 'Add company filing', alias: 'filing' },
  'build/operating-systems#system': { action: 'connect-system', label: 'Connect an operating system', alias: 'system' },
  'raise/fundraising-readiness#rescore': { action: 'rescore', label: 'Re-score fundraising readiness', alias: 'rescore' },
  'raise/investor-narrative#narrative-version': { action: 'create-narrative-version', label: 'Create narrative version', alias: 'narrative' },
  'raise/data-room#upload': { action: 'upload-document', label: 'Upload to the data room', alias: 'upload' },
  'raise/cap-table#holder': { action: 'add-holder', label: 'Add cap table holder', alias: 'holder' },
  'raise/use-of-funds#split': { action: 'edit-split', label: 'Edit use-of-funds split', alias: 'funds-split' },
  'raise/capital-relationships#investor': { action: 'add-investor', label: 'Add investor', alias: 'investor' },
  'grow/product-improvement#feedback': { action: 'log-feedback', label: 'Log product feedback', alias: 'feedback' },
  'grow/distribution#channel': { action: 'add-channel', label: 'Add distribution channel', alias: 'channel' },
  'grow/revenue-and-traction#kpi': { action: 'enter-kpi', label: 'Enter a KPI', alias: 'kpi' },
  'grow/team-expansion#role': { action: 'open-role', label: 'Open a role', alias: 'role' },
  'grow/partner-network#partner': { action: 'add-partner', label: 'Add partner', alias: 'partner' },
  'grow/market-expansion#market': { action: 'add-market', label: 'Add market', alias: 'market' },
  'grow/durable-company-building#obligation': { action: 'add-obligation', label: 'Add obligation', alias: 'obligation' },
};

/**
 * Forms that have no command, each with its reason. A row here names a form
 * the test proves exists, so an exemption cannot outlive its form.
 */
export const EXEMPT_FORMS = {
  'build/company-creation#suggested': 'An address-only form (D8259): it opens from a suggested filing’s own link with that filing’s values, never from an empty Add.',
};

/** The shortcuts, by name. Each is a command of its own, not a form. */
export const SHORTCUTS = [
  {
    name: 'record', label: 'Record a session', handler: 'record', scope: 'project',
    href: '/validate/record', roles: ['admin', 'founder'], labRoles: true, coverage: 'navigable',
    preview: 'Opens the Record a session lightbox; nothing records until Start.',
    writer: 'The recording routes the lightbox calls at Start (#9280 extends them).',
    errors: 'The lightbox says what failed and offers Try again; nothing was recorded.',
  },
  {
    name: 'task', label: 'Suggest a task', handler: 'task', scope: 'none',
    href: '/studio/tickets/new?type=task', roles: ['founder'], labRoles: false, coverage: 'draftable',
    preview: 'Opens Studio’s ticket form on the task preset (D701); nothing is sent until Submit.',
    writer: 'The ticket form’s own submit.',
    errors: 'The form shows the Worker’s sentence when it refuses.',
  },
  {
    name: 'ticket', label: 'Open a ticket', handler: 'ticket', scope: 'none',
    href: '/studio/tickets/new', roles: ['founder'], labRoles: false, coverage: 'draftable',
    preview: 'Opens Studio’s ticket form; nothing is sent until Submit.',
    writer: 'The ticket form’s own submit.',
    errors: 'The form shows the Worker’s sentence when it refuses.',
  },
  {
    name: 'team', label: 'Bring Eadwyn into Teams', handler: 'team', scope: 'none',
    href: null, roles: ['admin', 'founder'], labRoles: false, coverage: 'unavailable',
    unavailable: 'Not built yet: #9282 adds it and sets its scope.',
    preview: null, writer: null, errors: null,
  },
  {
    name: 'explain', label: 'Explain this page', handler: 'explain', scope: 'none',
    href: null, roles: null, labRoles: false, coverage: 'explainable',
    preview: 'Eadwyn explains the page the member is on; nothing is written.',
    writer: null, errors: 'Eadwyn says it could not answer; asking again retries.',
  },
];

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The names a form requires, from its own fields (a paired field's parts included). */
export function requiredInputs(form) {
  const out = [];
  const walk = (fields) => {
    for (const f of Array.isArray(fields) ? fields : []) {
      if (!f || typeof f !== 'object') continue;
      if (f.required === true && typeof f.name === 'string') out.push(f.name);
      if (Array.isArray(f.fields)) walk(f.fields);
    }
  };
  walk(form?.fields);
  return out;
}

/** The project query an address carries, or '' with no venture open. */
const projectQuery = (projectId) => (projectId ? `project_id=${encodeURIComponent(projectId)}` : '');
const withQuery = (path, parts) => {
  const q = parts.filter(Boolean).join('&');
  return q ? `${path}?${q}` : path;
};

/**
 * The registry, from the cycles' modules and forms. `missing` names each form
 * with no `ACTIONS` row and no exemption; `stale` each `ACTIONS` row whose form
 * is gone; `duplicates` each alias or path used twice.
 */
export function buildRegistry({
  modules = MODULES, formsFor = liveFormsFor, actions = ACTIONS, exempt = EXEMPT_FORMS,
  shortcuts = SHORTCUTS, guards = SECTION_GUARDS, sections = SECTIONS,
} = {}) {
  const entries = [];
  const missing = [];
  const seen = new Set();
  for (const section of Object.keys(sections)) {
    const guard = guards[section];
    for (const mod of own(modules, section) ? modules[section] : []) {
      const base = `/${section}/${mod.slug}`;
      const crumb = `${sections[section]} › ${mod.name}`;
      const common = { section, module: mod.slug, moduleTitle: mod.name, sectionTitle: sections[section], roles: [...guard.roles], labRoles: guard.labRoles };
      entries.push({
        ...common, kind: 'module', id: `${section}.${mod.slug}`, action: null, path: base,
        label: `Open ${mod.name} · ${sections[section]}`, aliases: [], handler: 'navigate', scopes: ['project'],
        inputs: [], coverage: 'navigable', unavailable: null,
        preview: 'Opens the module page; nothing is written.', writer: null, result: base, errors: 'The page says what it could not read.',
        href: ({ projectId } = {}) => withQuery(base, [projectQuery(projectId)]),
      });
      formsFor(section, mod.slug).forEach((form, index) => {
        const key = `${section}/${mod.slug}#${form.key}`;
        seen.add(key);
        if (own(exempt, key)) return;
        if (!own(actions, key)) { missing.push(key); return; }
        const a = actions[key];
        entries.push({
          ...common, kind: 'action', id: `${section}.${mod.slug}.${a.action}`, action: a.action,
          path: `${base}<${a.action}>`, label: `${a.label} · ${crumb}`, shortLabel: a.label, aliases: [a.alias],
          form: form.key, cta: form.cta, handler: 'form', scopes: ['project'], inputs: requiredInputs(form),
          coverage: 'draftable', unavailable: null,
          preview: `Opens ${mod.name}’s ${form.title || form.cta} form; nothing is written until ${form.cta}.`,
          writer: `forms.js ${section}/${mod.slug} '${form.key}' submit, through the module’s Worker route`,
          result: base,
          errors: 'The form shows the Worker’s sentence when it refuses (D695); submitting again retries.',
          href: ({ projectId } = {}) => withQuery(`${base}/new`, [projectQuery(projectId), index > 0 ? `form=${encodeURIComponent(form.key)}` : '']),
        });
      });
    }
  }
  for (const s of shortcuts) {
    entries.push({
      kind: 'shortcut', id: `shortcut.${s.name}`, section: null, module: null, moduleTitle: null, sectionTitle: null,
      action: s.name, path: `/${s.name}`, label: s.label, aliases: [s.name], handler: s.handler,
      scopes: [s.scope], inputs: [], roles: s.roles ? [...s.roles] : null, labRoles: s.labRoles,
      coverage: s.coverage, unavailable: s.unavailable || null, preview: s.preview, writer: s.writer,
      result: s.href, errors: s.errors,
      href: ({ projectId } = {}) => {
        if (!s.href) return null;
        const [path, query = ''] = s.href.split('?');
        return withQuery(path, [query, s.scope === 'project' ? projectQuery(projectId) : '']);
      },
    });
  }
  const stale = Object.keys(actions).filter((k) => !seen.has(k));
  const counts = new Map();
  for (const e of entries) for (const name of new Set([e.path, ...e.aliases.map((x) => `/${x}`)])) counts.set(name, (counts.get(name) || 0) + 1);
  const duplicates = [...counts].filter(([, n]) => n > 1).map(([name]) => name);
  return { entries, missing, stale, duplicates };
}

/**
 * Whether a viewer may see an entry, as the route's guard would admit them:
 * their role is listed, or the guard is `labRoles` and they are an active
 * Spin-Out Lab member. An entry with `roles: null` is open to any member.
 */
export function visibleTo(entry, viewer) {
  if (!viewer || typeof viewer.role !== 'string') return false;
  if (entry.roles === null) return true;
  if (entry.roles.includes(viewer.role)) return true;
  return entry.labRoles === true && viewer.spinoutLabActive === true;
}

export const REGISTRY = buildRegistry();
export const ENTRIES = REGISTRY.entries;

/** The entries a viewer may see. */
export const entriesFor = (viewer, entries = ENTRIES) => entries.filter((e) => visibleTo(e, viewer));

/** The coverage map as a Markdown table, one row per entry, as D9276.md carries it. */
export function coverageMarkdown(entries = ENTRIES) {
  const head = `| Command | Label | Handler | Scope | ${COVERAGE.map((c) => c[0].toUpperCase() + c.slice(1)).join(' | ')} |`;
  const rule = `| --- | --- | --- | --- | ${COVERAGE.map(() => ':---:').join(' | ')} |`;
  const rows = entries.map((e) => {
    const names = [e.path, ...e.aliases.filter((a) => `/${a}` !== e.path).map((a) => `/${a}`)].map((n) => `\`${n}\``).join(' ');
    return `| ${names} | ${e.label} | ${e.handler} | ${e.scopes.join(', ')} | ${COVERAGE.map((c) => (e.coverage === c ? 'yes' : '')).join(' | ')} |`;
  });
  return [head, rule, ...rows].join('\n');
}
