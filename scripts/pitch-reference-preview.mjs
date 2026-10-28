#!/usr/bin/env node
// D898 §8.6 (#3658) — draws the reference decks for design review: both
// decks (`cloudflare-worker/test/fixtures/pitchReferenceDecks.ts`) in the three
// themes at 16:9, and the phone editor's card list at 390px, as HTML, then
// screenshots each page with the pre-installed Playwright Chromium.
//
// A REVIEW HARNESS, NOT THE PRODUCT RENDERER. The editor, Present and the
// exports draw slides through their own renderer (#3656, #3655); this file
// reads the same tokens and budgets (`designSystem.ts`) so the owner can judge
// the design system before it is wired in. It loads fonts from Google Fonts
// for the preview only; production serves them from Cloudflare (D898 §8.5).
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     scripts/pitch-reference-preview.mjs <out-dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BASE_THEMES, SLIDE, TYPE_SCALE, boxOf, fitProblems, themeProblems, typeRoleOf } from '../cloudflare-worker/src/services/decks/designSystem.ts';
import { fullReferenceDeck, sparseReferenceDeck, SYNTHETIC_VENTURE } from '../cloudflare-worker/test/fixtures/pitchReferenceDecks.ts';
// D897 §9 (#3659): `--story` draws decks the composer generated from synthetic records instead of the hand-composed ones.
import { buildCards, standardOutline } from '../cloudflare-worker/src/services/decks/newDeck.ts';
import { conflictingRecords, fullRecords, sparseRecords, wordsFor } from '../cloudflare-worker/test/fixtures/pitchStoryFixtures.ts';

