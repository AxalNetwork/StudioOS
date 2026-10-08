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
const acNav = (active) => ['Profile and identity', 'Notifications', 'Sign-in and security', 'Billing and orders', 'Usage', 'Following', 'Developer'].map(t => ({ t, style: 'padding:9px 12px;border-radius:8px;font-size:13px;font-weight:' + (t === active ? '600' : '500') + ';color:' + (t === active ? '#6d28d9' : '#6b6577') + ';background:' + (t === active ? '#f4f0fe' : 'transparent'), dev: t === 'Developer' }));
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

/* ───────── DEAL ROOMS · FUNDS · SEATS ───────── */
screens['dr-pipeline'] = {
  area: 'Deals', route: '/deals', sideActive: 'Deals', role: 'investor',
  head: { h1: 'Deal pipeline', sub: 'Join a deal room to follow a company in your portfolio and research views, and to open a diligence case on it.' },
  list: { search: 'Search companies…', filters: ['Stage', 'Sector', 'Round'], sort: 'Updated', count: '1–25 of [N]' },
  rail: { title: 'Room summary', body: 'Summarise what joining [Company] adds to your portfolio and research views.', writes: 'Accept writes a note. It does not join a room.' },
  states: { empty: 'No deals in this stage.', emptyCta: 'Clear filters', nr: 'Round size: the company has not recorded one.', unread: 'The pipeline could not be read just now.' },
  vals: {
    quota: { used: '[3]', cap: 'of [5] deal rooms', pct: '60%', full: false },
    quotaFull: { used: '[5]', cap: 'of [5] deal rooms', plan: 'Professional raises this to [N]. Institutional is unlimited.' },
    joinNote: 'Joining adds the company to your portfolio and research views, and lets you open a diligence case on it. It does not open the room\u2019s documents; only an invited or committed investor reads them.',
    deals: [1, 2, 3, 4, 5].map(i => ({ co: '[Company]', sector: '[Sector]', stage: ['Sourced', 'Screening', 'Diligence', 'Screening', 'IC'][i - 1], stageStyle: i === 3 ? ST.violet : ST.grey, round: '[Seed] · [€1.5M]', joined: i === 1 || i === 3, action: i === 1 || i === 3 ? 'Leave' : 'Join deal room', actionStyle: i === 1 || i === 3 ? btn.ghost : btn.primary, memberT: i === 1 || i === 3 ? 'Member' : '' })),
  },
};
screens['dr-header'] = {
  area: 'Deals', route: '/deals/[deal]', sideActive: 'Deals', role: 'investor',
  head: { h1: '[Company]', sub: '[Sector] · [Seed] · [€1.5M] round · lead [Firm]', back: 'Deal pipeline', cta: 'Join deal room' },
  rail: false,
  states: { empty: 'No documents are open to you. Only an invited or committed investor reads them.', emptyCta: 'Ask for an invitation', nr: 'Lead: no lead investor has been recorded for this round.', unread: 'This deal could not be read just now.' },
  vals: {
    tabs: ['Overview', 'Documents', 'Invitations', 'Transfers', 'Conditions'].map((t, i) => ({ t, style: 'font-size:12.5px;font-weight:600;padding:8px 12px;border-radius:8px;white-space:nowrap;' + (i === 0 ? 'background:#f4f0fe;color:#6d28d9' : 'color:#6b6577') })),
    quota: { used: '[3]', cap: 'of [5] deal rooms' },
    joinNote: 'Joining adds the company to your portfolio and research views, and lets you open a diligence case on it. It does not open the room\u2019s documents.',
    facts: [{ k: 'Round', v: '[Seed] · [€1.5M]' }, { k: 'Committed', v: '[€900k]' }, { k: 'Closing target', v: '[30 Nov]' }, { k: 'Members', v: '[n] investors' }],
    docsLocked: { t: 'Documents are not open to you', d: 'You are a member of this room, not an invited or committed investor. The founder opens documents to investors they invite.' },
  },
};
screens['dr-invites'] = {
  area: 'Deals', route: '/deals/[deal]/invitations', sideActive: 'Deals', role: 'admin',
  head: { h1: 'Invitations', sub: '[Company] · every investor invited into this room, and how they answered.', back: '[Company]', cta: 'Invite an investor' },
  list: { search: 'Search invited investors…', filters: ['Status', 'Emailed', 'Invited'], sort: 'Invited', count: '1–25 of [N]' },
  rail: { title: 'Follow-up', body: 'Draft a short note to the [n] investors who were invited over 14 days ago and have not answered.', writes: 'Accept writes drafts. It does not send them.' },
  states: { empty: 'Nobody has been invited into this room yet.', emptyCta: 'Invite an investor', nr: 'Answered: this investor has not answered yet.', unread: 'Invitations could not be read just now.' },
  vals: {
    invites: [1, 2, 3, 4, 5].map(i => ({ who: '[Investor name]', email: '[email]', st: ['Invited', 'Interested', 'Passed', 'Interested', 'Invited'][i - 1], stStyle: [ST.grey, ST.ok, ST.bad, ST.ok, ST.grey][i - 1], msg: '[The message that was sent, one line]', emailed: i !== 5, emailedT: i !== 5 ? 'Email sent' : 'No email', invited: '[12 Oct]', answered: i === 1 || i === 5 ? '' : '[14 Oct]', answeredNR: i === 1 || i === 5 })),
  },
};
screens['dr-transfers'] = {
  area: 'Deals', route: '/deals/[deal]/transfers', sideActive: 'Deals', role: 'admin',
  head: { h1: 'Transfers', sub: '[Company] · wires recorded against this round. Visible to the admin, the partner, the founder, and invited or committed investors.', back: '[Company]', cta: 'Record a transfer' },
  list: { search: 'Search by reference…', filters: ['Firm', 'Verified', 'Recorded'], sort: 'Recorded', count: '1–25 of [N]' },
  rail: false,
  states: { empty: 'No wire has been recorded for this round.', emptyCta: 'Record a transfer', nr: 'Firm: the transfer was recorded without a firm. The recorder can add one.', unread: 'Transfers could not be read just now.' },
  vals: {
    wires: [1, 2, 3, 4].map(i => ({ amt: '[€' + (i * 50) + ',000]', ref: '[WIRE-REF-' + i + ']', verified: i !== 3, verifiedT: i !== 3 ? 'Phone-verified' : 'Not verified', verifiedStyle: i !== 3 ? ST.ok : ST.amber, note: '[Note, one line]', by: '[Admin name]', when: '[12 Oct] · [09:4' + i + ']', firm: i === 2 ? '' : '[Firm]', firmNR: i === 2 })),
    form: [{ k: 'Amount', v: '[€50,000]' }, { k: 'Reference', v: '[WIRE-REF]' }, { k: 'Firm', v: '[Firm] · required' }, { k: 'Phone-verified', v: 'Yes · No' }, { k: 'Note', v: 'optional' }],
    refusals: [
      { t: '[n] open conditions', d: 'A transfer cannot be recorded while closing conditions are open. Resolve them on the Conditions tab.', style: 'border:1px solid #fcd34d;background:#fffdf5;color:#92400e' },
      { t: 'The closing check could not be read', d: 'Try again. Nothing was recorded.', style: 'border:1px solid #fecaca;background:#fef2f2;color:#b91c1c' },
      { t: 'Invalid amount', d: 'Enter a positive amount in the round\u2019s currency.', style: 'border:1px solid #fecaca;background:#fef2f2;color:#b91c1c' },
      { t: 'No firm given', d: 'Name the firm the wire came from.', style: 'border:1px solid #fecaca;background:#fef2f2;color:#b91c1c' },
    ],
  },
};
screens['fd-page'] = {
  area: 'Fund', route: '/funds/[fund]', sideActive: 'Fund', role: 'investor',
  head: { h1: '[Fund name]', sub: 'Size, status, LPs counted live, commitments, the general partner of record, service providers and the LPA.', back: 'Funds' },
  rail: { title: 'Fund brief', body: 'Draft a one-paragraph description of this fund from its recorded facts.', writes: 'Accept writes a note. It changes no fund record.' },
  states: { empty: 'No LP has committed yet.', emptyCta: 'Open LPs', nr: 'Auditor: no service provider has been recorded for this role.', unread: 'This fund could not be read just now.' },
  vals: {
    facts: [{ k: 'Size', v: '[€10M]' }, { k: 'Status', v: 'Investing', pill: ST.violet }, { k: 'LPs', v: '[12]', note: 'counted live' }, { k: 'Vintage', v: '[2026]' }].map(f => Object.assign({ pill: '', note: '' }, f, { isPill: !!f.pill, plain: !f.pill && !f.note })),
    totals: [{ k: 'Committed', v: '[€6.2M]' }, { k: 'Invested', v: '[€2.4M]' }],
    gp: { name: '[General partner of record]', title: '[Title]', entity: '[GP entity]', email: '[email]' },
    providers: [{ k: 'Fund administrator', v: '[Firm]' }, { k: 'Auditor', v: '' }, { k: 'Legal counsel', v: '[Firm]' }, { k: 'Custodian', v: '' }, { k: 'Valuation policy', v: '[Policy name]' }].map(p => Object.assign(p, { nr: !p.v })),
    lpa: { st: 'Signed', stStyle: ST.ok, version: 'v[3]', date: '[12 Mar 2026]' },
  },
};
screens['fd-report'] = {
  area: 'Fund', route: '/funds/[fund]/reporting/[period]', sideActive: 'Fund', role: 'investor',
  head: { h1: 'Quarterly report · Q2 [2026]', sub: 'Draft the letter, key developments, outlook and subsequent events. Issuing cannot be undone.', back: 'Reporting' },
  rail: { title: 'Letter draft', body: 'Draft the letter\u2019s opening paragraph from this period\u2019s recorded capital movements.', writes: 'Accept writes into the draft. Issuing stays a human click.' },
  states: { empty: 'This period has no content yet.', emptyCta: 'Start the letter', nr: 'End date: not set for this period.', unread: 'This period could not be read just now.' },
  vals: {
    period: [{ k: 'Label', v: 'Q2 [2026]' }, { k: 'Start', v: '[1 Apr 2026]' }, { k: 'End', v: '[30 Jun 2026]' }],
    sections: [
      { t: 'Letter', kind: 'paragraphs', rows: ['[Paragraph]', '[Paragraph]'] },
      { t: 'Key developments', kind: 'dated', rows: ['[12 May] · [Title] — [text]', '[3 Jun] · [Title] — [text]'] },
      { t: 'Outlook', kind: 'paragraphs', rows: ['[Paragraph]'] },
      { t: 'Subsequent events', kind: 'dated', rows: ['[8 Jul] · [text]'] },
    ],
    issueConfirm: { t: 'Issue Q2 [2026]?', d: 'Issuing cannot be undone. LPs see the report as issued. To change it later, issue a correcting period.' },
    issued: { st: 'Issued', stStyle: ST.ok, when: '[15 Jul 2026]', by: '[GP name]' },
  },
};
screens['sy-close'] = {
  area: 'Deals', route: '/deals/[deal]/syndicates/[syndicate]', sideActive: 'Deals', role: 'investor',
  head: { h1: '[Syndicate name]', sub: 'Open while it gathers commitments, Funded once the target is reached, Closed when its creator or an admin closes it.', back: '[Company]' },
  rail: false,
  states: { empty: 'No member has committed yet.', emptyCta: 'Invite members', nr: 'Target: no target has been set for this syndicate.', unread: 'This syndicate could not be read just now.' },
  vals: {
    flow: ['Open', 'Funded', 'Closed'].map((t, i) => ({ t, style: i === 1 ? ST.violet : ST.grey, cur: i === 1 })),
    facts: [{ k: 'Target', v: '[€500k]' }, { k: 'Committed', v: '[€500k]' }, { k: 'Members', v: '[n]' }, { k: 'Creator', v: '[Name]' }],
    members: [1, 2, 3].map(() => ({ who: '[Member name]', amt: '[€100k]', when: '[12 Oct]' })),
    closeConfirm: { t: 'Close this syndicate?', d: 'Its status becomes Closed. Members are not notified. Only the creator or an admin can do this.' },
  },
};
screens['ct-variants'] = {
  area: 'Cap table', route: '/raise/cap-table/variants/[variant]', sideActive: 'Raise', role: 'member',
  head: { h1: 'Draft variants', sub: 'Model alternatives without touching the main cap table. The main table stays one per company.', back: 'Cap table', cta: 'New variant' },
  rail: { title: 'Variant read', body: 'Describe how [Variant name] differs from the main table, in plain words.', writes: 'Accept writes a note. It does not change a variant.' },
  states: { empty: 'No draft variants yet. The main cap table is the only table.', emptyCta: 'New variant', nr: 'Exit value: none has been set for this variant.', unread: 'Variants could not be read just now.' },
  vals: {
    variants: [{ name: '[Variant name]', sel: true }, { name: '[Variant name]', sel: false }, { name: 'Main cap table', sel: false, main: true }].map(v => Object.assign({ main: false }, v, { style: 'font-size:12.5px;font-weight:600;padding:8px 12px;border-radius:8px;white-space:nowrap;' + (v.sel ? 'background:#f4f0fe;color:#6d28d9' : 'color:#6b6577') })),
    rename: { label: 'Variant name', v: '[Variant name]' },
    groups: [
      { t: 'Founders', cols: ['Name', 'Shares', 'Vesting'], rows: [['[Founder]', '[4,000,000]', '[4y · 1y cliff]'], ['[Founder]', '[4,000,000]', '[4y · 1y cliff]']] },
      { t: 'Option pool', cols: ['Pool', 'Size', 'Granted'], rows: [['[Pool]', '[10%]', '[2%]']] },
      { t: 'SAFEs', cols: ['Investor', 'Amount', 'Cap · discount'], rows: [['[Investor]', '[€250k]', '[€8M] · [20%]']] },
      { t: 'Rounds', cols: ['Round', 'Raise', 'Pre-money'], rows: [['[Seed]', '[€1.5M]', '[€6M]']] },
      { t: 'Exit value', cols: ['Scenario', 'Value', ''], rows: [['[Exit]', '[€40M]', '']] },
    ].map(g => ({ t: g.t, cols: g.cols, rows: g.rows.map(r => ({ c: r })) })),
  },
};
screens['st-invite'] = {
  area: 'Firm Settings', route: '/firm/seats', sideActive: 'Firm Settings', role: 'investor',
  head: { h1: 'Colleague seats', sub: 'Institutional plans include seats for colleagues. No email is sent: copy the link and pass it on yourself.', cta: 'Invite a colleague' },
  list: { search: 'Search seats…', filters: ['State'], sort: 'Invited', count: '1–25 of [N]' },
  rail: false,
  states: { empty: 'No seat has been used yet.', emptyCta: 'Invite a colleague', nr: 'Accepted: this seat has not been accepted yet.', unread: 'Seats could not be read just now.' },
  vals: {
    quota: { used: '[2]', cap: 'of [4] seats' },
    once: { t: 'Copy this link now. It is shown once, because no email is sent.', url: 'axal.vc/invite/[token]', email: '[colleague email]' },
    seats: [1, 2, 3].map(i => ({ email: '[colleague email]', st: ['Accepted', 'Invited', 'Revoked'][i - 1], stStyle: [ST.ok, ST.grey, ST.bad][i - 1], invited: '[12 Oct]', accepted: i === 1 ? '[13 Oct]' : '', acceptedNR: i !== 1, canRevoke: i !== 3 })),
  },
};
screens['st-accept'] = {
  area: 'Invitation', route: '/invite/[token]', sideActive: '', role: 'member', rail: false,
  head: { h1: 'You have been offered a seat', sub: '[Inviter name] at [Firm] invited you to join their Institutional plan as a colleague.' },
  states: { empty: 'This invitation has no seat attached.', emptyCta: 'Ask the inviter', nr: 'Firm: the inviter has not recorded a firm name.', unread: 'This invitation could not be read just now.' },
  vals: {
    gives: ['Their deal rooms, pipeline and portfolio views', 'Their fund pages and reporting', 'Seats, research and introductions on the firm\u2019s plan'],
    warn: 'Accepting turns your account into an investor account. Your current workspace stays, but your role changes.',
    cases: [
      { t: 'Signed out', d: 'Sign in, then come back to this link.', cta: 'Sign in', style: ST.grey },
      { t: 'Wrong account', d: 'This invitation was for [other email]. Sign in with that account.', cta: 'Switch account', style: ST.amber },
      { t: 'Revoked', d: '[Inviter name] revoked this seat. Ask them for a new link.', cta: '', style: ST.bad },
      { t: 'Already accepted', d: 'This seat is yours. Open your workspace.', cta: 'Open workspace', style: ST.ok },
      { t: 'Plan no longer covers seats', d: 'The inviter\u2019s plan changed. The seat cannot be accepted until it does again.', cta: '', style: ST.amber },
    ].map(c => Object.assign(c, { hasCta: !!c.cta })),
  },
};

