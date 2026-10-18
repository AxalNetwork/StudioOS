/**
 * D717 (#1782) decision 11 — the entity and money map: one model
 * (services/fundStructure.ts), the paper's drawing (fundStructurePaper.ts),
 * its page in the PPM, the booklet and the Compliance Manual, and
 * GET /api/admin/fund-structure.
 *
 * #1774's fee harness gives the D1 (472's registry, Fund I as `vc_funds` 1)
 * and #1773's synthetic GP checking row. No Fund row exists, so the Fund's
 * flows read "Not opened yet". Every number is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import adminFundStructure from '../src/routes/admin_fund_structure.ts';
import {
  fundStructureModel, structureForPaper, ADMIN_WITHHELD, RECEIVING_BRACKET, NOT_OPENED_YET, OUTSIDE_THE_MAP,
  type StructureModel,
} from '../src/services/fundStructure.ts';
import { structureSvg, structureLines, STRUCTURE_MARKER } from '../src/services/fundStructurePaper.ts';
import { paperModel, paperHtml } from '../src/services/legalPaper.ts';
import { renderPaperFallbackPdf } from '../src/services/pdf.ts';
import { MONEY_KINDS } from '../src/services/moneyRails.ts';
import { PAYMENT_PURPOSES } from '../src/services/payInstructions.ts';
import { makeEnv, gpAccount, GP_NUMBER, token, ADMIN, SUPER, LP_USER } from './_fund_fees_d709_harness.ts';

const ARROWS = /[←-⇿]/;
const flow = (m: StructureModel, kind: string) => m.flows.find((f) => f.kind === kind)!;

async function readyEnv() {
  const env = makeEnv();
  await gpAccount(env);
  return env;
}

/** Fails the test if anything reaches the network. */
function noFetch() {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; throw new Error('fetch must not be called'); }) as any;
  return { calls: () => calls, restore: () => { globalThis.fetch = real; } };
}

test('D717 the Super Admin and an issued copy see the masked GP account and the Fund\'s "Not opened yet"; an Admin and a preview read no account', async () => {
  const env = await readyEnv();
  const net = noFetch();
  try {
    for (const audience of ['super_admin', 'issued'] as const) {
      const m = await fundStructureModel(env, { audience });
      const fee = flow(m, 'management_fee').receiving;
      assert.equal(fee.shown, 'account', audience);
      if (fee.shown === 'account') {
        assert.equal(fee.account_last4, GP_NUMBER.slice(-4));
        assert.equal(fee.beneficiary_name, 'Axal VC GP LLC');
        assert.ok(!fee.account_masked.includes(GP_NUMBER.slice(0, 6)));
      }
      for (const kind of ['capital_contribution', 'gp_commitment']) {
        const r = flow(m, kind).receiving;
        assert.equal(r.shown, 'refusal', `${audience} ${kind}`);
        if (r.shown === 'refusal') { assert.equal(r.code, 'fund_account_missing'); assert.equal(r.label, NOT_OPENED_YET); }
      }
      const licence = flow(m, 'licence_fee_fund_admin').receiving;
      assert.equal(licence.shown === 'refusal' && licence.code, 'no_active_account', audience);
      assert.ok(!JSON.stringify(m).includes(GP_NUMBER), `${audience}: no full number`);
      assert.ok(!JSON.stringify(m).includes('121145433'), `${audience}: no routing number`);
    }
    const admin = await fundStructureModel(env, { audience: 'admin' });
    for (const kind of ['management_fee', 'capital_contribution', 'gp_commitment', 'licence_fee_management_admin', 'licence_fee_fund_admin']) {
      assert.deepEqual(flow(admin, kind).receiving, { shown: 'withheld', text: ADMIN_WITHHELD }, kind);
    }
    assert.ok(!JSON.stringify(admin).includes(GP_NUMBER.slice(-4)), 'the Admin\'s map holds no digit of the account');
    assert.doesNotMatch(JSON.stringify(admin), /\d{4}/);
    const preview = await fundStructureModel(env, { audience: 'preview' });
    assert.deepEqual(flow(preview, 'management_fee').receiving, { shown: 'bracket', text: RECEIVING_BRACKET });
    assert.ok(!JSON.stringify(preview).includes(GP_NUMBER.slice(-4)));
    assert.equal(net.calls(), 0);
  } finally { net.restore(); }
});

test('D717 the model is built from #1772 and #1773: four entities, two licences, every money kind, Stripe on Management\'s account', async () => {
  const env = await readyEnv();
  const m = await fundStructureModel(env, { audience: 'super_admin' });
  assert.deepEqual(m.entities.map((e) => e.key), ['holdings', 'management', 'gp', 'fund']);
  assert.ok(m.entities.every((e) => e.role.length > 20));
  assert.deepEqual(m.flows.map((f) => f.kind), MONEY_KINDS.map((k) => k.kind));
  assert.deepEqual(m.licences.map((l) => [l.licensee, l.scope]), [['management', 'management administration'], ['gp', 'fund administration']]);
  for (const f of m.flows.filter((x) => x.rail === 'stripe')) {
    assert.deepEqual(f.receiving, { shown: 'stripe', text: "Stripe, Axal VC Management LLC's account" }, f.kind);
  }
  assert.equal(m.note, OUTSIDE_THE_MAP);
});

