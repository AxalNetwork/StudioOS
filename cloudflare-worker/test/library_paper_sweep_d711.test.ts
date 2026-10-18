/**
 * D711 follow-up (#1865, part of #1782) — the library sweep. Every row of the
 * Templates catalog, every notice type, the Subscription Booklet and the five
 * bundled outside keys are drawn on the one D711 paper, and the canvas's paper
 * rules (L0–L7, L8 item 2, L10) are asserted on each, in R2's tokens.
 *
 * Nothing here calls Browser Run: every render is `paperHtml` or the pdf-lib
 * fallback. Every name and value is made up, and no account digit appears.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/library_paper_sweep_d711.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over, makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { pdfPageTexts, pdfText } from './_pdf_text.ts';
import contracts from '../src/routes/admin_contracts.ts';
import booklets from '../src/routes/fund_booklets.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import {
  COUNSEL_LINE, COVER_SLUGS, PART_STUB, STUB_LINE, paperHtml, paperModel, stampText, type PaperInput, type PaperModel,
} from '../src/services/legalPaper.ts';
import { inlineRuns, runsText, type Block } from '../src/services/legalPaperBlocks.ts';
import { PAPER_TOKENS, cssString, paperCss } from '../src/services/legalPaperCss.ts';
import { fallbackStateText, renderPaperFallbackPdf } from '../src/services/pdf.ts';
import { COUNSEL_DRAFT_SLUGS, STRUCTURE_MAP_SLUGS, effectiveFormat, renderFormat } from '../src/services/templateFormat.ts';
import { fundStructureModel } from '../src/services/fundStructure.ts';
import { NOTICE_TYPES, noticePaperInput, type NoticeFigures } from '../src/services/fundNotices.ts';
import { PAY_WARNING } from '../src/services/payInstructions.ts';
import { bookletPaperInput } from '../src/services/subscriptionBooklet.ts';
import { AXAL_ENTITIES, AXAL_LEGAL_ADDRESS, SUBSCRIPTION_BOOKLET_PARTS, winAnsiSafe } from '../src/services/legalDocFormat.ts';
import { getLegalTemplateBody } from '../src/services/legalTemplates.ts';

// ---------------------------------------------------------------- the catalog

const MIGRATIONS = 'cloudflare-worker/sql/migrations';
const SECRET = ['sweep', 'd711', 'fixture', 'secret', '0123456789'].join('-');
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const migrationFile = (prefix: string) => readdirSync(MIGRATIONS).find((f) => f.startsWith(`${prefix}_`));
const migration = (prefix: string) => {
  const name = migrationFile(prefix);
  assert.ok(name, `migration ${prefix}`);
  return readFileSync(`${MIGRATIONS}/${name}`, 'utf8');
};
const catalogInserts = (sql: string) => sql.match(/INSERT OR IGNORE INTO legal_templates[\s\S]*?;/g) ?? [];
/** #1861's 484 joins the sweep without an edit, when it exists. */
const HAS_484 = !!migrationFile('484');

function catalogDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'activity_logs', 'legal_templates', 'legal_template_versions', 'esign_envelopes',
    'esign_recipients', 'documents', 'projects', 'founders', 'deals', 'pairwise_ndas', 'partner_deals']) {
    db.exec(tableFromBaseline(baseline, t));
  }
  for (const f of ['085', '105', '113', '468', '469', '471']) db.exec(migration(f));
  for (const s of catalogInserts(migration('478'))) db.exec(s);
  db.exec(migration('434'));
  db.exec(migration('479'));
  if (HAS_484) db.exec(migration('484'));
  db.prepare('INSERT INTO users(id,role,name,email,is_active) VALUES(?,?,?,?,?)').run(1, 'admin', 'HQ owner', 'hq@example.test', 1);
  db.exec('INSERT INTO super_admins(user_id) VALUES(1)');
  return db;
}

interface Row { slug: string; title: string; category: string | null; body_md: string | null; version: number | null; is_stub: number; doc_kind: string | null; axal_party: string | null }

const DB = catalogDb();
const ROWS = DB.prepare('SELECT slug, title, category, body_md, version, is_stub, doc_kind, axal_party FROM legal_templates WHERE is_active = 1 ORDER BY slug').all() as unknown as Row[];
const isStub = (r: Row) => !!r.is_stub || !(r.body_md || '').trim();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// The resolver is a spy: a preview's map never reads an account.
let resolverCalls = 0;
const PREVIEW_STRUCTURE = await fundStructureModel({ DB: d1Over(DB) } as any, {
  audience: 'preview',
  resolver: (async () => { resolverCalls++; throw new Error('a preview read an account'); }) as any,
});

