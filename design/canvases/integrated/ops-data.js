// Screen registry for Ops Page.dc.html — every label and count is a field here, never typed into markup.
(function(){
const pill = (fg, bg, bd) => 'font-size:11px;font-weight:600;border-radius:99px;padding:2px 8px;white-space:nowrap;color:' + fg + ';background:' + bg + ';border:1px solid ' + (bd || bg);
const ST = {
  grey: pill('#6b6577', '#f4f3f7', '#ececf1'), violet: pill('#6d28d9', '#f4f0fe', '#ddd0fb'), amber: pill('#92400e', '#fcd34d'),
  ok: pill('#047857', '#ecfdf5', '#a7f3d0'), bad: pill('#b91c1c', '#fef2f2', '#fecaca'),
  nr: 'font-size:11px;font-weight:500;color:#6b6577;background:#f4f3f7;border:1px dashed #d4d1dc;border-radius:99px;padding:2px 8px;white-space:nowrap',
};
const mono = "font:500 12px 'Roboto Mono',monospace";
const btn = { primary: 'font-size:12.5px;font-weight:600;color:#fff;background:#7c3aed;border-radius:9px;padding:8px 13px;white-space:nowrap', ghost: 'font-size:12.5px;font-weight:600;padding:8px 13px;border-radius:9px;border:1px solid #ececf1;white-space:nowrap', danger: 'font-size:12.5px;font-weight:600;color:#b91c1c;padding:8px 13px;border-radius:9px;border:1px solid #fecaca;white-space:nowrap', link: 'font-size:12.5px;font-weight:600;color:#6d28d9;white-space:nowrap' };
const toggle = (on) => ({ wrap: 'width:34px;height:20px;border-radius:99px;position:relative;flex:none;background:' + (on ? '#7c3aed' : '#d4d1dc'), knob: 'position:absolute;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;' + (on ? 'right:2px' : 'left:2px') });

const screens = {};

/* ───────── ADVISOR PRACTICE ───────── */
const advList = (search, filters, sort, count) => ({ search, filters, sort, count });
screens['adv-deliverables'] = {
  area: 'Practice', route: '/practice/deliverables', sideActive: 'Practice',
  head: { h1: 'Deliverables', sub: 'What you owe each client, with its status. Edit a row or change its status from the row.', cta: 'New deliverable' },
  list: advList('Search deliverables…', ['Client', 'Status', 'Due'], 'Due date', '1–25 of [N]'),
  rail: { title: 'Status update', body: 'Draft a one-paragraph update to [Client] on the three deliverables due this month.', writes: 'Accept writes a draft message. It does not send it or change a status.' },
  states: { empty: 'No deliverables yet for this client.', emptyCta: 'New deliverable', nr: 'Due date: none was set when the deliverable was created.', unread: 'Deliverables could not be read just now.' },
  vals: {
    clients: ['[Client company]', '[Client company]'].map((name, i) => ({ name, count: '[n] deliverables', rows: [
      { t: '[Deliverable title]', due: '[12 Oct]', st: 'Planned', stStyle: ST.grey, att: 'Attach', attStyle: btn.link },
      { t: '[Deliverable title]', due: '[19 Oct]', st: 'In progress', stStyle: ST.violet, att: '[file.pdf]', attStyle: btn.link },
      { t: '[Deliverable title]', due: '[3 Oct]', st: 'Delivered', stStyle: ST.amber, att: '[file.pdf]', attStyle: btn.link },
      { t: '[Deliverable title]', due: '[26 Sep]', st: 'Accepted', stStyle: ST.ok, att: '[file.pdf]', attStyle: btn.link },
    ].slice(0, i === 0 ? 4 : 2) })),
    statusFlow: ['Planned', 'In progress', 'Delivered', 'Accepted'].map((t, i) => ({ t, style: i === 1 ? ST.violet : ST.grey })),
  },
};
screens['adv-sessions'] = {
  area: 'Practice', route: '/practice/session-types', sideActive: 'Practice',
  head: { h1: 'Session types', sub: 'What a client can book. Each type has a length, a price or "included", and a bookable switch.', cta: 'New session type' },
  rail: { title: 'Description', body: 'Draft a two-line description for [Session type] from its length and what past clients booked it for.', writes: 'Accept writes the description. It does not change the price.' },
  states: { empty: 'No session types yet. Clients cannot book until one is bookable.', emptyCta: 'New session type', nr: 'Price: not set. The type shows as "included" only if you mark it so.', unread: 'Session types could not be read just now.' },
  vals: {
    types: [
      { name: '[Session type]', len: '[30 min]', price: '[€150]', priceNote: '', bookable: true, bookings: '[n] booked' },
      { name: '[Session type]', len: '[60 min]', price: '[€280]', priceNote: '', bookable: true, bookings: '[n] booked' },
      { name: '[Session type]', len: '[45 min]', price: 'Included', priceNote: 'in the engagement', bookable: false, bookings: '[n] booked' },
      { name: '[Session type]', len: '[90 min]', price: '', priceNote: 'Not recorded · no price set', bookable: false, bookings: '—' },
    ].map(t => Object.assign(t, toggle(t.bookable), { bookableT: t.bookable ? 'Bookable' : 'Not bookable', hasPrice: !!t.price })),
    editor: [{ k: 'Name', v: '[Session type]' }, { k: 'Length', v: '[60] min' }, { k: 'Price', v: '[€280] · or "included"' }, { k: 'Bookable', v: 'Yes' }],
  },
};
screens['adv-links'] = {
  area: 'Practice', route: '/practice/booking-links', sideActive: 'Practice',
  head: { h1: 'Booking links', sub: 'One link per session type. Copy it, switch it off, and see the bookings it received.' },
  list: advList('Search bookings…', ['Session type', 'Client', 'Date'], 'Newest', '1–25 of [N]'),
  rail: { title: 'Follow-up', body: 'Draft a follow-up to the [n] people who opened a link this week and did not book.', writes: 'Accept writes drafts. It does not send them.' },
  states: { empty: 'This link has received no bookings yet.', emptyCta: 'Copy link', nr: 'Opens: this link was created before open-tracking started.', unread: 'Bookings could not be read just now.' },
  vals: {
    links: [
      { type: '[Session type]', url: 'axal.vc/book/[handle]/[slug]', on: true, opens: '[n] opens', booked: '[n] bookings' },
      { type: '[Session type]', url: 'axal.vc/book/[handle]/[slug]', on: true, opens: '[n] opens', booked: '[n] bookings' },
      { type: '[Session type]', url: 'axal.vc/book/[handle]/[slug]', on: false, opens: 'Not recorded', booked: '[n] bookings' },
    ].map(l => Object.assign(l, toggle(l.on), { onT: l.on ? 'Enabled' : 'Disabled' })),
    bookings: [1, 2, 3, 4, 5].map(i => ({ who: '[Client name]', co: '[Client company]', type: '[Session type]', when: '[12 Oct] · [14:00]', st: i === 2 ? 'Cancelled' : i === 4 ? 'Completed' : 'Upcoming', stStyle: i === 2 ? ST.grey : i === 4 ? ST.ok : ST.violet })),
  },
};
screens['adv-access'] = {
  area: 'Practice', route: '/practice/access-log', sideActive: 'Practice',
  head: { h1: 'Client data access log', sub: 'Who opened which client record, and when. Read-only. The client company sees the same log for its own records.' },
  list: advList('Search by record…', ['Client', 'Date range', 'Who'], 'Newest', '1–25 of [N]'),
  rail: false,
  states: { empty: 'No access recorded for this client in this period.', emptyCta: 'Clear filters', nr: 'Record name: the record was deleted after it was opened.', unread: 'The access log could not be read just now.' },
  vals: {
    access: [1, 2, 3, 4, 5, 6].map(i => ({ who: i % 3 === 0 ? '[Client member]' : '[You]', whoStyle: i % 3 === 0 ? ST.grey : ST.violet, rec: ['[Cap table]', '[Pitch deck v4]', '[Data room · Financials]', '[Roadmap]', '[Interview log]', '[Cap table]'][i - 1], client: '[Client company]', when: '[12 Oct] · [09:4' + i + ']', how: i % 2 ? 'Opened' : 'Downloaded' })),
    viewers: [{ t: 'Advisor view', d: 'Every record you opened, across your clients.', on: true }, { t: 'Client company view', d: 'Every record of theirs you opened. Same rows, their side.', on: false }],
  },
};
screens['advpub-profile'] = {
  area: 'Advisor', route: '/advisors/[handle]', sideActive: 'Network', role: 'member', rail: false,
  head: { h1: '[Advisor name]', sub: '[One-line positioning] · [Sector], [Sector] · [City]' },
  states: { empty: 'This advisor has no bookable session yet.', emptyCta: 'Request an introduction', nr: 'Rate: this advisor has not published a price for this session.', unread: 'The profile could not be read just now.' },
  vals: {
    expertise: ['[Expertise]', '[Expertise]', '[Expertise]', '[Expertise]', '[Expertise]'],
    pubTypes: [
      { name: '[Session type]', len: '[30 min]', price: '[€150]', cta: 'Book' },
      { name: '[Session type]', len: '[60 min]', price: '[€280]', cta: 'Book' },
      { name: '[Session type]', len: '[45 min]', price: 'Included in engagement', cta: 'Book' },
    ],
    proof: [{ k: 'Engagements', v: '[n]' }, { k: 'Since', v: '[2024]' }, { k: 'Response', v: '[within 2 days]' }],
  },
};

/* ───────── WELLBEING ───────── */
screens['wb-home'] = {
  area: 'Wellbeing', route: '/wellbeing', sideActive: 'Studio', role: 'member',
  head: { h1: 'Wellbeing', sub: 'A weekly check-in, your bookings with experts, and resources. Check-ins are stored encrypted; only you can read them.' },
  rail: { title: 'Pattern', body: 'Describe how your five scores moved over the last [8] weeks, in plain words.', writes: 'Accept writes a private note to this week. Nothing leaves your account.' },
  states: { empty: 'No check-in this week yet.', emptyCta: 'Check in', nr: 'Past weeks: no check-in was recorded for [week].', unread: 'Your check-ins could not be read just now.' },
  vals: {
    scores: ['Stress', 'Sleep', 'Support', 'Decisions', 'Energy'].map((k, i) => ({ k, dots: [1, 2, 3, 4, 5].map(n => ({ n, style: 'width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font:500 12px \'Roboto Mono\',monospace;' + (n <= [3, 4, 2, 4, 3][i] ? 'background:#7c3aed;color:#fff' : 'background:#fff;border:1px solid #ececf1;color:#6b6577') })) })),
    weeks: ['Stress', 'Sleep', 'Support', 'Decisions', 'Energy'].map((k, i) => ({ k, path: ['M0 22 L18 14 L36 18 L54 10 L72 12 L90 6 L108 9 L126 4', 'M0 10 L18 12 L36 8 L54 14 L72 9 L90 11 L108 7 L126 8', 'M0 18 L18 20 L36 16 L54 18 L72 14 L90 16 L108 12 L126 14', 'M0 12 L18 8 L36 10 L54 6 L72 9 L90 5 L108 8 L126 4', 'M0 16 L18 18 L36 12 L54 14 L72 10 L90 12 L108 8 L126 10'][i] })),
    bookingTabs: [{ t: 'Upcoming', on: true }, { t: 'Past', on: false }].map(x => ({ t: x.t, style: 'font-size:12.5px;font-weight:600;padding:6px 10px;border-radius:7px;' + (x.on ? 'background:#f4f0fe;color:#6d28d9' : 'color:#6b6577') })),
    bookings: [{ who: '[Expert name]', svc: '[Service]', when: '[14 Oct] · [10:00]', len: '[50 min]' }, { who: '[Expert name]', svc: '[Service]', when: '[21 Oct] · [10:00]', len: '[50 min]' }],
    resources: [{ kind: 'Article', t: '[Resource title]', meta: '[6 min read]' }, { kind: 'Audio', t: '[Resource title]', meta: '[12 min]' }, { kind: 'Video', t: '[Resource title]', meta: '[8 min]' }],
  },
};
screens['wb-book'] = {
  area: 'Wellbeing', route: '/wellbeing/book', sideActive: 'Studio', role: 'member', rail: false,
  head: { h1: 'Book an expert', sub: 'Four steps: expert, service, time, confirm. Bookings are visible to you alone and carry no notes.' },
  states: { empty: 'No expert has an open slot this week.', emptyCta: 'Try next week', nr: 'Rate: this expert has not published a rate for this service.', unread: 'Availability could not be read just now.' },
  vals: {
    steps: ['Expert', 'Service', 'Time', 'Confirm'].map((t, i) => ({ t, style: 'font-size:12px;font-weight:600;padding:6px 12px;border-radius:99px;white-space:nowrap;' + (i === 2 ? 'background:#7c3aed;color:#fff' : i < 2 ? 'background:#f4f0fe;color:#6d28d9' : 'background:#fff;border:1px solid #ececf1;color:#6b6577') })),
    experts: [1, 2, 3].map(i => ({ name: '[Expert name]', spec: ['[Specialty]', '[Specialty]'], rate: '[€90] / session', next: 'Next: [Tue 14 Oct]', border: i === 1 ? '#7c3aed' : '#ececf1' })),
    services: [{ name: '[Service]', len: '[50 min]', rate: '[€90]', sel: true }, { name: '[Service]', len: '[25 min]', rate: '[€50]', sel: false }, { name: '[Service]', len: '[80 min]', rate: '', sel: false }].map(s => Object.assign(s, { hasRate: !!s.rate, border: s.sel ? '#7c3aed' : '#ececf1' })),
    days: ['Tue 14', 'Wed 15', 'Thu 16', 'Fri 17'].map((d, i) => ({ d: '[' + d + ']', slots: ['09:00', '10:00', '14:00', '15:30'].map((t, j) => ({ t: '[' + t + ']', style: 'text-align:center;font:500 12px \'Roboto Mono\',monospace;padding:7px 0;border-radius:7px;' + (i === 0 && j === 1 ? 'background:#7c3aed;color:#fff' : 'background:#fff;border:1px solid #ececf1') })) })),
    confirm: [{ k: 'Expert', v: '[Expert name]' }, { k: 'Service', v: '[Service] · [50 min]' }, { k: 'When', v: '[Tue 14 Oct] · [10:00] [TZ]' }, { k: 'Rate', v: '[€90]' }],
  },
};
screens['wbx-practice'] = {
  area: 'Wellbeing', route: '/wellbeing/practice', sideActive: 'Practice', role: 'expert',
  head: { h1: 'My practice', sub: 'Your services, weekly availability and upcoming bookings. Bookings show names and times only.', cta: 'New service' },
  rail: { title: 'Availability', body: 'Suggest which two half-days to open next week, from the slots founders asked for and could not get.', writes: 'Accept opens nothing. It writes a note you act on in the grid.' },
  states: { empty: 'No bookings this week.', emptyCta: 'Open more slots', nr: 'Rate: not set for this service. It cannot be booked until it is.', unread: 'Your practice could not be read just now.' },
  vals: {
    services: [{ name: '[Service]', len: '[50 min]', rate: '[€90]', active: true }, { name: '[Service]', len: '[25 min]', rate: '[€50]', active: true }, { name: '[Service]', len: '[80 min]', rate: '', active: false }].map(s => Object.assign(s, toggle(s.active), { hasRate: !!s.rate, activeT: s.active ? 'Active' : 'Inactive' })),
    hours: ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17'],
    grid: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d, di) => ({ d, cells: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map(h => { const open = ((di === 1 || di === 3) && h >= 9 && h <= 12) || (di === 0 && h >= 14 && h <= 16); const booked = di === 1 && h === 10; return { style: 'height:26px;border-radius:5px;' + (booked ? 'background:#7c3aed' : open ? 'background:#ddd0fb' : 'background:#fff;border:1px solid #ececf1') }; }) })),
    upcoming: [1, 2, 3, 4].map(() => ({ who: '[Member name]', when: '[Tue 14 Oct] · [10:00]', len: '[50 min]', svc: '[Service]' })),
    legend: [{ t: 'Open', style: 'width:12px;height:12px;border-radius:3px;background:#ddd0fb' }, { t: 'Booked', style: 'width:12px;height:12px;border-radius:3px;background:#7c3aed' }, { t: 'Closed', style: 'width:12px;height:12px;border-radius:3px;background:#fff;border:1px solid #ececf1' }],
  },
};
screens['wba-library'] = {
  area: 'Wellbeing', route: '/admin/wellbeing/resources', sideActive: 'Community', role: 'admin',
  head: { h1: 'Resource library', sub: 'Articles, audio, video and links members see under Wellbeing. Create, publish, delete.', cta: 'New resource' },
  list: { search: 'Search resources…', filters: ['Kind', 'Topic', 'Published'], sort: 'Updated', count: '1–25 of [N]' },
  rail: { title: 'Summary', body: 'Draft a one-line summary for [Resource title] from its content.', writes: 'Accept writes the summary. It does not publish the resource.' },
  states: { empty: 'No resources yet. Members see an empty Wellbeing library.', emptyCta: 'New resource', nr: 'Topic: not set when the resource was imported.', unread: 'The library could not be read just now.' },
  vals: {
    resources: [['Article', true], ['Audio', true], ['Video', false], ['Link', true], ['Article', false], ['Audio', true]].map(([kind, pub], i) => ({ kind, t: '[Resource title]', topic: '[Topic]', topicNR: i === 4, pubT: pub ? 'Published' : 'Draft', pubStyle: pub ? ST.ok : ST.amber, updated: '[12 Oct]' })),
    editor: [{ k: 'Title', v: '[Resource title]' }, { k: 'Kind', v: 'Article · Audio · Video · Link' }, { k: 'Topic', v: '[Topic]' }, { k: 'Source', v: '[URL or upload]' }],
  },
};

