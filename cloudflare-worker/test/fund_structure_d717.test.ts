/**
 * D717 (#1782) decision 11 — the entity and money map: one model
 * (services/fundStructure.ts), the paper's drawing (fundStructurePaper.ts),
 * its page in the PPM, the booklet and the Compliance Manual, and
 * GET /api/admin/fund-structure.
 *
 * #1774's fee harness gives the D1 (472's registry, Fund I as `vc_funds` 1)
 * and #1773's synthetic GP checking row. No Fund row exists, so the Fund's
 * flows read "Not opened yet". Every number is synthetic.
 *
 * #1855: the eight numbered rows, the one `map` both drawings print, the paper
 * table, who signs for each entity, and the Super Admin's `accounts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import adminFundStructure from '../src/routes/admin_fund_structure.ts';
import {
  fundStructureModel, structureForPaper, ADMIN_WITHHELD, RECEIVING_BRACKET, NOT_OPENED_YET, OUTSIDE_THE_MAP,
  FLOW_ROWS, RAILS_NOTE, type StructureModel,
} from '../src/services/fundStructure.ts';
import { structureSvg, structureLines, structureTable, STRUCTURE_MARKER } from '../src/services/fundStructurePaper.ts';
import { AXAL_ENTITIES } from '../src/services/legalDocFormat.ts';
import { ENTITY_SIGNS, STRIPE_MONEY_KINDS } from '../src/services/moneyRails.ts';
import { encryptColumn } from '../src/services/columnCipher.ts';
import { paperModel, paperHtml } from '../src/services/legalPaper.ts';
import { renderPaperFallbackPdf } from '../src/services/pdf.ts';
import { MONEY_KINDS } from '../src/services/moneyRails.ts';
import { PAYMENT_PURPOSES } from '../src/services/payInstructions.ts';
import { makeEnv, gpAccount, addFundAccount, GP_NUMBER, token, ADMIN, SUPER, LP_USER } from './_fund_fees_d709_harness.ts';

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
    // `signing.address` holds "16192" and "19958", so the digit sweep reads the flows and the rows.
    assert.doesNotMatch(JSON.stringify({ flows: admin.flows, rows: admin.rows }), /\d{4}/);
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
  assert.equal((svg.match(/class="fs-marker/g) || []).length, m.map.routes.length, 'one numbered marker per route');
  assert.equal((svg.match(/class="fs-head/g) || []).length, m.map.routes.length, 'one arrowhead per route');
  assert.equal(m.map.routes.length, 10);
  assert.doesNotMatch(svg, /<(circle|line|polygon|polyline|rect)\b/, 'lines, heads, markers and boxes are paths');
  // The drawing prints the model's map: its titles and labels are the texts to escape.
  const hostile: StructureModel = {
    ...m,
    map: {
      ...m.map,
      boxes: m.map.boxes.map((b, i) => (i === 0 ? { ...b, title: { ...b.title, text: '<img src=x onerror=alert(1)> & "Co"' } } : b)),
      labels: m.map.labels.map((l, i) => (i === 0 ? { ...l, text: '</svg><script>x</script>' } : l)),
    },
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

    // #1855: the Super Admin's answer lists the accounts; the Admin's has no `accounts` key.
    assert.ok(Array.isArray(sm.accounts));
    assert.ok(!('accounts' in am));

    // The sweep: the synthetic full number, the routing number and the bank's
    // address are in no response, and the number in no row and no console line.
    for (const r of [sup, adm]) {
      assert.ok(!r.text.includes(GP_NUMBER));
      assert.ok(!r.text.includes('121145433'));
      assert.ok(!r.text.includes('1 Letterman Drive'));
    }
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

// ── #1855: the numbered rows, the one map, who signs, and the accounts ─────

/** A GP savings account and a retired GP checking account, in the harness's insert pattern. Synthetic numbers. */
async function gpSavingsAndRetired(env: any) {
  const rows: [string, string, string, string, string][] = [
    ['0000bbbb-0000-4000-8000-000000000721', 'GP reserve', 'savings', '7700112206', 'active'],
    ['0000bbbb-0000-4000-8000-000000000722', 'GP old checking', 'checking', '7700112299', 'retired'],
  ];
  for (const [uid, label, kind, number, status] of rows) {
    const enc = await encryptColumn(env, 'entity_bank_accounts', 'account_number_enc', uid, number);
    env.__db.prepare(`INSERT INTO entity_bank_accounts
        (uid, entity_key, label, bank_name, bank_address, beneficiary_name, beneficiary_address, account_kind,
         account_number_enc, account_last4, routing_number, swift_code, purposes_json, status, retired_at, retired_reason, recorded_by)
       VALUES (?, 'gp', ?, 'Column N.A.', '1 Letterman Drive', 'Axal VC GP LLC', '16192 Coastal Highway', ?,
         ?, ?, '121145433', 'CLNOUS66MER', '[]', ?, ?, ?, ?)`)
      .run(uid, label, kind, enc, number.slice(-4), status,
        status === 'retired' ? '2026-10-01 09:00:00' : null, status === 'retired' ? 'Closed at the bank.' : null, SUPER);
  }
}

