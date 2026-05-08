export default {
  id: 'legal',
  title: 'Legal & Compliance',
  icon: 'Scale',
  subsections: [
    {
      id: 'incorporation',
      title: 'Incorporation',
      overview:
        "The Incorporation wizard takes you from a project to a registered company in a single sitting. Pick a jurisdiction (Delaware C-Corp by default), confirm officers and registered agent, sign the formation docs, and the platform files them with the state.",
      howto: [
        'Open Incorporation from the Legal sidebar group.',
        'Pick a jurisdiction (Delaware, Wyoming, UK, Singapore, and more supported).',
        'Confirm officers, registered agent, and authorized share count.',
        'Sign the formation packet electronically; the system files with the state and returns the certificate.',
      ],
      tips: [
        'The Compliance calendar auto-seeds standard events for your jurisdiction the moment incorporation completes.',
        'Use the same legal name on the cap table and the formation docs — fixing mismatches later is painful.',
      ],
      related: [
        { label: 'Cap Table', href: '#capital/cap-table' },
        { label: 'Compliance basics', href: '#legal/compliance' },
        { label: 'Section 83(b)', href: '#legal/section-83b' },
      ],
    },
    {
      id: 'cofounder-agreement',
      title: 'Cofounder Agreement',
      overview:
        "The Cofounder Agreement flow generates an NDA-then-equity-split agreement between two founders. It captures equity percentages, vesting (4-year, 1-year cliff default), and IP assignment, and produces a signed PDF for both parties.",
      howto: [
        'Open Cofounder Agreement from the Legal sidebar.',
        'Add your co-founder’s details and confirm equity split.',
        'Both parties sign the NDA, then the full agreement.',
        'Both download a signed PDF; the doc is also stored under your project documents.',
      ],
      tips: [
        'Don’t skip the NDA stage — it protects the conversation if you don’t end up signing the full agreement.',
        'Equity is rarely 50/50 forever — talk about cliff and acceleration before signing.',
      ],
      related: [
        { label: 'Co-founder Match', href: '#validate-grow/cofounder-match' },
        { label: 'Cap Table', href: '#capital/cap-table' },
      ],
    },
    {
      id: 'section-83b',
      title: 'Section 83(b) elections',
      overview:
        "An 83(b) election lets you pay tax on restricted stock at grant rather than at vest, usually saving founders a lot of money over the vesting period. The window is 30 days from grant — the platform tracks the deadline and reminds you.",
      howto: [
        'Open the 83(b) tracker after your founder shares are granted.',
        'Generate the election letter (the form is pre-filled from your cap table).',
        'Print, sign, and mail to the IRS within 30 days of grant.',
        'Upload proof of mailing back into the tracker so the deadline closes.',
      ],
      tips: [
        'Use certified mail with return receipt — that’s your proof of timely filing.',
        'Talk to a tax advisor before filing if your stock has any meaningful value at grant.',
      ],
      related: [
        { label: 'Cap Table', href: '#capital/cap-table' },
        { label: 'Compliance basics', href: '#legal/compliance' },
      ],
    },
    {
      id: 'compliance',
      title: 'Compliance basics',
      overview:
        "The Compliance calendar tracks every annual filing, franchise tax, board minute, and regulatory deadline for your jurisdiction. It auto-seeds standard events when you incorporate and lets you add custom items.",
      howto: [
        'Open Compliance to see your calendar.',
        'Review the auto-seeded events and add reminders.',
        'Mark events complete as you file them; upload proof for audit purposes.',
      ],
      tips: [
        'Delaware franchise tax is due March 1 every year — the most-missed deadline by far.',
        'Board meeting minutes don’t need to be elaborate; a one-page summary is fine.',
      ],
      related: [
        { label: 'Incorporation', href: '#legal/incorporation' },
      ],
    },
    {
      id: 'kyc',
      title: 'KYC',
      overview:
        "KYC (Know Your Customer) verification is required before signing critical legal documents and before LP commitments are accepted. The flow takes 5–10 minutes and uses ID + selfie + address verification.",
      howto: [
        'Open KYC when prompted (or from your account menu).',
        'Upload a government-issued ID (passport or driver’s license).',
        'Take a selfie with the same camera so we can match it.',
        'Confirm your residential address and submit.',
        'Verification typically returns within minutes; pending cases can take up to 24 hours.',
      ],
      tips: [
        'Make sure ID photos are sharp and the full document is in frame — most rejections are blurry photos.',
        'Re-verification is required if your ID expires.',
      ],
      related: [
        { label: 'Privacy & data export', href: '#account/privacy' },
      ],
    },
    {
      id: 'esign',
      title: 'ESign',
      overview:
        "ESign is the in-platform signature flow for every contract, NDA, and agreement. Documents are sent to the right parties, signed in browser, and stored with an audit trail.",
      howto: [
        'When a document needs a signature, you’ll get an in-app notification and an email.',
        'Open the ESign link, review the document, and type your name + click to sign.',
        'You’ll get a copy of the signed PDF; the studio retains the original with full audit log.',
      ],
      tips: [
        'You can decline to sign with a reason — the originator gets notified.',
        'Signatures bind you legally; read the document before clicking.',
      ],
      related: [
        { label: 'Cofounder Agreement', href: '#legal/cofounder-agreement' },
        { label: 'Legal Templates', href: '#legal/templates' },
      ],
    },
    {
      id: 'templates',
      title: 'Legal Templates',
      overview:
        "The Legal Templates library covers the documents most spin-outs need: SAFE, term sheet, stock purchase agreement, bylaws, founder equity split, IP assignment, voting rights, and 83(b) election letter. All are starting points and your spin-out includes attorney review.",
      howto: [
        'Open Legal → Templates.',
        'Pick the template you need; the wizard pre-fills from your project data.',
        'Review and edit; route to the partner attorney for review before signing.',
      ],
      tips: [
        'Never sign a template without attorney review for anything money-related.',
        'Keep a versioned copy of every executed agreement under project documents.',
      ],
      related: [
        { label: 'ESign', href: '#legal/esign' },
        { label: 'Cofounder Agreement', href: '#legal/cofounder-agreement' },
      ],
    },
  ],
};
