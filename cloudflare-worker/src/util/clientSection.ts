/** Diagnostic hints for the anonymous client-error intake. No access or dispatch decision may use them. */
type Member = 'founder' | 'investor' | 'partner' | 'advisor';
type Profile = Member | 'superadmin' | 'admin' | 'explorer' | 'all';
type Section = { profile: Profile; section: string };
type Paths = Record<string, string>;
const members: Member[] = ['founder', 'investor', 'partner', 'advisor'];
const shellProfiles = new Map<string, Profile>([
  ['super_admin', 'superadmin'], ['branch_admin', 'admin'], ['admin', 'admin'],
  ['exploring', 'explorer'], ...members.map((role): [string, Profile] => [role, role]),
]);

// Canonical paths and explicit sidebar aliases. Boundaries match complete segments.
const hq: Paths = {
  '/hq': 'home', '/admin/analytics': 'home', '/admin/licences': 'licences', '/admin/programs': 'programs',
  '/admin/funds': 'funds-oversight', '/admin/fund-admin': 'fund-admin', '/admin/contracts': 'contracts',
  '/admin/hq-team': 'team', '/admin/accounts/credits': 'team', '/admin/accounts/all': 'team',
  '/admin/revenue': 'revenue', '/admin/content': 'content', '/admin/articles': 'content',
  '/admin/publications': 'content', '/admin/persona-segments': 'content', '/admin/advisors-partners': 'content',
  '/admin/team': 'content', '/admin/platform': 'platform', '/admin/credit-rules': 'platform',
  '/hq/ai-agents': 'ai-agents', '/admin/integration-keys': 'integration-keys',
  '/admin/hq-support': 'support', '/hq/review': 'support', '/admin/security': 'security',
};
const admin: Paths = {
  '/studio': 'studio', '/admin/accounts': 'accounts', '/admin/persona-segments': 'accounts',
  '/admin/exploring': 'accounts', '/admin/trash': 'accounts', '/admin/approvals': 'approvals',
  '/admin/kyc': 'approvals', '/admin/lp-applications': 'approvals', '/admin/due-diligence': 'approvals',
  '/admin/spinout-moderation': 'approvals', '/admin/partner-profiles': 'approvals',
  '/admin/programs': 'programs', '/admin/held/programs': 'programs', '/admin/advisor-cohorts': 'programs',
  '/admin/refer-earn': 'programs', '/admin/spinout-lab': 'programs', '/admin/community': 'community',
  '/admin/events': 'community', '/admin/jobs': 'community', '/admin/circles': 'community',
  '/admin/partner-invitations': 'community', '/admin/advisors-partners': 'community',
  '/admin/directory': 'community', '/admin/wellbeing': 'community', '/admin/contracts': 'contracts',
  '/admin/fund-admin': 'fund-admin', '/admin/insights': 'insights', '/admin/my-licence': 'licences',
};
const branch: Paths = {
  '/studio': 'studio', '/branch/accounts': 'accounts', '/branch/approvals': 'approvals',
  '/branch/programs': 'programs', '/branch/community': 'community', '/admin/partner-invitations': 'community',
  '/branch/contracts': 'contracts', '/branch/insights': 'insights', '/branch/settings': 'licences',
  '/admin/my-licence': 'licences',
};
const common: Paths = {
  '/account/usage': 'usage', '/account/connectors': 'connectors', '/account/billing': 'billing',
  '/account/licences': 'licences', '/perks': 'perks', '/calendar': 'calendar', '/my/events': 'events',
  '/learning': 'learning', '/help': 'help-center', '/pricing': 'pricing', '/influencer': 'influencer',
  '/account/profile': 'account', '/account/account': 'account', '/account/security-privacy': 'account',
  '/account/notifications': 'account', '/account/appearance': 'account', '/account/following': 'account',
  '/account/builder': 'account', '/account/onboarding': 'account', '/account/activity': 'account',
};
const memberPaths: Record<Member, Paths> = {
  founder: { '/validate': 'validate', '/build': 'build', '/raise': 'raise', '/grow': 'grow', '/profile': 'profile' },
  investor: { '/deals': 'deals', '/spinout-lab/investor-workspace': 'axal-vc-fund', '/funds': 'fund', '/portfolio': 'portfolio' },
  partner: { '/pipeline': 'pipeline', '/delivery': 'delivery', '/offers': 'offers' },
  advisor: { '/practice': 'practice', '/cohorts': 'cohorts', '/expertise': 'expertise' },
};
const memberShared: Paths = { '/studio': 'studio', '/spinout-lab': 'spin-out-lab', '/network': 'network', '/research': 'research' };
const explorer: Paths = { '/exploring': 'studio', '/spinout-lab': 'spin-out-lab', '/email': 'email' };