const ROW_LABELS = [
  'Plans, subscriptions, partner services, marketplace and perks, to Axal VC Management LLC',
  'Platform licence fee, Management to Holdings',
  'Platform licence fee, the GP to Holdings',
  'Capital contributions, limited partners to the Fund',
  'Distributions, the Fund to limited partners',
  'Management fee, the Fund to the GP',
  'GP commitment, the GP to the Fund',
  'Fund expenses, paid by the Fund',
];

test('#1855 eight rows, 1 to 8, in the canvas\'s words: every money kind in exactly one, row 1 the four Stripe kinds, one rail and one receiving account a row', async () => {
  const env = await readyEnv();
  for (const audience of ['super_admin', 'admin', 'preview', 'issued'] as const) {
    const m = await fundStructureModel(env, { audience });
    assert.deepEqual(m.rows.map((r) => r.no), [1, 2, 3, 4, 5, 6, 7, 8], audience);
    assert.deepEqual(m.rows.map((r) => r.label), ROW_LABELS, audience);
    assert.deepEqual([...m.rows[0].kinds].sort(), [...STRIPE_MONEY_KINDS].sort(), 'row 1 holds the four Stripe kinds');
    for (const k of MONEY_KINDS) {
      assert.equal(m.rows.filter((r) => r.kinds.includes(k.kind)).length, 1, `${k.kind} sits in exactly one row`);
      const f = flow(m, k.kind);
      const row = m.rows.find((r) => r.kinds.includes(k.kind))!;
      assert.equal(f.no, row.no, `${k.kind}'s no is its row's`);
      assert.equal(f.rail, row.rail, `${k.kind} shares its row's rail`);
      assert.deepEqual(f.receiving, row.receiving, `${k.kind} shares its row's receiving account`);
    }
    assert.ok(m.rows.every((r) => r.receiving_text.length > 0));
  }
  assert.equal(FLOW_ROWS.flatMap((r) => r.kinds).length, MONEY_KINDS.length);
});