/* ───────── HQ TOOLS ───────── */
screens['hq-contracts'] = {
  area: 'Contracts', route: '/admin/contracts', sideActive: 'Contracts', role: 'hq',
  head: { h1: 'Document types', sub: 'The contract registry. A type lives in code until it is drafted here; publishing makes it live for every tenant.' },
  list: { search: 'Search document types…', filters: ['Layer', 'Party role', 'State'], sort: 'Layer', count: '1–25 of [N]' },
  rail: { title: 'Overlap read', body: 'Describe how [Type] and [Type] overlap on layer and party role, and what distinguishes them.', writes: 'Accept writes a note. It does not publish or merge a type.' },
  states: { empty: 'No document type matches these filters.', emptyCta: 'Clear filters', nr: 'Published by: this type went live before publishing was recorded.', unread: 'The registry could not be read just now.' },
  vals: {
    types: [
      { name: '[Document type]', layer: 'GP', role: '[party role]', st: 'Published', stStyle: ST.ok, meta: '[12 Oct] · [Admin name] · "[reason]"', overlap: true, action: 'Edit draft' },
      { name: '[Document type]', layer: 'FUND', role: '[party role]', st: 'Draft', stStyle: ST.amber, meta: 'drafted [10 Oct]', overlap: false, action: 'Publish' },
      { name: '[Document type]', layer: 'PORTFOLIO', role: '[party role]', st: 'In code only', stStyle: ST.grey, meta: 'no draft yet', overlap: false, action: 'Draft' },
      { name: '[Document type]', layer: 'GP', role: '[party role]', st: 'Published', stStyle: ST.ok, meta: '[2 Sep] · [Admin name] · "[reason]"', overlap: true, action: 'Edit draft' },
      { name: '[Document type]', layer: 'COMPLIANCE', role: '[party role]', st: 'Draft', stStyle: ST.amber, meta: 'drafted [1 Oct]', overlap: false, action: 'Publish' },
    ],
    publishFlow: [{ n: '1', t: 'Reason', d: 'At least 10 characters. Kept with the type.' }, { n: '2', t: 'Fresh sign-in', d: 'Confirm your identity again before it goes through.' }, { n: '3', t: 'Live', d: 'Every tenant\u2019s template picker shows the new version.' }],
    liveWarn: 'This type is published. Saving its draft changes the live type at once, for every tenant.',
    reasonField: '[Why this type is being published]',
  },
};
screens['hq-credits'] = {
  area: 'Team', route: '/admin/team/[member]/credits', sideActive: 'Team', role: 'hq',
  head: { h1: '[Member name] · credits', sub: '1 credit = US$1 of perk value. Every adjustment is kept in the audit log with its reason.', back: '[Member name]', cta: 'Adjust credits' },
  list: { search: 'Search the ledger…', filters: ['Source', 'Period'], sort: 'Newest', count: '1–25 of [N]' },
  rail: false,
  states: { empty: 'No credit has been granted or spent yet.', emptyCta: 'Adjust credits', nr: 'Note: this entry was recorded without a note to the member.', unread: 'The ledger could not be read just now.' },
  vals: {
    balance: { v: '[n]', note: 'credits · US$[n] of perk value' },
    ledger: [1, 2, 3, 4, 5].map(i => ({ when: '[12 Oct]', change: i % 2 ? '+[10]' : '−[25]', changeColor: i % 2 ? '#047857' : '#b91c1c', src: ['Task approved', 'Perk claimed', 'Bug bounty', 'Perk claimed', 'Adjustment'][i - 1], note: i === 4 ? '' : '[Note the member sees]', noteNR: i === 4 })),
    form: [{ k: 'Amount', v: '+[10] · or −[10]' }, { k: 'Reason', v: '[At least 10 characters · kept in the audit log]' }, { k: 'Note to the member', v: '[What they see on their balance]' }],
    refusals: [
      { t: 'Balance would go below zero', d: 'The member has [n] credits. A change of −[m] is refused.' },
      { t: 'Unknown member', d: 'No account matches this id. Nothing was changed.' },
      { t: 'Same change sent twice', d: 'An identical adjustment was recorded [n] seconds ago. The second one was ignored.' },
    ],
  },
};
screens['hq-obligations'] = {
  area: 'Security', route: '/admin/security/obligations', sideActive: 'Security', role: 'hq',
  head: { h1: 'Trust obligations by role', sub: 'What each role must sign or prove, whether it is required, and how long it stays valid before renewal. Read-only. One member\u2019s list can differ from these defaults.' },
  rail: false,
  states: { empty: 'This role carries no obligation.', emptyCta: 'Back', nr: 'Validity: this obligation does not expire, so no period is recorded.', unread: 'Obligations could not be read just now.' },
  vals: {
    roles: ['Founder', 'Investor', 'Advisor', 'Partner', 'Admin'].map((r, ri) => ({ r, rows: [
      { t: 'Terms of service', req: true, valid: 'Until the terms change' },
      { t: 'Privacy', req: true, valid: 'Until the policy changes' },
      { t: ['Founder NDA', 'Investor NDA', 'Advisor NDA', 'Partner NDA + non-solicit', 'Data access acknowledgment'][ri], req: true, valid: '[12] months' },
      { t: 'Identity check', req: ri !== 4, valid: '[24] months' },
      { t: 'Accreditation', req: ri === 1, valid: ri === 1 ? '[12] months' : '' },
    ].map(o => ({ t: o.t, reqT: o.req ? 'Required' : 'Optional', reqStyle: o.req ? ST.violet : ST.grey, valid: o.valid, validNR: !o.valid })) })),
  },
};
screens['hq-comments'] = {
  area: 'Content', route: '/admin/articles/[article]/comments', sideActive: 'Content', role: 'hq',
  head: { h1: '[Article title] · review comments', sub: 'Resolve stays the first action. Delete removes the comment for the author too and cannot be undone.', back: 'Content queue' },
  list: { search: 'Search comments…', filters: ['Open', 'Resolved', 'Reviewer'], sort: 'Newest', count: '1–25 of [N]' },
  rail: { title: 'Summary', body: 'Summarise the [n] open comments for the author in three lines.', writes: 'Accept writes a draft note. It does not resolve or delete a comment.' },
  states: { empty: 'No comments on this article.', emptyCta: 'Back to the queue', nr: 'Section: this comment is not anchored to a section.', unread: 'Comments could not be read just now.' },
  vals: {
    comments: [1, 2, 3, 4].map(i => ({ who: '[Reviewer name]', when: '[12 Oct] · [09:4' + i + ']', anchor: i === 3 ? '' : '[Section]', anchorNR: i === 3, text: '[The comment, one or two lines.]', resolved: i === 2 })),
    deleteConfirm: { t: 'Delete this comment?', d: 'The author loses it too. This cannot be undone. To keep it on record, resolve it instead.' },
  },
};
screens['hq-dispute'] = {
  area: 'Revenue', route: '/admin/revenue/disputes/[dispute]', sideActive: 'Revenue', role: 'hq',
  head: { h1: 'Dispute [dp_…]', sub: 'Read live from Stripe each time this page opens. Nothing here is stored on the platform.', back: 'Disputes' },
  rail: false,
  states: { empty: 'No evidence has been sent for this dispute.', emptyCta: 'Open in Stripe', nr: 'Due date: Stripe returned none for this dispute.', unread: 'Stripe could not be read. Try again.' },
  vals: {
    facts: [{ k: 'Amount', v: '[€1,200.00] EUR' }, { k: 'Status', v: 'Needs response', pill: ST.amber }, { k: 'Reason', v: '[fraudulent]' }, { k: 'Due', v: '[19 Oct]' }].map(f => Object.assign({ pill: '' }, f, { isPill: !!f.pill })),
    refs: [{ k: 'Charge', v: '[ch_…]' }, { k: 'Payment intent', v: '[pi_…]' }, { k: 'Customer', v: '[cus_…]' }],
    evidence: { sent: true, times: '[n]', last: '[14 Oct]' },
    stripeStates: [
      { t: 'Stripe is not configured', d: 'No Stripe key is set for this tenant. Disputes cannot be read until one is.', style: 'border:1px solid #fcd34d;background:#fffdf5;color:#92400e' },
      { t: 'Stripe could not be read', d: 'The request failed or timed out. Nothing is cached; try again.', style: 'border:1px solid #fecaca;background:#fef2f2;color:#b91c1c' },
    ],
  },
};
screens['hq-sensitive'] = {
  area: 'Team', route: '/admin/kyc/[member]', sideActive: 'Team', role: 'hq',
  head: { h1: '[Member name] · identity review', sub: 'Sensitive fields are masked by default. Each showing is logged with your name and the time.', back: 'KYC queue' },
  rail: false,
  states: { empty: 'This member has not submitted identity details.', emptyCta: 'Back to the queue', nr: 'Tax ID: the member did not submit one.', unread: 'Identity details could not be read just now.' },
  vals: {
    fields: [{ k: 'Date of birth', m: '•••• •• ••' }, { k: 'ID number', m: '•••• •••• ••12' }, { k: 'Address', m: '•••••••••••••••••' }, { k: 'Phone', m: '+•• ••• ••• •34' }, { k: 'Tax ID', m: '' }].map(f => Object.assign(f, { nr: !f.m })),
    shown: { k: 'Date of birth', v: '[DD Mon YYYY]', log: 'Shown by [Admin name] · [12 Oct] · [09:41]' },
    windows: [{ t: 'KYC queue', d: 'Identity details from the member\u2019s submission.' }, { t: 'Partner profiles', d: 'Principal\u2019s details on a partner profile under review.' }],
    plain: [{ k: 'Legal name', v: '[Name]' }, { k: 'Nationality', v: '[Country]' }, { k: 'Submitted', v: '[12 Oct]' }],
  },
};

