/**
 * D800 (#2233) — the Licences page, part 1: the frame and its six tabs,
 * Summary, Terms (the ledger), History, the states, phone and the row's count
 * (canvas `Licences Page.dc.html`, boards L1, L2, L6–L8).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licences_page_d800.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import {
  LICENCE_TABS, NOT_RECORDED, allowanceCard, changeHref, contractCard, feeCard, longDate,
  needRow, needsCount, oweCard, pageState, renewalCard, scheduleSections, seatRows, shareCard, stateBanner, tabFor, tabPath, termCard,
} from '../src/lib/licencePage.js';
import {
  Administrators, DealGlance, NeedsYou, OweHq, SummaryCards, YourContract,
} from '../src/pages/subsidiary/LicenceSummary.jsx';
import LicenceTerms from '../src/pages/subsidiary/LicenceTerms.jsx';
import { LicenceHeader, LicenceStateBanner } from '../src/pages/subsidiary/LicenceFrame.jsx';
import { eventLabel, ledgerSections } from '../src/pages/subsidiary/MyLicencePage.jsx';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { pageKeyFor } from '../src/lib/railPages.js';
import { RENDER_NOT_YET, railRenderer } from './_airailRender.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => html(el).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const NOW = new Date(Date.UTC(2026, 9, 20));
// An invented licence. No real company, person or account appears in a fixture.
const LICENCE = {
  uid: 'lic_test', licence_ref: 'AXL-ZZ-0001', brand_name: 'Testland Ventures', status: 'active', kind: 'subsidiary',
  legal_entity_name: 'Testland Ventures Ltd', registered_address: '1 Example Street', signatory_name: 'A. Signer',
  signatory_title: 'Director', territories: ['PT', 'ES'], seats: { founder: 60, investor: 40, advisor: 15, partner: 10 },
  annual_fee_cents: 9_000_000, currency: 'EUR', revenue_share_bps: 2000, token_split_bps: 3000,
  starts_on: '2025-03-01', renews_on: '2028-03-01', term_years: 3, admin_role: 'principal',
};

test('the six tabs are sub-paths of /admin/my-licence, routed behind the admin guard, and written out as doors', () => {
  assert.deepEqual(LICENCE_TABS.map((t) => t.label), ['Summary', 'Terms', 'Contract', 'Statements', 'Requests', 'History']);
  assert.equal(tabPath('summary'), '/admin/my-licence');
  const app = read('frontend/src/App.jsx');
  for (const t of LICENCE_TABS.slice(1)) {
    assert.ok(app.includes(`<Route path="${t.path}" element={guard(['admin'], <MyLicencePage />)} />`), `${t.path} is not routed`);
  }
  // The page reads its tab from the path; anything else is Summary.
  for (const t of LICENCE_TABS) assert.equal(tabFor(t.path), t.key);
  assert.equal(tabFor('/admin/my-licence/terms/'), 'terms');
  assert.equal(tabFor('/admin/my-licence/unknown'), 'summary');
  // The tab row's literal doors are exactly the six paths (the reachability walk counts literals).
  const frame = codeOnly(read('frontend/src/pages/subsidiary/LicenceFrame.jsx'));
  const doors = [...frame.matchAll(/<Tab to="([^"]+)" tab="([a-z]+)">/g)].map((m) => [m[2], m[1]]);
  assert.deepEqual(doors, LICENCE_TABS.map((t) => [t.key, t.path]));
  // Contract, Statements and Requests are D804's tabs (#2241), mounted in this frame on their own paths.
  const page = codeOnly(read('frontend/src/pages/subsidiary/MyLicencePage.jsx'));
  for (const [key, C] of [['contract', 'ContractTab'], ['statements', 'StatementsTab'], ['requests', 'RequestsTab']]) {
    assert.ok(page.includes(`{tab === '${key}' && <${C} />}`), `${C} is not mounted on ${key}`);
    assert.ok(page.includes(`import ${C} from './licence/${C}';`), C);
  }
  // D804's stand-ins are gone: one page, one frame, one tab row.
  assert.ok(!app.includes('LicenceTabRoute'), 'D804\'s stand-in route is still mounted');
  assert.ok(!page.includes('LicenceTabsNav'), 'D804\'s stand-in tab row is still drawn');
  assert.ok(!frame.includes('Built by D804'), 'the placeholder is still drawn');
});

test('the Licences row stays lit on every tab, on both Admin shells, and carries the count', () => {
  for (const role of ['admin', 'branch_admin']) {
    const rows = (SIDEBAR_GROUPS[role] || []).flatMap((g) => g.items || []).filter((i) => i.label === 'Licences');
    assert.equal(rows.length, 1, `${role} has one Licences row`);
    const row = rows[0];
    assert.equal(row.count, 'licence_needs');
    // SidebarNav's rule: a row with `match` is lit on its paths and the paths below them.
    const lit = (path) => path === row.to || row.match.some((p) => path === p || path.startsWith(`${p}/`));
    for (const t of LICENCE_TABS) assert.ok(lit(t.path), `${role}: the row is dark on ${t.path}`);
    assert.ok(!lit('/admin/my-licences'), 'a sibling path lights the row');
  }
  const nav = codeOnly(read('frontend/src/ui/SidebarNav.jsx'));
  assert.match(nav, /useLicenceNeeds\(wantsLicenceNeeds\)/);
  assert.match(nav, /rowCounts\[item\.count\] > 0/, 'a zero or unread count is drawn');
});

test('the count pill counts the "Needs you" items, and an unread list draws none', () => {
  assert.equal(needsCount({ available: true, count: 3, items: [{}, {}, {}] }), 3);
  assert.equal(needsCount({ available: true, items: [{}, {}] }), 2);
  assert.equal(needsCount({ available: true, count: 0, items: [] }), 0);
  assert.equal(needsCount(null), null);
  assert.equal(needsCount(undefined), null);
  assert.equal(needsCount({ available: false }), null);
});

test('every tab draws the Admin rail with the Licences key in the real App, and no RENDER_NOT_YET line names one', async () => {
  for (const t of LICENCE_TABS) assert.equal(pageKeyFor(t.path, 'admin'), 'Admin · Licences', t.path);
  const listed = Object.values(RENDER_NOT_YET).flat().filter((n) => String(n).includes('/admin/my-licence'));
  assert.deepEqual(listed, []);
  // D781's ratchet renders the page map's routes; the five sub-paths are not
  // in it, so each is drawn here with the same harness, as an Admin member.
  const renderer = await railRenderer();
  try {
    for (const t of LICENCE_TABS) {
      const v = await renderer.verdict('Admin', t.path);
      assert.ok(v.pass, `${t.path}: ${v.why?.join('; ')}`);
      assert.ok(v.drawn.some((d) => d.keys.includes('Admin · Licences')), `${t.path} drew no Licences rail`);
    }
  } finally {
    renderer.close();
  }
});

test('Summary: the four cards read the ledger, and what it lacks reads "Not recorded"', () => {
  const t = termCard(LICENCE, NOW);
  assert.equal(t.title, 'Year 2 of 3');
  assert.equal(t.range, '1 Mar 2025 to 29 Feb 2028');
  assert.ok(t.pct > 50 && t.pct < 60);
  assert.equal(termCard({ ...LICENCE, term_years: null }, NOW).title, NOT_RECORDED);
  assert.equal(feeCard(LICENCE, NOW).amount, '€90,000');
  assert.equal(feeCard(LICENCE, NOW).next, 'next invoice 1 Mar 2027');
  assert.equal(feeCard({ ...LICENCE, annual_fee_cents: null }, NOW).amount, NOT_RECORDED);
  assert.deepEqual(shareCard(LICENCE), { share: '20%', detail: 'AI token split 30%' });
  assert.equal(shareCard(LICENCE, { royalty_platform_licence_bps: null }).detail, 'AI token split 30% · royalty on licences sold Not recorded');
  const out = text(h(SummaryCards, { licence: LICENCE, terms: null, requests: null, now: NOW }));
  for (const s of ['Year 2 of 3', '€90,000', '20%', 'Renews 1 Mar 2028, in 498 days', 'Renewal: Not recorded']) assert.ok(out.includes(s), s);
});

test('the Renewal card: what HQ is deciding first, then the recorded mode, never a guessed one', () => {
  const notice = renewalCard(LICENCE, { requests: { items: [{ kind: 'non_renewal', status: 'open', created_at: '2027-10-01T09:00:00Z' }] }, now: NOW });
  assert.deepEqual([notice.variant, notice.title, notice.detail], ['notice', 'Notice of non-renewal given', 'Ends 29 Feb 2028 · given 1 Oct 2027']);
  const asked = renewalCard(LICENCE, { requests: { items: [{ kind: 'renewal', status: 'open', created_at: '2026-10-12T09:00:00Z' }], response_hours: { renewal: 72 } }, now: NOW });
  assert.deepEqual([asked.variant, asked.title, asked.detail], ['requested', 'Renewal requested 12 Oct 2026', 'HQ answers within 72 hours']);
  const answered = renewalCard(LICENCE, { requests: { items: [{ kind: 'renewal', status: 'answered', created_at: '2026-10-12' }] }, now: NOW });
  assert.equal(answered.variant, 'date', 'an answered renewal request is not still "requested"');
  const auto = renewalCard(LICENCE, { terms: { renewal_mode: 'auto', non_renewal_notice_days: 90 }, now: NOW });
  assert.deepEqual([auto.title, auto.detail], ['Auto-renews 1 Mar 2028', 'Give notice by 2 Dec 2027 to stop it']);
  const onRequest = renewalCard(LICENCE, { terms: { renewal_mode: 'on_request', non_renewal_notice_days: 90 }, now: NOW });
  assert.equal(onRequest.detail, 'On request · notice by 2 Dec 2027');
  assert.equal(renewalCard({ ...LICENCE, renews_on: null }, { now: NOW }).title, 'Renewal date: Not recorded');
});

test('Needs you: one button per item; a notice is answered on History; empty and unreadable are different', () => {
  assert.deepEqual(needRow({ kind: 'contract', title: 'Contract v2 is waiting for your signature', link: '/admin/my-licence/contract' }),
    { title: 'Contract v2 is waiting for your signature', to: '/admin/my-licence/contract', label: 'Sign', primary: true });
  assert.equal(needRow({ kind: 'notice', title: 'HQ notice: x', link: '/admin/my-licence/requests' }).to, '/admin/my-licence/history');
  assert.equal(needRow({ kind: 'notice' }).label, 'Answer');
  assert.equal(needRow({ kind: 'statement', link: '/admin/my-licence/statements' }).label, 'View');
  assert.equal(needRow({ kind: 'seats', link: '/admin/my-licence/requests' }).label, 'Request seats');
  const full = html(h(NeedsYou, { needs: { available: true, count: 2, items: [{ kind: 'contract', title: 'Sign it', link: '/admin/my-licence/contract' }, { kind: 'notice', title: 'Answer it', link: '/x' }] } }));
  assert.equal((full.match(/data-testid="licence-need"/g) || []).length, 2);
  assert.match(full, /href="\/admin\/my-licence\/history"/);
  assert.match(text(h(NeedsYou, { needs: { available: true, count: 0, items: [] } })), /Nothing needs you/);
  assert.match(html(h(NeedsYou, { needs: null })), /licence-needs-unreadable/);
  assert.doesNotMatch(text(h(NeedsYou, { needs: null })), /Nothing needs you/, 'an unread list said nothing needs you');
});

test('What you owe HQ and Your contract read D798; "Sign" shows only with a signing link', () => {
  const statements = { available: true, statements: [
    { uid: 's2', period: '2026-Q3', status: 'issued', currency: 'EUR', gross_cents: 12_040_000, revenue_share_bps: 2000, owed_cents: 2_408_000, paid_cents: 0 },
    { uid: 's1', period: '2026-Q2', status: 'paid', currency: 'EUR', gross_cents: 1, revenue_share_bps: 2000, owed_cents: 1, paid_cents: 1 },
  ] };
  const owe = oweCard(statements);
  assert.equal(owe.status, 'Issued');
  assert.deepEqual(owe.rows, [['Period', '2026-Q3'], ['Gross', '€120,400'], ['Share', '20%'], ['Owed', '€24,080'], ['Paid', '€0']]);
  assert.deepEqual(oweCard({ available: true, statements: [] }), { empty: true });
  assert.deepEqual(oweCard({ available: false, reason: 'Read on HQ; this branch has no copy yet' }), { reason: 'Read on HQ; this branch has no copy yet' });
  assert.match(text(h(OweHq, { read: { value: statements, reason: '' } })), /€24,080/);

  const pending = { uid: 'c2', template_title: 'Subsidiary licence agreement', template_version: 2, status: 'sent', sent_at: '2026-10-12', signed_at: null };
  const inForce = { uid: 'c1', template_title: 'Subsidiary licence agreement', template_version: 1, status: 'signed', sent_at: '2025-02-20', signed_at: '2025-03-02' };
  const withLink = { available: true, pending, in_force: inForce, earlier: [], sign_url: 'https://example.test/esign/tok', sign_reason: null };
  const c = contractCard(withLink);
  assert.equal(c.title, 'Subsidiary licence agreement v2');
  assert.deepEqual(c.lines.map((l) => l.text), ['Sent 12 Oct 2026 · waiting for your signature', 'In force: v1, signed 2 Mar 2025']);
  assert.match(html(h(YourContract, { read: { value: withLink, reason: '' } })), /data-testid="licence-sign"[^>]*>Sign</);
  const noLink = { ...withLink, sign_url: null, sign_reason: 'HQ sent it to another administrator' };
  assert.doesNotMatch(html(h(YourContract, { read: { value: noLink, reason: '' } })), /licence-sign/);
  assert.match(text(h(YourContract, { read: { value: noLink, reason: '' } })), /HQ sent it to another administrator/);
  assert.doesNotMatch(html(h(YourContract, { read: { value: { available: true, pending: null, in_force: inForce, earlier: [], sign_url: null, sign_reason: 'Signed' }, reason: '' } })), /licence-sign/);
});

test('a null term reads "Not recorded": Deal terms at a glance, the Terms tab, the AI allowance', () => {
  const glance = text(h(DealGlance, { terms: null, termsReason: 'HQ has not recorded this licence\'s terms yet.', currency: 'EUR' }));
  assert.match(glance, /HQ has not recorded this licence's terms yet\./);
  assert.equal((glance.match(/Not recorded/g) || []).length, 5);
  const some = text(h(DealGlance, { terms: { first_look_business_days: 10, co_invest_max_bps: 2500, carry_share_bps: null, referral_fee_bps: 150, hq_approval_above_cents: 200_000_000 }, currency: 'EUR' }));
  for (const s of ['10 business days', 'up to 25%', '1.5%', '€2,000,000']) assert.ok(some.includes(s), s);
  assert.equal((some.match(/Not recorded/g) || []).length, 1);

  const sections = ledgerSections({ ...LICENCE, annual_fee_cents: null, seats: { founder: 60 } });
  assert.deepEqual(sections.map((s) => s.title), ['Parties', 'Territory and exclusivity', 'Term and renewal', 'Fees and money', 'Deal terms', 'Seats', 'Brand and platform', 'Compliance and reporting']);
  const rows = sections.flatMap((s) => s.rows);
  assert.equal(rows.find((r) => r.label === 'Annual licence fee').value, 'Not recorded');
  assert.equal(rows.find((r) => r.label === 'Investor / LP').value, 'Not recorded', 'a seat the copy omits is not zero');
  assert.ok(rows.every((r) => r.source === 'Ledger'));
  const terms = text(h(LicenceTerms, { sections, reason: 'HQ has not recorded this licence\'s terms yet.' }));
  assert.ok(terms.includes('Not recorded'));
  assert.ok(terms.includes('Notice → Your answer → Freeze → Suspension'), 'the compliance ladder');

  assert.deepEqual(allowanceCard({ daily_microusd: 5_000_000, monthly_microusd: 50_000_000, month_spend_microusd: 19_000_000 }),
    { daily: '$5', monthly: '$50', used: '$19 of $50 used this month', pct: 38 });
  assert.equal(allowanceCard({ daily_microusd: null }).daily, NOT_RECORDED);
});

test('Terms carries D797\'s schedule (#2242) under its sections, chipped with the contract section, a null term "Not recorded"', () => {
  const ledger = ledgerSections(LICENCE);
  // No schedule: no D797 row, and the sections that hold it say why.
  const none = scheduleSections(ledger, { terms: null });
  assert.deepEqual(none.flatMap((s) => s.rows), ledger.flatMap((s) => s.rows));
  assert.ok(none.filter((s) => s.schedule).length >= 5);
  const noneHtml = text(h(LicenceTerms, { sections: none, reason: 'HQ has not pushed this licence\'s terms yet.' }));
  assert.ok(noneHtml.includes('HQ has not pushed this licence\'s terms yet.'));

  const terms = {
    renewal_mode: 'on_request', non_renewal_notice_days: 90, royalty_platform_licence_bps: 1250,
    first_look_business_days: 10, hq_approval_above_cents: 200_000_000, exclusive: 1, carry_share_bps: null,
    usage_report_day: 5,
  };
  const out = scheduleSections(ledger, { terms, sections: { renewal_mode: '§4.2', first_look_business_days: '9.1' }, currency: 'EUR' });
  assert.deepEqual(out.map((s) => s.title), ledger.map((s) => s.title), 'D797\'s groups land in the eight sections');
  assert.ok(out.every((s) => !s.schedule), 'a recorded schedule repeats no reason');
  const row = (label) => out.flatMap((s) => s.rows).find((r) => r.label === label);
  assert.equal(row('Renewal').value, 'On request');
  assert.equal(row('Renewal').source, '§4.2');
  assert.equal(row('Non-renewal notice').value, '90 days');
  assert.equal(row('Non-renewal notice').source, 'Schedule');
  assert.equal(row('Royalty on platform licences sold').value, '12.5%');
  assert.equal(row('Exclusive territory').value, 'Yes');
  assert.equal(row('Carry share on sourced deals').value, NOT_RECORDED, 'a null term is not zero');
  assert.equal(row('Minimum guarantee').value, NOT_RECORDED, 'an absent term is not zero');
  assert.equal(row('Usage report due, day of month').value, 'Day 5');
  assert.ok(out.find((s) => s.title === 'Deal terms').rows.some((r) => r.label === 'First look'));
  // No D797 row offers a change: D799 takes the four ledger terms only.
  assert.ok(out.flatMap((s) => s.rows).filter((r) => r.source !== 'Ledger').every((r) => !r.term));
  const drawn = html(h(LicenceTerms, { sections: out, canRequest: true }));
  assert.match(drawn, /Contract §4\.2/);
  assert.match(drawn, /Contract §9\.1/);
  assert.equal((drawn.match(/licence-terms-schedule-reason/g) || []).length, 0);
  // The page draws the tab from `/mine`'s own terms and sections.
  const page = codeOnly(read('frontend/src/pages/subsidiary/MyLicencePage.jsx'));
  assert.ok(page.includes('scheduleSections(ledgerSections(l), { terms, sections: data.sections, currency: l.currency })'));
});

test('"Request a change" opens the Requests tab on the term, only on the four D799 takes, and never once terminated', () => {
  assert.equal(changeHref('fee'), '/admin/my-licence/requests?change=fee');
  const sections = ledgerSections(LICENCE);
  const offered = sections.flatMap((s) => s.rows).filter((r) => r.term).map((r) => r.term);
  assert.deepEqual([...new Set(offered)].sort(), ['fee', 'seats', 'term', 'territory']);
  const worker = read('cloudflare-worker/src/services/escalationRequests.ts');
  for (const t of new Set(offered)) assert.match(worker, new RegExp(`REQUESTABLE_TERMS = \\[[^\\]]*'${t}'`), `D799 does not take ${t}`);
  const open = html(h(LicenceTerms, { sections, canRequest: true }));
  assert.match(open, /href="\/admin\/my-licence\/requests\?change=fee"/);
  assert.match(open, /href="\/admin\/my-licence\/requests\?change=territory"/);
  assert.equal((open.match(/licence-term-change/g) || []).length, offered.length);
  assert.doesNotMatch(html(h(LicenceTerms, { sections, canRequest: false })), /licence-term-change/);
});

test('a frozen licence keeps the request lane open, and draws D142\'s lists in the Suspended banner', () => {
  const page = codeOnly(read('frontend/src/pages/subsidiary/MyLicencePage.jsx'));
  // Only termination closes "Request a change"; a suspension does not.
  assert.match(page, /canRequest=\{l\.status !== 'terminated'\}/);
  // The two lists still come from lib/branchFreeze, inside the Suspended banner.
  assert.match(page, /FROZEN\.map\(/);
  assert.match(page, /STILL_READABLE\.map\(/);
  assert.match(page, /suspended=\{suspendedDetail\}/);
  const summary = codeOnly(read('frontend/src/pages/subsidiary/LicenceSummary.jsx'));
  assert.match(summary, /\{state === 'suspended' \? suspended : null\}/);
  const b = stateBanner('suspended', { ...LICENCE, status: 'suspended', suspended_at: '2026-07-18', status_note: 'Statement unpaid past the cure period.' });
  assert.equal(b.title, 'Suspended by HQ since 18 Jul 2026');
  assert.equal(b.detail, 'Statement unpaid past the cure period.');
  assert.equal(b.action.to, '/admin/my-licence/history', 'the way out is the notice, on History');
  const drawn = text(h(LicenceStateBanner, { banner: b }, h('p', null, 'Locked list')));
  assert.match(drawn, /Suspended by HQ since 18 Jul 2026.*Answer the notice.*Locked list/);
});

test('board L7\'s states: pending, terminated, no licence; and no export link is drawn where none exists', () => {
  assert.equal(pageState(null), 'loading');
  assert.equal(pageState({ none: true }), 'none');
  assert.equal(pageState({ notPushed: true }), 'not_pushed');
  assert.equal(pageState({ licence: { status: 'pending_activation' } }), 'pending_activation');
  assert.equal(pageState({ licence: { status: 'active' } }), 'active');
  const pending = stateBanner('pending_activation', LICENCE, { signUrl: 'https://example.test/esign/tok' });
  assert.equal(pending.title, 'Sign your contract to activate');
  assert.deepEqual(pending.action, { label: 'Sign', href: 'https://example.test/esign/tok' });
  assert.deepEqual(stateBanner('pending_activation', LICENCE).action, { label: 'Open contract', to: '/admin/my-licence/contract' });
  const ended = stateBanner('terminated', { ...LICENCE, terminated_at: '2028-02-28' });
  assert.equal(ended.title, 'Terminated 28 Feb 2028 · read-only');
  assert.equal(ended.action, null, 'no account data export exists, so "Export your data" is not drawn');
  assert.equal(stateBanner('active', LICENCE), null);
  const page = read('frontend/src/pages/subsidiary/MyLicencePage.jsx');
  assert.ok(page.includes('Your account is not linked to a licence. Ask HQ.'));
  assert.match(page, /<Link to="\/help"[^>]*>\s*Contact HQ\s*<\/Link>/);
});

test('the header: kind, status, reference and territories; a copy pushed before migration 284 is not guessed a kind', () => {
  const out = text(h(LicenceHeader, { licence: LICENCE, terms: { exclusive: 1 } }));
  for (const s of ['Testland Ventures', 'AXL-ZZ-0001', 'Subsidiary', 'Active', 'Exclusive in', 'PT', 'ES']) assert.ok(out.includes(s), s);
  assert.match(text(h(LicenceHeader, { licence: { ...LICENCE, kind: 'white_label' } })), /White-label/);
  assert.match(text(h(LicenceHeader, { licence: { ...LICENCE, kind: null } })), /Not recorded/);
  assert.match(text(h(LicenceHeader, { licence: LICENCE })), /Territory PT ES/, 'exclusivity drawn though no term records it');
});

test('Seats: a branch\'s per-type count fills the bars; on HQ nothing is counted and nothing is drawn as zero', () => {
  const hq = seatRows(LICENCE);
  assert.equal(hq.counted, false);
  assert.ok(hq.rows.every((r) => r.used === null && r.pct === 0));
  const branch = seatRows({ ...LICENCE, seats_used_by_type: { founder: 57, investor: 18, advisor: 9, partner: 0 } });
  assert.equal(branch.counted, true);
  assert.deepEqual(branch.rows.map((r) => [r.key, r.used, r.licensed, r.pct, r.near]),
    [['founder', 57, 60, 95, true], ['investor', 18, 40, 45, false], ['advisor', 9, 15, 60, false], ['partner', 0, 10, 0, false]]);
  assert.equal(seatRows({ seats: {} }).rows[0].licensed, null);
});

test('Administrators names the caller and says the others are HQ\'s to read; History names each event', () => {
  const out = text(h(Administrators, { user: { name: 'A. Signer' }, adminRole: 'delegate' }));
  assert.match(out, /A\. Signer Delegate · you/);
  assert.match(out, /other administrators are on HQ.s record/);
  // D804's Requests tab draws the delegate form; it reads no `?kind=`, so the link is the tab itself.
  assert.match(html(h(Administrators, { user: {}, adminRole: 'principal' })), /href="\/admin\/my-licence\/requests"/);
  // "Request seats" opens D804's sheet on its Seats chip (`chipForTerm('seats')`).
  assert.ok(codeOnly(read('frontend/src/pages/subsidiary/MyLicencePage.jsx')).includes("<Link to={changeHref('seats')}"));
  assert.equal(eventLabel('terms_changed'), 'Terms changed');
  assert.equal(eventLabel(''), 'Not recorded');
  assert.equal(longDate('2026-07-18 10:00:00'), '18 Jul 2026');
  assert.equal(longDate(null), NOT_RECORDED);
});

test('phone (board L8): the tabs are one scrolling row, the cards stack', () => {
  const frame = read('frontend/src/pages/subsidiary/LicenceFrame.jsx');
  assert.match(frame, /overflow-x-auto/);
  assert.match(frame, /flex-nowrap gap-1\.5 pb-0\.5 sm:flex-wrap/);
  const summary = read('frontend/src/pages/subsidiary/LicenceSummary.jsx');
  assert.match(summary, /grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4/);
  assert.match(summary, /grid-cols-1 items-start gap-3 lg:grid-cols-/);
});
