export default {
  id: 'capital',
  title: 'Capital & Finance',
  icon: 'DollarSign',
  subsections: [
    {
      id: 'fundraise',
      title: 'Capital (fundraise)',
      overview:
        "Capital is the founder-side fundraise hub. Assemble a SAFE or priced round, set valuation cap and target raise, share a private dataroom with prospective investors, and track commitments as they roll in.",
      howto: [
        'Open Capital from the sidebar.',
        'Create a round (SAFE post-money is the default for first rounds).',
        'Set valuation cap, MFN, raise target, and minimum check size.',
        'Share the dataroom link with investors; track commitments in the round dashboard.',
      ],
      tips: [
        'Build the dataroom before you start outreach — every day of delay loses momentum.',
        'Pick a hard close date and stick to it; rounds without deadlines drag for months.',
      ],
      pitfalls: [
        'Sharing the dataroom link in public channels removes the access trail; always share to a named investor.',
        'Accepting commitments before counter-signing the SAFE leaves you exposed to renegotiation.',
      ],
      related: [
        { label: 'Cap Table', href: '#capital/cap-table' },
        { label: 'Investors & Pipeline', href: '#capital/investors' },
      ],
    },
    {
      id: 'investors',
      title: 'Investors & Pipeline',
      overview:
        "Pipeline is your fundraising CRM. Track every investor conversation from intro → meeting → diligence → committed → wired, with notes and next-step reminders.",
      howto: [
        'Add investors as you meet them; tag firm, lead partner, and stage.',
        'Move cards across columns as conversations progress.',
        'Write a note on each card saying why it moved.',
      ],
      tips: [
        'Pipeline coverage of 5x your raise target is healthy; below 3x means more outreach.',
        'Send a weekly investor update — even rejections often turn into intros.',
      ],
      pitfalls: [
        'Marking an investor as “committed” before the SAFE is signed inflates your pipeline number and misleads you.',
        'Not logging passes denies you the pattern (e.g. five passes for the same reason → fix the pitch).',
      ],
      related: [
        { label: 'Capital (fundraise)', href: '#capital/fundraise' },
      ],
    },
    {
      id: 'cap-table',
      title: 'Cap Table',
      overview:
        "The Cap Table tracks every share, option, SAFE, and warrant your company has issued. Run dilution scenarios, simulate a priced round, and export a clean cap table for investors and your attorney.",
      howto: [
        'Open Cap Table on your startup.',
        'Add founder shares with vesting (default: 4-year vest, 1-year cliff).',
        'Add SAFEs and option pool grants as they happen.',
        'Run scenarios with the simulator to see post-money dilution before agreeing to terms.',
      ],
      tips: [
        'Always model the option pool refresh into the priced round — investors require it.',
        'Export to CSV for your attorney once a round closes; keep the platform copy as the source of truth.',
      ],
      pitfalls: [
        'Forgetting to add the option pool top-up before priced-round modelling understates founder dilution.',
        'Issuing shares outside the platform without back-filling the cap table makes audits and exits painful.',
      ],
      related: [
        { label: 'Capital', href: '#capital/fundraise' },
        { label: 'Section 83(b)', href: '#legal/section-83b' },
      ],
    },
    {
      id: 'funds',
      title: 'Funds and Waterfall',
      overview:
        "Studio operators (and committed LPs with access) use Funds and Waterfall to manage fund-level economics: capital calls and the order of distributions when a deal exits.",
      howto: [
        'Open Funds to view fund-level metrics: TVPI, DPI, called vs. uncalled.',
        'Use Waterfall to simulate distribution priority for a hypothetical exit.',
      ],
      tips: [
        'Run the waterfall in advance of any exit so you can communicate proceeds clearly to LPs.',
      ],
      pitfalls: [
        'Waterfall outputs depend on assumed exit value — always run a base/upside/downside set.',
      ],
      related: [
        { label: 'Investor Portfolio Health', href: '#portals/portfolio-health' },
      ],
    },
    {
      id: 'metrics',
      title: 'Metrics',
      overview:
        "Metrics is the lightweight dashboard for the numbers that matter this month: revenue, active users, burn, runway, and any custom KPIs you’ve added. Investors and admins can view rolled-up versions.",
      howto: [
        'Open Metrics on your startup.',
        'Update the snapshot at the end of each month (revenue, users, burn, runway).',
        'Add custom KPIs as you discover what matters for your business.',
      ],
      tips: [
        'Updating metrics monthly takes 5 minutes and pays back tenfold in investor confidence.',
        'Runway is auto-calculated from cash + monthly burn; double-check it after big spend changes.',
      ],
      pitfalls: [
        'Skipping a month makes the trend chart unreliable — backfill or annotate the gap.',
        'Adding too many custom KPIs makes the dashboard unreadable — keep it to five or fewer.',
      ],
      related: [
        { label: 'Roadmap', href: '#build/roadmap' },
      ],
    },
    // D8994 (#8994): Share outside Axal (D6864, D6897). Every label a step quotes is one the page draws, and every
    // rule is the Worker's own (services/raiseEvidenceShare.ts); help_evidence_share_8994.test.mjs pins both.
    {
      id: 'share-evidence',
      title: 'Raise › Evidence: share evidence outside Axal',
      roles: ['admin', 'founder'],
      overview:
        "Share outside Axal makes a dated copy of the evidence you already share, for a reader who is not on Axal. You get a link, or a PDF copy, and send it yourself: Axal sends nothing. The reader opens the link with no sign-in and sees no more than an invited investor on Axal would see at that point. A Private item, a quote without consent and a file the data room refuses never leave.",
      beforeYouStart: [
        "Only the venture’s founders can share outside Axal. An admin or Super Admin reading the venture gets no Share outside Axal action and cannot open its Shared links.",
        'At least one item at Raise › Evidence is shared beyond Private, as Summary or After NDA. Until then the sheet says “Nothing is shared beyond Private yet, so there is no pack to make.”',
      ],
      howto: [
        'Open Raise › Evidence (/raise/evidence) and choose Share outside Axal, beside Add evidence. The Evidence pack sheet opens.',
        'Under Output choose Link or PDF. A link is dated, has an expiry and a view limit, and you can revoke it. A PDF is an A4 page you download and send yourself; it cannot be stopped or counted.',
        'Under Who reads it, keep Before an NDA: coverage only, or choose An NDA is signed outside Axal. For the second, tick “I confirm an NDA with this reader is signed outside Axal.” and enter Day the NDA was signed, which cannot be in the future. Axal stores your confirmation and that day; it does not hold or check the NDA.',
        'Enter a Label, such as who the pack is for, in up to 80 characters. For a link, set Expires after (days), from 1 to 90 (14 unless you change it), and View limit, from 1 to 100 (10 unless you change it).',
        'Check The reader sees. Before an NDA every row reads coverage only. After an NDA each item reads Summary with figure, Summary, no figure, Summary · Not recorded, or Value withheld with its reason; untick an item under Items in this pack to leave it out.',
        'Choose Create pack, or Download PDF for a PDF. For a link, Pack ready shows it and says “Nothing was sent. Copy the link and send it yourself.” Use Copy link. The pack carries no file: to let this reader open files, give them Data room access.',
        'To share your readiness instead, open Raise › Fundraising readiness (/raise/fundraising-readiness) and choose Share outside Axal. The Readiness snapshot sheet takes Who it is for, an optional Covering line of one sentence (at most 200 characters), Link or PDF, and the same expiry and Views allowed. Choose Create link.',
        'What the reader sees at /share/evidence/<link>: a page headed Evidence pack with your venture’s name, dated “As of” the day you made it, saying “This pack does not update”. Before an NDA it shows What is on record: area, kind, source, how many and the newest day, with no figures, files or quotes. After an NDA it shows Evidence, each item with its source, day and strength, a figure only for items you share After NDA, and Value withheld with its reason. Claims these items back gives each claim’s state in words. A Mismatch is never hidden, and the note you wrote on it shows under it as Founder’s note while it was written against the figure you still state. The footer gives the day the link expires. There is no sign-in and no Eadwyn.',
        'A readiness snapshot reader, at /share/readiness/<link>, sees the seven readiness areas, each with its score out of 10, its evidence, what is missing and the day it was scored. An area with no score reads Not scored yet, never 0; Team reads Team is assessed by a person. There is no overall score and no Product-market fit row.',
        'To follow or stop a link, open Shared links (/raise/evidence/shared). Each row gives what it shares, the item count, when it was created and expires, views against the limit, when it was last opened, and its state: Live, Expired, Used up or Revoked. On a Live row choose Revoke, review what it stops, and confirm Revoke link.',
        'Outcome: the reader opens the dated copy until it expires, uses its last view or is revoked. After that they see only a page that says why: This link has expired, This link has been opened as many times as its sender allowed, or This link was stopped by the founder. An unknown or mistyped address says This link does not open anything. None of these pages names the venture or shows any evidence, and none uses a view. A revoked, expired or used-up row stays on Shared links, in grey.',
      ],
      tips: [
        'For a pack after an NDA, Ask Eadwyn under The reader sees proposes a selection of items for one reader you describe, and on a readiness snapshot Use Eadwyn’s draft offers a covering line. Each run shows its cost and runs only when you confirm it. Accept selection only ticks rows, and an accepted line stays yours to edit; you still make the pack, and nothing is sent.',
        'Shared links lists your readiness snapshots and Raise status pages beside your evidence packs, and your PDF copies apart under PDF copies, so you can see everything that left Axal in one place.',
      ],
      pitfalls: [
        'Every open uses one view, including the same reader opening the page again or reloading it. Set the view limit with that in mind.',
        'A pack is frozen when you make it and the reader’s copy never changes. When your evidence changes, a Live row says Changed since sent; choose Make a new pack, send the new link, and revoke the old one if it should stop. Could not be compared means the current evidence could not be read, not that nothing changed.',
        'Revoking stops the link, not a PDF copy that already left. A PDF cannot be stopped and its opens are not counted.',
        'The link is the only key: anyone who holds a live link can open it. Send it only to the reader you labelled it for.',
      ],
      related: [
        { label: 'Data Room', href: '#validate-grow/data-room' },
        { label: 'NDA flows', href: '#legal/nda' },
        { label: 'Sharing your pitch deck via a link', href: '#build/deck-share-viewer' },
        { label: 'AI allowance and token balance', href: '#account/balances' },
        { label: 'Contact support', href: '#troubleshooting/contact-support' },
      ],
    },
  ],
};