const PREVIEW = (r: Row, structure = PREVIEW_STRUCTURE): PaperInput => ({
  title: r.title, body: r.body_md || '', slug: r.slug, category: r.category, version: r.version, bodySha256: sha(r.body_md || ''),
  merge: 'brackets', state: { kind: 'draft' }, stub: isStub(r), ...renderFormat(effectiveFormat(r)), structure,
});
const ISSUED = (r: Row): PaperInput => ({
  title: r.title, body: r.body_md || '', slug: r.slug, category: r.category, version: r.version, bodySha256: sha(r.body_md || ''),
  merge: 'raw', state: { kind: 'issued' }, envelopeUuid: 'env-sweep-1', certificate: true, ...renderFormat(effectiveFormat(r)),
  recipients: [
    { name: 'Ada Counterparty', email: 'ada@example.test', status: 'signed', signedAt: '2026-10-18 10:00:00' },
    { name: 'Axal Legal', email: 'legal@axal.vc', status: 'pending' },
  ],
});

const html = (m: PaperModel, o: Partial<Parameters<typeof paperHtml>[1]> = {}) =>
  paperHtml(m, { pageSize: 'letter', cover: 'dark', medium: 'pdf', fonts: 'omit', ...o });
const mainOf = (h: string) => h.slice(h.indexOf('<main>'), h.indexOf('</main>'));
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
/** The paper's printed text: its `<main>`, tags stripped, entities decoded. */
const textOf = (h: string) => decode(mainOf(h).replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, '\n'));

const FORBIDDEN = /[←→↔⇒✓✔☑☐]|\p{Extended_Pictographic}/u;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
/**
 * The emails a paper prints that its own body does not hold: always none. No
 * recipient's or signer's email reaches paper (D711 decision 13). A body that
 * names a contact address (privacy_v1's) is legal text this task never edits;
 * it is on the follow-up list.
 */
const strayEmails = (t: string, body: string) => (t.match(EMAIL) || []).filter((e) => !body.includes(e));

/** Every string the model prints, for the WinAnsi check. */
function printed(m: PaperModel): string[] {
  const runs = (rs: { k: string; text?: string }[]) => rs.map((r) => r.text ?? '').join('');
  const blocks = (bs: Block[]): string[] => bs.flatMap((b) => {
    switch (b.t) {
      case 'bullets': return b.items.map(runs);
      case 'table': return [...b.head.map(runs), ...b.rows.flatMap((r) => r.map(runs))];
      case 'legend': return b.paras.map(runs);
      case 'rule': return [];
      case 'para': return [runs(b.runs), b.runIn ? runs(b.runIn) : '', b.num || ''];
      case 'schedule': return [runs(b.runs), b.dateline ? runs(b.dateline) : ''];
      default: return [runs(b.runs)];
    }
  });
  const parties = (m.execution?.parties || []).flatMap((p) => [p.heading, p.by || '', p.name, p.title, p.date, p.through || '', p.signedLine || '']);
  return [m.title, m.preamble || '', m.footerLeft, m.auditLine, ...m.articles.map((a) => a.text), ...blocks(m.blocks), ...parties,
    m.execution?.recital || '', ...(m.cover ? [m.cover.fund, m.cover.name, m.cover.copyNumber || '', m.cover.preparedFor || '', ...blocks(m.cover.legends)] : []),
    ...(m.parts || []).flatMap((pt) => [pt.title, pt.footer, ...blocks(pt.blocks)])].filter(Boolean);
}

// The body's own reading, computed here so no count is hard-coded.
const HEADING_LINE = /^#{1,6}\s/m;
const PLAIN_ARTICLE = /^(ARTICLE|SECTION|PART)\s+(\d{1,3}|[IVXLC]{1,7})\s*[—–-]\s*\S/;
const NUM_CAPS = /^\d{1,2}\.\s+(?=[^a-z]*[A-Z])[^a-z]+$/;
const hasArticle = (body: string) => /^##\s/m.test(body)
  || (!HEADING_LINE.test(body) && body.split('\n').some((l) => PLAIN_ARTICLE.test(l.trim()) || NUM_CAPS.test(l.trim())));
