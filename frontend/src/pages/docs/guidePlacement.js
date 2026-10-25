// D626: descriptive placement only. Stable anchors remain the address and roles remain the visibility gate.
export const HELP_AREAS = [
  {"id": "getting-started", "title": "Getting started", "icon": "Compass"},
  {"id": "spin-out-lab", "title": "The Spin-Out Lab", "icon": "Rocket"},
  {"id": "building", "title": "Building your startup", "icon": "Hammer"},
  {"id": "legal", "title": "Incorporation & legal", "icon": "Scale"},
  {"id": "raising", "title": "Raising & cap table", "icon": "DollarSign"},
  {"id": "funds", "title": "Funds & portfolio", "icon": "TrendingUp"},
  {"id": "data", "title": "Data rooms & due diligence", "icon": "FileText"},
  {"id": "advisors", "title": "Advisors & office hours", "icon": "UserCircle"},
  {"id": "network", "title": "Partners & the network", "icon": "Network"},
  {"id": "tools", "title": "Connecting your tools", "icon": "LayoutDashboard"},
  {"id": "account", "title": "Billing & account", "icon": "UserCircle"},
  {"id": "admin", "title": "Running the platform", "icon": "LayoutDashboard"}
];

export const HELP_SURFACES = {
  "/onboarding": {"label": "Choose your licence", "roles": ["admin", "founder", "partner", "investor", "advisor", "pending", "exploring"], "lab": false},
  "/onboarding/chat": {"label": "Onboarding conversation", "roles": ["admin", "founder", "partner", "investor", "advisor", "pending", "exploring"], "lab": false},
  "/build/team": {"label": "Team", "roles": ["admin", "founder"], "lab": false},
  "/studio": {"label": "Studio", "roles": ["admin", "founder", "partner", "investor", "advisor"], "lab": true},
  "/spinout-lab/discovery": {"label": "Lab customer discovery", "roles": ["admin"], "lab": true},
  "/build/board": {"label": "Startup board", "roles": ["admin", "founder"], "lab": false},
  "/validate": {"label": "Validate", "roles": ["admin", "founder"], "lab": true},
  "/build/roadmap": {"label": "Roadmap", "roles": ["admin", "founder"], "lab": true},
  "/build/brand": {"label": "Brand Builder", "roles": ["admin", "founder"], "lab": true},
  "/raise/pitch": {"label": "Pitch Deck", "roles": ["admin", "founder", "advisor", "partner", "exploring"], "lab": true},
  "/raise/capital/model": {"label": "Financial Model", "roles": ["admin", "founder"], "lab": false},
  "/trust/me": {"label": "Trust Center", "roles": ["admin", "founder", "partner", "investor", "advisor", "exploring"], "lab": false},
  "/raise/data-room": {"label": "Data Room", "roles": ["admin", "founder", "investor"], "lab": false},
  "/research/diligence": {"label": "Due Diligence", "roles": ["admin", "investor"], "lab": true},
  "/advisors": {"label": "Advisors", "roles": ["admin", "founder", "partner", "investor", "advisor"], "lab": true},
  "/spinout-lab/cofounder-match": {"label": "Co-founder Match", "roles": ["admin", "founder"], "lab": true},
  "/wellbeing": {"label": "Wellbeing", "roles": ["admin", "founder"], "lab": false},
  "/research/markets": {"label": "Market Intelligence", "roles": ["admin", "founder", "partner", "investor", "advisor"], "lab": true},
  "/raise/capital": {"label": "Capital", "roles": ["admin", "founder"], "lab": false},
  "/raise/capital/pipeline": {"label": "Investor pipeline", "roles": ["admin", "founder"], "lab": false},
  "/raise/capital/cap-table": {"label": "Cap Table", "roles": ["admin", "founder"], "lab": false},
  "/funds": {"label": "Funds", "roles": ["admin", "investor"], "lab": false},
  "/build/kpi": {"label": "KPI entry", "roles": ["admin", "founder"], "lab": true},
  "/incorporate": {"label": "Incorporation", "roles": ["admin", "founder", "partner", "investor"], "lab": true},
  "/incorporate/cofounder-agreement": {"label": "Cofounder Agreement", "roles": ["admin", "founder", "partner"], "lab": true},
  "/raise/legal-engine/equity": {"label": "Equity & 83(b)", "roles": ["admin", "founder", "partner"], "lab": false},
  "/raise/legal-engine/compliance": {"label": "Compliance", "roles": ["admin", "founder", "partner"], "lab": false},
  "/kyc": {"label": "Identity verification", "roles": ["admin", "founder", "partner", "investor"], "lab": false},
  "/legal": {"label": "Legal templates", "roles": ["admin", "founder"], "lab": false},
  "/deals": {"label": "Deals", "roles": ["admin", "partner", "investor"], "lab": false},
  "/comarketing": {"label": "Co-marketing", "roles": ["admin", "partner", "founder", "investor"], "lab": false},
  "/build/marketplace": {"label": "Marketplace", "roles": ["admin", "founder"], "lab": false},
  "/directory": {"label": "Public Directory", "roles": null, "lab": false},
  "/articles/draft": {"label": "Write an article", "roles": null, "lab": false, "authenticated": true},
  "/network/relationships": {"label": "Relationships", "roles": ["admin", "founder", "partner", "investor", "advisor"], "lab": false},
  "/referrals": {"label": "Refer & Earn", "roles": ["admin", "founder", "partner", "investor", "advisor"], "lab": false},
  "/portfolio/health": {"label": "Portfolio Health", "roles": ["admin", "founder", "partner", "investor"], "lab": false},
  "/practice/engagements": {"label": "Advisor engagements", "roles": ["admin", "advisor"], "lab": false},
  "/account/connectors": {"label": "Connectors", "roles": ["admin", "founder", "partner", "investor", "advisor", "exploring"], "lab": false},
  "/account": {"label": "Account", "roles": ["admin", "founder", "partner", "investor", "advisor", "exploring"], "lab": false},
  "/account/billing": {"label": "Billing", "roles": ["admin", "founder", "partner", "investor", "advisor", "exploring"], "lab": false},
  "/account/notifications": {"label": "Notifications", "roles": ["admin", "founder", "partner", "investor", "advisor", "exploring"], "lab": false},
  "/account/privacy": {"label": "Privacy", "roles": ["admin", "founder", "partner", "investor", "advisor", "exploring"], "lab": false},
  "/account/security": {"label": "Security", "roles": ["admin", "founder", "partner", "investor", "advisor", "exploring"], "lab": false},
  "/auth/recover": {"label": "Account recovery", "roles": null, "lab": false},
  "/account/appearance": {"label": "Appearance", "roles": ["admin", "founder", "partner", "investor", "advisor", "exploring"], "lab": false},
  "/activity": {"label": "Activity", "roles": ["admin", "founder", "partner", "investor", "advisor", "exploring"], "lab": false},
  "/help/tickets": {"label": "Tickets", "roles": ["admin", "founder", "partner", "investor", "advisor", "exploring"], "lab": false},
  "/admin": {"label": "Admin Console", "roles": ["admin"], "lab": false},
  "/login": {"label": "Sign in", "roles": null, "lab": false}
};