test('D717 a distribution and a fund expense name who is paid in every audience, and never call the resolver', async () => {
  const env = await readyEnv();
  for (const audience of ['super_admin', 'admin', 'preview', 'issued'] as const) {
    const calls: [string, string][] = [];
    const spy = async (payee: any, purpose: any) => { calls.push([payee, purpose]); return { ok: false as const, code: 'no_active_account' as const, message: 'x' }; };
    const m = await fundStructureModel(env, { audience, resolver: spy });
    assert.deepEqual(flow(m, 'distribution').receiving, { shown: 'paid_out', text: 'Paid to the LP' }, audience);
    assert.deepEqual(flow(m, 'fund_expense').receiving, { shown: 'paid_out', text: 'Paid to the vendor' }, audience);
    assert.equal(flow(m, 'distribution').purpose, null);
    assert.equal(flow(m, 'fund_expense').purpose, null);
    if (audience === 'admin' || audience === 'preview') {
      assert.equal(calls.length, 0, `${audience} reads no account`);
    } else {
      // One call per purpose, each with the purpose's own payee: never for a kind no purpose receives.
      assert.deepEqual(calls.map(([, p]) => p).sort(), Object.keys(PAYMENT_PURPOSES).sort(), audience);
      for (const [payee, purpose] of calls) assert.equal(payee, (PAYMENT_PURPOSES as any)[purpose].payee);
    }
  }
});