const OWN_BLOCK = /^(#|\||>|[-*+•]\s|\d+\.|\([a-z0-9ivxl]{1,5}\)\s|\[[ xX]\]|[☐☑✓✔]|whereas\b|[-*_]{3,})/i;
/**
 * The prose chunks a sound paper joins into one paragraph: two or more lines
 * up to a blank line, none starting a block or holding a fill-in, each line
 * open-ended or followed by a lowercase start, and none in plain capitals.
 */
function wrappedChunks(body: string): string[][] {
  const plain = !HEADING_LINE.test(body);
  return body.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((c) => c.split('\n').map((l) => l.trim()).filter(Boolean)).filter((ls) =>
    ls.length > 1
    && ls.every((l) => !OWN_BLOCK.test(l) && !/_{3,}/.test(l) && !(plain && !/[a-z]/.test(l)))
    && ls.slice(1).every((l, k) => !/[.:;?!]$/.test(ls[k]) || /^[a-z]/.test(l)));
}

// ---------------------------------------------------------------- the routes

const app = new Hono<any>();
app.route('/contracts', contracts);
app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function route(path: string, method = 'GET', body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await new SignJWT({ user_id: 1, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return app.request(`/contracts${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) },
    { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(DB) });
}

// ================================================================ the tests

test('#1865 the fixture is the catalog the migrations leave: 97 active rows and 31 stubs, 98 and 32 with 484', () => {
  assert.equal(ROWS.length, HAS_484 ? 98 : 97);
  assert.equal(ROWS.filter(isStub).length, HAS_484 ? 32 : 31);
  for (const r of ROWS.filter(isStub)) assert.ok(COUNSEL_DRAFT_SLUGS.has(r.slug), `${r.slug} is a counsel stub`);
});

test('#1865 every row as a preview, at Letter and A4, dark and light, passes L0, L1, L4 and the everywhere rules', () => {
  const css = paperCss({ pageSize: 'letter', cover: 'dark', medium: 'pdf', footerLeft: 'x', auditLine: 'y' });
  assert.match(css, /@top-left \{\s*content: "Axal VC";/);
  assert.ok(css.includes('url(data:image/png;base64,'), 'the mark beside the wordmark');
  assert.match(css, /@top-right \{\s*content: "CONFIDENTIAL";/);
  assert.ok(css.includes('content: "Page " counter(page) " of " counter(pages);'));
  assert.ok(css.includes('section.execution { break-before: page; break-inside: avoid; }'));

  let wrapped = 0;
  for (const r of ROWS) {
    const m = paperModel(PREVIEW(r));
    for (const pageSize of ['letter', 'a4'] as const) {
      for (const cover of ['dark', 'light'] as const) {
        const h = html(m, { pageSize, cover });
        const t = textOf(h);
        if (r.version) {
          assert.equal(m.footerLeft, `${m.title} — v${r.version}`, r.slug);
          assert.ok(h.includes(cssString(m.footerLeft)), `${r.slug} footer`);
        }
        assert.equal(m.auditLine, 'SHA-256 and envelope id assigned when issued', r.slug);
        assert.ok(!h.includes(sha(r.body_md || '').slice(0, 16)), `${r.slug} prints no hash prefix`);
        assert.ok(!t.includes('{{'), `${r.slug} prints a raw merge token`);
        assert.ok(!t.includes('**'), `${r.slug} prints raw asterisks`);
        assert.ok(!/(^|\n)\s*#/.test(t), `${r.slug} prints a raw # heading`);
        assert.ok(!FORBIDDEN.test(t), `${r.slug} prints an arrow, tick or emoji`);
        assert.deepEqual(strayEmails(t, r.body_md || ''), [], `${r.slug} prints an email`);
        if (cover === 'dark' && pageSize === 'letter') {
          if (!isStub(r) && hasArticle(r.body_md || '')) assert.ok(h.includes('<h2 class="article'), `${r.slug} has an article`);
          if (m.kind === 'policy') {
            assert.ok(!h.includes('<section class="execution'), `${r.slug}: a policy has no execution block`);
          } else {
            assert.ok(h.includes('<section class="execution">'), `${r.slug} has an execution block`);
            assert.ok(m.execution!.parties.length >= 1, `${r.slug} has a party`);
            assert.ok(h.indexOf('<p class="sig-follows">[Signature page follows]</p>') < h.indexOf('<section class="execution">')
              && h.includes('<p class="sig-follows">[Signature page follows]</p>'), `${r.slug} signature page follows`);
          }
          if (m.kind === 'agreement') {
            const pre = h.match(/<p class="preamble">([^<]*)<\/p>/);
            assert.ok(pre && pre[1].includes(m.entityName) && pre[1].includes(AXAL_LEGAL_ADDRESS), `${r.slug} preamble`);
          } else {
            assert.ok(!h.includes('<p class="preamble">'), `${r.slug}: only an agreement has a preamble`);
          }
          if (m.execution?.parties.some((p) => p.role === 'axal' && p.through)) {
            assert.ok(h.indexOf('By: Axal VC GP LLC, its general partner') < h.indexOf('<div class="through-block">'), `${r.slug} Fund block`);
          }
          for (const s of printed(m)) assert.equal(winAnsiSafe(s), s, `${r.slug}: the fallback would substitute in ${JSON.stringify(s.slice(0, 60))}`);
        }
      }
    }
    assert.ok(!textOf(html(m, { medium: 'screen' })).includes('{{'), `${r.slug} screen`);
    if (!isStub(r)) {
      for (const chunk of wrappedChunks(r.body_md || '')) {
        const expected = runsText(inlineRuns(chunk.join(' '), 'brackets'));
        assert.ok(m.blocks.some((b) => b.t === 'para' && runsText(b.runs) === expected), `${r.slug}: one paragraph for ${JSON.stringify(chunk[0].slice(0, 40))}…`);
        wrapped++;
      }
    }
  }
  assert.ok(wrapped >= 22, `the wrapped paragraphs were checked (${wrapped})`);
  assert.equal(resolverCalls, 0, 'a preview never reads an account');
});

