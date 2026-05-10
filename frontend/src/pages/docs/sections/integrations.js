export default {
  id: 'integrations',
  title: 'Integrations',
  icon: 'Network',
  subsections: [
    {
      id: 'overview',
      title: 'Integrations overview',
      overview:
        "Integrations are connected third-party accounts the platform talks to on your behalf — calendars, CRMs, e-signature providers, identity providers, and chat tools. Each integration is opt-in, scoped to the minimum permissions needed, and revocable from Settings → Integrations.",
      howto: [
        'Open Settings → Integrations to see the list.',
        'Click "Connect" on any provider and complete the provider’s sign-in.',
        'Review the scopes the provider asks for before approving — they’re listed plainly.',
        'Disconnect any provider any time; in-flight syncs will stop.',
      ],
      tips: [
        'Connect calendar first — bookings (mentors, office hours, deal calls) all rely on it.',
        'You can connect multiple providers for the same category (e.g. both Google and Microsoft) but only one is "active" per category.',
      ],
      pitfalls: [
        'Approving with a personal account instead of a work account leads to surprising behaviour for work-only events.',
        'Some providers require admin consent on enterprise plans — flag the request to your IT admin if it bounces.',
      ],
      related: [
        { label: 'Calendar (Google / Microsoft)', href: '#integrations/calendar' },
        { label: 'Slack', href: '#integrations/slack' },
        { label: 'CRM (HubSpot, Salesforce)', href: '#integrations/crm' },
        { label: 'DocuSign', href: '#integrations/docusign' },
      ],
    },
    {
      id: 'calendar',
      title: 'Calendar (Google / Microsoft)',
      overview:
        "Calendar integration writes booked sessions, office hours, and deal calls to your Google Calendar or Microsoft 365 / Outlook calendar. It also reads availability so the booking widget hides slots when you’re busy.",
      howto: [
        'Open Settings → Integrations.',
        'Click "Connect" on Google Calendar or Microsoft 365.',
        'Sign in with the account whose calendar you want to use.',
        'Pick the specific calendar to write to (you can have many; the picker lists all of them).',
      ],
      tips: [
        'Set a working-hours window in your calendar — the booking widget honours it.',
        'Cancellations on either side update the other within seconds.',
      ],
      pitfalls: [
        'Granting only read scope hides the "write" features (no auto-bookings); accept both scopes.',
        'Tenant policies may block external invites from being accepted automatically — accept manually if needed.',
      ],
      related: [
        { label: 'Mentors', href: '#validate-grow/mentors' },
        { label: 'Office Hours', href: '#validate-grow/office-hours' },
        { label: 'Calendar not syncing', href: '#troubleshooting/calendar-not-syncing' },
      ],
    },
    {
      id: 'slack',
      title: 'Slack',
      overview:
        "The Slack integration delivers notifications (mentions, deal updates, new RFPs, calendar reminders) to a Slack channel of your choice and lets you action a few common items (mark read, snooze) without leaving Slack.",
      howto: [
        'Open Settings → Integrations and click "Connect" on Slack.',
        'Pick the workspace and the default channel for notifications.',
        'In Settings → Notifications, route specific categories to Slack instead of email.',
      ],
      tips: [
        'Use a private channel for personal notifications and a public one for team-visible deal updates.',
        'Slack notifications respect quiet hours — set them in Settings → Notifications.',
      ],
      pitfalls: [
        'Notifying a public channel for everything floods teammates — be selective with categories.',
        'Removing the app from Slack on the workspace side disconnects it for everyone — coordinate before doing so.',
      ],
      related: [
        { label: 'Notifications', href: '#account/notifications' },
      ],
    },
    {
      id: 'crm',
      title: 'CRM (HubSpot, Salesforce)',
      overview:
        "CRM integration syncs deal records (founder pipelines, partner deal engine) to HubSpot or Salesforce so investor-relations teams can keep their existing system of record. Sync is one-way (StudioOS → CRM) by default.",
      howto: [
        'Open Settings → Integrations and click "Connect" on HubSpot or Salesforce.',
        'Pick which deal pipelines should sync (you can include or exclude individual ones).',
        'Map StudioOS stages to CRM stages — defaults are pre-filled.',
        'Run an initial backfill or wait for the next nightly sync.',
      ],
      tips: [
        'Keep stage mapping simple — fewer stages reconcile better.',
        'Sync runs nightly by default; force a manual sync from the integration settings if you need a faster refresh.',
      ],
      pitfalls: [
        'Custom required fields in your CRM block sync — mark them optional or pre-populate them.',
        'Deletions in StudioOS do not propagate; archive or close the CRM record manually.',
      ],
      related: [
        { label: 'Investors & Pipeline', href: '#capital/investors' },
        { label: 'Partner deal engine', href: '#partnerships/deal-engine' },
      ],
    },
    {
      id: 'docusign',
      title: 'DocuSign',
      overview:
        "DocuSign is supported as an alternative signature provider for organisations that already standardise on it. The platform routes the document, captures the signed copy, and stores it alongside the project documents.",
      howto: [
        'Open Settings → Integrations and click "Connect" on DocuSign.',
        'Sign in with the account that has the right signing credit.',
        'In any flow that sends a document, pick "DocuSign" instead of in-platform signature.',
      ],
      tips: [
        'In-platform signing is faster for routine NDAs; reserve DocuSign for anything your counterparty insists on.',
        'DocuSign envelope status syncs back to the document record so you can see who has signed.',
      ],
      pitfalls: [
        'Routing through DocuSign without enough signing credit fails silently — top up before sending.',
        'Editing a document after sending creates a new envelope; the old one becomes invalid.',
      ],
      related: [
        { label: 'ESign', href: '#legal/esign' },
        { label: 'Legal Templates', href: '#legal/templates' },
      ],
    },
    {
      id: 'identity',
      title: 'Identity providers (LinkedIn, Google, Microsoft)',
      overview:
        "Identity providers let you sign in with an existing account instead of a passwordless link. They also fill out parts of your profile (headline, photo, work history) when you grant the relevant scopes.",
      howto: [
        'Open Settings → Integrations.',
        'Click "Connect" on LinkedIn, Google, or Microsoft.',
        'Approve the scopes the provider asks for — they’re listed plainly.',
        'Use the provider on the sign-in page next time.',
      ],
      tips: [
        'Connecting LinkedIn auto-fills your headline and work history but never publishes anything back to LinkedIn.',
        'You can connect more than one provider; any of them can sign you in.',
      ],
      pitfalls: [
        'Disconnecting your only sign-in provider locks you out — keep at least one method active.',
        'Provider profile changes (e.g. new LinkedIn headline) don’t back-fill until you re-import.',
      ],
      related: [
        { label: 'Security (2FA, sessions)', href: '#account/security' },
      ],
    },
  ],
};