const STORY = process.argv.includes('--story');
const OUT = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || 'pitch-reference-preview');
/** A bound series' points, as the editor reads them from `GET /api/decks/chart-series`; here, from the fixture. */
const SERIES_POINTS = new Map();
mkdirSync(OUT, { recursive: true });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const month = (ym) => { const m = /^(\d{4})-(\d{2})/.exec(ym || ''); return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ''; };
const day = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ''; };
const fmt = (n) => (n >= 1000 ? `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : `$${n}`);

function type(role, t, extra = '') {
  const s = TYPE_SCALE[role];
  return `font-size:${s.size}px;line-height:${s.leading};font-weight:${s.weight};letter-spacing:${s.tracking}em;${extra}`;
}

function sourceChip(b, t) {
  const c = t.colours;
  if (!b || b.grade === 'Not recorded') return `<span style="${type('caption', t)}color:${c.muted}">Not recorded on StudioOS</span>`;
  return `<span style="${type('caption', t)}color:${c.muted}">${esc(b.grade)} · ${esc(day(b.as_of))}</span>`;
}

function chartSvg(b, t, w, h) {
  const c = t.colours;
  if (b.chart_type === 'comparison_table') {
    // Names only: what a record holds. No feature cells are drawn, because no record holds them.
    const rows = b.series[0]?.points || [];
    return `<div style="display:grid;grid-template-columns:repeat(${Math.min(3, rows.length)}, 1fr);gap:24px">${rows.map((r, i) => `
      <div style="padding:36px;border-radius:${t.radius}px;background:${c.surface};border:2px solid ${c.hairline};display:flex;flex-direction:column;gap:18px">
        <div style="${type('metric_label', t)}color:${t.chart[i % t.chart.length]};text-transform:uppercase">Competitor ${i + 1}</div>
        <div style="font-family:${t.fonts.display};${type('subheading', t)}color:${c.ink}">${esc(r.x)}</div>
        ${sourceChip(b.series[0]?.binding, t)}
      </div>`).join('')}</div>`;
  }
  const pts = b.series[0]?.points || SERIES_POINTS.get(b.series[0]?.binding?.source_key) || [];
  if (!pts.length) return '';
  const pad = { l: 120, r: 40, t: 40, b: 80 };
  const max = Math.max(...pts.map((p) => p.y)) * 1.15;
  const x = (i) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, pts.length - 1);
  const y = (v) => pad.t + (1 - v / max) * (h - pad.t - pad.b);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const area = `${path} L${x(pts.length - 1)},${h - pad.b} L${x(0)},${h - pad.b} Z`;
  const grid = [0, 0.5, 1].map((f) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(max / 1.15 * f)}" y2="${y(max / 1.15 * f)}" stroke="${c.hairline}" stroke-width="2"/><text x="${pad.l - 16}" y="${y(max / 1.15 * f) + 8}" text-anchor="end" fill="${c.muted}" font-size="22" font-family="${t.fonts.mono}">${fmt(Math.round(max / 1.15 * f))}</text>`).join('');
  const last = pts[pts.length - 1];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${grid}
    <path d="${area}" fill="${t.chart[0]}" opacity="0.12"/>
    <path d="${path}" fill="none" stroke="${t.chart[0]}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>
    ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.y)}" r="${i === pts.length - 1 ? 11 : 6}" fill="${t.chart[0]}"/><text x="${x(i)}" y="${h - pad.b + 40}" text-anchor="middle" fill="${c.muted}" font-size="22" font-family="${t.fonts.mono}">${month(p.x).slice(0, 3)}</text>`).join('')}
    <text x="${x(pts.length - 1) - 16}" y="${y(last.y) - 24}" text-anchor="end" fill="${c.ink}" font-size="40" font-weight="700" font-family="${t.fonts.display}">${fmt(last.y)}</text>
  </svg><div>${sourceChip(b.series[0]?.binding, t)} · <span style="${type('caption', t)}color:${c.muted}">${esc(b.series[0]?.label)}</span></div>`;
}

function diagramHtml(d, t, w) {
  const c = t.colours;
  const n = d.items.length;
  if (d.type === 'timeline') {
    return `<div style="position:relative;height:100%;display:flex;align-items:center">
      <div style="position:absolute;left:0;right:0;top:50%;height:4px;background:${c.hairline}"></div>
      ${d.items.map((it, i) => `<div style="position:absolute;left:${(i + 0.5) * (100 / n)}%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:20px;width:${Math.floor(w / n) - 24}px">
        <div style="${type('metric_label', t)}color:${t.chart[0]};text-transform:uppercase">${esc(month(it.date))}</div>
        <div style="width:36px;height:36px;border-radius:50%;background:${i === 0 ? t.chart[0] : c.surface};border:6px solid ${t.chart[0]}"></div>
        <div style="${type('subheading', t)}color:${c.ink};text-align:center;font-size:34px">${esc(it.label)}</div>
      </div>`).join('')}
    </div>`;
  }
  return `<div style="display:flex;gap:24px;height:100%;align-items:stretch">${d.items.map((it, i) => `
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:16px;padding:40px;border-radius:${t.radius}px;background:${i === 0 ? t.chart[0] : c.surface};color:${i === 0 ? c.accent_ink : c.ink};border:2px solid ${i === 0 ? t.chart[0] : c.hairline}">
      <div style="${type('metric_label', t)}text-transform:uppercase;opacity:.8">Step ${i + 1}</div>
      <div style="${type('subheading', t)}">${esc(it.label)}</div>
      ${it.detail ? `<div style="${type('paragraph', t, 'font-size:28px')}opacity:.85">${esc(it.detail)}</div>` : ''}
    </div>`).join(`<div style="align-self:center;font-size:48px;color:${c.muted}">→</div>`)}</div>`;
}

function blockHtml(b, slide, t) {
  const c = t.colours;
  const box = boxOf(b.grid);
  const pos = `position:absolute;left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;`;
  if (b.kind === 'text') {
    const role = typeRoleOf(b.style, slide.layout);
    const colour = b.style === 'heading' ? c.ink : c.muted;
    const body = b.style === 'list'
      ? `<ul style="margin:0;padding-left:1.1em">${String(b.text).split('\n').map((l) => `<li style="margin-bottom:.4em">${esc(l)}</li>`).join('')}</ul>`
      : esc(b.text);
    const valign = slide.layout === 'title' || slide.layout === 'statement' || slide.layout === 'quote' ? 'display:flex;flex-direction:column;justify-content:flex-end;' : '';
    return `<div style="${pos}${valign}font-family:${role === 'display' || role === 'heading' ? t.fonts.display : t.fonts.body};${type(role, t)}color:${colour};overflow:hidden">${body}</div>`;
  }
  if (b.kind === 'metric') {
    const none = b.value == null;
    return `<div style="${pos}box-sizing:border-box;padding:28px 32px;border-radius:${t.radius}px;background:${c.surface};border:2px solid ${c.hairline};display:flex;flex-direction:column;justify-content:space-between">
      <div style="${type('metric_label', t)}color:${c.muted};text-transform:uppercase">${esc(b.label)}</div>
      <div style="font-family:${t.fonts.display};${type('metric', t)}color:${none ? c.muted : c.ink};${none ? 'font-size:40px' : ''}">${none ? 'Not recorded' : esc(b.value)}</div>
      ${sourceChip(b.binding, t)}</div>`;
  }
  if (b.kind === 'chart') return `<div style="${pos}">${chartSvg(b, t, box.w, box.h - 40)}</div>`;
  if (b.kind === 'graphic' && b.diagram) return `<div style="${pos}">${diagramHtml(b.diagram, t, box.w)}</div>`;
  if (b.kind === 'image') {
    if (b.tag === 'photo') {
      const initials = String(b.alt).split(',')[0].split(/[\s.]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      return `<div style="${pos}box-sizing:border-box;border-radius:${t.image.radius}px;background:${c.surface};border:2px dashed ${c.hairline};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px">
        <div style="width:160px;height:160px;border-radius:50%;background:${t.chart[0]};color:${c.accent_ink};display:grid;place-items:center;font-family:${t.fonts.display};font-size:56px;font-weight:700">${esc(initials)}</div>
        <div style="${type('caption', t)}color:${c.muted}">Photo the person agreed to share</div></div>`;
    }
    return `<div style="${pos}box-sizing:border-box;border-radius:${t.image.radius}px;overflow:hidden;background:linear-gradient(135deg, ${t.chart[0]}33, ${t.chart[1]}33), repeating-linear-gradient(45deg, ${c.hairline} 0 2px, transparent 2px 28px);display:flex;align-items:flex-end;padding:32px">
      <div style="${type('caption', t)}color:${c.ink};background:${c.surface};padding:10px 16px;border-radius:999px">Illustration · drawn by Workers AI when generated · ${esc(b.alt)}</div></div>`;
  }
  return '';
}

function slideHtml(slide, i, total, t) {
  const c = t.colours;
  const accentBar = slide.layout === 'title' ? `<div style="position:absolute;left:${112}px;top:${96}px;width:120px;height:12px;border-radius:6px;background:${c.accent}"></div>` : '';
  return `<section style="position:relative;width:${SLIDE.width}px;height:${SLIDE.height}px;background:${c.ground};overflow:hidden;font-family:${t.fonts.body}">
    ${accentBar}
    ${slide.blocks.map((b) => blockHtml(b, slide, t)).join('')}
    <div style="position:absolute;left:112px;right:112px;bottom:32px;display:flex;justify-content:space-between;${type('caption', t)}color:${c.muted}">
      <span>${esc(SYNTHETIC_VENTURE)}</span><span>${i + 1} / ${total}</span></div>
  </section>`;
}

const FONT_LINK = '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto+Mono:wght@400;500&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">';

function deckPage(name, slides, t, scale = 0.5) {
  const w = SLIDE.width * scale, h = SLIDE.height * scale;
  return `<!doctype html><html><head><meta charset="utf-8">${FONT_LINK}<title>${esc(name)}</title></head>
  <body style="margin:0;padding:40px;background:#1f1f24;font-family:Inter,sans-serif">
    <h1 style="color:#fff;font:600 22px Inter;margin:0 0 24px">${esc(name)} · ${t.kind} · synthetic reference deck</h1>
    <div style="display:grid;grid-template-columns:repeat(2, ${w}px);gap:28px">
      ${slides.map((s, i) => `<div style="width:${w}px;height:${h}px;overflow:hidden;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.35)"><div style="transform:scale(${scale});transform-origin:0 0">${slideHtml(s, i, slides.length, t)}</div></div>`).join('')}
    </div></body></html>`;
}

function phonePage(name, slides, t) {
  const w = 358, scale = w / SLIDE.width, h = SLIDE.height * scale;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=390">${FONT_LINK}<title>${esc(name)} phone</title></head>
  <body style="margin:0;width:390px;background:#f4f3f7;font-family:Inter,sans-serif">
    <div style="height:56px;display:flex;align-items:center;padding:0 16px;background:#fff;border-bottom:1px solid #ececf1;font:700 16px 'Space Grotesk'">‹ Pitch deck</div>
    <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
      ${slides.map((s, i) => `<div style="background:#fff;border:1px solid #ececf1;border-radius:12px;padding:10px">
        <div style="width:${w - 20}px;height:${h * ((w - 20) / w)}px;overflow:hidden;border-radius:8px"><div style="transform:scale(${scale * ((w - 20) / w)});transform-origin:0 0">${slideHtml(s, i, slides.length, t)}</div></div>
        <div style="display:flex;justify-content:space-between;align-items:center;min-height:44px;padding:6px 4px 0;font:600 14px Inter;color:#18181b"><span>${i + 1}. ${esc(s.title)}</span><span style="font:500 12px 'Roboto Mono';color:#6b6577">${esc(s.layout)}</span></div>
      </div>`).join('')}
    </div></body></html>`;
}