test('#1865 the named rows: tos_v1, the 3-Way NDA, the platform licences, ppm\'s contents and the stub cover slugs', async () => {
  const row = (slug: string) => ROWS.find((r) => r.slug === slug)!;
  const tos = html(paperModel(PREVIEW(row('tos_v1'))));
  assert.ok(tos.includes('<strong>Axal VC Holdings LLC</strong>'), 'bold that wraps a line is one bold run');
  assert.ok(textOf(tos).includes('Settings > Account'));
  assert.ok((await pdfText(await renderPaperFallbackPdf(paperModel(PREVIEW(row('tos_v1'))), { pageSize: 'letter' }))).includes('Settings > Account'));

  const nda = paperModel(PREVIEW(row('nda_3way_founder_investor_axal')));
  const title = '3-Way NDA (Founder – Investor – Axal) v1';
  const ndaHtml = html(nda);
  assert.ok(ndaHtml.includes(`<h1 class="title">${title}</h1>`), 'the title');
  assert.ok(nda.preamble!.includes(title), 'the preamble');
  assert.ok(nda.footerLeft.startsWith(title), 'the footer');

  for (const slug of ROWS.map((r) => r.slug).filter((s) => s.startsWith('platform_ip_licence_'))) {
    assert.ok(html(paperModel(PREVIEW(row(slug)))).includes('<div class="heading">Axal VC Holdings LLC</div>'), slug);
  }

  for (const r of ROWS.filter((x) => COVER_SLUGS.has(x.slug))) {
    for (const cover of ['dark', 'light'] as const) {
      const h = html(paperModel(PREVIEW(r)), { cover });
      assert.ok(h.includes(`<section class="cover cover-${cover}">`), `${r.slug} ${cover}`);
      for (const s of [AXAL_ENTITIES.fund.name, 'Copy No.', 'Prepared for']) assert.ok(h.includes(s), `${r.slug}: ${s}`);
    }
  }
  const ppm = paperModel(PREVIEW(row('ppm')));
  assert.deepEqual(ppm.articles.map((a) => a.text), [
    'SECTION 1 — EXECUTIVE SUMMARY', 'SECTION 2 — INVESTMENT STRATEGY', 'SECTION 3 — RISK FACTORS',
    'SECTION 4 — FEES & EXPENSES', 'SECTION 5 — TAX CONSIDERATIONS',
  ]);
  const front = html(ppm, { part: 'front', tocPages: [1, 2, 3, 4, 5] });
  assert.equal((front.match(/<li><span>[^<]*<\/span><span class="leader"><\/span><span class="pg">\d<\/span><\/li>/g) || []).length, 5);
  assert.ok(front.includes('counter(page, lower-roman)'));
  for (const slug of ['lpa_amended_restated', 'compliance_manual_code_of_ethics']) {
    const h = html(paperModel(PREVIEW(row(slug))));
    assert.ok(h.includes('<section class="cover'), `${slug} prints its cover`);
    assert.ok(!h.includes('<section class="contents'), `${slug} prints no empty contents`);
    const text = await pdfText(await renderPaperFallbackPdf(paperModel(PREVIEW(row(slug))), { pageSize: 'letter' }));
    assert.ok(!text.includes('CONTENTS'), `${slug} fallback prints no contents`);
  }
});