function inFamily(path: string, parent: string) {
  return path === parent || path.startsWith(parent + '/');
}

function sectionFor(path: string, paths: Paths) {
  let longest = '';
  for (const prefix of Object.keys(paths)) {
    // HQ Home itself claims /hq, not all new HQ modules.
    if ((prefix === '/hq' ? path === prefix : inFamily(path, prefix)) && prefix.length > longest.length) longest = prefix;
  }
  return paths[longest];
}

function portfolioSection(path: string, scope: unknown) {
  if (path === '/account/portfolio') {
    if (scope === 'portfolio:create-project') return 'projects';
    if (scope === 'portfolio:create-company') return 'companies';
    return 'portfolio';
  }
  if (/^\/account\/portfolio\/(funds|engagements|invitations)(\/|$)/.test(path)) return 'portfolio';
  if (/^\/account\/(?:companies|portfolio)\/[^/]+\/settings\/projects(?:\/|$)/.test(path)
    || inFamily(path, '/account/portfolio/projects') || /^\/p\/[^/]+/.test(path)
    || /^\/c\/[^/]+\/(?:p\/[^/]+|settings\/projects)(?:\/|$)/.test(path)
    || /^\/projects\/(?!invitations(?:\/|$))[^/]+(?:\/|$)/.test(path)) return 'projects';
  if (/^\/c\/[^/]+/.test(path) || inFamily(path, '/account/portfolio')
    || /^\/account\/companies\/[^/]+\/settings\/(?:team|compliance)$/.test(path)) return 'companies';
  return undefined;
}

/** Only keys from the tables above can be emitted. A missing/ambiguous match stays null. */
export function clientSectionHint(pathname: unknown, raw: unknown, scope?: unknown): Section | null {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) return null;
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  const ctx = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const profile = typeof ctx.shell === 'string' ? shellProfiles.get(ctx.shell) : undefined;
  const viaSidebar = ctx.sidebar === true;
  if (path === '/account') return profile === 'superadmin' && viaSidebar
    ? { profile, section: 'settings' } : { profile: 'all', section: 'account' };
  if (path === '/trust/me') return viaSidebar && members.includes(profile as Member)
    ? { profile: profile as Member, section: 'trust' } : { profile: 'all', section: 'trust-center' };

  const sharedSection = portfolioSection(path, scope) || sectionFor(path, common);
  if (sharedSection) return { profile: 'all', section: sharedSection };
  if (!profile) return null;
  if (profile === 'superadmin' || profile === 'admin' || profile === 'explorer') {
    const paths = profile === 'superadmin' ? hq : profile === 'explorer' ? explorer : ctx.shell === 'branch_admin' ? branch : admin;
    // The investor workspace is never the explorer's generic Lab.
    if (profile === 'explorer' && inFamily(path, '/spinout-lab/investor-workspace')) return null;
    const section = sectionFor(path, paths);
    return section ? { profile, section } : null;
  }

  const held = members.filter(role => role === profile || (Array.isArray(ctx.licences) && ctx.licences.includes(role)));
  if (inFamily(path, '/due-diligence')) {
    const candidates = held.filter(role => role !== 'founder');
    const owner = candidates.find(role => role === profile) || (candidates.length === 1 ? candidates[0] : undefined);
    return owner ? { profile: owner, section: 'due-diligence' } : null;
  }
  for (const owner of members) {
    const section = sectionFor(path, memberPaths[owner]);
    if (section) return held.includes(owner) ? { profile: owner, section } : null;
  }
  const section = sectionFor(path, memberShared);
  return section ? { profile, section } : null;
}