test('#1855 paper and screen number the same: the map\'s routes, the SVG\'s markers, the lines and the PPM\'s table', async () => {
  const env = await readyEnv();
  const m = await fundStructureModel(env, { audience: 'issued' });
  const ids = ['A', 'B', '1', '2', '3', '4', '5', '6', '7', '8'];
  assert.deepEqual(m.map.routes.map((r) => r.id), ids);
  assert.deepEqual(m.licences.map((l) => [l.id, l.licensee]), [['A', 'management'], ['B', 'gp']]);
  const svg = structureSvg(m);
  assert.deepEqual([...svg.matchAll(/<text class="fs-num[^"]*"[^>]*>([^<]*)<\/text>/g)].map((x) => x[1]), ids);
  const lines = structureLines(m);
  const numbered = lines.map((l) => /^([AB1-8])\. /.exec(l)?.[1]).filter(Boolean);
  assert.deepEqual(numbered, ids);
  assert.deepEqual(structureTable(m).map((r) => r[0]), ['1', '2', '3', '4', '5', '6', '7', '8']);

  const { html } = ppmHtml(PPM_BODY, await structureForPaper(env, 'ppm', 'issued'));
  assert.equal((html.match(/<table class="structure-table">/g) || []).length, 1);
  const body = /<table class="structure-table">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/.exec(html)![1];
  assert.deepEqual([...body.matchAll(/<tr><td>(\d+)<\/td>/g)].map((x) => x[1]), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.ok(html.includes(`<p class="structure-closing">${RAILS_NOTE}</p>`), 'the closing paragraph');
  assert.ok(html.includes('The four entities, the two platform licences and every money flow'));
  assert.ok(html.includes('A. Axal VC Holdings LLC licenses the platform to Axal VC Management LLC for management administration.'));
});

test('#1855 who signs: every audience gets each entity\'s signs, signatory, title, through and receives; Management receives nothing', async () => {
  const env = await readyEnv();
  for (const audience of ['super_admin', 'admin', 'preview', 'issued'] as const) {
    const m = await fundStructureModel(env, { audience });
    for (const e of m.entities) {
      assert.equal(e.signs, ENTITY_SIGNS[e.key], `${audience} ${e.key}`);
      assert.equal(e.signatory, 'Joseph Gabriel Guillaume Lauzier');
      assert.equal(e.title, AXAL_ENTITIES[e.key].signatoryTitle);
      assert.equal(e.through, AXAL_ENTITIES[e.key].through ?? null);
    }
    const by = (k: string) => m.entities.find((e) => e.key === k)!;
    assert.deepEqual(by('management').receives, []);
    assert.deepEqual(by('fund').receives, ['Capital contributions', 'GP commitment']);
    assert.deepEqual(by('gp').receives, ['Management fee']);
    assert.deepEqual(by('holdings').receives, ['Platform licence fee']);
    assert.equal(by('holdings').title, AXAL_ENTITIES.holdings.signatoryTitle);
    assert.equal(by('fund').through, 'By: Axal VC GP LLC, its general partner');
    assert.deepEqual(m.signing, {
      address: '16192 Coastal Highway, Lewes, Delaware 19958', email: 'legal@axal.vc',
      routing: 'Routing: the platform and every partner agreement, Management · platform or brand IP, Holdings · investing in the Fund, the GP for the Fund · investing in a portfolio company, the company with the Fund as investor.',
    });
  }
});

test('#1855 the accounts: the Super Admin\'s active accounts by entity, four fields each, savings in no flow; no other audience has the key', async () => {
  const env = await readyEnv();
  await gpSavingsAndRetired(env);
  const sup = await fundStructureModel(env, { audience: 'super_admin' });
  assert.deepEqual(sup.accounts!.map((a) => a.key), ['holdings', 'management', 'gp', 'fund']);
  const gp = sup.accounts!.find((a) => a.key === 'gp')!.accounts;
  assert.deepEqual(gp.map((a) => [a.account_kind, a.account_last4]).sort(), [['checking', GP_NUMBER.slice(-4)], ['savings', '2206']]);
  assert.ok(!gp.some((a) => a.account_last4 === '2299'), 'a retired account is not listed');
  for (const a of sup.accounts!.flatMap((e) => e.accounts)) {
    assert.deepEqual(Object.keys(a).sort(), ['account_kind', 'account_last4', 'account_masked', 'label']);
  }
  assert.ok(!JSON.stringify({ flows: sup.flows, rows: sup.rows }).includes('2206'), 'the reserve is in no flow');
  for (const n of [GP_NUMBER, '7700112206', '121145433', '1 Letterman Drive', 'CLNOUS66MER']) assert.ok(!JSON.stringify(sup).includes(n), n);
  for (const audience of ['admin', 'preview', 'issued'] as const) {
    const m = await fundStructureModel(env, { audience });
    assert.ok(!('accounts' in m), `${audience} has no accounts key`);
  }
});

test('#1855 the Fund box reads "account not opened yet" only when the audience read the Fund and found none', async () => {
  const env = await readyEnv();
  const fundSub = (m: StructureModel) => m.map.boxes.find((b) => b.id === 'fund')!.sub!.text;
  for (const audience of ['super_admin', 'issued'] as const) {
    assert.equal(fundSub(await fundStructureModel(env, { audience })), 'The Fund · account not opened yet', audience);
  }
  for (const audience of ['admin', 'preview'] as const) assert.equal(fundSub(await fundStructureModel(env, { audience })), 'The Fund', audience);
  await addFundAccount(env);
  for (const audience of ['super_admin', 'issued'] as const) assert.equal(fundSub(await fundStructureModel(env, { audience })), 'The Fund', audience);
});

test('#1855 a registry that cannot be read leaves accounts null, and the rows and the map intact; the route still answers 200', async () => {
  const env = await readyEnv();
  const failing = new Proxy(env.DB, {
    get(t: any, k) {
      if (k === 'prepare') {
        return (sql: string) => {
          if (/FROM entity_bank_accounts ORDER BY CASE status/.test(sql)) throw new Error('fixture: the registry is down');
          return t.prepare(sql);
        };
      }
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  const warn = console.warn; console.warn = () => {};
  try {
    const m = await fundStructureModel({ ...env, DB: failing }, { audience: 'super_admin' });
    assert.equal(m.accounts, null);
    assert.equal(m.rows.length, 8);
    assert.equal(m.map.routes.length, 10);
    const res = await read(env, SUPER, { DB: failing });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.text).accounts, null);
  } finally { console.warn = warn; }
});

test('#1855 no arrow character in any audience\'s model, the SVG, the paper page or the lines', async () => {
  const env = await readyEnv();
  await gpSavingsAndRetired(env);
  for (const audience of ['super_admin', 'admin', 'preview', 'issued'] as const) {
    const m = await fundStructureModel(env, { audience });
    assert.doesNotMatch(JSON.stringify(m), ARROWS, audience);
    assert.doesNotMatch(structureSvg(m), ARROWS, audience);
    for (const l of structureLines(m)) assert.doesNotMatch(l, ARROWS);
  }
  const { html } = ppmHtml(PPM_BODY, await structureForPaper(env, 'ppm', 'preview'));
  assert.doesNotMatch(html, ARROWS);
});