test('D717 the SVG draws with paths, escapes every text and uses no arrow character', async () => {
  const env = await readyEnv();
  const m = await fundStructureModel(env, { audience: 'issued' });
  const svg = structureSvg(m);
  assert.match(svg, /^<svg class="fund-structure"/);
  assert.doesNotMatch(svg, /<script/i);
  assert.doesNotMatch(svg, ARROWS);
  assert.equal((svg.match(/class="fs-marker"/g) || []).length, m.flows.length, 'one numbered marker per flow');
  assert.equal((svg.match(/class="fs-head/g) || []).length, m.flows.length, 'one arrowhead per flow');
  assert.doesNotMatch(svg, /<(circle|line|polygon|polyline|rect)\b/, 'lines, heads, markers and boxes are paths');
  const hostile: StructureModel = {
    ...m,
    entities: m.entities.map((e, i) => (i === 0 ? { ...e, name: '<img src=x onerror=alert(1)> & "Co"' } : e)),
    flows: m.flows.map((f, i) => (i === 0 ? { ...f, payer_label: '</svg><script>x</script>' } : f)),
  };
  const out = structureSvg(hostile);
  assert.doesNotMatch(out, /<img|<script|<\/svg>\s*<script/i);
  assert.ok(out.includes('&lt;img'));
  for (const l of structureLines(m)) assert.doesNotMatch(l, ARROWS);
  assert.ok(structureLines(m).some((l) => l.includes('Paid to the LP')));
});

const PPM_BODY = '## 1. The Offering\n\nInterests are offered to accredited investors.\n\n' + STRUCTURE_MARKER
  + '\n\n## 2. Risk Factors\n\nAn investment involves risk.';
const PPM_NO_MARKER = '## 1. The Offering\n\nInterests are offered to accredited investors.\n\n## 2. Risk Factors\n\nAn investment involves risk.';

function ppmHtml(body: string, structure: StructureModel | null, slug = 'ppm') {
  const m = paperModel({ title: 'Private Placement Memorandum', body, slug, bodySha256: '0'.repeat(64), state: { kind: 'draft' }, structure });
  return { model: m, html: paperHtml(m, { pageSize: 'letter', cover: 'light', medium: 'screen', fonts: 'omit' }) };
}

test('D717 the PPM carries the page once: at the marker line when there is one, after the preamble when not; another slug carries none', async () => {
  const env = await readyEnv();
  const structure = await structureForPaper(env, 'ppm', 'preview');
  assert.ok(structure, 'ppm is a map document');
  const marked = ppmHtml(PPM_BODY, structure).html;
  assert.equal((marked.match(/class="structure-page"/g) || []).length, 1);
  assert.ok(!marked.includes(STRUCTURE_MARKER), 'the marker line is dropped');
  const at = marked.indexOf('class="structure-page"');
  // lastIndexOf: the contents page lists each article first.
  assert.ok(marked.indexOf('accredited investors') < at && at < marked.lastIndexOf('2. Risk Factors'), 'at the marker');
  assert.ok(marked.includes(RECEIVING_BRACKET), 'a preview prints the bracket label');

  const plain = ppmHtml(PPM_NO_MARKER, structure).html;
  assert.equal((plain.match(/class="structure-page"/g) || []).length, 1);
  assert.ok(plain.indexOf('class="structure-page"') < plain.lastIndexOf('1. The Offering'), 'straight after the preamble');

  assert.equal(await structureForPaper(env, 'investor_nda_axal', 'preview'), null);
  const nda = ppmHtml(PPM_NO_MARKER, structure, 'investor_nda_axal');
  assert.equal(nda.model.structure, null, 'a non-map slug prints no page even when handed a model');
  assert.ok(!nda.html.includes('class="structure-page"'));

  const issued = ppmHtml(PPM_NO_MARKER, await structureForPaper(env, 'ppm', 'issued')).html;
  assert.ok(issued.includes(`ending ${GP_NUMBER.slice(-4)}`), 'an issued copy prints the masked account');
  assert.ok(issued.includes(NOT_OPENED_YET));
  assert.ok(!issued.includes(GP_NUMBER));
  assert.doesNotMatch(issued, /<script/i);
});

test('D717 the booklet carries the page after Part 2; the pdf-lib fallback prints the list', async () => {
  const env = await readyEnv();
  const structure = await structureForPaper(env, 'subscription_booklet', 'preview');
  const part = (n: number, title: string) => ({ n, title, body: `Part ${n} text.`, block: null, footer: title });
  const m = paperModel({
    title: 'Subscription Booklet', body: '> Legend.', slug: 'subscription_booklet', bodySha256: '0'.repeat(64), state: { kind: 'draft' },
    parts: [part(1, 'Cover'), part(2, 'Instructions'), part(3, 'Subscription Agreement')], structure,
  });
  const html = paperHtml(m, { pageSize: 'letter', cover: 'light', medium: 'screen', fonts: 'omit' });
  const at = html.indexOf('class="structure-page"');
  assert.ok(at > html.indexOf('Part 2 text.') && at < html.indexOf('Part 3 text.'), 'after Part 2');
  assert.equal((html.match(/class="structure-page"/g) || []).length, 1);

  const ppm = ppmHtml(PPM_BODY, structure).model;
  const pdf = await renderPaperFallbackPdf(ppm, { pageSize: 'letter' });
  assert.equal(new TextDecoder().decode(pdf.subarray(0, 5)), '%PDF-');
  for (const l of ppm.structure!.lines) assert.doesNotMatch(l, ARROWS);
});

const app = new Hono<any>();
app.route('/api/admin/fund-structure', adminFundStructure);
app.onError((e: any, c) => {
  const m = String(e?.message ?? '');
  if (m === 'Unauthorized') return c.json({ detail: 'Unauthorized' }, 401);
  if (m === 'Admin required' || m === 'Forbidden') return c.json({ detail: m }, 403);
  if (m === 'HQ only') return c.json({ detail: m }, 403);
  return c.json({ error: m }, 500);
});
async function read(env: any, who: number | null, extraEnv: Record<string, unknown> = {}) {
  const headers: Record<string, string> = who ? { Authorization: `Bearer ${await token(who)}` } : {};
  const res = await app.request('/api/admin/fund-structure', { headers }, { ...env, ...extraEnv });
  return { status: res.status, text: await res.text(), cache: res.headers.get('Cache-Control') };
}

test('D717 GET /api/admin/fund-structure: the Super Admin\'s map, the Admin\'s sentence, refused on a branch and to a non-admin; the number is nowhere', async () => {
  const env = await readyEnv();
  const net = noFetch();
  const lines: string[] = [];
  const spies = (['log', 'info', 'warn', 'error'] as const).map((k) => {
    const real = console[k];
    console[k] = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
    return () => { console[k] = real; };
  });
  try {
    const sup = await read(env, SUPER);
    assert.equal(sup.status, 200);
    assert.equal(sup.cache, 'no-store');
    const sm = JSON.parse(sup.text);
    assert.equal(sm.audience, 'super_admin');
    assert.equal(flow(sm, 'management_fee').receiving.account_last4, GP_NUMBER.slice(-4));

    const adm = await read(env, ADMIN);
    assert.equal(adm.status, 200);
    const am = JSON.parse(adm.text);
    assert.equal(am.audience, 'admin');
    assert.equal(flow(am, 'management_fee').receiving.text, ADMIN_WITHHELD);
    assert.ok(!adm.text.includes(GP_NUMBER.slice(-4)));

    assert.equal((await read(env, null)).status, 401);
    assert.equal((await read(env, LP_USER)).status, 403);
    const branch = await read(env, SUPER, { BRANCH_CODE: 'acme' });
    assert.equal(branch.status, 403);
    assert.ok(branch.text.includes('HQ only'));

    // The sweep: the synthetic full number is in no response, no row and no console line.
    for (const r of [sup, adm]) assert.ok(!r.text.includes(GP_NUMBER));
    const tables = env.__db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    for (const { name } of tables) {
      const rows = env.__db.prepare(`SELECT * FROM "${name}"`).all();
      assert.ok(!JSON.stringify(rows).includes(GP_NUMBER), name);
    }
    assert.ok(!lines.some((l) => l.includes(GP_NUMBER)));
    assert.equal(net.calls(), 0);
  } finally {
    spies.forEach((undo) => undo());
    net.restore();
  }
});