/* ───────── PARTNER EARNINGS ───────── */
screens['pe-earnings'] = {
  area: 'Earnings', route: '/partner/earnings', sideActive: 'Pipeline', role: 'partner',
  head: { h1: 'Earnings', sub: 'Commissions on introductions and referrals, as stored: accrued, then paid. Request a payout when you want one.', cta: 'Request payout' },
  list: { search: 'Search commissions…', filters: ['Source', 'Status', 'Period'], sort: 'Accrued', count: '1–25 of [N]' },
  rail: { title: 'Statement', body: 'Draft a plain-language statement of this quarter\u2019s commissions for your accountant.', writes: 'Accept writes a PDF to your files. It does not request a payout.' },
  states: { empty: 'No commissions yet. They appear when an introduction or referral you made converts.', emptyCta: 'See referrals', nr: 'Paid on: this commission is accrued and has not been paid.', unread: 'Commissions could not be read just now.' },
  vals: {
    totals: [{ k: 'Accrued', v: '[€4,250]', style: ST.violet }, { k: 'Paid', v: '[€12,800]', style: ST.ok }, { k: 'Requested', v: '[€1,200]', style: ST.amber }],
    commissions: [1, 2, 3, 4, 5].map(i => ({ src: i % 2 ? 'Referral' : 'Deal', srcStyle: i % 2 ? ST.violet : ST.grey, d: i % 2 ? '[Member] signed up with your code' : 'Introduction to [Company] closed', amt: '[€' + (i * 350) + ']', cur: 'EUR', st: i < 3 ? 'Accrued' : 'Paid', stStyle: i < 3 ? ST.violet : ST.ok, accrued: '[12 Oct]', paid: i < 3 ? '' : '[30 Sep]', paidNR: i < 3 })),
    payoutForm: [{ k: 'Amount', v: '[€4,250] · all accrued' }, { k: 'Method', v: 'Bank transfer ▾' }],
    payouts: [
      { amt: '[€1,200]', method: 'Bank transfer', st: 'Requested', stStyle: ST.amber, req: '[10 Oct]', done: '', reason: '' },
      { amt: '[€6,400]', method: 'Bank transfer', st: 'Completed', stStyle: ST.ok, req: '[28 Sep]', done: '[30 Sep]', reason: '' },
      { amt: '[€2,000]', method: 'Bank transfer', st: 'Failed', stStyle: ST.bad, req: '[14 Sep]', done: '[15 Sep]', reason: '[Bank returned the transfer: account closed]' },
      { amt: '[€6,400]', method: 'PayPal', st: 'Completed', stStyle: ST.ok, req: '[28 Jun]', done: '[1 Jul]', reason: '' },
    ].map(p => Object.assign(p, { hasReason: !!p.reason, hasDone: !!p.done })),
  },
};
screens['pe-referrals'] = {
  area: 'Earnings', route: '/partner/referrals', sideActive: 'Pipeline', role: 'partner',
  head: { h1: 'Referrals', sub: 'Your code, the people who signed up with it, and the introduction credits you have left.' },
  list: { search: 'Search sign-ups…', filters: ['Status', 'Role', 'Period'], sort: 'Newest', count: '1–25 of [N]' },
  rail: { title: 'Share text', body: 'Draft three short messages that carry your referral code, one each for email, LinkedIn and WhatsApp.', writes: 'Accept writes the drafts. It does not send them.' },
  states: { empty: 'Nobody has signed up with your code yet.', emptyCta: 'Share your code', nr: 'Status: this sign-up has not completed onboarding, so no status is set.', unread: 'Referrals could not be read just now.' },
  vals: {
    code: '[AXL-PARTNER-CODE]', codeUrl: 'axal.vc/r/[code]',
    credits: { left: '[n]', of: 'of [n] this quarter', renew: 'Renews [1 Jan]' },
    signups: [1, 2, 3, 4, 5, 6].map(i => ({ who: '[Name]', role: ['Founder', 'Investor', 'Founder', 'Advisor', 'Founder', 'Partner'][i - 1], when: '[12 Oct]', st: ['Signed up', 'Active', 'Converted', 'Signed up', 'Active', 'Churned'][i - 1], stStyle: [ST.grey, ST.violet, ST.ok, ST.grey, ST.violet, ST.bad][i - 1], comm: i === 3 ? '[€350] accrued' : '—' })),
  },
};
screens['pe-log'] = {
  area: 'Earnings', route: '/partner/relationships/[id]', sideActive: 'Network', role: 'partner',
  head: { h1: '[Relationship name]', sub: '[Company] · [Role] · relationship since [date]', back: 'Relationships', cta: 'Log an interaction' },
  rail: { title: 'Next step', body: 'From the last five interactions, draft the next message to [Name].', writes: 'Accept writes a draft. It does not log an interaction.' },
  states: { empty: 'No interactions logged yet for this relationship.', emptyCta: 'Log an interaction', nr: 'Outcome: this interaction was logged without an outcome.', unread: 'The log could not be read just now.' },
  vals: {
    timeline: [
      { kind: 'Event', kindStyle: ST.grey, t: 'Commission accrued · [€350]', d: 'Introduction to [Company] closed.', when: '[12 Oct]' },
      { kind: 'Interaction', kindStyle: ST.violet, t: 'Call · [30 min]', d: '[What was discussed, in one line.]', when: '[9 Oct]' },
      { kind: 'Event', kindStyle: ST.grey, t: 'Introduction made', d: 'You introduced [Name] to [Company].', when: '[2 Oct]' },
      { kind: 'Interaction', kindStyle: ST.violet, t: 'Email', d: '[What was sent, in one line.]', when: '[28 Sep]' },
      { kind: 'Event', kindStyle: ST.grey, t: 'Relationship created', d: 'Added from [source].', when: '[14 Sep]' },
    ],
    logForm: [{ k: 'Type', v: 'Call · Email · Meeting · Message' }, { k: 'When', v: '[Today] · [14:00]' }, { k: 'Summary', v: '[One or two lines]' }, { k: 'Outcome', v: 'optional' }],
  },
};
screens['pe-board'] = {
  area: 'Earnings', route: '/partner/leaderboard', sideActive: 'Network', role: 'partner',
  head: { h1: 'Leaderboard', sub: 'Partners ranked by [metric] this [period]. Your own row is highlighted. Other partners are shown by rank only.' },
  rail: false,
  states: { empty: 'No partner has recorded [metric] this period yet.', emptyCta: 'See last period', nr: 'Your rank: you have no [metric] recorded this period, so you are unranked.', unread: 'The leaderboard could not be read just now.' },
  vals: {
    metricChips: ['[Metric]', 'Introductions', 'Referrals', 'Commissions'].map((t, i) => ({ t, style: 'font-size:12px;font-weight:600;padding:6px 12px;border-radius:99px;border:1px solid ' + (i === 0 ? '#ddd0fb' : '#ececf1') + ';background:' + (i === 0 ? '#f4f0fe' : '#fff') + ';color:' + (i === 0 ? '#6d28d9' : '#6b6577') })),
    board: [1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ rank: '[' + i + ']', who: i === 4 ? 'You' : '[Partner]', v: '[n]', delta: i % 3 === 0 ? '▼ [n]' : '▲ [n]', deltaColor: i % 3 === 0 ? '#b91c1c' : '#047857', bg: i === 4 ? '#f4f0fe' : '#fff', weight: i === 4 ? 700 : 500 })),
  },
};
screens['pea-commissions'] = {
  area: 'Commissions', route: '/admin/commissions', sideActive: 'Insights', role: 'admin',
  head: { h1: 'Commissions and payouts', sub: 'Rules, every commission in the territory, the payout queue, and the HQ take rate.', cta: 'New rule' },
  list: { search: 'Search commissions…', filters: ['Partner', 'Source', 'Status', 'Period'], sort: 'Accrued', count: '1–25 of [N]' },
  rail: { title: 'Queue note', body: 'Summarise the [n] requested payouts and flag any partner with a failed payout in the last 90 days.', writes: 'Accept writes a note. It does not process a payout.' },
  states: { empty: 'No payouts are waiting.', emptyCta: 'See history', nr: 'Processed by: this payout was completed before processing was recorded.', unread: 'The queue could not be read just now.' },
  vals: {
    rules: [
      { key: '[referral_signup]', src: 'Referral', fixed: '[€50]', pct: '', desc: '[One line]', on: true },
      { key: '[deal_intro]', src: 'Deal', fixed: '', pct: '[2%]', desc: '[One line]', on: true },
      { key: '[retainer_intro]', src: 'Deal', fixed: '', pct: '[5%]', desc: '[One line]', on: false },
    ].map(r => Object.assign(r, toggle(r.on), { amount: r.fixed || r.pct, kind: r.fixed ? 'fixed' : 'percentage' })),
    all: [1, 2, 3, 4, 5].map(i => ({ partner: '[Partner]', src: i % 2 ? 'Referral' : 'Deal', srcStyle: i % 2 ? ST.violet : ST.grey, amt: '[€' + (i * 350) + ']', st: i < 3 ? 'Accrued' : 'Paid', stStyle: i < 3 ? ST.violet : ST.ok, when: '[12 Oct]' })),
    queue: [
      { partner: '[Partner]', amt: '[€1,200]', method: 'Bank transfer', req: '[10 Oct]', st: 'Requested', stStyle: ST.amber, action: 'Process payout', by: '', reason: '' },
      { partner: '[Partner]', amt: '[€800]', method: 'PayPal', req: '[9 Oct]', st: 'Requested', stStyle: ST.amber, action: 'Process payout', by: '', reason: '' },
      { partner: '[Partner]', amt: '[€2,000]', method: 'Bank transfer', req: '[14 Sep]', st: 'Failed', stStyle: ST.bad, action: 'Retry', by: '[Admin name] · [15 Sep]', reason: '[Bank returned the transfer: account closed]' },
      { partner: '[Partner]', amt: '[€6,400]', method: 'Bank transfer', req: '[28 Sep]', st: 'Completed', stStyle: ST.ok, action: '', by: '[Admin name] · [30 Sep]', reason: '' },
    ].map(q => Object.assign(q, { hasAction: !!q.action, hasBy: !!q.by, hasReason: !!q.reason })),
    takeRate: { v: '[15%]', note: 'Applied to every commission before the partner\u2019s share. Changing it affects commissions accrued from now on, not past ones.' },
    confirm: [{ k: 'Partner', v: '[Partner]' }, { k: 'Amount', v: '[€1,200]' }, { k: 'Method', v: 'Bank transfer · [IBAN ending 1234]' }],
  },
};

