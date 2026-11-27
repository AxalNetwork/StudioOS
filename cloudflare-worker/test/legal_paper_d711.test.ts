/**
 * D711 (#1776) — the paper: one HTML document per legal document, in the brand
 * faces, with its state from stored state, every recipient's block, and
 * nothing that loads from the network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { paperModel, paperHtml, paperStateFor, type PaperInput } from '../src/services/legalPaper.ts';
import { LEGAL_FACES, LEGAL_MARK_PNG, PAPER_TOKENS, paperCss, paperFontsCss } from '../src/services/legalPaperCss.ts';
import { AXAL_LEGAL_ADDRESS } from '../src/services/legalDocFormat.ts';
import { fixture, call, raw } from './_legal_paper_harness.ts';

/** An opening script tag, spelled in parts so no scanner reads the test as building one. */
const SCRIPT_OPEN = ['<', 'script'].join('');
const SHA = 'c'.repeat(64);
const base: PaperInput = { title: 'Mutual NDA', body: '## Article 1 Terms\nThe parties agree.', slug: 'mutual_nda', bodySha256: SHA, state: { kind: 'draft' } };
const html = (i: Partial<PaperInput> = {}, o: Partial<Parameters<typeof paperHtml>[1]> = {}) =>
  paperHtml(paperModel({ ...base, ...i }), { pageSize: 'letter', cover: 'dark', medium: 'pdf', fonts: 'omit', ...o });
const mainOf = (h: string) => h.slice(h.indexOf('<main>'), h.indexOf('</main>'));

test('D711 an agreement prints the lockup, title, preamble with the address, body, both parties and the footer', () => {
  const sub = html({ title: 'Subscription Agreement', slug: 'subscription', version: 4 });
  assert.ok(sub.includes('url(data:image/png;base64,') && sub.includes('"Axal VC"'), 'the pdf lockup');
  const screen = html({ title: 'Subscription Agreement', slug: 'subscription', version: 4 }, { medium: 'screen' });
  assert.ok(/<img alt="" src="data:image\/png;base64,[A-Za-z0-9+/=]+">/.test(screen) && screen.includes('>Axal VC<'), 'the screen lockup');
  assert.ok(sub.includes('<h1 class="title">Subscription Agreement</h1>'));
  assert.ok(sub.includes(AXAL_LEGAL_ADDRESS), 'the preamble writes the address out');
  assert.ok(sub.includes('The parties agree.'));
  const at = (s: string) => sub.indexOf(s);
  assert.ok(at('Axal VC Spin-Out Lab Fund I LP</div>') > 0);
  assert.ok(at('By: Axal VC GP LLC, its general partner') < at('<div class="through-block">'), 'the through line sits above the nested By line');
  assert.ok(sub.includes('Title: General Partner'));
  assert.ok(sub.includes('[Counterparty Legal Name]'));
  assert.ok(sub.includes('"Subscription Agreement — v4"'), 'the footer carries the real version');
  const mgmt = html({ title: 'Mentor Agreement', slug: 'mentor_nda_axal' });
  assert.ok(mgmt.includes('Title: Managing Partner'));
  assert.ok(!mgmt.includes('its general partner'));
});

test('D711 the state comes from stored state: Draft, Specimen, Superseded, Issued', () => {
  const pub = { version: 3, bodySha256: SHA };
  assert.deepEqual(paperStateFor({ version: 3, bodySha256: SHA, publication: null }), { kind: 'draft' });
  assert.deepEqual(paperStateFor({ version: 3, bodySha256: SHA, publication: pub }), { kind: 'specimen' });
  assert.deepEqual(paperStateFor({ version: 3, bodySha256: 'd'.repeat(64), publication: pub }), { kind: 'draft' });
  assert.deepEqual(paperStateFor({ version: 2, bodySha256: SHA, publication: pub }), { kind: 'superseded', by: 3 });
  assert.deepEqual(paperStateFor({ issued: true, publication: null }), { kind: 'issued' });

  const draft = mainOf(html({ state: { kind: 'draft' } }));
  assert.ok(draft.includes('DRAFT — for counsel review') && draft.includes('class="diagonal draft"'));
  const specimen = mainOf(html({ state: { kind: 'specimen' } }));
  assert.ok(specimen.includes('class="diagonal specimen"') && !specimen.includes('DRAFT'));
  assert.ok(mainOf(html({ state: { kind: 'superseded', by: 5 } })).includes('<div class="stamp superseded">SUPERSEDED BY v5</div>'));
  const issued = html({ state: { kind: 'issued' }, envelopeUuid: 'env-77' });
  assert.ok(mainOf(issued).includes(`<div class="stamp issued">Issued · SHA-256 ${SHA.slice(0, 12)}</div>`));
  assert.ok(issued.includes(`SHA-256 ${SHA.slice(0, 16)}… · Envelope env-77`), 'only an issued copy prints the audit line');
  for (const s of [{ kind: 'draft' }, { kind: 'specimen' }, { kind: 'superseded', by: 5 }] as const) {
    const h = html({ state: s, envelopeUuid: null });
    assert.ok(h.includes('SHA-256 and envelope id assigned when issued'), s.kind);
    assert.ok(!h.includes(SHA.slice(0, 16)), s.kind);
  }
});

