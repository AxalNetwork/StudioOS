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
        'Profile — name, headline, avatar, timezone, locale, pronouns, archetype character, and your public profile slug.',
        'Account — email change, account deletion request, data export.',
        'Security — TOTP setup, recovery codes, active sessions, password-less login configuration.',
        'Notifications — per-channel email and in-app toggles plus quiet hours and digest cadence.',
        'Privacy — visibility (public / network / private), Public Directory opt-in, advisor discoverability.',
        'Integrations — connected accounts (LinkedIn, Google, Microsoft, Slack, HubSpot, Salesforce, DocuSign) with disconnect controls.',
        'Billing — current plan, payment method, and invoices.',
        'Appearance — choose a light or dark theme.',
        'Builder — the StudioOS MCP server and the assistants you connected, your API keys, API usage and the Activity of every call (every profile).',
      ],
      tips: [
        'Bookmark direct links to specific tabs (e.g. /account/notifications) for fast access.',
        'This page was /settings and is now /account. Old links keep working — /settings and /settings/<tab> redirect here, preserving the query string and anchor, as do the legacy /settings/jurisdictions, /email, /auth and /role tabs.',
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
      title: 'Founder plans and access',
      overview:
        'Founder plans are Free, Validate + Build, and Raise + Grow. The public Pricing page reads current offers from the subscription catalogue; a technical tier key is not a separate plan name.',
      howto: [
        'Open /pricing?for=founder to compare the currently offered founder plans and any trial terms.',
        'Free supports starting validation on one idea; Validate + Build covers the founder build workflow; Raise + Grow adds the fundraising and growth features shown in the current catalogue.',
        'Before upgrading, open /pricing/products to confirm the live plan name, billing interval, included items and AI allowance. A member with more than one licence should check which licence owns the feature.',
        'Review your active subscription and invoices in Account → Billing. If access disagrees with the paid licence, contact support with the affected feature and transaction reference (never a payment credential).',
      ],
      tips: [
        'A paid subscription is not an unlimited AI balance; see AI allowance, tokens, introductions and Perks for the separate counters.',
        'Annual versus monthly billing can alter both the price and monthly included AI allowance. Use the live catalogue figures; this guide deliberately does not repeat them.',
      ],
      pitfalls: [
        'Do not infer availability from a marketing feature list alone. A missing licence, company scope, provider setup or usage limit can also prevent an action.',
        'Do not assume that changing subscription or cancelling takes effect immediately: confirm the effective date in your billing/checkout record.',
      ],
      related: [
        { label: 'AI allowance, tokens, introductions and Perks', href: '#account/balances' },
        { label: 'Paywalls', href: '#account/paywalls' },
        { label: 'Contact support', href: '#troubleshooting/contact-support' },
      ],
    },
    {
      id: 'balances',
      title: 'AI allowance, tokens, introductions and Perks',
      overview:
        'Your subscription, included AI allowance, purchased AI tokens, introduction allowance and Perks are different entitlements. They cannot be treated as one spendable balance.',
      howto: [
        'Subscription/licence — the active plan controls paid features and eligibility. Compare the authoritative plan catalogue at /pricing/products and your purchased licence in Account → Billing.',
        'Included AI allowance — shown in Account → Usage → AI tokens (/account/usage/ai-tokens); it is calculated from the current paid-plan read. Without a paid plan there is no included monthly AI balance. An unreadable balance is not zero.',
        'Purchased AI tokens — the separate token balance on Account → Usage → AI tokens. A run uses eligible included allowance first and then tokens; purchased tokens do not expire. See /pricing?for=models for the currently offered packs, if configured.',
        'Introduction allowance — a separate quota enforced when requesting or accepting introductions. Consult the current introduction view for remaining capacity and its period; it does not purchase AI use.',
        'Perks credits — a partner-perk redemption mechanism, not AI tokens or introduction allowance. Check your Perks surface for its own balance and terms.',
        'For a failed or unknown AI run or token top-up, inspect the usage/transaction history. An unconfirmed payment is not an available token balance; if still missing, report the transaction reference through Help without payment details.',
      ],
      tips: [
        'Spend and reset statements come from your live subscription and usage reads, not from static screenshots or this guide.',
        'Feature access, available funds and whether a provider is configured are separate questions.',
      ],
      pitfalls: [
        'Do not retry a paid AI action repeatedly when its first outcome is unknown; check usage and pending holds first.',
        'Refund/chargeback and downgraded-plan behavior depend on the purchased product and applicable policy. Review the checkout terms or ask support; do not assume automatic credits.',
      ],
      related: [
        { label: 'Founder plans and access', href: '#account/tiers' },
        { label: 'Investor plans and billing', href: '#account/investor-billing' },
        { label: 'Privacy & data export', href: '#account/privacy' },
      ],
    },
    {
      id: 'investor-billing',
      title: 'Investor plans and billing',
      overview:
        'Investor Free, Investor Plus, Investor Pro and negotiated institutional access have distinct capabilities and research allowances. Check the current catalogue rather than assuming a flat, uncapped institutional or metered offer.',
      howto: [
        'Open /pricing?for=investor and /pricing/products for the currently available investor licences, checkout prices and billing intervals.',
        'Check the active investor licence in Account → Billing before using gated research, deal or portfolio features.',
        'Check Account → Usage → AI tokens for included AI budget, any purchased tokens and the current ability to run AI work.',
        'If your licence is not recognized or a payment failed, use Help → Your tickets with a nonsensitive transaction reference.',
      ],
      tips: [
        'Investor research capacity, AI allowance and workspace permissions are separate entitlements; avoid assuming one pays for another.',
        'For multiple licences, each paid feature follows the licence that grants it; compare the account-specific entitlement rather than a guessed global tier.',
      ],
      pitfalls: [
        'Do not assume a pro-rata amount, refund policy, unconditional bulk export or unlimited dealroom access without confirmation from checkout and the live entitlement.',
        'An invoice or failed payment does not by itself prove the effective access state; check the updated licence read.',
      ],
      related: [
        { label: 'Founder plans and access', href: '#account/tiers' },
        { label: 'AI allowance, tokens, introductions and Perks', href: '#account/balances' },
      ],
    },
    {
      id: 'paywalls',
      title: 'Why an action may require a plan',
      overview:
        'A paywall or access message indicates an entitlement or usage check. It does not necessarily mean a payment failed or a product is offered in your location.',
      howto: [
        'Read the required licence and the exact reason shown on the blocked action.',
        'Compare currently offered products at /pricing/products, then check your active licence and account scope in Account → Billing.',
        'If the issue is a depleted AI allowance, check /account/usage/ai-tokens before purchasing tokens. A token purchase does not grant a higher subscription tier.',
        'If payment or activation has not been confirmed, check the checkout outcome and avoid repeating the payment without reconciling the first attempt.',
        'If access remains inconsistent, open a Help ticket with the feature, licence and time; do not include card data.',
      ],
      tips: [
        'Limits and plan names are read from catalogue and entitlement enforcement; avoid relying on an old Help screenshot.',
        'Some paid services require separate provider availability or permissions even when your licence includes the feature.',
      ],
      pitfalls: [
        'A temporary read failure is not proof that you have no balance or a free plan.',
        'Do not assume all upgrades, cancellations or refunds happen instantly; use the applicable checkout agreement and Account status.',
      ],
      related: [
        { label: 'Founder plans and access', href: '#account/tiers' },
        { label: 'AI allowance, tokens, introductions and Perks', href: '#account/balances' },
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
      title: 'Privacy, visibility and data export',
      overview:
        'Profile visibility and directory discoverability are separate controls. The Download my data JSON is a defined account snapshot, not an export of everything stored in every Axal VC subsystem.',
      howto: [
        'Open Account → Privacy (or /profile/visibility where available) and choose Public, Members only or Hidden. The corresponding stored values are public, network and private.',
        'Until you choose, your profile is public. The visibility options are Public (anyone with the address) / Members only (signed-in Axal VC members) / Hidden (only you).',
        'Open Account → Account & data → Download my data (JSON). The current file includes your selected user profile fields, recent activity up to 500 records and an agents export when readable.',
        'The downloaded file does not contain the full deals, projects or KYC datasets; private relationship notes are not included in this endpoint. For data held in other subsystems or a full access request, contact support/privacy through the approved channel.',
        'Request account deletion from Account & data if appropriate. The request is reviewable and cancellable in the interface; do not treat the request itself as proof that all records were erased.',
      ],
      tips: [
        'Inspect the JSON contents and exported_at field before relying on it for an archive; a failed agents export is marked unavailable rather than silently complete.',
        'The deletion form currently describes a 30-day grace period. Legal retention and actual erasure scope require review against the Privacy Policy and data-subject request status.',
      ],
      pitfalls: [
        'Do not confuse the label Members only with a public listing or with a permission to access someone else’s private company records.',
        'Do not assume signed contracts, KYC files or other regulated records can be instantly deleted or are automatically included in the account JSON.',
      ],
      related: [
        { label: 'Relationships', href: '#network/relationships' },
        { label: 'AI allowance, tokens, introductions and Perks', href: '#account/balances' },
        { label: 'Contact support', href: '#troubleshooting/contact-support' },
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
        'From /login, follow the Account recovery link to /auth/recover.',
        'The recovery page shows only the recovery methods enabled on your account. If backup codes are available, use a saved one.',
        'If trusted contacts or another recovery method are enabled, follow the on-screen steps; otherwise use the offered admin-review path.',
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
      title: 'Appearance (theme)',
      overview:
        'Appearance lets you switch between a light and a dark theme.',
      howto: [
        'Open Settings → Appearance.',
        'Pick a theme: Light or Dark.',
      ],
      tips: [
        'The sidebar starts open on a desktop and closed on a phone. Use its toggle to collapse it to the icon rail.',
      ],
      pitfalls: [
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
        "Every meaningful action you take is recorded in your Activity log: logins, document signings, settings changes, startup edits, KYC events. The log is read-only and forms part of the studio’s audit trail.",
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