/* ───────── SMALL PIECES ───────── */
screens['sp-verdict'] = {
  area: 'Validate', route: '/validate/verdict', sideActive: 'Validate', role: 'member',
  head: { h1: 'Verdict', sub: 'Record Proceed, Pivot or Stop with your reasoning. Decisions are never overwritten. Partners do not see this card.' },
  rail: { title: 'Evidence read', body: 'List what the interviews and claims support and contradict, so the reasoning is grounded.', writes: 'Accept writes a draft of the reasoning. The decision is yours to record.' },
  states: { empty: 'No decision recorded yet.', emptyCta: 'Record a decision', nr: 'Reasoning: this decision was recorded without any.', unread: 'Decisions could not be read just now.' },
  vals: {
    opts: ['Proceed', 'Pivot', 'Stop'].map((t, i) => ({ t, style: 'flex:1;text-align:center;font-size:13px;font-weight:600;padding:10px;border-radius:9px;border:1px solid ' + (i === 0 ? '#7c3aed' : '#ececf1') + ';background:' + (i === 0 ? '#f4f0fe' : '#fff') + ';color:' + (i === 0 ? '#6d28d9' : '#6b6577') })),
    current: { d: 'Proceed', dStyle: ST.ok, when: '[12 Oct]', by: '[Founder name]', why: '[The reasoning, two or three lines.]' },
    earlier: [{ d: 'Pivot', dStyle: ST.amber, when: '[3 Sep]', by: '[Founder name]', why: '[Earlier reasoning.]' }, { d: 'Proceed', dStyle: ST.ok, when: '[14 Jul]', by: '[Founder name]', why: '[Earlier reasoning.]' }],
  },
};
screens['sp-interviews'] = {
  area: 'Validate', route: '/validate/interviews', sideActive: 'Validate', role: 'member',
  head: { h1: 'Interviews', sub: 'ICP fit, quote consent and the interviewee\u2019s company, inline on each row. Not recorded is not None.' },
  list: { search: 'Search interviews…', filters: ['ICP fit', 'Consent', 'Company'], sort: 'Newest', count: '1–25 of [N]' },
  rail: { title: 'Fit read', body: 'From the transcript of [Interviewee], propose an ICP fit with the lines that support it.', writes: 'Accept writes nothing until you set the fit yourself.' },
  states: { empty: 'No interviews yet.', emptyCta: 'Log an interview', nr: 'ICP fit: not set. The claim it supports shows Verdict withheld until it is.', unread: 'Interviews could not be read just now.' },
  vals: {
    fitOpts: ['Strong', 'Partial', 'None', 'Not recorded'],
    consentOpts: ['Yes', 'No', 'Not asked'],
    rows: [1, 2, 3, 4].map(i => ({ who: '[Interviewee]', co: '[Company]', when: '[12 Oct]', fit: ['Strong', 'Partial', '', 'None'][i - 1], fitNR: i === 3, fitStyle: [ST.ok, ST.violet, ST.nr, ST.grey][i - 1], consent: ['Yes', 'Not asked', 'No', 'Yes'][i - 1], consentStyle: [ST.ok, ST.grey, ST.bad, ST.ok][i - 1] })),
    withheld: { t: 'Verdict withheld', d: '[Claim] has an interview whose ICP fit is not recorded. Set it to let the verdict compute.' },
  },
};
screens['sp-claims'] = {
  area: 'Validate', route: '/validate/hypotheses', sideActive: 'Validate', role: 'member',
  head: { h1: 'Claims', sub: 'Each claim links to the pain themes that support or contradict it. Unlink from the row.' },
  rail: { title: 'Link suggestions', body: 'Which pain themes in your interviews bear on [Claim], and in which direction?', writes: 'Accept writes nothing; you link themes yourself.' },
  states: { empty: 'This claim has no linked themes.', emptyCta: 'Link a theme', nr: 'Direction: this link was made without supporting or contradicting set.', unread: 'Claims could not be read just now.' },
  vals: {
    claims: [1, 2].map(i => ({ t: '[Claim]', verdict: i === 1 ? 'Supported' : 'Verdict withheld', verdictStyle: i === 1 ? ST.ok : ST.nr, links: [{ theme: '[Pain theme]', dir: 'Supporting', dirStyle: ST.ok }, { theme: '[Pain theme]', dir: 'Supporting', dirStyle: ST.ok }, { theme: '[Pain theme]', dir: 'Contradicting', dirStyle: ST.bad }].slice(0, i === 1 ? 3 : 2) })),
  },
};
screens['sp-brand'] = {
  area: 'Brand', route: '/spinout-lab/brand', sideActive: 'Grow', role: 'member',
  head: { h1: 'Brand & landing pages', sub: 'The startup\u2019s address, each page\u2019s own address, and saved templates.' },
  rail: false,
  states: { empty: 'No saved templates yet. Save any page as one.', emptyCta: 'Open a page', nr: 'Address: this page has no address of its own yet.', unread: 'Pages could not be read just now.' },
  vals: {
    site: { url: 'axal.vc/p/[slug]', rules: '1 to 48 lowercase letters, digits and hyphens. Reserved words are refused.', warn: 'Old links stop working after a change.', taken: 'That address is already taken.' },
    pages: [{ t: '[Page title]', path: 'axal.vc/p/[slug]/[page]', avail: 'Available', availStyle: ST.ok }, { t: '[Page title]', path: 'axal.vc/p/[slug]/[page]', avail: 'Taken', availStyle: ST.bad }, { t: '[Page title]', path: '', availNR: true }].map(p => Object.assign({ availNR: false }, p)),
    templates: { count: '[n] of 50', note: 'across all your projects', rows: [1, 2, 3].map(() => ({ t: '[Template name]', from: 'from [Project]', when: '[12 Oct]' })) },
  },
};
screens['sp-references'] = {
  area: 'Deals', route: '/deals/[deal]/references', sideActive: 'Deals', role: 'investor',
  head: { h1: 'References', sub: '[Company] · reference checks on the founders. Recording, transcript and summary are not available yet.', back: '[Company]', cta: 'Schedule a reference' },
  list: { search: 'Search references…', filters: ['Status', 'Consent', 'Role'], sort: 'Scheduled', count: '1–25 of [N]' },
  rail: false,
  states: { empty: 'No reference has been scheduled.', emptyCta: 'Schedule a reference', nr: 'Consent: not yet given or refused.', unread: 'References could not be read just now.' },
  vals: {
    refs: [1, 2, 3, 4].map(i => ({ who: '[Reference name]', email: '[email]', role: '[Role]', rel: '[Relationship]', when: '[14 Oct] · [15:00]', consent: i === 2 ? '' : 'Given [12 Oct]', consentNR: i === 2, st: ['Scheduled', 'Recorded', 'Summarised', 'Cancelled'][i - 1], stStyle: [ST.violet, ST.amber, ST.ok, ST.grey][i - 1], notes: '[Notes, one line]' })),
    artefacts: ['Recording', 'Transcript', 'Summary'],
  },
};
screens['sp-watchlist'] = {
  area: 'Watchlist', route: '/watchlist/[item]', sideActive: 'Deals', role: 'investor',
  head: { h1: '[Company]', sub: '[Sector] · [Stage] · on the watchlist since [date]', back: 'Watchlist' },
  rail: { title: 'Thesis check', body: 'Compare this thesis with what the company has done since the last check.', writes: 'Accept writes a note. The conviction is yours to set.' },
  states: { empty: 'No journal entry for this company yet.', emptyCta: 'Write an entry', nr: 'Next check: no date set.', unread: 'This item could not be read just now.' },
  vals: {
    item: [{ k: 'Thesis', v: '[Thesis, two lines]' }, { k: 'Conviction', v: 'High', pill: ST.ok }, { k: 'Source', v: '[Source]' }, { k: 'Tags', v: '[tag] · [tag]' }, { k: 'Status', v: 'Watching', pill: ST.violet }, { k: 'Next check', v: '[1 Nov]' }, { k: 'Ended', v: 'Passed · [reason]', pill: ST.grey }].map(f => Object.assign({ pill: '' }, f, { isPill: !!f.pill })),
    entry: { decision: 'Defer', decisionStyle: ST.amber, conviction: '[3] / 5', thesis: '[Thesis]', risks: '[Risks]', expected: '[Outcome] · [3×] · [5 years]', outcome: 'Partial', outcomeStyle: ST.amber, notes: '[Outcome notes]', actual: '[1.4×]', edited: true, editedT: 'Edited after the outcome' },
  },
};
screens['sp-delivery'] = {
  area: 'Delivery', route: '/delivery/health', sideActive: 'Delivery', role: 'partner',
  head: { h1: 'Health and capacity edits', sub: 'Clear a blocker and keep it on record, or delete it. Edit a seat\u2019s scope. Delete an hours entry, which is not the same as logging 0.' },
  rail: false,
  states: { empty: 'No open blocker on this client.', emptyCta: 'Back', nr: 'Hours: no entry for this week. Not the same as 0.', unread: 'Delivery could not be read just now.' },
  vals: {
    blockers: [{ t: '[Blocker]', since: '[12 Oct]' }, { t: '[Blocker]', since: '[9 Oct]' }],
    seat: { who: '[Operator]', client: '[Client]', scope: ['Board', 'KPIs'], all: ['Board', 'KPIs', 'Roadmap', 'Data room'] },
    hours: [{ wk: '[W41]', v: '[12.5] h' }, { wk: '[W40]', v: '' }, { wk: '[W39]', v: '[8] h' }].map(h => Object.assign(h, { nr: !h.v })),
  },
};
screens['sp-cofounder'] = {
  area: 'Team', route: '/build/team?tab=cofounders', sideActive: 'Build', role: 'member',
  head: { h1: 'Co-founder matching', sub: 'Your listing, the interest you sent, and each connection\u2019s NDA state.' },
  rail: false,
  states: { empty: 'You have not sent interest to anyone.', emptyCta: 'Browse profiles', nr: 'Email: shown once both NDAs are signed.', unread: 'Matching could not be read just now.' },
  vals: {
    me: { st: 'Listed', stStyle: ST.ok },
    sent: [1, 2].map(() => ({ who: '[Profile]', role: '[Looking for]', when: '[12 Oct]' })),
    conn: { st: 'Waiting for both NDAs', stStyle: ST.amber, signed: [{ who: 'You', ok: true }, { who: '[Other person]', ok: false }], revealed: false },
    connActive: { st: 'Active', stStyle: ST.ok, name: '[Other person]', email: '[email]' },
  },
};
screens['sp-comarketing'] = {
  area: 'Co-marketing', route: '/comarketing/[pitch]', sideActive: 'Grow', role: 'member',
  head: { h1: '[Pitch title]', sub: 'Edit while the pitch is Proposed. Locked once approved, rejected or withdrawn.', back: 'Co-marketing' },
  rail: { title: 'Angle', body: 'Sharpen the angle in one line for the audience you named.', writes: 'Accept writes into the form. Submitting is yours.' },
  states: { empty: 'No results yet. They appear once the piece is live.', emptyCta: 'Back', nr: 'Conversions: not tracked on this channel.', unread: 'This pitch could not be read just now.' },
  vals: {
    form: [{ k: 'Type', v: 'Webinar · Blog post · Podcast' }, { k: 'Title', v: '[Pitch title]' }, { k: 'Angle', v: '[Angle, one line]' }, { k: 'Audience', v: '[Audience]' }, { k: 'What you bring', v: '[Audience size, distribution]' }],
    locked: { st: 'Approved', stStyle: ST.ok, note: 'Approved on [12 Oct]. The form is locked; to change the pitch, withdraw it and propose again.' },
    results: [{ k: 'Visits', v: '[n]' }, { k: 'Sign-ups', v: '[n]' }, { k: 'Leads', v: '[n]' }, { k: 'Conversions', v: '', nr: true }].map(r => Object.assign({ nr: false }, r)),
  },
};