export const GUIDE_PLACEMENT = {
  "getting-started/what-is-studioos": {"area": "getting-started", "surface": null, "appliesTo": null},
  "getting-started/choosing-path": {"area": "getting-started", "surface": "/onboarding", "appliesTo": null},
  "getting-started/roles": {"area": "getting-started", "surface": null, "appliesTo": null},
  "getting-started/personas": {"area": "getting-started", "surface": "/onboarding/chat", "appliesTo": null},
  "getting-started/onboarding": {"area": "getting-started", "surface": "/onboarding/chat", "appliesTo": null},
  "getting-started/invite-team": {"area": "getting-started", "surface": "/build/team", "appliesTo": null},
  "getting-started/help-and-shortcuts": {"area": "getting-started", "surface": null, "appliesTo": null},
  "getting-started/pricing-demo": {"area": "getting-started", "surface": null, "appliesTo": null},
  "getting-started/personal-advisor": {"area": "getting-started", "surface": "/studio", "appliesTo": null},
  "spin-out-lab/overview": {"area": "spin-out-lab", "surface": null, "appliesTo": ["founder"]},
  "spin-out-lab/week-1": {"area": "spin-out-lab", "surface": "/spinout-lab/discovery", "appliesTo": ["founder"]},
  "spin-out-lab/week-2": {"area": "spin-out-lab", "surface": null, "appliesTo": ["founder"]},
  "spin-out-lab/week-3": {"area": "spin-out-lab", "surface": null, "appliesTo": ["founder"]},
  "spin-out-lab/week-4": {"area": "spin-out-lab", "surface": null, "appliesTo": ["founder"]},
  "spin-out-lab/graduating": {"area": "spin-out-lab", "surface": null, "appliesTo": ["founder"]},
  "build/projects": {"area": "building", "surface": "/build/board", "appliesTo": ["founder"]},
  "build/customer-discovery": {"area": "building", "surface": "/validate", "appliesTo": ["founder"]},
  "build/roadmap": {"area": "building", "surface": "/build/roadmap", "appliesTo": ["founder"]},
  "build/brand-builder": {"area": "building", "surface": "/build/brand", "appliesTo": ["founder"]},
  "build/pitch-deck": {"area": "raising", "surface": "/raise/pitch", "appliesTo": ["founder"]},
  "build/deck-share-viewer": {"area": "raising", "surface": null, "appliesTo": ["founder"]},
  "build/financial-model": {"area": "building", "surface": "/raise/capital/model", "appliesTo": ["founder"]},
  "validate-grow/trust-center": {"area": "data", "surface": "/trust/me", "appliesTo": null},
  "validate-grow/data-room": {"area": "data", "surface": "/raise/data-room", "appliesTo": null},
  "validate-grow/due-diligence": {"area": "data", "surface": "/research/diligence", "appliesTo": ["investor"]},
  "validate-grow/advisors": {"area": "advisors", "surface": "/advisors", "appliesTo": null},
  "validate-grow/office-hours": {"area": "advisors", "surface": null, "appliesTo": null},
  "validate-grow/cofounder-match": {"area": "building", "surface": "/spinout-lab/cofounder-match", "appliesTo": ["founder"]},
  "validate-grow/expert-profiles": {"area": "advisors", "surface": null, "appliesTo": null},
  "validate-grow/wellbeing": {"area": "building", "surface": "/wellbeing", "appliesTo": ["founder"]},
  "capital/fundraise": {"area": "raising", "surface": "/raise/capital", "appliesTo": ["founder"]},
  "capital/investors": {"area": "raising", "surface": "/raise/capital/pipeline", "appliesTo": ["founder"]},
  "capital/cap-table": {"area": "raising", "surface": "/raise/capital/cap-table", "appliesTo": ["founder"]},
  "capital/funds": {"area": "funds", "surface": "/funds", "appliesTo": ["investor"]},
  "capital/metrics": {"area": "building", "surface": "/build/kpi", "appliesTo": ["founder"]},
  "legal/incorporation": {"area": "legal", "surface": "/incorporate", "appliesTo": ["founder"]},
  "legal/cofounder-agreement": {"area": "legal", "surface": "/incorporate/cofounder-agreement", "appliesTo": ["founder"]},
  "legal/nda": {"area": "legal", "surface": null, "appliesTo": null},
  "legal/section-83b": {"area": "legal", "surface": "/raise/legal-engine/equity", "appliesTo": ["founder"]},
  "legal/compliance": {"area": "legal", "surface": "/raise/legal-engine/compliance", "appliesTo": ["founder"]},
  "legal/kyc": {"area": "legal", "surface": "/kyc", "appliesTo": null},
  "legal/esign": {"area": "legal", "surface": null, "appliesTo": null},
  "legal/templates": {"area": "legal", "surface": "/legal", "appliesTo": ["founder"]},
  "partnerships/overview": {"area": "network", "surface": null, "appliesTo": ["partner"]},
  "partnerships/deal-engine": {"area": "network", "surface": "/deals", "appliesTo": ["partner"]},
  "partnerships/onboarding": {"area": "network", "surface": null, "appliesTo": ["partner"]},
  "partnerships/co-marketing": {"area": "network", "surface": "/comarketing", "appliesTo": ["partner"]},
  "partnerships/counters": {"area": "network", "surface": null, "appliesTo": ["partner"]},
  "network/marketplace": {"area": "network", "surface": "/build/marketplace", "appliesTo": null},
  "network/partners": {"area": "network", "surface": "/comarketing", "appliesTo": null},
  "network/directory": {"area": "network", "surface": "/directory", "appliesTo": null},
  "network/articles": {"area": "network", "surface": "/articles/draft", "appliesTo": null},
  "network/relationships": {"area": "network", "surface": "/network/relationships", "appliesTo": null},
  "network/matches": {"area": "network", "surface": null, "appliesTo": null},
  "network/refer-earn": {"area": "network", "surface": "/referrals", "appliesTo": null},
  "portals/portfolio-health": {"area": "funds", "surface": "/portfolio/health", "appliesTo": ["investor"]},
  "portals/partner": {"area": "network", "surface": "/studio", "appliesTo": ["partner"]},
  "portals/advisor": {"area": "advisors", "surface": "/practice/engagements", "appliesTo": ["advisor"]},
  "integrations/overview": {"area": "tools", "surface": "/account/connectors", "appliesTo": null},
  "integrations/calendar": {"area": "advisors", "surface": "/account/connectors", "appliesTo": null},
  "integrations/slack": {"area": "tools", "surface": "/account/connectors", "appliesTo": null},
  "integrations/crm": {"area": "tools", "surface": "/account/connectors", "appliesTo": null},
  "integrations/docusign": {"area": "tools", "surface": "/account/connectors", "appliesTo": null},
  "integrations/google-signin": {"area": "account", "surface": "/login", "appliesTo": null},
  "integrations/hubspot-pat": {"area": "tools", "surface": "/account/connectors", "appliesTo": null},
  "integrations/identity": {"area": "account", "surface": "/account/connectors", "appliesTo": null},
  "account/settings-overview": {"area": "account", "surface": "/account", "appliesTo": null},
  "account/tiers": {"area": "account", "surface": "/account/billing", "appliesTo": ["founder"]},
  "account/investor-billing": {"area": "account", "surface": "/account/billing", "appliesTo": ["investor"]},
  "account/paywalls": {"area": "account", "surface": "/account/billing", "appliesTo": null},
  "account/notifications": {"area": "account", "surface": "/account/notifications", "appliesTo": null},
  "account/privacy": {"area": "account", "surface": "/account/privacy", "appliesTo": null},
  "account/security": {"area": "account", "surface": "/account/security", "appliesTo": null},
  "account/auth-recovery": {"area": "account", "surface": "/auth/recover", "appliesTo": null},
  "account/appearance": {"area": "account", "surface": "/account/appearance", "appliesTo": null},
  "account/activity": {"area": "account", "surface": "/activity", "appliesTo": null},
  "troubleshooting/cant-see-projects": {"area": "getting-started", "surface": "/build/board", "appliesTo": null},
  "troubleshooting/calendar-not-syncing": {"area": "advisors", "surface": "/account/connectors", "appliesTo": null},
  "troubleshooting/billing-issues": {"area": "account", "surface": "/account/billing", "appliesTo": null},
  "troubleshooting/paywall-blocking": {"area": "account", "surface": "/account/billing", "appliesTo": null},
  "troubleshooting/integration-disconnected": {"area": "tools", "surface": "/account/connectors", "appliesTo": null},
  "troubleshooting/customer-chat": {"area": "getting-started", "surface": "/studio", "appliesTo": null},
  "troubleshooting/contact-support": {"area": "getting-started", "surface": "/help/tickets", "appliesTo": null},
  "changelog/release-notes": {"area": "getting-started", "surface": null, "appliesTo": null},
  "admin/overview": {"area": "admin", "surface": "/admin", "appliesTo": null},
  "admin/users": {"area": "admin", "surface": "/admin", "appliesTo": null},
  "admin/trust": {"area": "admin", "surface": "/admin", "appliesTo": null},
  "admin/audit": {"area": "admin", "surface": "/admin", "appliesTo": null},
  "admin/feature-flags": {"area": "admin", "surface": null, "appliesTo": null},
  "admin/events-ops": {"area": "admin", "surface": null, "appliesTo": null},
  "admin/assessment-ops": {"area": "admin", "surface": "/admin", "appliesTo": null}
};

