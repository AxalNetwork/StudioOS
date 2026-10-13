import { hasTier } from '../../sidebarConfig.js';
import { MODULES } from './modules.js';
import { cycleOf } from './cycleModel.js';

/** #1539: module doors and editor returns share one project-aware map. */
export const FOUNDER_TOOLS = [
  // D686: the interview log returns to Customer research, the venture kept.
  { path: '/validate/interviews', cycle: 'validate', module: 'customer-research' },
  { path: '/grow/brand', cycle: 'grow', module: 'distribution', label: 'Open landing-page builder', door: true, roles: ['admin', 'founder'] },
  { path: '/grow/launch', cycle: 'grow', module: 'distribution', label: 'Open launch calendar', door: true, roles: ['admin', 'founder'] },
  { path: '/raise/liquidity', aliases: ['/liquidity'], cycle: 'raise', module: 'cap-table', label: 'Open liquidity', door: true, roles: ['admin', 'founder'], requiredTier: 'studio' },
  { path: '/legal', cycle: 'build', module: 'company-creation', label: 'Open legal documents', door: true, roles: ['admin', 'founder'] },
  { path: '/legal/send', cycle: 'build', module: 'company-creation', label: 'Open e-signature', door: true, roles: ['admin', 'founder', 'partner', 'investor', 'advisor'] },
  { path: '/raise/capital-match', aliases: ['/grow/capital-match'], cycle: 'raise', module: 'capital-relationships', label: 'Open investor match', door: true, roles: ['admin', 'founder'] },
  { path: '/build/discovery', cycle: 'validate', module: 'customer-research' },
  { path: '/build/marketplace', cycle: 'validate', module: 'customer-research' },
  { path: '/advisory', cycle: 'validate', module: 'customer-research' },
  { path: '/execution', cycle: 'build', module: 'product-roadmap' },
  { path: '/build/metrics', cycle: 'build', module: 'operating-systems' },
  { path: '/build/team', cycle: 'grow', module: 'team-expansion' },
  { path: '/comarketing', cycle: 'grow', module: 'distribution' },
  { path: '/network-effects', cycle: 'grow', module: 'partner-network' },
  { path: '/raise/pitch', cycle: 'raise', module: 'pitch-deck' },
  { path: '/raise/pitch/positioning', cycle: 'raise', module: 'investor-narrative' },
  { path: '/raise/capital', cycle: 'raise', module: 'use-of-funds' },
  { path: '/raise/capital/cap-table', cycle: 'raise', module: 'cap-table' },
  { path: '/raise/capital/pipeline', cycle: 'raise', module: 'capital-relationships' },
  { path: '/raise/data-room', cycle: 'raise', module: 'data-room' },
  { path: '/raise/legal-engine', cycle: 'build', module: 'company-creation' },
];

export const MODULE_LINK_CLASS = 'inline-block text-[12px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300';

/** Editor-only mode/tab/filter parameters do not belong to the destination module. */
export function projectSearch(search = '') {
  const params = new URLSearchParams(search);
  const project = params.get('project_id') || params.get('project');
  return project && /^[1-9]\d*$/.test(project) ? '?project_id=' + project : '';
}

export function moduleToolLinks(cycle, slug, user, search = '') {
  if (!['admin', 'founder'].includes(user?.role)) return [];
  return FOUNDER_TOOLS.filter((tool) => tool.door && tool.cycle === cycle && tool.module === slug
    && tool.roles.includes(user.role) && hasTier(user, tool.requiredTier))
    .map((tool) => ({ label: tool.label, href: tool.path + projectSearch(search) }));
}

export function editorModuleLink(pathname, search = '', user) {
  if (!['admin', 'founder'].includes(user?.role)) return null;
  const tool = FOUNDER_TOOLS.filter((item) => [item.path, ...(item.aliases || [])]
    .some((path) => pathname === path || pathname.startsWith(path + '/')))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!tool) return null;
  const module = MODULES[tool.cycle].find((item) => item.slug === tool.module);
  return { href: '/' + tool.cycle + '/' + tool.module + projectSearch(search),
    label: '← ' + cycleOf(tool.cycle).name + ' › ' + module.name };
}
