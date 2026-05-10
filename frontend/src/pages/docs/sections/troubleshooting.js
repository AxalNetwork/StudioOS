export default {
  id: 'troubleshooting',
  title: 'Troubleshooting',
  icon: 'LifeBuoy',
  subsections: [
    {
      id: 'cant-see-projects',
      title: "Can't see my projects",
      overview:
        "If your project list is empty, the most common causes are: you’re viewing the wrong workspace, your role doesn’t have project access, or your account is impersonating another user.",
      howto: [
        'Check the role badge in the bottom-left of the sidebar — Investors and Mentors don’t own projects, only Founders and Admins do.',
        'If you’re an admin, exit any "View as" mode from the violet bar at the top of the screen.',
        'Refresh the page. If it’s still empty, try signing out and back in.',
        'If the project should be there, contact support with the project name.',
      ],
      tips: [
        'New projects can take a few seconds to appear after creation — refresh once if it doesn’t show right away.',
      ],
      pitfalls: [
        'Multiple browser tabs in different "View as" modes can cause confusing empty views — close extras.',
      ],
      related: [
        { label: 'Account roles explained', href: '#getting-started/roles' },
        { label: 'Contact support', href: '#troubleshooting/contact-support' },
      ],
    },
    {
      id: 'calendar-not-syncing',
      title: 'Calendar not syncing',
      overview:
        "Calendar sync covers Google Calendar and Microsoft 365 / Outlook. If a booking didn’t land on your calendar, it’s usually a re-auth issue or a quiet-hours/visibility setting on the provider side.",
      howto: [
        'Open Settings → Integrations and check that the calendar provider shows "Connected".',
        'If it shows disconnected, click "Connect" and re-authorize.',
        'Open the source booking page (Mentors / Office Hours) and click "Re-sync" on the booking.',
        'On Google or Outlook, confirm there isn’t a calendar-level rule rejecting external invites.',
      ],
      tips: [
        'Re-auth is sometimes triggered by a provider-side password change or 2FA event — re-connect and you’re back.',
        'Microsoft tenant policies sometimes block external calendar writes; ask your IT admin if all syncs fail.',
      ],
      pitfalls: [
        'Connecting a personal calendar where work invites land on a corporate calendar leads to silent misses — connect the right one.',
        'Disabling all calendar notifications hides re-auth prompts — keep at least the Calendar category on.',
      ],
      related: [
        { label: 'Calendar (Google / Microsoft)', href: '#integrations/calendar' },
        { label: 'Office Hours', href: '#validate-grow/office-hours' },
      ],
    },
    {
      id: 'billing-issues',
      title: 'Billing & invoice issues',
      overview:
        "If a charge looks wrong or an invoice is missing, check the Billing tab first — most invoices are available there within minutes of charging. If something’s missing or disputed, email the billing team directly.",
      howto: [
        'Open Settings → Billing.',
        'Confirm your current plan and most recent charge.',
        'Download the invoice from the recent invoices list.',
        'For disputes, missing invoices, or refund requests, email billing@axal.vc with the date and amount.',
      ],
      tips: [
        'Update your card before it expires — failed renewals downgrade you to Free until resolved.',
        'Tax IDs (EU VAT, etc.) can be added to your account; they’ll appear on future invoices.',
      ],
      pitfalls: [
        'Disputing a charge with your bank before contacting support can lock the account; reach out first.',
        'Downgrades take effect at the next renewal — you keep the higher tier until then.',
      ],
      related: [
        { label: 'Subscription tiers (founders)', href: '#account/tiers' },
        { label: 'Investor billing & tiers', href: '#account/investor-billing' },
      ],
    },
    {
      id: 'paywall-blocking',
      title: 'A paywall is blocking me unexpectedly',
      overview:
        "Paywalls show up when you try to use a feature outside your tier. If you believe you should have access, the most common causes are an expired card, an admin downgrade, or a stale browser session.",
      howto: [
        'Open Settings → Billing and confirm the current tier.',
        'If the card has expired, update it — the tier reactivates within minutes.',
        'Sign out and back in to refresh your session.',
        'Still blocked? File a support ticket from the Tickets page.',
      ],
      tips: [
        'Paywalls cache for a few minutes after upgrades; reload the page once.',
        'Admins can grant a one-time bypass for support cases — ask in the ticket if you’re mid-task.',
      ],
      pitfalls: [
        'Sharing a magic link with a teammate on a lower tier shows them the same paywall, not the feature.',
        'Some metered add-ons (e.g. extra dealrooms) are separate from tier — check the banner text.',
      ],
      related: [
        { label: 'Paywalls', href: '#account/paywalls' },
        { label: 'Subscription tiers (founders)', href: '#account/tiers' },
      ],
    },
    {
      id: 'integration-disconnected',
      title: 'An integration shows as disconnected',
      overview:
        "Connected accounts can drop for a handful of reasons: the studio rotated keys, the provider expired your token, or you revoked access from the provider side. Reconnect from Settings → Integrations.",
      howto: [
        'Open Settings → Integrations.',
        'Find the disconnected provider; the row shows the last known error.',
        'Click "Reconnect" and complete the provider’s sign-in flow.',
        'Re-trigger any sync that was in progress (calendar booking, deal sync, etc.).',
      ],
      tips: [
        'Rotating provider keys on the studio side requires every user to reconnect — it’s a known event, not a bug.',
        'If reconnect fails repeatedly, check the provider’s status page first.',
      ],
      pitfalls: [
        'Reconnecting with a different account silently swaps which inbox/calendar is used — pick the same account every time.',
        'Disconnecting an integration is immediate; in-flight syncs will fail.',
      ],
      related: [
        { label: 'Integrations overview', href: '#integrations/overview' },
        { label: 'Calendar', href: '#integrations/calendar' },
      ],
    },
    {
      id: 'contact-support',
      title: 'Contact support',
      overview:
        "Support is available via the Tickets page in-app and via email. Response times depend on your plan; the team is fastest on weekdays during business hours but covers urgent items 24/7 for enterprise plans.",
      howto: [
        'Open Tickets from the sidebar to file a new ticket.',
        'Pick a category (Bug, How-to, Billing, Security, Other).',
        'Describe what you tried and what you expected; attach a screenshot if you can.',
        'For urgent security issues, email security@axal.vc directly.',
      ],
      tips: [
        'Including the URL where the issue happened cuts triage time in half.',
        'Screenshots beat descriptions every time — drop them in the ticket.',
      ],
      pitfalls: [
        'Filing the same ticket twice fragments the conversation — update the original instead.',
        'Including secrets (passwords, recovery codes) in a ticket is unsafe — never send them.',
      ],
      related: [
        { label: 'Activity & audit log', href: '#account/activity' },
      ],
    },
  ],
};