test('#1865 every row with a body as an issued copy, and the fallback for issued and preview copies', async () => {
  for (const r of ROWS) {
    const m = paperModel(ISSUED(r));
    if (!isStub(r)) {
      const h = html(m);
      const t = textOf(h);
      const bodySha = sha(r.body_md || '');
      assert.equal(m.auditLine, `SHA-256 ${bodySha.slice(0, 16)}… · Envelope env-sweep-1`, r.slug);
      assert.ok(t.includes(stampText({ kind: 'issued' }, m)!), `${r.slug} stamp`);
      assert.match(stampText({ kind: 'issued' }, m)!, r.version ? new RegExp(`^Issued · v${r.version} · SHA-256 [0-9a-f]{12}$`) : /^Issued · SHA-256 [0-9a-f]{12}$/);
      if (m.kind !== 'policy') assert.ok(t.includes('Signed 2026-10-18 10:00:00 UTC · Envelope env-sweep-1'), `${r.slug} signed line`);
      assert.ok(h.includes('<section class="certificate">'), `${r.slug} certificate`);
      assert.deepEqual(strayEmails(t, r.body_md || ''), [], `${r.slug} prints an email`);
      assert.ok(!t.includes('203.0.113.'), `${r.slug} prints an IP`);
      assert.ok(!FORBIDDEN.test(t), `${r.slug} issued glyphs`);
      const pages = await pdfPageTexts(await renderPaperFallbackPdf(m, { pageSize: 'letter' }));
      pages.forEach((p, i) => assert.ok(p.includes('Axal VC') && p.includes('CONFIDENTIAL'), `${r.slug} fallback page ${i + 1} header`));
      // A cover slug's first pages are its cover and contents; the body numbers from 1.
      assert.ok(pages.some((p) => /Page 1 of \d+/.test(p)), `${r.slug} fallback page label`);
      if (!m.cover) assert.ok(pages[0].includes(`Page 1 of ${pages.length}`), `${r.slug} fallback page count`);
    }
    const preview = paperModel(PREVIEW(r));
    const fb = await pdfText(await renderPaperFallbackPdf(preview, { pageSize: 'a4' }));
    assert.ok(fb.includes('DRAFT') && fb.includes('Axal VC'), `${r.slug} fallback preview`);
    assert.ok(!/[←→↔]/.test(fb), `${r.slug} fallback arrows`);
  }
});

test('#1865 L3: legends never break, and the states read as L3 draws them in both renderers', () => {
  const css = paperCss({ pageSize: 'letter', cover: 'dark', medium: 'pdf', footerLeft: 'x', auditLine: 'y' });
  assert.match(css, /\.legend \{[^}]*break-inside: avoid;/);
  assert.ok(css.includes(`rotate(${PAPER_TOKENS.angle.diagonal})`));
  for (const r of ROWS.filter((x) => !isStub(x) && /^>/m.test(x.body_md || ''))) {
    assert.ok(html(paperModel(PREVIEW(r))).includes('<div class="legend'), `${r.slug} legend`);
  }
  const base: PaperInput = { title: 'Mutual NDA', body: '## Article 1 Terms\nThe parties agree.', slug: 'mutual_nda', version: 4, bodySha256: 'c'.repeat(64), state: { kind: 'draft' } };
  const draft = paperModel(base);
  assert.ok(mainOf(html(draft)).includes('DRAFT — for counsel review') && html(draft).includes('class="diagonal draft"'));
  assert.equal(fallbackStateText(draft)!.toLowerCase(), 'draft — for counsel review');
  const sup = paperModel({ ...base, state: { kind: 'superseded', by: 5 } });
  assert.ok(mainOf(html(sup)).includes('SUPERSEDED BY v5'));
  assert.equal(fallbackStateText(sup), 'SUPERSEDED BY v5');
  const iss = paperModel({ ...base, state: { kind: 'issued' }, envelopeUuid: 'env-sweep-1' });
  assert.ok(mainOf(html(iss)).includes(`Issued · v4 · SHA-256 ${'c'.repeat(12)}`));
  assert.equal(fallbackStateText(iss), `Issued · v4 · SHA-256 ${'c'.repeat(12)}`);
});