function storyDeck(rec, audience) {
  for (const x of rec.series) SERIES_POINTS.set(x.key, x.points);
  const rows = standardOutline('standard', audience);
  return buildCards(rows, rec.items, wordsFor(rows), SYNTHETIC_VENTURE, new Set(), { series: rec.series }).slides;
}
const decks = STORY
  ? { 'story-full': storyDeck(fullRecords(), 'seed_fund'), 'story-sparse': storyDeck(sparseRecords(), 'pre_seed_fund'), 'story-conflicting': storyDeck(conflictingRecords(), 'series_a_fund') }
  : { full: fullReferenceDeck(), sparse: sparseReferenceDeck() };
const report = { themes: {}, fit: {}, files: [] };
for (const [kind, t] of Object.entries(BASE_THEMES)) report.themes[kind] = themeProblems(t);
for (const [name, slides] of Object.entries(decks)) {
  report.fit[name] = fitProblems(slides.filter((x) => !x.appendix));
  for (const t of Object.values(BASE_THEMES)) {
    const f = join(OUT, `${name}-${t.kind}.html`);
    writeFileSync(f, deckPage(`${name} deck`, slides, t));
    report.files.push(f);
  }
  const p = join(OUT, `${name}-phone.html`);
  writeFileSync(p, phonePage(`${name} deck`, slides, BASE_THEMES.brand));
  report.files.push(p);
}

const { chromium } = await import('playwright');
// The repo pins its own Playwright; the container's Chromium is at a fixed path (PW_CHROMIUM overrides).
const { existsSync } = await import('node:fs');
const executablePath = process.env.PW_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
for (const f of report.files) {
  const phone = f.endsWith('-phone.html');
  const page = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1960, height: 1200 } });
  await page.goto(`file://${f}`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: f.replace(/\.html$/, '.png'), fullPage: true });
  await page.close();
}
await browser.close();
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out: OUT, themes: report.themes, fit: report.fit }, null, 2));
