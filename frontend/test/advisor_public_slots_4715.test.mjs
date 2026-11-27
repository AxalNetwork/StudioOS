// #4715 — the advisor directory's slot list reads a slot as anyone but its
// advisor sees it: no meeting link, only `has_meeting_link`. The video badge
// follows that flag, so a slot keeps its badge without the link being sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h, mountForm, sourceModule } from './_form_d695.mjs';
import { slotView } from '../src/pages/advisor/advisory/kit.jsx';

const later = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
const slot = (id, extra) => ({ id, uid: `s-${id}`, advisor_id: 1, starts_at: later(id), ends_at: new Date(Date.parse(later(id)) + 3_600_000).toISOString(),
  capacity: 1, taken: 0, available: 1, is_cancelled: false, ...extra });

test('slotView: the public flag decides hasMeetingLink; a whole slot still reads its own link', () => {
  assert.equal(slotView(slot(1, { has_meeting_link: true })).hasMeetingLink, true);
  assert.equal(slotView(slot(1, { has_meeting_link: true })).meetingUrl, null, 'no link is invented');
  assert.equal(slotView(slot(2, { has_meeting_link: false })).hasMeetingLink, false);
  assert.equal(slotView(slot(3, { meeting_url: 'https://meet.example.test/x' })).hasMeetingLink, true, "the advisor's own read");
  assert.equal(slotView(slot(4, { meeting_url: null })).hasMeetingLink, false);
});

const API_IMPORT = "import { api } from '../lib/api';";

test('AdvisorDetail: the video badge shows on a public slot that has a link, and only there', async () => {
  const src = readFileSync(new URL('../src/pages/AdvisorsPage.jsx', import.meta.url), 'utf8');
  assert.ok(src.includes(API_IMPORT));
  globalThis.__api4715 = { api: { listAdvisorSlots: async () => ({ items: [
    slot(1, { has_meeting_link: true }), slot(2, { has_meeting_link: false }),
  ] }) } };
  const mod = await sourceModule(src.replace(API_IMPORT, 'const { api } = globalThis.__api4715;'), 'pages/AdvisorsPage.jsx');
  const f = await mountForm(h(mod.AdvisorDetail, { advisor: { uid: 'a-1', display_name: 'Advisor' }, onClose() {} }), { modal: true });
  try {
    await f.flush();
    const text = f.text();
    assert.equal((text.match(/ min video/g) || []).length, 1, 'one badge, on the slot with a link');
  } finally { await f.unmount(); }
});