test('#1865 L8 item 2: every stub says it is one, through the model and through the routes', async () => {
  for (const r of ROWS.filter(isStub)) {
    const m = paperModel(PREVIEW(r));
    const counsel = COUNSEL_DRAFT_SLUGS.has(r.slug);
    assert.deepEqual(m.blocks.map((b) => runsText((b as any).runs || [])), counsel ? [STUB_LINE, COUNSEL_LINE] : [STUB_LINE], r.slug);
    const h = html(m);
    assert.ok(h.includes(`<h1 class="title">`), `${r.slug} title`);
    if (m.kind !== 'policy') assert.ok(h.includes('<section class="execution">'), `${r.slug} keeps its execution block`);
  }
  const stubs = ROWS.filter(isStub);
  const pick = stubs[0];
  const res = await route(`/templates/store/${encodeURIComponent(pick.slug)}/preview.pdf`);
  assert.equal(res.status, 200);
  const text = await pdfText(new Uint8Array(await res.arrayBuffer()));
  // WinAnsi's em dash decodes as \x97 here, so the counsel line is read in two halves.
  assert.ok(text.includes(STUB_LINE) && text.includes('Stub') && text.includes('counsel to draft.'), 'preview.pdf marks the stub');
  const rendered = await route('/templates/render', 'POST', { slug: pick.slug, title: pick.title, body: '', fonts: 'omit' });
  const body = await rendered.json() as any;
  assert.equal(rendered.status, 200, JSON.stringify(body).slice(0, 200));
  assert.ok(body.html.includes(STUB_LINE), 'render marks an empty draft');
});

// ---------------------------------------------------------------- notices

const NOTICE = (type: string, payment: NoticeFigures['payment'] | 'refused' = null): NoticeFigures => {
  const def = NOTICE_TYPES.find((d) => d.type === type)!;
  const distribution = type === 'distribution_notice';
  return {
    type: def.type, title: def.title, notice_date: '2026-10-18', sender: def.sender === 'purpose_payee' ? 'fund' : def.sender,
    payee: null, purpose: null, fund_id: 1, limited_partner_id: 7, source_ref: 'ref-sweep-1',
    addressee: ['[LIMITED PARTNER NAME]', 'LP No. [LP NUMBER]', '[ADDRESS]'],
    key_figures: [{ label: 'Amount', value: '[AMOUNT]', mono: true }, { label: 'Due date', value: '[DATE]' }],
    tables: [{
      title: 'Figures',
      columns: [{ label: 'Line' }, ...(distribution ? [{ label: 'Tax character' }] : []), { label: 'Amount', align: 'right' as const }],
      rows: [['[LINE]', ...(distribution ? ['[CHARACTER]'] : []), '[AMOUNT]'], ['Total', ...(distribution ? [''] : []), '[AMOUNT]']],
      total: true,
    }],
    warning: PAY_WARNING,
    payment: payment === 'refused'
      ? { refusal: 'No account in the registry fits this purpose, so these instructions are withheld.' }
      : payment ?? { lines: [{ label: 'Beneficiary', value: '[BENEFICIARY]' }, { label: 'Account', value: 'ending [LAST FOUR]', mono: true }], reference: '[REFERENCE]' },
    reference: '[REFERENCE]', amount_cents: null, prose: null, closing: [],
  };
};

