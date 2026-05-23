export default {
  id: 'account',
  title: 'Account & Billing',
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
        'Integrations — connected accounts (LinkedIn, Google, Microsoft, Slack, HubSpot, Salesforce, DocuSign) with disconnect controls.',
        'Billing — current plan, payment method, and invoices.',
        'Appearance — theme (light / dark / system), density, and sidebar default state.',
        'Developer — feature flags, search index re-sync, raw user object (admins only).',
      ],
      tips: [
        'Bookmark direct links to specific tabs (e.g. /settings/notifications) for fast access.',
        'Old links to /settings/jurisdictions, /email, /auth, and /role still work — they redirect to the new tabs.',
      ],
      pitfalls: [
        'Changing your email triggers a re-verification on the new address — keep the old inbox accessible until that completes.',
        'Disconnecting an integration also revokes any in-flight syncs; reconnecting starts fresh.',
      ],
      related: [
        { label: 'Notifications', href: '#account/notifications' },
        { label: 'Privacy & data export', href: '#account/privacy' },
        { label: 'Security (2FA, sessions)', href: '#account/security' },
        { label: 'Appearance', href: '#account/appearance' },
      ],
    },
    {
      id: 'tiers',
      title: 'Subscription tiers (founders)',
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
      pitfalls: [
        'Downgrading mid-fundraise can lock the dataroom view for invited investors — finish the round first.',
        'Trial extensions are a one-time courtesy; plan to upgrade before the trial ends.',
      ],
      related: [
        { label: 'Settings → Billing', href: '#account/settings-overview' },
        { label: 'Investor billing & tiers', href: '#account/investor-billing' },
        { label: 'Paywalls', href: '#account/paywalls' },
      ],
    },
    {
      id: 'investor-billing',
      title: 'Investor billing & tiers',
      overview:
        "Investors have their own pricing tied to dealroom access, portfolio size, and Trust Center features. Limited-volume angels see a metered plan; institutional investors get an enterprise tier with no dealroom cap.",
      howto: [
        'Open Settings → Billing on an investor account.',
        'Pick the plan that matches your active dealroom count and portfolio size.',
        'Add a payment method; invoices appear in the same tab.',
      ],
      tips: [
        'Cap-bumps are billed pro-rata — moving to a higher tier mid-month only charges the difference.',
        'Institutional plans include export tooling; ask the studio if you need bulk extracts.',
      ],
      pitfalls: [
        'Hitting your dealroom cap silently locks new invites — keep the cap above your active count.',
        'A failed renewal downgrades you to a read-only investor view until the card is updated.',
      ],
      related: [
        { label: 'Subscription tiers (founders)', href: '#account/tiers' },
        { label: 'Paywalls', href: '#account/paywalls' },
      ],
    },
    {
      id: 'paywalls',
      title: 'Paywalls — what unlocks at each tier',
      overview:
        "Paywalls show up as a friendly banner explaining what you’re trying to do and which tier unlocks it. They never silently fail; you can always preview the gated feature and upgrade in two clicks.",
      howto: [
        'When you hit a paywall, read the banner — it lists the exact tier and what it unlocks.',
        'Click "Compare plans" to see the full grid before deciding.',
        'Click "Upgrade" to switch tier and return to the same screen with the feature unlocked.',
      ],
      tips: [
        'Some features (e.g. extra dealrooms) are metered add-ons rather than tier upgrades — the banner says which.',
        'You can request a specific feature; the studio team prioritizes by demand.',
      ],
      pitfalls: [
        'Refreshing the page mid-upgrade can re-trigger the paywall — wait for the upgrade confirmation toast.',
        'Sharing a paywalled link with a free-tier teammate shows them the same paywall, not the feature.',
      ],
      related: [
        { label: 'Subscription tiers (founders)', href: '#account/tiers' },
        { label: 'Investor billing & tiers', href: '#account/investor-billing' },
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
      pitfalls: [
        'Disabling all categories also disables security alerts; keep the Security category on at minimum.',
        'Quiet hours apply to push only — urgent emails still arrive.',
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
      pitfalls: [
        'Setting visibility to Private hides you from co-founder match results too — toggle Network if you still want introductions.',
        'Export is a snapshot; later changes won’t appear without a re-export.',
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
      pitfalls: [
        'Storing recovery codes only in the same password manager as your TOTP defeats the purpose — keep one offline.',
        'Signing out all sessions while travelling can lock you out of your live device — sign out individually.',
      ],
      related: [
        { label: 'KYC', href: '#legal/kyc' },
      ],
    },
    {
      id: 'auth-recovery',
      title: 'Account recovery (lost device)',
      overview:
        "If you lose access to your authenticator app, you have two recovery paths: the ten single-use recovery codes you saved when you set up two-factor, or a trusted contact you nominated in advance who can vouch for you to the studio team.",
      howto: [
        'On the sign-in page, click "Lost your device?".',
        'Pick "Use a recovery code" and paste one of the ten codes you saved.',
        'If you have no codes, pick "Ask a trusted contact" — the studio team will reach out to your nominated contact for verification.',
        'Once verified, you\'re prompted to set up a fresh authenticator on your new device.',
      ],
      tips: [
        'Nominate a trusted contact ahead of time in Settings → Security; recovery is far faster when the contact is already on file.',
        'After recovery, regenerate a fresh set of codes and re-save them somewhere offline.',
      ],
      pitfalls: [
        'Storing recovery codes only in the same password manager as your authenticator defeats the purpose — keep one copy offline.',
        'Recovery has a cooling-off period and a step-up review for sensitive actions — expect a short delay before things like withdrawals are re-enabled.',
      ],
      related: [
        { label: 'Security (2FA, sessions)', href: '#account/security' },
        { label: 'Contact support', href: '#troubleshooting/contact-support' },
      ],
    },
    {
      id: 'appearance',
      title: 'Appearance (theme & density)',
      overview:
        "Appearance lets you switch between light, dark, and system themes, set the table/list density (compact, comfortable, cosy), and choose whether the sidebar starts collapsed.",
      howto: [
        'Open Settings → Appearance.',
        'Pick a theme: Light, Dark, or System (follows your OS).',
        'Pick a density: Compact (more rows visible), Comfortable (default), or Cosy (extra padding).',
        'Toggle "Start sidebar collapsed" if you prefer the icon-only rail.',
      ],
      tips: [
        'System theme follows your OS automatically — useful if you switch ambient lighting throughout the day.',
        'Density affects tables and cards; typography stays at a comfortable reading size.',
      ],
      pitfalls: [
        'Compact density can hide hover-only controls on small screens — use Comfortable on a phone.',
        'Theme changes apply across all your sessions on the next page load.',
      ],
      related: [
        { label: 'Settings overview', href: '#account/settings-overview' },
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
      pitfalls: [
        'The actor field is stored as a hash for privacy — don’t expect to search by plain email.',
        'Filtering to a small range can hide important context — widen the range when investigating.',
      ],
      related: [
        { label: 'Security', href: '#account/security' },
      ],
    },
  ],
};