/* ───────── EVENTS ───────── */
screens['evo-eligibility'] = {
  area: 'Events', route: '/events/[event]/manage', sideActive: 'Network', role: 'member',
  head: { h1: '[Event title]', sub: 'Organiser view · [DD Mon] · [venue or link] · capacity [N]', back: 'Events' },
  rail: { title: 'Invite text', body: 'Draft the invitation for the roles this event is open to, from the agenda.', writes: 'Accept writes a draft. It does not send it.' },
  states: { empty: 'No eligibility rule yet: everyone may register.', emptyCta: 'Set a rule', nr: 'Reason: the member\u2019s role is not recorded, so eligibility cannot be judged.', unread: 'Eligibility could not be read just now.' },
  vals: {
    who: [{ t: 'Everyone', on: false }, { t: 'Chosen roles and personas', on: true }, { t: 'Invite-only', on: false }].map(o => ({ t: o.t, dot: 'width:16px;height:16px;border-radius:50%;border:1.5px solid ' + (o.on ? '#7c3aed' : '#d4d1dc') + ';display:grid;place-items:center', fill: 'width:8px;height:8px;border-radius:50%;background:' + (o.on ? '#7c3aed' : 'transparent') })),
    roles: ['Founder', 'Investor', 'Advisor', 'Partner'].map((t, i) => ({ t, style: 'font-size:12px;font-weight:600;padding:5px 11px;border-radius:99px;border:1px solid ' + (i < 2 ? '#ddd0fb' : '#ececf1') + ';background:' + (i < 2 ? '#f4f0fe' : '#fff') + ';color:' + (i < 2 ? '#6d28d9' : '#6b6577') })),
    personas: ['[Persona]', '[Persona]', '[Persona]'].map((t, i) => ({ t, style: 'font-size:12px;font-weight:600;padding:5px 11px;border-radius:99px;border:1px solid ' + (i === 0 ? '#ddd0fb' : '#ececf1') + ';background:' + (i === 0 ? '#f4f0fe' : '#fff') + ';color:' + (i === 0 ? '#6d28d9' : '#6b6577') })),
    approval: toggle(true),
    preview: [
      { t: 'You\u2019re eligible', d: 'Registration goes to the organiser for approval.', style: 'border:1px solid #a7f3d0;background:#ecfdf5;color:#047857' },
      { t: 'You\u2019re not eligible: [reason]', d: 'e.g. this event is open to founders and investors.', style: 'border:1px solid #ececf1;background:#f4f3f7;color:#6b6577' },
    ],
  },
};
screens['evo-queue'] = {
  area: 'Events', route: '/events/[event]/manage/registrations', sideActive: 'Network', role: 'member',
  head: { h1: 'Registrations', sub: '[Event title] · approve or decline, promote from the waitlist when a seat frees.', back: '[Event title]' },
  list: { search: 'Search registrations…', filters: ['Role', 'Registered'], sort: 'Registered', count: '1–25 of [N]' },
  rail: { title: 'Decline reasons', body: 'Draft a kind, specific decline note for the [n] pending registrations outside the eligibility rule.', writes: 'Accept writes drafts into the reason field. It does not decline anyone.' },
  states: { empty: 'Nobody is waiting in this tab.', emptyCta: 'See approved', nr: 'Role: this member has not set a role, so the row shows none.', unread: 'Registrations could not be read just now.' },
  vals: {
    capacity: { used: '[42]', of: 'of [60] seats', pct: '70%', waiting: '[n] on the waitlist' },
    qtabs: ['Pending', 'Approved', 'Waitlist', 'Declined', 'Cancelled'].map((t, i) => ({ t, n: '[n]', style: 'display:flex;gap:6px;align-items:center;font-size:12.5px;font-weight:600;white-space:nowrap;padding:7px 12px;border-radius:8px;' + (i === 0 ? 'background:#f4f0fe;color:#6d28d9' : 'color:#6b6577') })),
    regs: [1, 2, 3, 4, 5].map(i => ({ who: '[Member name]', role: ['Founder', 'Investor', 'Founder', 'Advisor', 'Founder'][i - 1], when: '[12 Oct] · [09:4' + i + ']', eligible: i !== 4, eligT: i !== 4 ? 'Eligible' : 'Outside rule', eligStyle: i !== 4 ? ST.ok : ST.amber })),
    promote: { show: true, t: 'A seat freed at [HH:MM]. Promote the first on the waitlist?', who: '[Member name] · waiting since [date]' },
  },
};
screens['ev-mine'] = {
  area: 'Events', route: '/events/[event]', sideActive: 'Network', role: 'member', rail: false,
  head: { h1: '[Event title]', sub: '[DD Mon] · [HH:MM] [TZ] · [venue or link]', back: 'Events' },
  states: { empty: 'You have not registered for this event.', emptyCta: 'Register', nr: 'Waitlist place: the organiser has not ordered the waitlist yet.', unread: 'Your registration could not be read just now.' },
  vals: {
    mine: [
      { st: 'Pending approval', stStyle: ST.amber, d: 'The organiser reviews registrations. You will be told either way.', place: '' },
      { st: 'Approved', stStyle: ST.ok, d: 'Your seat is confirmed. The join details arrive the day before.', place: '' },
      { st: 'Waitlisted', stStyle: ST.violet, d: 'You are in line for a seat.', place: 'Place [n] of [n]' },
    ].map(m => Object.assign(m, { hasPlace: !!m.place })),
    agendaPreview: [{ t: '[HH:MM]', title: '[Item title]', who: '[Speaker]' }, { t: '[HH:MM]', title: '[Item title]', who: '[Speaker]' }, { t: '[HH:MM]', title: '[Item title]', who: '[Speaker]' }],
  },
};
screens['evo-agenda'] = {
  area: 'Events', route: '/events/[event]/manage/agenda', sideActive: 'Network', role: 'member',
  head: { h1: 'Agenda', sub: '[Event title] · add, edit, delete and reorder. Attendees see the right-hand column.', back: '[Event title]', cta: 'Add item' },
  rail: { title: 'Timing check', body: 'Check the agenda for overlaps and gaps longer than 15 minutes.', writes: 'Accept writes a note. It does not move any item.' },
  states: { empty: 'No agenda items yet. Attendees see the event without a schedule.', emptyCta: 'Add item', nr: 'Room: this item has no room or link set.', unread: 'The agenda could not be read just now.' },
  vals: {
    items: [1, 2, 3, 4, 5].map(i => ({ t: '[HH:MM]', title: '[Item title]', who: i === 3 ? '' : '[Speaker]', whoNR: i === 3, room: i === 4 ? '' : '[Room or link]', roomNR: i === 4 })),
    itemForm: [{ k: 'Time', v: '[HH:MM] – [HH:MM]' }, { k: 'Title', v: '[Item title]' }, { k: 'Speaker', v: '[Speaker]' }, { k: 'Room or link', v: '[Room or link]' }],
  },
};