/* ───────── USAGE (#1430) and CONTRACTS (#1441) ─────────
   The owner's shares of these two boards (Usage, PeE58rhm…, and Contracts, AQg6bk…) carried the Ops Page
   markup but not this file, so every frame drew only its screen id. S1 wrote the entries below from the two
   prompts the boards were made from (#1430's, and prompt 2 on #1439). Every figure is a bracketed placeholder.
   Replace them with the owner's own entries if a later share carries its ops-data.js. */
const chip = (on, accent) => 'font-size:12px;font-weight:600;padding:5px 11px;border-radius:99px;white-space:nowrap;border:1px solid ' + (on ? (accent === 'hq' ? '#fbcfe8' : '#ddd0fb') : '#ececf1') + ';color:' + (on ? (accent === 'hq' ? '#881337' : '#6d28d9') : '#6b6577') + ';background:' + (on ? (accent === 'hq' ? '#fdf2f6' : '#f4f0fe') : '#fff');
const track = 'height:8px;border-radius:99px;background:#f4f3f7;overflow:hidden;margin:10px 0 8px';
const fill = (pct) => 'height:100%;width:' + pct + '%;background:#7c3aed;border-radius:99px';
const usMenu = ['Account', 'Usage', 'Trust Center', 'Perks', 'Calendar', 'Events', 'Learning', 'Help Center', 'Plans & Pricing', 'Log Out'].map(t => ({ t, style: 'padding:8px 10px;border-radius:8px;font-size:13px;font-weight:' + (t === 'Usage' ? '600' : '500') + ';color:' + (t === 'Usage' ? '#6d28d9' : t === 'Log Out' ? '#b91c1c' : '#18181b') + ';background:' + (t === 'Usage' ? '#f4f0fe' : 'transparent') }));
const usBase = (hash, extra) => Object.assign({
  area: 'Account', route: '/account/usage' + (hash ? '#' + hash : ''), sideActive: '', role: 'member',
  head: { h1: 'Usage', sub: 'What you have used across all your companies.' },
  rail: false,
}, extra, { vals: Object.assign({ acNav: acNav('Usage') }, extra.vals) });

