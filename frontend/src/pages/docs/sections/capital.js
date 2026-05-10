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
        "Pipeline is your fundraising CRM. Track every investor conversation from intro → meeting → diligence → committed → wired, with notes, next-step reminders, and decision-journal entries.",
      howto: [
        'Add investors as you meet them; tag firm, lead partner, and stage.',
        'Move cards across columns as conversations progress.',
        'Use the Decision Journal to capture why you said yes or no to each.',
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
        'Open Cap Table on your project.',
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
      title: 'Funds, Reserves, Waterfall',
      overview:
        "Studio operators (and committed LPs with access) use Funds, Reserves, and Waterfall to manage fund-level economics: capital calls, follow-on reserves, and the order of distributions when a deal exits.",
      howto: [
        'Open Funds to view fund-level metrics: TVPI, DPI, called vs. uncalled.',
        'Use Reserves to model follow-on allocations across the portfolio.',
        'Use Waterfall to simulate distribution priority for a hypothetical exit.',
      ],
      tips: [
        'Reserve modeling matters more than initial check sizing — most fund returns come from doubling down on winners.',
        'Run the waterfall in advance of any exit so you can communicate proceeds clearly to LPs.',
      ],
      pitfalls: [
        'Modelling reserves as a flat per-deal number ignores winner concentration; use a power-law assumption.',
        'Waterfall outputs depend on assumed exit value — always run a base/upside/downside set.',
      ],
      related: [
        { label: 'Investor Portfolio Health', href: '#portals/portfolio-health' },
      ],
    },
    {
      id: 'liquidity',
      title: 'Liquidity events',
      overview:
        "Liquidity covers secondary share sales, tender offers, and full exits. Founders, employees, and early investors can list shares; admins manage approvals and AI-generated fair-value bands.",
      howto: [
        'Open Liquidity from the sidebar.',
        'Create a listing (number of shares, price expectation, lock-up status).',
        'Wait for buyer matching — listings get a fair-value band based on recent rounds.',
        'Admins approve the trade and update the cap table on settlement.',
      ],
      tips: [
        'Buyer matching is anonymized — no email or exact amount is shared with the matching engine.',
        'Some shares are restricted by company bylaws — check the right-of-first-refusal clause first.',
      ],
      pitfalls: [
        'Listing shares that are still inside a lock-up window will be auto-rejected — check the lock-up date first.',
        'Pricing far above the fair-value band sits unmatched; price near the band for a faster trade.',
      ],
      related: [
        { label: 'Cap Table', href: '#capital/cap-table' },
      ],
    },
    {
      id: 'metrics',
      title: 'Metrics',
      overview:
        "Metrics is the lightweight dashboard for the numbers that matter this month: revenue, active users, burn, runway, and any custom KPIs you’ve added. Investors and admins can view rolled-up versions.",
      howto: [
        'Open Metrics on your project.',
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
  ],
};
