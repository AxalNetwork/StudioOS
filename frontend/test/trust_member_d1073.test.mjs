/** D1073 — the mounted member page uses real clients over a stubbed fetch.
 * Each scenario runs unchanged, against deliberate regressions, then restored.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h, mountForm, mutationCheck } from './_form_d695.mjs';

const source = readFileSync('frontend/src/pages/TrustCenterPage.jsx', 'utf8');
const path = 'pages/TrustCenterPage.jsx';
const obligation = (key, status = 'pending') => ({ obligation_key: key, required: 1, status });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function mounted(Page, { phone = false, role = 'founder', obligations = [obligation('founder_nda_v1')], fail = false } = {}) {
  const original = globalThis.fetch;
  const seen = [];
  const state = { fail };
  globalThis.fetch = async (url, init = {}) => {
    const p = new URL(url, 'https://fixture.example.test').pathname;
    seen.push([init.method || 'GET', p]);
    if (p === '/api/trust/me') return state.fail ? json({ message: 'Synthetic failure' }, 503) : json({ role, obligations });
    if (p === '/api/trust/nda/required') return json({ items: [{ obligation_key: 'founder_nda_v1', open: true, evidence_envelope_uuid: 'synthetic-envelope' }] });
    if (p === '/api/kyc/status') return json({ kyc_status: 'not_started' });
    if (p === '/api/trust/pairwise-ndas') return json({ items: [{ id: 10, party_a_user_id: 1, party_b_user_id: 2, party_b_name: 'Synthetic counterparty', status: 'pending', nda_envelope_uuid: 'synthetic-pair' }] });
    if (p === '/api/trust/agreements') return json({ pending_envelopes: [], documents: [] });
    return json({});
  };
  let view;
  try {
    view = await mountForm(h(Page), { phone });
    await view.flush();
    localStorage.setItem('user', JSON.stringify({ id: 1, role }));
    return { ...view, state, seen, async unmount() { await view.unmount(); globalThis.fetch = original; } };
  } catch (e) { globalThis.fetch = original; throw e; }
}

for (const phone of [false, true]) test(`failed requirements are Unreadable with no score, and retry works (${phone ? 'phone' : 'desktop'})`, async () => {
  await mutationCheck(source, path, async ({ default: Page }) => {
    const v = await mounted(Page, { phone, fail: true });
    try {
      assert.match(v.text(), /Unreadable.*Your requirements could not be read\./s);
      assert.doesNotMatch(v.text(), /of 100|No obligations outstanding|Nothing is required/);
      v.state.fail = false;
      await v.click('Try again'); await v.flush();
      assert.doesNotMatch(v.text(), /Unreadable/);
      assert.match(v.text(), /Founder NDA/);
      assert.equal(v.seen.filter(([, p]) => p === '/api/trust/me').length, 2);
    } finally { await v.unmount(); }
  }, [
    ["if (m.status === 'fulfilled') setMatrix(m.value); else setMatrix({ obligations: [], role, failed: true });", "setMatrix(m.status === 'fulfilled' ? m.value : { obligations: [], role });"],
    ['onClick={reload} className="ml-2 underline"', 'onClick={() => {}} className="ml-2 underline"'],
    ['Your requirements could not be read.', 'Everything is complete.'],
  ]);
});

test('only the authoritative investor role gets Identity, including with stale non-investor KYC rows', async () => {
  await mutationCheck(source, path, async ({ default: Page }) => {
    for (const role of ['founder', 'partner', 'admin', 'advisor', 'exploring', 'investor']) for (const obligations of [[], [obligation('kyc_v1', 'waived')]]) {
      const v = await mounted(Page, { role, obligations });
      try {
        assert.equal(!!v.by('trust-tab-identity'), role === 'investor', role);
      } finally { await v.unmount(); }
    }
  }, [
    ["new Set(['investor'])", "new Set(['founder', 'partner', 'investor', 'admin'])"],
    ['if (KYC_ELIGIBLE_ROLES.has(role))', "if (has('identity') || KYC_ELIGIBLE_ROLES.has(role))"],
    ["new Set(['investor'])", 'new Set([])'],
  ]);
});

test('pending rows have no Start; real role-envelope signing remains available', async () => {
  await mutationCheck(source, path, async ({ default: Page }) => {
    const v = await mounted(Page);
    try {
      assert.ok(!v.nodes().some(n => n.tagName === 'BUTTON' && n.textContent === 'Start'));
      await v.click('Agreements'); await v.flush();
      assert.match(v.text(), /Open to sign/);
      assert.ok(!v.nodes().some(n => n.tagName === 'BUTTON' && n.textContent === 'Start'));
      assert.ok(v.seen.every(([method]) => method === 'GET'));
    } finally { await v.unmount(); }
  }, [
    ['{rowAction ? rowAction(o) : null}', '{rowAction ? rowAction(o) : null}<button>Start</button>'],
    ['return <OpenToSignButton item={it} onChanged={onChanged} />;', 'return null;'],
  ]);
});

for (const phone of [false, true]) test(`admin tools are links without global reads or writes (${phone ? 'phone' : 'desktop'})`, async () => {
  await mutationCheck(source, path, async ({ default: Page }) => {
    const v = await mounted(Page, { phone, role: 'admin', obligations: [] });
    try {
      assert.ok(!v.by('trust-tab-sanctions'));
      const links = () => v.nodes().filter(n => n.tagName === 'A').map(n => v.props(n).href);
      assert.ok(links().includes('/admin/contracts?tab=ndas'));
      assert.ok(links().includes('/admin/kyc'));
      await v.click('Agreements'); await v.flush();
      assert.doesNotMatch(v.text(), /Synthetic counterparty|Run screening|Resend|Void/);
      assert.ok(v.seen.every(([method, p]) => method === 'GET' && !p.includes('pairwise-ndas') && !p.includes('/sanctions')));
    } finally { await v.unmount(); }
  }, [
    ['{role === \'admin\' && <TrustAdminTools />}', '{false && <TrustAdminTools />}'],
    ['href="/admin/contracts?tab=ndas"', 'href="/admin/contracts"'],
    ['href="/admin/kyc"', 'href="/kyc"'],
    ['isAdmin ? Promise.resolve({ items: [] }) : api.trustListPairwiseNdas()', 'api.trustListPairwiseNdas()'],
    ["  tabs.push({ key: 'agreements', label: 'Agreements', icon: FileSignature });", "  tabs.push({ key: 'agreements', label: 'Agreements', icon: FileSignature }); if (role === 'admin') tabs.push({key:'sanctions',label:'Sanctions',icon:Globe});"],
  ]);
});

test('members keep their own pairwise signing and never get admin tools', async () => {
  await mutationCheck(source, path, async ({ default: Page }) => {
    const v = await mounted(Page);
    try {
      assert.ok(!v.by('trust-admin-tools'));
      await v.click('Agreements'); await v.flush();
      assert.match(v.text(), /Mutual NDA · Synthetic counterparty/);
      assert.match(v.text(), /Sign/);
      assert.ok(v.seen.some(([, p]) => p === '/api/trust/pairwise-ndas'));
    } finally { await v.unmount(); }
  }, [
    ["{role === 'admin' && <TrustAdminTools />}", '{true && <TrustAdminTools />}'],
    ['{!isAdmin && <Section icon={Lock}', '{false && <Section icon={Lock}'],
    ['{canSign && <PairwiseSignButton', '{false && <PairwiseSignButton'],
  ]);
});