screens['us-allowance'] = usBase('', {
  states: { empty: 'No AI runs yet this month.', emptyCta: 'Open Eadwyn', nr: 'Today: the plan sets no daily allowance. Runs use your top-up balance.', unread: 'Your allowance could not be read just now. The other cards still load.' },
  vals: {
    menuOpen: true, menu: usMenu,
    plan: 'Included with your plan: [Founder · Growth]',
    today: { used: '[$0.42]', of: 'of [$2.00]', reset: 'Resets at 00:00 UTC · [in 5 h 12 min]', track, fill: fill(21) },
    month: { used: '[$6.10]', of: 'of [$40.00]', reset: 'Resets on the 1st at 00:00 UTC', track, fill: fill(15) },
    held: { v: '[$0.05]', note: 'Held by runs in progress. Returned if a run does not finish within 5 minutes.' },
    topup: { v: '[$10.00]', note: 'Runs use your included allowance first, then your top-up balance.' },
    alt: [
      { t: 'No allowance on this plan', d: 'Runs use your top-up balance.', cta: 'Add tokens', style: 'background:#fff;border:1px solid #ececf1' },
      { t: 'Today’s allowance is used up', d: 'It resets at 00:00 UTC, [in 5 h 12 min]. Runs use your top-up balance until then.', cta: 'Add tokens', style: 'background:#fffdf5;border:1px solid #fcd34d;color:#92400e' },
      { t: 'Top-ups not available yet', d: 'Runs use your included allowance only.', cta: '', style: 'background:#fff;border:1px solid #ececf1' },
      { t: 'Runs paused', d: 'A run cost more than it held. New runs wait while HQ checks the charge.', cta: '', style: 'background:#fef2f2;border:1px solid #fecaca;color:#b91c1c' },
    ].map(a => Object.assign(a, { hasCta: !!a.cta })),
  },
});
screens['us-days'] = usBase('days', {
  states: { empty: 'No AI runs in the last 30 days.', emptyCta: 'Open Eadwyn', nr: 'A day’s cost: one of its runs recorded no cost, so the bar shows the runs that did.', unread: 'The last 30 days could not be read just now.' },
  vals: {
    days: Array.from({ length: 30 }, (_, i) => {
      const none = i === 6 || i === 13 || i === 20;
      const h = none ? 2 : [38, 52, 24, 61, 45, 70, 33, 58, 41, 66][i % 10];
      return { h: h + '%', bg: none ? '#d4d1dc' : (i === 29 ? '#7c3aed' : '#c4b5fd'), tip: none ? '[Day] · 0 runs · $0.00' : '[Day] · [n] runs · [$0.21]' };
    }),
    axis: ['[9 Sep]', '[16 Sep]', '[23 Sep]', '[30 Sep]', '[8 Oct]'],
    dayNote: 'Estimated cost per day, UTC. Hover or tap a bar for its runs. A day with no runs is a real $0.00. No allowance line: the allowance may have been different on earlier days.',
  },
});
screens['us-where'] = usBase('where', {
  states: { empty: 'No AI runs yet this month.', emptyCta: 'Open Eadwyn', nr: 'No page recorded: these runs carry no page.', unread: 'Where it went could not be read just now.' },
  vals: {
    tabs: [{ t: 'By page', style: chip(true) }, { t: 'By task', style: chip(false) }],
    byPage: [
      { t: '[Validate › Interviews]', runs: '[42]', cost: '[$1.84]' },
      { t: '[Raise › Pitch]', runs: '[31]', cost: '[$1.12]' },
      { t: '[Build › Roadmap]', runs: '[18]', cost: '[$0.66]' },
      { t: '[Research › Market reading]', runs: '[9]', cost: '[$0.41]' },
      { t: 'No page recorded', runs: '[6]', cost: '[$0.0042]', nr: true },
    ].map(r => Object.assign({ nr: false }, r, { plain: !r.nr })),
    byTask: [
      { t: '[Explain this page]', runs: '[38]', cost: '[$1.20]' },
      { t: '[Draft an email]', runs: '[27]', cost: '[$1.05]' },
      { t: '[Summarise interviews]', runs: '[21]', cost: '[$0.98]' },
      { t: '[Transcribe a recording]', runs: '[4]', cost: '[$0.36]' },
    ],
    estNote: 'Estimated from the run log. Runs still in progress are not in these figures yet.',
  },
});
screens['us-models'] = usBase('models', {
  states: { empty: 'No AI runs yet this month.', emptyCta: 'Open Eadwyn', nr: 'Tokens: a cached answer, a streamed reply or a transcription recorded no count.', unread: 'Models could not be read just now.' },
  vals: {
    models: [
      { name: '[Llama 3.3 70B]', id: '[@cf/meta/llama-3.3-70b-instruct-fp8-fast]', runs: '[64]', tin: '[1.2M]', tout: '[340k]', cost: '[$3.92]', fb: '[0]', cached: '[5]', nc: '[5]', hasTokens: true },
      { name: '[Model name]', id: '[@cf/vendor/model-id]', runs: '[22]', tin: '[410k]', tout: '[96k]', cost: '[$1.31]', fb: '[3]', cached: '[0]', nc: '[2]', hasTokens: true },
      { name: '[Transcription model]', id: '[@cf/openai/whisper]', runs: '[4]', tin: '', tout: '', cost: '[$0.36]', fb: '[0]', cached: '[0]', nc: '[4]', hasTokens: false },
    ],
    rates: [
      { name: '[Llama 3.3 70B]', id: '[@cf/meta/llama-3.3-70b-instruct-fp8-fast]', pin: '[$0.29]', pout: '[$2.25]', unit: 'per million tokens', hasOut: true, retired: false },
      { name: '[Model name]', id: '[@cf/vendor/model-id]', pin: '[$0.20]', pout: '[$0.80]', unit: 'per million tokens', hasOut: true, retired: false },
      { name: '[Transcription model]', id: '[@cf/openai/whisper]', pin: '[$0.0005]', pout: '', unit: 'per audio minute', hasOut: false, retired: false },
      { name: '[Older model]', id: '[@cf/vendor/older-model-id]', pin: '[$0.27]', pout: '[$0.85]', unit: 'per million tokens', hasOut: true, retired: true },
    ],
    ratesNote: 'Your allowance and top-up balance are charged at these rates.',
  },
});
screens['us-receipt'] = usBase('last-run', {
  states: { empty: 'No AI runs yet.', emptyCta: 'Open Eadwyn', nr: 'Tokens out: a streamed reply recorded no count.', unread: 'The last run could not be read just now.' },
  vals: {
    flags: [{ t: 'Fallback', style: ST.amber }, { t: 'Not cached', style: ST.grey }],
    receipt: [
      { k: 'When', v: '[8 Oct, 14:02 UTC]' },
      { k: 'Task', v: '[Draft an email]', sub: 'on [Raise › Investors]' },
      { k: 'Model', v: '[Model name]', sub: '[@cf/vendor/model-id] · answered after [Llama 3.3 70B] failed' },
      { k: 'Tokens in', v: '[1,840]' },
      { k: 'Tokens out', v: 'Not counted', nr: true, sub: 'A streamed reply recorded no count.' },
      { k: 'Cost', v: '[$0.0042]' },
    ].map(r => Object.assign({ nr: false, sub: '' }, r, { plain: !r.nr })),
  },
});
screens['us-storage'] = usBase('storage', {
  states: { empty: 'No files uploaded yet.', emptyCta: 'Open the data room', nr: 'Size: these files were stored before sizes were recorded.', unread: 'Storage could not be read just now.' },
  vals: {
    total: { size: '[1.2 GB]', files: 'in [148] files' },
    places: [
      { t: 'Data room', files: '[64]', size: '[820 MB]', nosize: '' },
      { t: 'Diligence files', files: '[31]', size: '[210 MB]', nosize: '[3] files with no size recorded' },
      { t: 'Research library', files: '[22]', size: '[48 MB]', nosize: '' },
      { t: 'Message attachments', files: '[27]', size: '[96 MB]', nosize: '' },
      { t: 'Interview recordings', files: '[4]', size: '[31 MB]', nosize: '' },
    ].map(p => Object.assign(p, { hasNosize: !!p.nosize })),
    storageNote: 'Other files you keep on StudioOS are not counted yet. No plan sets a storage limit.',
  },
});