test('#1865 L6: every notice type prints its addressee, figures, warning above payment, and its block or none', () => {
  for (const def of NOTICE_TYPES) {
    for (const refused of [false, true]) {
      const m = paperModel(noticePaperInput(NOTICE(def.type, refused ? 'refused' : null)));
      const h = html(m);
      assert.ok(h.includes('<div class="addressee">') && h.includes('<dl class="key-figures">') && h.includes('<table class="paper-table">'), def.type);
      assert.ok(/<th class="right mono">Amount<\/th>/.test(h) && /<td class="right mono">\[AMOUNT\]<\/td>/.test(h), `${def.type} figures right in mono`);
      const warn = h.indexOf(`<div class="legend warning warning-box"><p>${PAY_WARNING.replace(/'/g, '&#39;')}</p></div>`);
      assert.ok(warn > 0, `${def.type} warning`);
      const after = h.slice(warn + h.slice(warn).indexOf('</p></div>') + '</p></div>'.length);
      assert.ok(after.trimStart().startsWith('<section class="payment">'), `${def.type}: the warning sits directly above payment`);
      assert.ok(h.includes('<section class="payment"><div class="eyebrow">Payment instructions</div>'), `${def.type} payment head`);
      if (refused) assert.ok(h.includes('<p class="payment-refusal">'), `${def.type} refusal`);
      if (def.type === 'distribution_notice') assert.ok(h.includes('<th>Tax character</th>'));
      if (def.type === 'management_fee_invoice' || def.type === 'platform_licence_fee_invoice') {
        assert.ok(!h.includes('<section class="execution'), `${def.type} has no block`);
      } else {
        assert.ok(h.includes('<section class="execution inline">') && !h.includes('[Signature page follows]'), `${def.type} inline block`);
      }
      const t = textOf(h);
      assert.ok(!FORBIDDEN.test(t) && !(t.match(EMAIL) || []).length && !/\d{6,}/.test(t), `${def.type} glyphs, email or digits`);
      for (const s of printed(m)) assert.equal(winAnsiSafe(s), s, `${def.type}: ${s.slice(0, 40)}`);
    }
  }
  assert.equal(NOTICE_TYPES.length, 7);
});

// ---------------------------------------------------------------- the booklet

const BOOKLET_SCHEMA = ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'lp_applications', 'legal_templates', 'legal_template_versions']
  .map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n') + '\n' + migration('478');
const BOOKLET_BODIES: Record<string, string> = {
  subscription: '## Article 1 Subscription\nThe applicant subscribes.\n- [ ] I have read the Private Placement Memorandum.',
  lp_investor_questionnaire: '- [ ] I am an accredited investor.',
  lp_aml_kyc_certification: '- [ ] The funds are not the proceeds of crime.',
  lp_electronic_delivery_consent: '- [ ] I consent to electronic delivery.',
  gp_closing_certificate: 'The General Partner accepts the subscription.',
};

