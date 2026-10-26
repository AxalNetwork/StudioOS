import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountForm, mutationCheck } from './_form_d695.mjs';

// #2440 held that an IC meeting is never created without its deal. Since
// D1211 (#3177) the deal is chosen by name in New IC meeting (CAL7) from the
// deals the caller can open, never typed as a number; the rule is the same.
// The real dialog is mounted with only its fetch stubbed.
const source = readFileSync(new URL('../src/pages/CalendarNewDialogs.jsx', import.meta.url), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: String(status), headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

async function verify(module) {
  const posted = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if ((options.method || 'GET') === 'POST') { posted.push(JSON.parse(options.body)); return response({ id: 1 }); }
    if (u.includes('/calendar/deals')) return response({ items: [{ id: 200, name: 'Fixture venture', status: 'open' }] });
    return response({ for: 'ic', items: [] });
  };
  let saved = 0;
  const f = await mountForm(h(module.NewIcDialog, { meetAvailable: false, onClose() {}, onSaved() { saved++; } }), { modal: true });
  const settle = async () => { for (let i = 0; i < 5; i += 1) await f.flush(); };
  const type = async (id, value) => { await act(async () => f.props(f.by(id)).onChange({ target: { value } })); await settle(); };
  try {
    await type('cal-ic-title', 'Fixture IC');
    await type('cal-ic-start', '2999-01-01T12:00');
    assert.equal(f.props(f.by('cal-ic-save')).disabled, true, 'no deal, no meeting');
    // The handler also refuses invalid state if invoked programmatically.
    await act(async () => f.props(f.by('cal-ic-save')).onClick());
    assert.equal(posted.length, 0);
    await act(async () => { await new Promise((r) => setTimeout(r, 260)); });
    await settle();
    await act(async () => f.props(f.by('cal-ic-deal-option')).onClick());
    await settle();
    assert.equal(f.props(f.by('cal-ic-save')).disabled, false);
    await act(async () => f.props(f.by('cal-ic-save')).onClick());
    await settle();
    assert.equal(posted[0].deal_id, 200);
    assert.equal(saved, 1);
  } finally { await f.unmount(); globalThis.fetch = previous; }
}
test('#2440: New IC meeting requires a chosen deal and sends it; each validation/payload mutation is rejected', async () => {
  await mutationCheck(source, 'pages/CalendarNewDialogs.jsx', verify, [
    ["const ready = title.trim().length >= 2 && deal && startOf(start)", "const ready = title.trim().length >= 2 && startOf(start)"],
    ['deal_id: deal.id,', 'deal_id: null,'],
    ['onChoose={setDeal}', 'onChoose={() => {}}'],
  ]);
});