screens['hq-allowances'] = {
  area: 'Platform', route: '/admin/platform/allowances', sideActive: 'Platform', role: 'hq',
  head: { h1: 'AI allowances', sub: 'The daily and monthly AI allowance each plan includes, and runs held for a check.' },
  rail: false,
  states: { empty: 'No run is held for a check.', emptyCta: 'Back to Platform', nr: 'Set by: this plan uses the platform default, which records no editor.', unread: 'Allowances could not be read just now.' },
  vals: {
    plans: ['Founder · Free', 'Founder · Growth', 'Founder · Studio', 'Investor · Free', 'Investor · Professional', 'Investor · Institutional', 'Advisor', 'Partner', 'Admin', 'Other'].map((p, i) => {
      const hq = i === 1 || i === 5;
      return { p, daily: '[$2.00]', monthly: '[$40.00]', src: hq ? 'Set by HQ · [Name] · [12 Oct]' : 'Platform default', srcStyle: hq ? ST.violet : ST.grey };
    }),
    editForm: [{ k: 'Daily (US$, 0 or more)', v: '[2.00]' }, { k: 'Monthly (US$, 0 or more)', v: '[40.00]' }],
    editConfirm: 'The change applies at once to every member on [Founder · Growth].',
    holds: [
      { who: '[Member name]', when: '[8 Oct, 14:02]', held: '[$0.05]', cost: '[$0.0731]' },
      { who: '[Member name]', when: '[7 Oct, 09:40]', held: '[$0.05]', cost: '[$0.0612]' },
    ],
    holdNote: 'Charge and Refund each need a reason of at least 10 characters. The member is never charged more than the hold.',
  },
};