async function bookletModel(): Promise<PaperModel> {
  const { DB: BDB, db } = makeD1(BOOKLET_SCHEMA);
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)').run(2, 'investor', 'Ivy Applicant', 'ivy@example.test');
  db.exec("INSERT INTO lp_applications (id, user_id, fund_slug, investor_type, status) VALUES (21, 2, 'spinout-fund-i', 'individual', 'approved')");
  const t = db.prepare(`INSERT INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES (?, ?, 'fund', ?, '[]', 1, 1, 0)`);
  for (const [slug, body] of Object.entries(BOOKLET_BODIES)) t.run(slug, slug, body);
  const env = { DB: BDB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const bapp = new Hono<any>();
  bapp.route('/api/fund-booklets', booklets);
  const token = await new SignJWT({ user_id: 2 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await withThrownResponses(() => bapp.request('/api/fund-booklets/mine', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, env));
  assert.equal(res.status, 201, await res.clone().text());
  const row = { ...(db.prepare('SELECT * FROM fund_subscription_booklets').get() as any) };
  return paperModel({ ...(await bookletPaperInput(env, row)), structure: PREVIEW_STRUCTURE });
}

test('#1865 L7 and L10: the booklet prints its cover, contents, parts, footers, Part 2, a stub, Part 9 last and the map once', async () => {
  const m = await bookletModel();
  const h = html(m);
  assert.equal((h.match(/<section class="cover/g) || []).length, 1);
  const parts = (SUBSCRIPTION_BOOKLET_PARTS as readonly { part: number; title: string }[]).filter((p) => p.part > 1);
  assert.deepEqual(m.articles.map((a) => a.text), parts.map((p) => `Part ${p.part} · ${p.title}`));
  assert.equal(m.articles.length, 8);
  assert.equal(m.articles[0].text, 'Part 2 · Instructions and Checklist');
  assert.equal(m.articles[7].text, 'Part 9 · Acceptance by the General Partner');
  for (let n = 2; n <= 9; n++) assert.ok(h.includes(`<section class="booklet-part part-${n}">`), `part ${n}`);
  assert.ok(h.includes('@page part-4 { @bottom-left { content: "Subscription Booklet · Part 4"'));
  const part2 = h.slice(h.indexOf('booklet-part part-2'), h.indexOf('booklet-part part-3'));
  assert.ok(part2.includes('Send no money until you receive a Capital Call Notice.'));
  assert.ok(h.includes(PART_STUB), 'a missing part says so');
  const last = h.lastIndexOf('<section class="execution part-block">');
  assert.ok(last > h.indexOf('booklet-part part-9'), 'Part 9\'s block is last');
  assert.equal((h.match(/<section class="structure-page">/g) || []).length, 1);
  assert.ok(h.indexOf('<section class="structure-page">') > h.indexOf('booklet-part part-2') && h.indexOf('<section class="structure-page">') < h.indexOf('booklet-part part-3'));
  assert.ok(!FORBIDDEN.test(textOf(h)));
});

test('#1865 L10: the map prints once on ppm and the compliance manual, never elsewhere, under its heading', () => {
  for (const r of ROWS) {
    const h = html(paperModel(PREVIEW(r)));
    const n = (h.match(/<section class="structure-page">/g) || []).length;
    assert.equal(n, STRUCTURE_MAP_SLUGS.has(r.slug) ? 1 : 0, r.slug);
    if (n) assert.ok(h.includes('Structure of the Fund</h2>'), `${r.slug} heading`);
  }
  assert.ok(ROWS.some((r) => r.slug === 'ppm') && ROWS.some((r) => r.slug === 'compliance_manual_code_of_ethics'));
});

// ---------------------------------------------------------------- the outside keys

const OUTSIDE = ['investor_nda_v1', 'mentor_nda_v1', 'mentor_disclaimer_v1', 'partner_msa_v1', 'nda_3way_founder_investor_axal_v1'] as const;
const CATALOG_SRC = readFileSync('cloudflare-worker/src/routes/admin_contracts.ts', 'utf8');

test('#1865 the five bundled outside keys pass L0, L1 and the everywhere rules', () => {
  for (const key of OUTSIDE) {
    const hit = CATALOG_SRC.match(new RegExp(`\\{ key: '${key}',\\s*doc_type: '([^']+)',\\s*title: '([^']+)' \\}`));
    assert.ok(hit, key);
    const body = getLegalTemplateBody(key as any);
    const m = paperModel({ title: hit![2], body, slug: hit![1], version: null, bodySha256: sha(body), merge: 'brackets', state: { kind: 'draft' } });
    const h = html(m);
    const t = textOf(h);
    assert.ok(!t.includes('{{') && !t.includes('**') && !FORBIDDEN.test(t), key);
    assert.deepEqual(strayEmails(t, body), [], key);
    if (m.kind !== 'policy') assert.ok(h.includes('<p class="sig-follows">[Signature page follows]</p>'), key);
    for (const s of printed(m)) assert.equal(winAnsiSafe(s), s, `${key}: ${s.slice(0, 40)}`);
  }
});

// ---------------------------------------------------------------- R2's tokens

test('#1865 R2: violet only where R2 allows it; the wordmark and the table head in ink; no faked Public Sans weight', () => {
  const V = PAPER_TOKENS.color.violet;
  const INK = PAPER_TOKENS.color.ink;
  const allowed = new Set(['@top-right', '.eyebrow, .confidential', 'a', '.restricted', 'p.clause .num', 'table.paper-table th',
    '.state-banner.draft', '.diagonal.draft', '.stamp.superseded', '.cover-light', '.cover-light .cover-fund']);
  for (const medium of ['pdf', 'screen'] as const) {
    for (const cover of ['dark', 'light'] as const) {
      const css = paperCss({ pageSize: 'letter', cover, medium, footerLeft: 'x', auditLine: 'y' });
      const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((x) => ({ sel: x[1].trim().replace(/^[\s\S]*\n/, '').trim(), decl: x[2] }));
      for (const { sel, decl } of rules) {
        if (decl.includes(V)) {
          const structure = /structure|fund-structure/.test(sel);
          assert.ok(allowed.has(sel) || structure, `violet in ${sel}`);
        }
        if (/font-weight:\s*(600|800)/.test(decl)) assert.ok(/Bricolage/.test(decl), `${sel} asks Public Sans for 600 or 800`);
      }
      const rule = (sel: string) => rules.find((r) => r.sel === sel)?.decl ?? '';
      assert.ok(rule('.lockup .wordmark').includes(`color: ${INK}`), 'the wordmark is ink');
      assert.ok(rule('table.paper-table th').includes(`color: ${INK}`), 'the table head is ink');
      assert.ok(new RegExp(`border-bottom: [^;]+ solid ${V}`).test(rule('table.paper-table th')), 'over a violet rule');
      if (medium === 'pdf') assert.ok(rule('@top-left').includes(`color: ${INK}`), 'the PDF wordmark is ink');
    }
  }
});