test('D711 a three-recipient envelope prints three parties side by side and a certificate, and no IP or email', () => {
  const h = html({
    title: '3-Way Mutual NDA', slug: 'nda_3way_v1', envelopeUuid: 'env-3', state: { kind: 'issued' }, certificate: true,
    recipients: [
      { name: 'Ada Founder', email: 'ada@example.test', status: 'signed', signedAt: '2026-10-17T10:00:00Z' },
      { name: 'Ivan Investor', email: 'ivan@example.test', status: 'pending' },
      { name: 'Axal Legal', email: 'legal@axal.vc', status: 'pending' },
    ],
  });
  const parties = h.slice(h.indexOf('<div class="parties">'), h.indexOf('</section>', h.indexOf('<div class="parties">')));
  assert.equal(parties.split('<div class="party">').length - 1, 3);
  const headings = [...parties.matchAll(/<div class="heading">([^<]+)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(headings, ['Ada Founder', 'Ivan Investor', 'Axal VC Management LLC'], 'the counter-signer signs the Axal block');
  assert.ok(h.includes('Signed 2026-10-17 10:00:00 UTC · Envelope env-3'));
  const cert = h.slice(h.indexOf('<section class="certificate">'));
  for (const s of ['Signer 1', 'Signer 2', 'Signer 3', 'Ada Founder', 'Ivan Investor', 'Axal Legal', SHA]) assert.ok(cert.includes(s), s);
  for (const s of ['ada@example.test', 'ivan@example.test', 'legal@axal.vc', '203.0.113.']) assert.ok(!h.includes(s), s);
});

test('D711 a cover slug has a cover, dark or light, and a contents entry per article; another slug has neither; restricted prints its marker', () => {
  const body = '> THESE SECURITIES ARE NOT REGISTERED.\n## Article I Summary\nA.\n## Article II Risks\nB.';
  for (const cover of ['dark', 'light'] as const) {
    const h = html({ title: 'Private Placement Memorandum', slug: 'ppm', body }, { cover });
    assert.ok(h.includes(`<section class="cover cover-${cover}">`), cover);
    assert.ok(h.includes('Axal VC Spin-Out Lab Fund I LP') && h.includes('Copy No.') && h.includes('Prepared for'));
    const contents = h.slice(h.indexOf('<section class="contents'), h.indexOf('</section>', h.indexOf('<section class="contents')));
    assert.equal(contents.split('<li>').length - 1, 2);
    assert.ok(h.indexOf('THESE SECURITIES ARE NOT REGISTERED.') < h.indexOf('<section class="contents'), 'the legend moves to the cover');
  }
  const plain = html({ body });
  assert.ok(!plain.includes('<section class="cover') && !plain.includes('<section class="contents'));
  assert.ok(html({ restricted: true }).includes('Confidential — GP and LPAC only'));
  assert.ok(!html().includes('Confidential — GP and LPAC only'));
});

function hue(hex: string): { h: number; s: number } {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: d / (1 - Math.abs(max + min - 1)) };
}

test('D711 no colour token is red; the execution block starts its own page after "[Signature page follows]"', () => {
  for (const [name, v] of Object.entries(PAPER_TOKENS.color)) {
    if (!v.startsWith('#')) continue;
    const { h, s } = hue(v);
    assert.ok(!(s > 0.25 && (h < 20 || h > 340)), `${name} ${v} is a red hue`);
  }
  const h = html();
  assert.ok(/section\.execution \{ break-before: page;/.test(h));
  assert.ok(h.indexOf('<p class="sig-follows">[Signature page follows]</p>') < h.indexOf('<section class="execution">'));
});

test('D711 a hostile body and title render as text; nothing loads from anywhere but data:', () => {
  const h = html({ title: '</style><script>x</script>', body: '<script>alert(1)</script> "quoted" \'single\' {{x}}' }, { fonts: 'inline' });
  assert.equal(h.toLowerCase().indexOf(SCRIPT_OPEN), -1, 'no script element');
  assert.ok(h.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(h.includes('{{x}}'));
  const style = h.slice(h.indexOf('<style id="paper-css">'), h.indexOf('</style>', h.indexOf('<style id="paper-css">')));
  assert.ok(style.includes('\\3C /style>\\3C script>'), 'the margin-box title is escaped');
  assert.equal((h.match(/<\/style>/g) || []).length, 2, 'only the two style elements close');
  for (const m of h.matchAll(/(?:src|href)="([^"]*)"|url\(([^)]*)\)/g)) {
    const target = (m[1] ?? m[2]).trim();
    assert.ok(target.startsWith('data:') || target.startsWith('#'), `loads ${target.slice(0, 40)}`);
  }
  assert.ok(h.includes(`content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"`));
});

test('D711 "Łukasz Żółć ș ğ ≥ 5" prints as typed', () => {
  assert.ok(html({ body: 'Signed by Łukasz Żółć ș ğ ≥ 5.' }).includes('Signed by Łukasz Żółć ș ğ ≥ 5.'));
});

test('D711 letter and a4 give their @page sizes; any other size or cover throws', () => {
  assert.ok(html({}, { pageSize: 'letter' }).includes('size: letter;'));
  assert.ok(html({}, { pageSize: 'a4' }).includes('size: A4;'));
  assert.throws(() => html({}, { pageSize: 'a5' as any }), /page_size_invalid/);
  assert.throws(() => html({}, { cover: 'grey' as any }), /cover_invalid/);
});

test('D711 the faces: one @font-face each, real woff2 under 400 KB, a PNG mark, and bold resolves to weight 700', () => {
  const css = paperFontsCss();
  let total = 0;
  for (const f of LEGAL_FACES) {
    const bytes = new Uint8Array(f.bytes);
    assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'wOF2', `${f.file} is woff2, not an LFS pointer`);
    total += bytes.length;
  }
  assert.equal((css.match(/@font-face/g) || []).length, LEGAL_FACES.length);
  assert.ok(total < 400 * 1024, `faces total ${total}`);
  assert.deepEqual([...new Uint8Array(LEGAL_MARK_PNG).subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(/font-family:'Public Sans';font-style:normal;font-weight:700;/.test(css), 'a bold run has a 700 face');
  assert.ok(/font-family:'Space Grotesk';font-style:normal;font-weight:700;/.test(css));
});

test('D711 no CSS rule outside the lockup names Space Grotesk', () => {
  for (const medium of ['pdf', 'screen'] as const) {
    const css = paperCss({ pageSize: 'letter', cover: 'dark', medium, footerLeft: 'x', auditLine: 'y' });
    let at = css.indexOf('Space Grotesk');
    while (at >= 0) {
      const brace = css.lastIndexOf('{', at);
      const start = Math.max(css.lastIndexOf('}', brace), css.lastIndexOf(';', brace), css.lastIndexOf('{', brace - 1)) + 1;
      const selector = css.slice(start, brace).trim();
      assert.ok(selector === '@top-left' || selector.includes('lockup'), `${medium}: "${selector}" names Space Grotesk`);
      at = css.indexOf('Space Grotesk', at + 1);
    }
  }
});

test('D711 a short paper stays under 600 KB with faces and 40 KB without; the fonts CSS holds the rules', () => {
  assert.ok(html({}, { fonts: 'inline' }).length < 600 * 1024);
  const omitted = html({}, { fonts: 'omit' });
  assert.ok(omitted.length < 40 * 1024, `omit is ${omitted.length}`);
  assert.ok(omitted.includes('<style id="paper-fonts"></style>'));
  assert.ok(paperFontsCss().includes('@font-face'));
});

test('D711 the screen medium has no page counter and no "Page 1 of 1"', () => {
  const h = html({}, { medium: 'screen' });
  assert.ok(!h.includes('counter(page'));
  assert.ok(!h.includes('Page 1 of 1'));
});

test('D711 the render and fonts routes are admin-only; render refuses a body over 256 KB and is never cached', async () => {
  const db = fixture();
  assert.equal((await call(db, '/templates/render', 3, 'POST', { title: 'T', body: 'x' })).status, 403);
  assert.equal((await call(db, '/templates/paper-fonts', 3)).status, 403);
  const big = await call(db, '/templates/render', 2, 'POST', { title: 'T', body: 'x'.repeat(256 * 1024 + 1) });
  assert.deepEqual([big.status, big.body.error], [413, 'body_too_large']);
  const ok = await raw(db, '/templates/render', 2, 'POST', { title: 'Mutual NDA', body: 'Body.', slug: 'mutual_nda', version: 3, page_size: 'a4', cover: 'light' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  const j: any = await ok.json();
  assert.deepEqual([j.page_size, j.state, j.paper_sha256.length], ['a4', 'Draft', 64]);
  assert.ok(j.html.includes('<style id="paper-fonts"></style>'), 'faces left out by default');
  assert.equal((await call(db, '/templates/render', 2, 'POST', { title: 'T', body: 'x', page_size: 'a5' })).body.error, 'page_size_invalid');
  const fonts = await raw(db, '/templates/paper-fonts', 2);
  assert.equal(fonts.headers.get('cache-control'), 'private, max-age=86400');
  const fj: any = await fonts.json();
  assert.equal((fj.css.match(/@font-face/g) || []).length, LEGAL_FACES.length);
  assert.equal(fj.paper_sha256, j.paper_sha256);
});
