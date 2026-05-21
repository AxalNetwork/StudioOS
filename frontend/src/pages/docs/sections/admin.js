export default {
  id: 'admin',
  title: 'Admin',
  icon: 'LayoutDashboard',
  // Task #2 (DD) — admin-only docs section. DocsLayout filters this
  // out for non-admin viewers; search index excludes it as well.
  roles: ['admin'],
  subsections: [
    {
      id: 'overview',
      title: 'Admin overview',
      overview:
        "Admins are studio operators with full visibility and the ability to act on behalf of users for support. The Admin Console organizes everything into Users, Projects, Deals, Trust, Audit, and Settings.",
      howto: [
        'Open Admin Console from the sidebar (admins only).',
        'Use the left rail to switch between sections.',
        'Use "View as" to step into a user’s view; exit from the violet bar at the top.',
      ],
      tips: [
        'Bookmark the section you use most — Users, Trust, and Audit are the common entry points.',
        'Use the global search at the top of the console to jump to any user, project, or deal.',
      ],
      pitfalls: [
        'Forgetting to exit "View as" before reading reports causes scoped data — exit first.',
        'Bulk actions are powerful and not always reversible; double-check the filter before applying.',
      ],
      related: [
        { label: 'Admin Console (overview)', href: '#portals/admin' },
        { label: 'Users & roles', href: '#admin/users' },
        { label: 'Trust management', href: '#admin/trust' },
        { label: 'Audit', href: '#admin/audit' },
      ],
    },
    {
      id: 'users',
      title: 'Users & roles',
      overview:
        "The Users section lists every account in the studio with role, tier, status, and last-active timestamp. From here you can edit profile fields, suspend accounts, trigger a passwordless re-invite, or impersonate for support.",
      howto: [
        'Open Admin Console → Users.',
        'Filter by role, tier, or status.',
        'Click any user to see their full record and recent actions.',
        'Use "Impersonate" to support; it routes through the audit log.',
      ],
      tips: [
        'Suspend instead of delete when in doubt — suspension is reversible.',
        'Use "Resend invite" if a user reports they never received the original.',
      ],
      pitfalls: [
        'Role changes via the UI are limited to non-admin roles; admin-role changes are direct database operations.',
        'Impersonation is logged with both the actor and the target — never use it casually.',
      ],
      related: [
        { label: 'Account roles explained', href: '#getting-started/roles' },
        { label: 'Audit', href: '#admin/audit' },
      ],
    },
    {
      id: 'trust',
      title: 'Trust management',
      overview:
        "Trust management is where admins approve, revoke, or escalate badges and trust signals visible in the Trust Center. Each badge has a documented checklist of evidence; admins must accept or reject each item before granting a badge.",
      howto: [
        'Open Admin Console → Trust.',
        'Pick a pending badge request; review the supporting evidence.',
        'Approve, reject (with a reason), or request more evidence.',
        'Revoke a previously granted badge from the same screen if circumstances change.',
      ],
      tips: [
        'Reject with a clear reason — the founder sees it and can resubmit.',
        'Use the "history" view on any badge to see prior approvals and rejections.',
      ],
      pitfalls: [
        'Approving a badge with incomplete evidence undermines investor trust in the system.',
        'Revoking without notifying the founder can blindside them mid-fundraise — write to them in parallel.',
      ],
      related: [
        { label: 'Trust Center', href: '#validate-grow/trust-center' },
      ],
    },
    {
      id: 'audit',
      title: 'Audit log',
      overview:
        "The platform-wide audit log records every meaningful action with a hashed actor ID, timestamp, target, and action type. It’s the source of truth for compliance and security investigations.",
      howto: [
        'Open Admin Console → Audit.',
        'Filter by actor (user ID), action type, target type, or date range.',
        'Click any row to see the full payload.',
        'Export a date range as CSV for compliance review.',
      ],
      tips: [
        'Combine actor and target filters to investigate a specific incident.',
        'The actor field is hashed for privacy — use the joined "user" panel to identify the human.',
      ],
      pitfalls: [
        'Audit log is append-only — there is no edit or delete; treat the log as evidence-grade.',
        'Exports can be large; pick a tight date range when possible.',
      ],
      related: [
        { label: 'Activity & audit log', href: '#account/activity' },
      ],
    },
    {
      id: 'feature-flags',
      title: 'Feature flags & rollout',
      overview:
        "Feature flags let admins switch new modules on per-cohort, per-role, or globally. Use them to canary-release new features, A/B test pricing, or gate experimental tools to internal-only users.",
      howto: [
        'Open Admin Console → Settings → Feature flags.',
        'Pick a flag and set its scope (off / cohort / role / on).',
        'Cohorts are picked from the Users list; you can save reusable cohorts.',
      ],
      tips: [
        'Roll out to a 5% cohort first; monitor errors and audit before expanding.',
        'Document each flag in the description field — future admins will thank you.',
      ],
      pitfalls: [
        'Toggling a flag off mid-flow can leave users with broken state — prefer "off for new sessions" where available.',
        'Flags are not a substitute for proper migration; some changes need data backfill before the flag flips.',
      ],
      related: [
        { label: 'Audit log', href: '#admin/audit' },
      ],
    },
  ],
};
