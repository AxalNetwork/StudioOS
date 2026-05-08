export default {
  id: 'account',
  title: 'Account',
  icon: 'UserCircle',
  subsections: [
    {
      id: 'settings-overview',
      title: 'Settings overview',
      overview:
        "Settings is organized into nine tabs covering everything from your profile to advanced developer toggles. Each tab saves on change; some require a confirmation step (email change, account deletion).",
      howto: [
        'Profile — name, headline, avatar, timezone, locale, pronouns, and your public profile slug.',
        'Account — email change, account deletion request, data export.',
        'Security — TOTP setup, recovery codes, active sessions, password-less login configuration.',
        'Notifications — per-channel email and in-app toggles plus quiet hours and digest cadence.',
        'Privacy — visibility (public / network / private), Public Directory opt-in, mentor discoverability.',
        'Integrations — connected accounts (LinkedIn, Google, Microsoft) with disconnect controls.',
        'Billing — current plan, payment method, and invoices.',
        'Appearance — theme (light / dark / system), density, and sidebar default state.',
        'Developer — feature flags, search index re-sync, raw user object (admins only).',
      ],
      tips: [
        'Bookmark direct links to specific tabs (e.g. /settings/notifications) for fast access.',
        'Old links to /settings/jurisdictions, /email, /auth, and /role still work — they redirect to the new tabs.',
      ],
      related: [
        { label: 'Notifications', href: '#account/notifications' },
        { label: 'Privacy & data export', href: '#account/privacy' },
        { label: 'Security (2FA, sessions)', href: '#account/security' },
      ],
    },
    {
      id: 'tiers',
      title: 'Subscription tiers',
      overview:
        "StudioOS has three commercial tiers tuned to where you are: Free for browsing and applying, Growth for active founders, and Studio for studio operators and committed LPs. Your tier determines which sidebar groups and features unlock.",
      howto: [
        'Free — browse Marketplace, submit your idea, view basic dashboards.',
        'Growth — full Build, Validate & Grow, and Capital tooling for founders running an active venture.',
        'Studio — full investor and operator tooling: funds, reserves, waterfall, portfolio health.',
      ],
      tips: [
        'Tier upgrades take effect immediately; downgrades preserve your data but lock the gated features.',
        'Studio operators with a license get a branded instance and a custom domain.',
      ],
      related: [
        { label: 'Settings → Billing', href: '#account/settings-overview' },
      ],
    },
    {
      id: 'notifications',
      title: 'Notifications',
      overview:
        "Notifications are organized by category (mentions, deal flow, calendar, scoring, billing) with separate toggles for email and in-app. Quiet hours pause real-time push during your stated window without affecting digest emails.",
      howto: [
        'Open Settings → Notifications.',
        'For each category, toggle email and in-app independently.',
        'Set the digest cadence (off / daily / weekly).',
        'Set quiet hours start, end, and timezone if you want pushes paused overnight.',
      ],
      tips: [
        'Daily digests are great if you’re heads-down building — they give you one read per day instead of a stream.',
        'The notification bell shows unread items; clicking marks them read.',
      ],
      related: [
        { label: 'Settings overview', href: '#account/settings-overview' },
      ],
    },
    {
      id: 'privacy',
      title: 'Privacy & data export',
      overview:
        "You control who can see your profile, whether you appear in the Public Directory, and whether mentors can discover you. You can export everything we hold about you as a JSON file at any time and request account deletion.",
      howto: [
        'Open Settings → Privacy.',
        'Pick visibility: Public (anyone with the link) / Network only / Private (admins only).',
        'Toggle Public Directory and mentor discoverability independently.',
        'Open Settings → Account → Download my data to export.',
        'Request account deletion from the same tab — there’s a 30-day grace period before hard delete.',
      ],
      tips: [
        'Export downloads as a single JSON file; keep it somewhere safe.',
        'Some records (signed contracts, capital call records) are preserved by law for 7 years even after deletion.',
      ],
      related: [
        { label: 'Public Directory', href: '#network/directory' },
        { label: 'Settings overview', href: '#account/settings-overview' },
      ],
    },
    {
      id: 'security',
      title: 'Security (2FA, sessions)',
      overview:
        "Security covers TOTP-based two-factor authentication, recovery codes for lost devices, and visibility into active sessions across your devices. We don’t use passwords — your authenticator app is your password.",
      howto: [
        'Open Settings → Security.',
        'Set up TOTP by scanning the QR code with Google Authenticator, 1Password, Authy, or any TOTP app.',
        'Save the 10 recovery codes shown — each is single-use and can rescue you if you lose your device.',
        'Regenerate recovery codes any time from the same tab.',
        'Review active sessions and sign out individual devices if anything looks off.',
      ],
      tips: [
        'Print or store recovery codes somewhere offline — losing both your device and your codes locks you out.',
        'If you change phones, regenerate TOTP from the new device before retiring the old one.',
      ],
      related: [
        { label: 'KYC', href: '#legal/kyc' },
      ],
    },
    {
      id: 'activity',
      title: 'Activity & audit log',
      overview:
        "Every meaningful action you take is recorded in your Activity log: logins, document signings, settings changes, project edits, KYC events. The log is read-only and forms part of the studio’s audit trail.",
      howto: [
        'Open Activity from the sidebar (or your account menu).',
        'Filter by event type or date range.',
        'Click any entry to see the full detail.',
      ],
      tips: [
        'If you ever spot an action you didn’t take, change your TOTP immediately and contact support.',
        'Admins can see a wider audit log; yours is scoped to events involving your account.',
      ],
      related: [
        { label: 'Security', href: '#account/security' },
      ],
    },
  ],
};