/* ───────── ACCOUNT ───────── */
const acNav = (active) => ['Profile and identity', 'Notifications', 'Sign-in and security', 'Billing and orders', 'Following', 'Developer'].map(t => ({ t, style: 'padding:9px 12px;border-radius:8px;font-size:13px;font-weight:' + (t === active ? '600' : '500') + ';color:' + (t === active ? '#6d28d9' : '#6b6577') + ';background:' + (t === active ? '#f4f0fe' : 'transparent'), dev: t === 'Developer' }));
const acBase = (h1, sub, active, extra) => Object.assign({ area: 'Account', route: '/account#' + active.toLowerCase().split(' ')[0], sideActive: '', role: 'member', head: { h1, sub }, vals: { acNav: acNav(active) } }, extra || {});
screens['ac-profile'] = acBase('Profile and identity', 'Who you are on the platform, and what your public profile shows.', 'Profile and identity', {
  rail: { title: 'Bio', body: 'Draft a two-line bio from your role, company and sectors.', writes: 'Accept writes the bio field. You still save.' },
  states: { empty: 'No company profile yet. Add one if you represent a company.', emptyCta: 'Add company profile', nr: 'Archetype: the profiling questions have not been answered.', unread: 'Your profile could not be read just now.' },
});
Object.assign(screens['ac-profile'].vals, {
  personal: [{ k: 'Full name', v: '[Name]' }, { k: 'Username', v: '[username]' }, { k: 'Email', v: '[email]' }, { k: 'Phone', v: '[+41 …]' }, { k: 'Location', v: '[City, Country]' }, { k: 'Language', v: '[English]' }],
  identity: [{ k: 'Legal name', v: '[Name]' }, { k: 'Date of birth', v: '[DD Mon YYYY]' }, { k: 'Nationality', v: '[Country]' }, { k: 'Tax residence', v: '[Country]' }],
  corp: [{ k: 'Company', v: '[Company]' }, { k: 'Role', v: '[Title]' }, { k: 'Registration', v: '[Number]' }, { k: 'Country', v: '[Country]' }],
  archetype: Object.assign({ name: '[Archetype]', conf: '[82%]' }, toggle(true)),
  history: [{ when: '[12 Oct]', what: 'Archetype changed to [Archetype]' }, { when: '[3 Sep]', what: 'Values profile updated · [n] questions' }, { when: '[14 Jul]', what: 'Profile created' }],
});
screens['ac-notifications'] = acBase('Notifications', 'Each type against each channel. Devices registered for push are listed below.', 'Notifications', {
  rail: false,
  states: { empty: 'No device is registered for push.', emptyCta: 'Open the app on a device', nr: 'Last seen: this device has not reported in since it registered.', unread: 'Preferences could not be read just now.' },
});
Object.assign(screens['ac-notifications'].vals, {
  channels: ['In-app', 'Email', 'Push'],
  types: ['Deals', 'Messages', 'Events', 'Tickets', 'Credits', 'Research alerts'].map((t, i) => ({ t, cells: [true, i !== 4, i < 3].map(on => toggle(on)) })),
  devices: [{ name: '[iPhone]', os: '[iOS 19]', seen: '[12 Oct]' }, { name: '[Pixel]', os: '[Android 16]', seen: '' }].map(d => Object.assign(d, { seenNR: !d.seen })),
});
screens['ac-security'] = acBase('Sign-in and security', 'Your sign-in factors, sessions, and alerts.', 'Sign-in and security', {
  rail: false,
  states: { empty: 'No second factor is set up.', emptyCta: 'Set up an authenticator app', nr: 'Last used: this factor has never been used to sign in.', unread: 'Security settings could not be read just now.' },
});
Object.assign(screens['ac-security'].vals, {
  factors: [{ t: 'Password', st: 'Set', stStyle: ST.ok, last: 'changed [date]', action: 'Change' }, { t: 'Authenticator app', st: 'Not set up', stStyle: ST.grey, last: '', action: 'Set up' }, { t: 'SMS', st: 'Verified', stStyle: ST.ok, last: '[+41 … 12 34]', action: 'Change number' }],
  totpSteps: [{ n: '1', t: 'Scan the QR code', d: 'In your authenticator app.' }, { n: '2', t: 'Enter the 6-digit code', d: '[_ _ _ _ _ _]' }, { n: '3', t: 'Confirmed', d: 'Recovery codes shown once.' }],
  smsSteps: [{ n: '1', t: 'Add a number', d: '[+41 …] · Send code' }, { n: '2', t: 'Verify', d: 'Enter the code we sent · [_ _ _ _ _ _]' }],
  sessions: { note: 'Signs you out on every device, including this one.', cta: 'Sign out everywhere' },
  settings: [{ k: 'Session length', v: '[30 days] ▾' }, { k: 'New-device alerts', on: true }].map(s => Object.assign(s, s.on !== undefined ? toggle(s.on) : {}, { isToggle: s.on !== undefined })),
});
screens['ac-billing'] = acBase('Billing and orders', 'Your plan, the billing portal, and what you have bought.', 'Billing and orders', {
  list: { search: 'Search orders…', filters: ['Status', 'Year'], sort: 'Newest', count: '1–25 of [N]' },
  rail: false,
  states: { empty: 'No orders yet.', emptyCta: 'See Plans & Pricing', nr: 'Renewal: this plan has no renewal date recorded.', unread: 'Orders could not be read just now.' },
});
Object.assign(screens['ac-billing'].vals, {
  plan: { name: '[Plan]', tier: '[Tier]', renews: '[1 Nov]', seats: '[n] seats' },
  orders: [1, 2, 3, 4].map(i => ({ when: '[12 Oct]', item: '[Item]', amt: '[€' + (i * 120) + ']', st: i === 3 ? 'Refunded' : 'Paid', stStyle: i === 3 ? ST.grey : ST.ok })),
});
screens['ac-following'] = acBase('Following', 'People and companies you follow. Unfollow from the row.', 'Following', {
  list: { search: 'Search…', filters: ['People', 'Companies'], sort: 'Recent', count: '1–25 of [N]' },
  rail: false,
  states: { empty: 'You follow nobody yet.', emptyCta: 'Browse the directory', nr: 'Since: this follow predates follow-dates.', unread: 'Follows could not be read just now.' },
});
Object.assign(screens['ac-following'].vals, { follows: [1, 2, 3, 4, 5, 6].map(i => ({ who: i % 2 ? '[Person]' : '[Company]', kind: i % 2 ? 'Person' : 'Company', kindStyle: i % 2 ? ST.violet : ST.grey, since: '[12 Oct]' })) });
screens['ac-developer'] = acBase('Developer', 'Shown only when developer mode is enabled on your account.', 'Developer', {
  rail: false,
  states: { empty: 'No API key yet.', emptyCta: 'Create a key', nr: 'Last run: the search index has never been re-synced.', unread: 'Developer settings could not be read just now.' },
});
Object.assign(screens['ac-developer'].vals, {
  api: [{ k: 'API key', v: '[••••••••••••1234]', action: 'Reveal · Rotate' }, { k: 'Webhook URL', v: '[https://…]', action: 'Edit' }, { k: 'Rate limit', v: '[n] / min', action: '' }].map(a => Object.assign(a, { hasAction: !!a.action })),
  sync: { last: '[12 Oct] · [09:41]', cta: 'Re-sync search indexes' },
});

window.OPS_DATA = { screens, shared: { ST, btn } };
})();