/* Contracts: one page, six tabs for the Super Admin, five for an administrator (no Document types). */
const ctrTabs = (hq, active) => ['Agreements', 'NDAs', 'Partner deals', 'Templates', 'Forms'].concat(hq ? ['Document types'] : []).map(t => ({ t, style: 'font-size:13px;font-weight:600;padding:9px 12px;white-space:nowrap;border-bottom:2px solid ' + (t === active ? (hq ? '#881337' : '#334155') : 'transparent') + ';color:' + (t === active ? '#18181b' : '#6b6577') }));
const ctrCounts = [{ k: 'Total', v: '[N]' }, { k: 'Awaiting signature', v: '[n]' }, { k: 'Signed', v: '[n]' }, { k: 'Average days to sign', v: '[4.2]' }, { k: 'Signed, last 30 days', v: '[n]' }];
const ctrBase = (hq, tab, extra) => Object.assign({
  area: 'Contracts', route: '/admin/contracts' + (tab === 'Agreements' ? '' : '?tab=' + tab.toLowerCase().replace(/ /g, '-')), sideActive: 'Contracts', role: hq ? 'hq' : 'admin',
  head: { h1: 'Contracts', sub: 'Every agreement the platform sends, signs or keeps, and the templates behind them.', cta: 'New envelope' },
  rail: { title: 'Signing read', body: 'List the agreements awaiting signature for more than [7] days, oldest first, with who they wait on.', writes: 'Accept writes a note. It does not resend or void anything.' },
}, extra, { vals: Object.assign({ ctTabs: ctrTabs(hq, tab), ctCounts: ctrCounts }, extra.vals) });
const agreements = {
  statusSwitch: ['All', 'Awaiting signature', 'Signed', 'Voided'].map((t, i) => ({ t, style: chip(i === 0) })),
  agreements: [
    { t: '[Agreement title]', type: '[Advisor agreement]', store: '[E-sign]', co: '[Company]', to: '[Recipient name]', sent: '[2 Oct]', signed: '[4 Oct]', days: '[2]', prov: 'Native', st: 'Signed', stStyle: ST.ok },
    { t: '[Agreement title]', type: '[SAFE]', store: '[E-sign]', co: '[Company]', to: '[Recipient name]', sent: '[5 Oct]', signed: '', days: '', prov: 'DocuSign', st: 'Awaiting signature', stStyle: ST.amber, sub: 'Viewed' },
    { t: '[Agreement title]', type: '[NDA]', store: '[Documents]', co: '[Company]', to: '[Recipient name]', sent: '[28 Sep]', signed: '[29 Sep]', days: '[1]', prov: 'Native', st: 'Signed', stStyle: ST.ok },
    { t: '[Agreement title]', type: '[Partner agreement]', store: '[Documents]', co: '[Company]', to: '[Recipient name]', sent: '[7 Oct]', signed: '', days: '', prov: 'Native', st: 'Awaiting signature', stStyle: ST.amber },
    { t: '[Agreement title]', type: '[Side letter]', store: '[E-sign]', co: '[Company]', to: '[Recipient name]', sent: '[20 Sep]', signed: '', days: '', prov: 'DocuSign', st: 'Voided', stStyle: ST.bad, sub: 'Declined' },
  ].map(a => Object.assign({ sub: '' }, a, { notSigned: !a.signed, hasSub: !!a.sub })),
  panel: {
    t: '[Agreement title]', type: '[SAFE] · [E-sign]', st: 'Awaiting signature', stStyle: ST.amber,
    parties: [{ k: 'Sender', v: '[Admin name] · Axal' }, { k: 'Founder', v: '[Founder name] · [Company]' }, { k: 'Investor', v: '[Investor name]' }],
    timeline: [{ e: 'Sent', when: '[5 Oct, 10:12]' }, { e: 'Viewed', when: '[5 Oct, 16:40]' }, { e: 'Signed', when: '[6 Oct, 09:03]' }],
    signer: { who: '[Founder name]', ip: '[203.0.113.24]' },
    pdf: { name: '[agreement-title].pdf', sha: '[9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08]' },
    voidNote: 'Void needs a reason, which then shows on the row.',
  },
};
const ctrList = { search: 'Search title, recipient, company, template…', filters: ['Document type', 'Party', 'Provider'], sort: 'Sent, newest', count: '1–25 of [N]' };
const ctrStates = { empty: 'No agreement matches these filters.', emptyCta: 'Clear filters', nr: 'Average days to sign: no signed agreement has both a sent and a signed date.', unread: 'Agreements could not be read just now.' };
screens['ctr-hq'] = ctrBase(true, 'Agreements', { list: ctrList, states: ctrStates, vals: agreements });
screens['ctr-admin'] = ctrBase(false, 'Agreements', { list: ctrList, states: ctrStates, vals: agreements });
screens['ctr-new'] = ctrBase(true, 'Agreements', {
  route: '/admin/contracts?new',
  states: { empty: 'No published template. Publish one under Templates first.', emptyCta: 'Open Templates', nr: 'Recipient name: a new email was entered without one.', unread: 'Templates could not be read just now.' },
  vals: {
    steps: ['Template', 'Recipient', 'Fields', 'Deal', 'Provider', 'Preview and send'].map((t, i) => ({ n: String(i + 1), t, style: 'display:flex;gap:9px;align-items:center;padding:6px 8px;border-radius:7px;font-size:12.5px;font-weight:' + (i === 2 ? '600;color:#881337;background:#fdf2f6' : i < 2 ? '500;color:#18181b' : '500;color:#6b6577') })),
    tpl: '[Template name] · v[3]',
    recipient: { found: '[Member name] · [name@company.com]', alt: 'Or a new email, with a name' },
    fields: [
      { k: '[Company legal name]', v: '[Company Ltd]', req: true },
      { k: '[Investment amount]', v: '[$250,000]', req: true },
      { k: '[Valuation cap]', v: '', req: true, missing: true },
      { k: '[Governing law]', v: '[Delaware]', req: false },
    ].map(f => Object.assign({ missing: false }, f)),
    deal: '[Deal name] · optional',
    providers: [
      { t: 'Native', d: 'Signed in the app.', lock: false, style: 'border:1px solid #ddd0fb;background:#f4f0fe;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:3px' },
      { t: 'DocuSign', d: 'Studio plan.', lock: true, style: 'border:1px solid #ececf1;background:#fff;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:3px' },
    ],
    errs: [
      { t: 'No published template', d: 'Publish a template under Templates first.', style: 'background:#fff;border:1px solid #ececf1' },
      { t: 'A required field is missing', d: '[Valuation cap] is required.', style: 'background:#fffdf5;border:1px solid #fcd34d;color:#92400e' },
      { t: 'DocuSign not available', d: 'DocuSign comes with the Studio plan. Native signing works on every plan.', style: 'background:#fff;border:1px solid #ececf1' },
      { t: 'The send failed', d: 'Nothing was sent. Try again.', style: 'background:#fef2f2;border:1px solid #fecaca;color:#b91c1c' },
    ],
  },
});
screens['ctr-ndas'] = ctrBase(true, 'NDAs', {
  list: { search: 'Search founder or investor…', filters: ['Status', 'Introduced by'], sort: 'Last activity', count: '1–25 of [N]' },
  states: { empty: 'No NDA yet. One is created when a founder and an investor are introduced.', emptyCta: 'Clear filters', nr: 'Valid until: this NDA was signed without an end date.', unread: 'NDAs could not be read just now.' },
  vals: {
    ndas: [
      { f: '[Founder name]', inv: '[Investor name]', intro: '[Advisor name]', st: 'Active', stStyle: ST.ok, until: '[12 Oct 2027]', last: '[2 Oct]' },
      { f: '[Founder name]', inv: '[Investor name]', intro: 'Direct', st: 'Partially signed', stStyle: ST.amber, until: '', last: '[6 Oct]' },
      { f: '[Founder name]', inv: '[Investor name]', intro: '[Partner name]', st: 'Pending', stStyle: ST.grey, until: '', last: '[7 Oct]' },
      { f: '[Founder name]', inv: '[Investor name]', intro: 'Direct', st: 'Expired', stStyle: ST.grey, until: '[1 Sep 2026]', last: '[1 Sep]' },
      { f: '[Founder name]', inv: '[Investor name]', intro: '[Advisor name]', st: 'Revoked', stStyle: ST.bad, until: '[3 Mar 2027]', last: '[20 Sep]' },
    ].map(n => Object.assign(n, { untilNR: !n.until })),
  },
});
screens['ctr-deals'] = ctrBase(true, 'Partner deals', {
  list: { search: 'Search partners…', filters: ['Deal type', 'Status'], sort: 'Partner', count: '1–25 of [N]' },
  states: { empty: 'No partner deal yet.', emptyCta: 'Clear filters', nr: 'Term: this deal was granted without an end date.', unread: 'Partner deals could not be read just now.' },
  vals: {
    deals: [
      { p: '[Partner name]', type: 'Equity', term: '[12 months]', plans: '[Founder · Growth, Studio]', red: '[14]', st: 'Active', stStyle: ST.ok },
      { p: '[Partner name]', type: 'Services', term: '', plans: '[Founder · Studio]', red: '[3]', st: 'Active', stStyle: ST.ok },
      { p: '[Partner name]', type: 'Rev-share', term: '[24 months]', plans: '[Investor · Professional]', red: '[0]', st: 'Paused', stStyle: ST.amber },
      { p: '[Partner name]', type: 'Custom', term: '[6 months]', plans: '[All plans]', red: '[22]', st: 'Ended', stStyle: ST.grey },
    ].map(d => Object.assign(d, { termNR: !d.term })),
  },
});
screens['ctr-templates'] = ctrBase(true, 'Templates', {
  list: { search: 'Search templates…', filters: ['Document type'], sort: 'Last edited', count: '1–25 of [N]' },
  states: { empty: 'No template yet.', emptyCta: 'New template', nr: 'Last edited by: this template was imported before editors were recorded.', unread: 'Templates could not be read just now.' },
  vals: {
    publish: { t: '[2] templates have unpublished changes', d: 'Publishing makes [Template name] v[4] and [Template name] v[2] the versions New envelope offers.' },
    tpls: [
      { name: '[Template name]', type: '[SAFE]', ver: 'v[4]', edited: '[Admin name] · [6 Oct]', used: 'Used in [18] agreements' },
      { name: '[Template name]', type: '[NDA]', ver: 'v[2]', edited: '[Admin name] · [1 Oct]', used: 'Used in [42] agreements' },
      { name: '[Template name]', type: '[Advisor agreement]', ver: 'v[1]', edited: '[Admin name] · [12 Sep]', used: 'Used in [5] agreements' },
    ],
    del: 'Delete asks for a confirmation. Agreements already sent keep their copy.',
    versions: [
      { v: 'v[4]', when: '[6 Oct]', who: '[Admin name]', note: '[What changed, one line]' },
      { v: 'v[3]', when: '[22 Sep]', who: '[Admin name]', note: '[What changed, one line]' },
      { v: 'v[2]', when: '[1 Sep]', who: '[Admin name]', note: '[What changed, one line]' },
    ],
  },
});
screens['ctr-forms'] = ctrBase(true, 'Forms', {
  states: { empty: 'No form is available.', emptyCta: 'Back to Agreements', nr: 'Sample values: this form has none yet.', unread: 'Forms could not be read just now.' },
  vals: {
    forms: [
      { t: 'SS-4, with its instructions', d: 'Application for an Employer Identification Number.' },
      { t: 'Form 8821', d: 'Tax information authorisation.' },
      { t: 'Statement for a faxed EIN', d: 'Sent with an SS-4 filed by fax.' },
      { t: 'Confirmation of information', d: 'The company details the forms are filled from.' },
    ],
  },
});
screens['ctr-types'] = ctrBase(true, 'Document types', {
  list: { search: 'Search document types…', filters: ['Layer', 'State'], sort: 'Layer', count: '1–25 of [N]' },
  states: { empty: 'No document type matches these filters.', emptyCta: 'Clear filters', nr: 'Published by: this type went live before publishing was recorded.', unread: 'Document types could not be read just now.' },
  vals: {
    layers: ['GP', 'Fund', 'Portfolio', 'Compliance', 'Outside the four layers'].map((l, i) => ({ l, rows: [
      { t: '[Document type]', st: 'Published', stStyle: ST.ok, meta: '[12 Oct] · [Admin name] · "[reason]"' },
      { t: '[Document type]', st: i % 2 ? 'In code only' : 'Draft', stStyle: i % 2 ? ST.grey : ST.amber, meta: i % 2 ? 'no draft yet' : 'drafted [10 Oct]' },
    ].slice(0, i === 4 ? 1 : 2) })),
    diff: [
      { k: 'Title', live: '[Current title]', pend: '[New title]', changed: true },
      { k: 'Layer', live: 'Fund', pend: 'Fund', changed: false },
      { k: 'Party roles', live: '[GP, LP]', pend: '[GP, LP, Advisor]', changed: true },
      { k: 'Required fields', live: '[n] fields', pend: '[n] fields', changed: false },
    ],
    liveWarn: 'This type is published. Saving its draft changes the live type at once, for every tenant.',
  },
});

window.OPS_DATA = { screens, shared: { ST, btn } };
})();
