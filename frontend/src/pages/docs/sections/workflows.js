// D4639 (#4639): task-oriented guides for current Research, Email, Validate, Network, Build, Grow and connected workflows.
// Routes and role gates were rechecked against frontend/src/App.jsx on the implementation branch.
// A route being registered does not establish that a provider is configured or a production action succeeded.
// D7515 (#7515): each guide's "Prerequisite:" step moved into `beforeYouStart`, its own section on the guide page, with the "Prerequisite:" label dropped and the first letter capitalised; no other word changed.
// D4639 part 2: the steps name the buttons and labels the current pages and Worker record actions draw; prerequisites stay in `beforeYouStart`.
export default {
  id: 'workflows',
  title: 'Current workflows',
  icon: 'Compass',
  subsections: [
    {
      id: 'research',
      title: "Research: check sources and keep an answer",
      roles: ['admin', 'founder', 'partner', 'investor', 'advisor'],
      overview: "Use Research Ask to keep an answer with its sources. The Library holds source documents and their indexing status. An accessible route does not guarantee a source has fresh data.",
      beforeYouStart: [
        'Sign in with an eligible role and choose the correct company or research context. Start at /research/ask.',
      ],
      howto: [
        "Ask a specific question. Use /research/markets for a market reading or /research/geographies for a country profile.",
        "Check which directories your workspace offers. Companies (/research/companies) is available in the standard founder, advisor and admin roles. Funds (/research/funds) is available in the standard founder and admin roles. An admitted Spin-Out Lab project may have additional route access. A missing role-gated page is not a failed search.",
        "On the answer, find Sources cited and choose a citation or Open passage. Compare the passage with the claim and check any dates shown. The separate Retrieved, not cited list contains material the search found without citing it.",
        "Choose Keep on the answer. When it shows Kept, open Saved answers in Ask to find it again. Choose Copy with citations to reuse it. To inspect the underlying documents or their indexing status, open /research/library.",
        "Outcome: you can find the answer under Saved answers and inspect its cited passage. If retrieval was unavailable, ask the question again. A missing save or an unreadable source is not evidence that no data exists. For a persistent failure, report the affected Research screen and status through Contact support.",
      ],
      tips: [
        "If your workspace offers an AI run with an estimate, check the displayed allowance and balance before approving it.",
      ],
      pitfalls: [
        "An unreadable source or a missing observation date leaves the claim unverified. An empty search and a search that could not run have different meanings.",
      ],
      related: [
        { label: "AI allowance and token balance", href: "#account/balances" },
        { label: "Contact support", href: "#troubleshooting/contact-support" },
      ],
    },
    {
      id: 'email',
      title: "Email: connect a mailbox, send and check the result",
      roles: ['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'],
      overview: "Email shows the address it will send from and whether the connection can read replies. You choose which of a person’s records Eadwyn can use in a draft.",
      beforeYouStart: [
        'Sign in and open /email or /email/settings. When no connected sending account is available, use the offered Connect panel and inspect provider permissions.',
      ],
      howto: [
        "On /email choose Email settings (/email/settings). Under Mailboxes, check the address and whether it says sends only or sends and shows replies. Use Connect for an offered provider and review its consent screen. For an existing connection, Check again reads its status. If the page says the connection expired, use its Reconnect action.",
        "Return to Email and check the mailbox shown at the top. The composer uses the first active mailbox. Choose a person. For a Network match, choose Share your email address and confirm Yes, share it. Both people must share before either sees the address. To revoke your share, choose Stop sharing and confirm.",
        "In What Eadwyn knows, turn off records to exclude, then choose Draft an email. Under What is it for, choose a purpose, check the estimate, and choose Draft with Eadwyn. Review the recipient, subject and body, or use Open draft to resume a saved version.",
        "Check the address in Send from, then confirm with Send now. The person’s conversation and the Sent log in Email settings show the recorded outcome. Gmail does not read your inbox, so replies stay in Gmail. A mailbox marked sends and shows replies shows replies only from people you wrote to here.",
        "Outcome: a saved draft or a recorded send result. For Not sent, read the provider’s refusal and correct the problem before trying again. If the composer shows Not confirmed, check the sending provider’s Sent folder first. Only when you know the outcome, choose It arrived or It did not arrive. If still uncertain, leave it unresolved and contact support before attempting a new send.",
      ],
      tips: [
        "When a sharing or mailbox read fails, use Try again. If it keeps failing, report the screen and status to support without an address, message text or provider credential.",
      ],
      pitfalls: [
        "Provider acceptance records the send. It does not establish that the recipient opened the email. Disconnecting a mailbox and stopping address sharing are separate controls.",
      ],
      related: [
        { label: "AI allowance and token balance", href: "#account/balances" },
        { label: "Privacy and data controls", href: "#account/privacy" },
        { label: "Contact support", href: "#troubleshooting/contact-support" },
      ],
    },
    {
      id: 'record-discovery',
      title: 'Validate: record and review discovery evidence',
      roles: ['admin', 'founder'],
      overview: 'Record an interview for a venture you can manage. The session keeps the transcript, speaker assignments and suggested findings together so you can check each finding against what the participant said. An uploaded or scheduled recording is not proof of a usable transcript.',
      beforeYouStart: [
        'Choose the correct venture, explain the purpose of recording and obtain the participant consent required for your channel and jurisdiction.',
      ],
      howto: [
        'Open /validate/record for the interview. Record the consent method the participant used, such as Said yes, out loud or In writing. Stop if they decline.',
        'For an in-person audio session, finish setup, choose Start recording and allow microphone access. Choose Stop when the interview ends, review the processing choice, and confirm. For a meeting bot, check the session record for capture status before expecting a transcript.',
        'Reopen the saved session from the interview, or use /validate/inbox for a channel conversation. On the transcript, select the correct speaker for a mislabeled passage. In Review, follow Heard in to the source and compare the quote with the proposed finding. Choose Accept, Edit then Save and accept, or Discard.',
        'In Problem discovery, choose Assign to a theme beside an unthemed quote. In Experiments and evidence, use Link to a pain to connect a hypothesis and its theme. At /validate/verdict choose Record a decision, select the venture or hypothesis under For, review Evidence it rests on, and record your own decision.',
        'If the recording is live in another tab, return to that tab. After an interruption, Resume here continues from the saved audio when offered. For failed processing use Try again on the existing session. For a failed bot capture use Try again with a new session, or import a recording or transcript you have permission to use.',
        'Outcome: the accepted finding appears in its destination and the decision cites the evidence you chose. If the session says Unreadable, its status is unknown, not ready. If it still fails, give Support the affected screen and processing stage. Omit participant details and interview content.',
      ],
      tips: ['A proposed finding keeps its citation. The session review lets you correct speaker assignments and edit findings before accepting them.'],
      pitfalls: ['A meeting invitation, queued session or missing transcript does not establish that the interview was captured.'],
      related: [
        { label: 'Customer Discovery', href: '#build/customer-discovery' },
        { label: 'Privacy, visibility and data export', href: '#account/privacy' },
        { label: 'AI allowance and balances', href: '#account/balances' },
        { label: 'Contact support', href: '#troubleshooting/contact-support' },
      ],
    },
    {
      id: 'introductions',
      title: 'Network: request and follow an introduction',
      roles: ['admin', 'founder', 'partner', 'investor', 'advisor'],
      overview: 'Open /network/introductions to follow requests involving you. A teammate request, a curated match and an investor request have different actions and allowance rules. Use the record that matches your task.',
      beforeYouStart: [
        'Sign in with a permitted role and open /network/introductions; confirm whose company or relationship is in scope.',
      ],
      howto: [
        'To ask a teammate, open a Capital relationships investor record or Deal flow company record you can access. Under Who knows them, choose the teammate who shared the connection. Enter the reason, review the optional context, and choose Send request. Only the teammate receives the request. They may forward the context when they contact the person.',
        'Under Asked of you, choose Accept or Not now. An optional decline note is visible to the requester. The requester can use Withdraw on a pending request. After acceptance choose Write the intro, check the sender and recipients, and send when ready.',
        'For a curated match with answer controls, inspect the counterpart and each consent state. Review the credit disclosure before selecting Accept. Declining spends no credit. Both sides must agree to advance. An expired or lapsed row is closed to a new answer.',
        'Investors can use Request an intro on an eligible founder or project row in Network. After submitting, check the recorded request and the asks left this quarter before trying again. For NDA-protected deal files, choose Sign the NDA in the deal, then Send it for signature and Review and sign when offered. The investor, founder and Axal VC must all sign before eligible NDA files open.',
        'Check the team introduction log after sending. If sending is still in progress, reload in a moment. For an unconfirmed send, check the sending mailbox’s Sent folder before confirming its outcome. If the mail server accepted it but the log is pending, choose Update the record. That updates the log without resending. A confirmed failed send allows you to write it again.',
        'Outcome: you can identify who has agreed and what happened to the send. A subsequent meeting or referral requires its own recorded outcome. If the log and mailbox still disagree, contact Support with the affected screen and displayed status. Leave names and addresses out of the ticket.',
      ],
      tips: ['Consult the balances and investor billing guides for the current allowance and where to see usage.'],
      pitfalls: ['A pending investor request or a spent credit does not establish signature, delivery or a meeting.'],
      related: [
        { label: 'Relationships', href: '#network/relationships' },
        { label: 'Introduction credits', href: '#account/balances' },
        { label: 'Investor plans and billing', href: '#account/investor-billing' },
        { label: 'Contact support', href: '#troubleshooting/contact-support' },
      ],
    },
    {
      id: 'build-week',
      title: 'Build: run a weekly operating cycle',
      roles: ['admin', 'founder'],
      overview: 'Use the same selected startup across This week, Board, Roadmap, Cadence and KPI entry. Each view keeps a different record of the week.',
      beforeYouStart: [
        'Choose the correct venture; open /build/this-week and identify the outcomes for the current week.',
      ],
      howto: [
        'At /build/this-week confirm Selected startup. Current commitment records shows key results on objectives in the roadmap’s Now column. Use Carried only and Commitment history to see work carried from an earlier week. Configure zone opens the roadmap editor if the commitments need to change.',
        'At /build/board select the work cards, choose Bulk move, select a lane or status, and confirm the move. Use Blocked for work that cannot proceed. If the move would put a lane over its WIP limit, none of the cards move. Choose fewer cards or a lane with capacity, then check the rows.',
        'At /build/roadmap choose Edit dependency links to connect a waiting objective with the one it depends on. Review the dependency chain. Keep unfinished work in Now for the next review if it remains a commitment.',
        'At /build/cadence choose an active ritual or add one first. Use File a review, choose the ritual, enter its date, state and what came out of it, and select File review. Check the Review archive for the entry and record what you will carry forward.',
        'At /build/kpi use Import CSV for monthly measurements. Paste the data, select Check the file, correct any refused lines, and confirm Import for the displayed count. Verify the stored figures in Snapshot history. When no snapshot is recorded, Enter a month opens Grow’s revenue and traction workspace. If no source exists, leave the figure Not recorded instead of estimating.',
        'To remove a mistaken feature, open its record in /build/solution-design and choose Remove feature from the actions, then confirm with Remove feature. To keep the feature but take it off the must-have list, open its record in /build/prototype-mvp and choose No longer a must-have, then confirm with Remove from must-haves.',
        'Outcome: the venture has identifiable commitments, blocked work, a filed review and dated figures. If a read or save fails, reopen the same startup and check the stored row before repeating the write. Give Support the startup, affected view and error if the discrepancy persists.',
      ],
      tips: [
        'A KPI read error means Unreadable, not zero.',
        'Carryover is derived from recorded column moves. A key result from before that history began can appear in Now without a logged move.',
        'The Build Plan keeps its original acceptance and shows Feature removed or No longer a must-have when the target leaves the list.',
      ],
      pitfalls: [
        'A missing measurement remains unrecorded. A scheduled ritual acquires a review outcome only after someone files it.',
        'Removing a feature is permanent and removes its design links and release checks. Linked roadmap items, risks or test sessions prevent removal. No longer a must-have keeps the feature and its related work.',
      ],
      related: [
        { label: 'Roadmap', href: '#build/roadmap' },
        { label: 'Contact support', href: '#troubleshooting/contact-support' },
      ],
    },
    {
      id: 'grow',
      title: 'Grow: focus, attention and operating workspaces',
      roles: ['admin', 'founder'],
      overview: 'The Grow overview puts the selected venture’s focus and recorded next actions before its operating workspaces. Overview, Focus, Customers, Distribution, Talent, Partnerships, Markets and Company share one navigation vocabulary; Reporting is a utility.',
      howto: [
        'Open the correct venture at /grow. This overview needs the founder role; without it, /grow opens /grow/focus instead. Needs your attention ranks recorded setup gaps, source problems and pending work; a failed read is not treated as an empty record.',
        'Use the primary action: Set focus metric, Record the first value or Review growth, or Share an update when a report is due. Share an update also stays available in the page header.',
        'At /grow/focus confirm Selected startup. Choose a target, set its metric and value with Set target if needed, then choose the Focus metric and Set focus. Check This month’s focus to verify it. To switch a recorded focus, first use Clear focus.',
        'At /grow/talent use Manage applicants or Open roster and hiring plan to work on the underlying team records. At /grow/customers inspect the stored customer source and stage, then use Open customer discovery to inspect the source records.',
        'At /grow/partnerships inspect each partner, its recorded state and Delivered so far. At /grow/launch check the dated project-linked items, use Open calendar to inspect an event and Open co-marketing workspace for the underlying records. A calendar entry alone supplies no registration or publication outcome.',
        'Use Brand at /build/brand for venture branding. Open /grow/reporting for the reporting desk. Advisors and partners can also open the reporting routes their account permits. The report edit route is available to founders and admins.',
        'Open a sent report and choose Print or save as PDF to keep its frozen figures, sources, narrative and revision. Choose a printer or Save as PDF in your browser. Download any attached documents separately.',
        'Outcome: the selected focus is visible and each activity you report is backed by its source record. If a source says Unavailable, confirm the startup and choose Retry. Report the affected view and error through Contact support if it stays unreadable.',
      ],
      tips: [
        'Connect each activity to a measurable outcome and date when the corresponding store supports them.',
        'When an applicant list or event feed is empty, check the selected startup and the underlying workspace before creating another record.',
      ],
      pitfalls: [
        'Do not assume that an external report or service has been delivered merely because a Grow card exists.',
        'Missing attribution or a failed read cannot establish zero leads.',
      ],
      related: [
        { label: 'Brand Builder', href: '#build/brand-builder' },
        { label: 'Contact support', href: '#troubleshooting/contact-support' },
      ],
    },
    {
      id: 'connector-recovery',
      title: "Connectors: recover from a failed or paused connection",
      roles: ['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'],
      overview: "Open the provider’s page to see its last sync, company scope, status and available actions.",
      howto: [
        "Open /account/connectors. In Yours or the connected list, open the provider and check its status and Last sync. Use the table below to choose your next step.",
        "For a registry connection, open Activity to check the latest result. If Activity cannot be read, use its Retry to read it again.",
        "If Axal VC says the provider is not set up, contact support with the provider name and the status shown.",
        "Outcome: the latest status confirms recovery for the intended company, or you can identify the reason the connection is still unavailable.",
      ],
      recoveryRows: [
        { status: "Sign-in expired", action: "Use Reconnect or Sign in again on the provider’s page. Sign in with the intended account and check the connection afterward." },
        { status: "Daily limit reached", action: "Wait for the provider’s quota to reset. Check the latest result after the next sync." },
        { status: "Last sync failed", action: "Read the error and the time of the last successful sync. Choose Sync now when offered, then check Activity for its result." },
        { status: "Paused", action: "Review the connection settings. Check with the owner before restarting a sync. A paused connection may still show data from its last successful sync." },
        { status: "Company required or wrong company", action: "Select the intended company in the sidebar. On a connection with a Companies list, check which authorized companies are enabled. Some personal connections apply only to your account." },
        { status: "Permission refused", action: "Read the refusal. For a provider denial, ask its administrator to allow the required access. If StudioOS says the sign-in asked for more than it uses, report it through Contact support. This refusal leaves the connection unapproved." },
      ],
      tips: [
        "For a connector that reads on request, use its displayed read status. It may have no scheduled sync time.",
      ],
      pitfalls: [
        "A previously successful sync can leave older data visible while the latest sync has failed. A waitlist or a request for a connector does not create a connection.",
      ],
      related: [
        { label: "An integration shows as disconnected", href: "#troubleshooting/integration-disconnected" },
        { label: "Privacy and data controls", href: "#account/privacy" },
        { label: "Contact support", href: "#troubleshooting/contact-support" },
      ],
    },
    {
      id: 'connected-assistants',
      title: "Connected assistants: approve company access and revoke a grant",
      roles: ['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'],
      overview: "Account → Builder manages assistants that call StudioOS through MCP. The available Validate tools depend on the companies your account owns, the server setting and the permissions granted.",
      howto: [
        "Open /account/builder and the MCP and services page. From /account/connectors, choose Open Builder. If the endpoint says Switched off, setup is unavailable. If you see Nothing to approve yet, check whether you own an eligible company or have an admitted Spin-Out Lab project.",
        "With the endpoint on, choose Copy beside axal.vc/mcp and paste the address into a compatible assistant’s custom remote MCP setup. Use the assistant’s sign-in flow. On the StudioOS approval screen, check the companies and requested permissions before approving.",
        "Return to Builder. Under Who can call for you, find the assistant and choose Open. Inspect its companies, connected date, last call and permissions when provided. If the permission details are unavailable, keep that scope unverified.",
        "To remove that assistant’s access, choose Revoke on its row or detail page. Check the companies listed in the confirmation, then choose Revoke again. If the connection list cannot be read, use Try again.",
        "Outcome: the authorized assistant appears under Who can call for you, or its grant is removed after revocation. For a persistent setup or read error, contact support with the screen and status, omitting credentials and private company data.",
      ],
      tips: [
        "Assistant sign-in and API keys for scripts are separate options in Builder. Review the active company and permissions for the connection you actually use.",
      ],
      pitfalls: [
        "An assistant connection can exist without an eligible company to act on. An assistant’s own plan and support for remote MCP may also limit the tools it can use.",
      ],
      related: [
        { label: "Privacy and data controls", href: "#account/privacy" },
        { label: "Contact support", href: "#troubleshooting/contact-support" },
      ],
    },
  ],
};