export function guidePlacement(anchor) {
  const placement = GUIDE_PLACEMENT[anchor];
  if (!placement) return null;
  return { ...placement, areaTitle: HELP_AREAS.find((area) => area.id === placement.area)?.title, surfaceInfo: HELP_SURFACES[placement.surface] || null };
}

// Call after the manifest's roles filter: appliesTo is never a visibility gate.
export function helpAreas(sections) {
  return HELP_AREAS.map((area) => {
    const guides = sections.flatMap((section) => section.subsections.map((sub) => ({
      ...sub, anchor: `${section.id}/${sub.id}`, ...guidePlacement(`${section.id}/${sub.id}`),
    }))).filter((guide) => guide.area === area.id);
    const role = guides[0]?.appliesTo?.length === 1 ? guides[0].appliesTo[0] : null;
    const badge = role && guides.every((guide) => guide.appliesTo?.length === 1 && guide.appliesTo[0] === role) ? role.toUpperCase() : null;
    return { ...area, guides, badge };
  }).filter((area) => area.guides.length > 0);
}

export function canOpenSurface(surface, user, session = null) {
  if (!surface) return false;
  if (surface.authenticated && !user) return false;
  if (surface.roles === null) return true;
  if (!user) return false;
  const role = session?.viewMode || user.role;
  return surface.roles.includes(role) || (surface.lab && (
    (user.spinout_lab_active === 1 && role === user.role)
    || (user.role === 'admin' && !session?.isImpersonating)
  ));
}
