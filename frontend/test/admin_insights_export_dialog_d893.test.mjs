/**
 * D893 (#2661) — the export dialog and its toast on Admin › Insights. The
 * file is the Worker's (cloudflare-worker/test/admin_insights_export_d893.test.ts):
 * the page only asks for it, says it is logged, and hands on the signed link.
 *
 *   · "This group only" can be chosen while a group is open, and not before;
 *   · CSV and PDF are offered, and the note says each export is logged;
 *   · the toast's Download is the Worker's link; a PDF that shipped as HTML
 *     says so; a refusal is the Worker's sentence, anything else one line;
 *   · the page calls the Worker for the file and makes none in the browser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { ExportDialog, ExportToast } from '../src/pages/admin/insights/AdminInsights.jsx';
import { EXPORT_LOGGED, EXPORT_NO_GROUP, exportToast } from '../src/pages/admin/insights/insightsModel.js';
import { renderedText } from './_renderedText.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const noop = () => {};
const dialog = (props) => renderToStaticMarkup(h(MemoryRouter, null, h(ExportDialog, {
  group: null, groupLabel: '', rangeText: '8 weeks · 31 Aug 2026 to 24 Oct 2026', busy: false, onCancel: noop, onExport: noop, ...props,
})));
const toast = (t) => renderToStaticMarkup(h(ExportToast, { toast: t, onClose: noop }));
const input = (html, id) => html.match(new RegExp(`<input[^>]*data-testid="${id}"[^>]*>`))?.[0] || '';

test('"This group only" waits for an open group; the page\'s figures are the default', () => {
  const m = dialog({});
  assert.match(input(m, 'insights-export-what-group'), /disabled=""/);
  assert.match(input(m, 'insights-export-what-page'), /checked=""/);
  assert.ok(renderedText(m).includes(EXPORT_NO_GROUP));

  const g = dialog({ group: 'founder', groupLabel: 'Founders' });
  assert.doesNotMatch(input(g, 'insights-export-what-group'), /disabled=""/);
  assert.match(renderedText(g), /This group only · Founders/);
  assert.ok(!renderedText(g).includes(EXPORT_NO_GROUP));
  assert.match(input(g, 'insights-export-what-page'), /checked=""/, 'from the page\'s button, the page is the default');

  const fromGroup = dialog({ group: 'founder', groupLabel: 'Founders', initialWhat: 'group' });
  assert.match(input(fromGroup, 'insights-export-what-group'), /checked=""/, 'from the group, the group is chosen');
  assert.match(input(dialog({ group: null, initialWhat: 'group' }), 'insights-export-what-page'), /checked=""/, 'no group: never the group');
});

test('CSV and PDF are offered, CSV first, and the note says each export is logged', () => {
  const m = dialog({});
  assert.match(input(m, 'insights-export-format-csv'), /checked=""/);
  assert.ok(input(m, 'insights-export-format-pdf'));
  const t = renderedText(m);
  assert.ok(t.includes(EXPORT_LOGGED));
  assert.equal(EXPORT_LOGGED, 'Each export is logged under your name.');
  assert.match(t, /counts only, never names or emails/);
  assert.match(t, /8 weeks · 31 Aug 2026 to 24 Oct 2026/);
  const go = (m) => m.match(/<button[^>]*data-testid="insights-export-go"[^>]*>([^<]*)</);
  assert.match(go(dialog({ busy: true }))[0], /disabled=""/);
  assert.equal(go(dialog({ busy: true }))[1], 'Exporting…');
  assert.equal(go(dialog({}))[1], 'Export');
  assert.doesNotMatch(go(dialog({}))[0], /disabled=""/);
});

test('the toast\'s Download is the Worker\'s signed link', () => {
  const answer = { download_url: 'https://axal.vc/api/monitoring/analytics/download/abc.def', expires_in_seconds: 86400, format: 'pdf', what: 'page', range: '8w' };
  const t = exportToast(answer);
  assert.deepEqual(t, { url: answer.download_url, format: 'pdf', fellBack: false, expires: 86400 });
  const m = toast(t);
  assert.match(m, /<a href="https:\/\/axal\.vc\/api\/monitoring\/analytics\/download\/abc\.def"[^>]*target="_blank"[^>]*data-testid="insights-toast-download"/);
  assert.match(renderedText(m), /Your export is ready\. The link works for 24 hours\./);
  assert.doesNotMatch(m, /blob:/);
});

test('a PDF that shipped as HTML says so; an inline file (no R2) is downloaded, not opened', () => {
  const fell = exportToast({ download_url: 'https://axal.vc/api/monitoring/analytics/download/x.y', expires_in_seconds: 86400, format: 'html' });
  assert.equal(fell.fellBack, true);
  assert.match(renderedText(toast(fell)), /as a web page: the PDF could not be made/);
  const inline = exportToast({ download_url: 'data:text/csv;charset=utf-8;base64,YQ==', expires_in_seconds: null, format: 'csv' });
  const m = toast(inline);
  assert.match(m, /download="insights\.csv"/);
  assert.doesNotMatch(m, /target="_blank"/);
  assert.doesNotMatch(renderedText(m), /24 hours/);
});

test('a refusal is the Worker\'s sentence; anything else is one line, never the raw error', () => {
  const logged = Object.assign(new Error('The export could not be logged, so it was not made. Try again.'), { status: 503, code: 'export_not_logged' });
  assert.deepEqual(exportToast(null, logged), { error: logged.message });
  assert.match(renderedText(toast(exportToast(null, logged))), /could not be logged, so it was not made/);
  const raw = new TypeError('Failed to fetch');
  assert.deepEqual(exportToast(null, raw), { error: 'The export could not be made. Try again.' });
  assert.deepEqual(exportToast({}), { error: 'The export could not be made. Try again.' }, 'an answer with no link is a failure');
});

test('the page asks the Worker for the file, and makes none in the browser', () => {
  const src = readFileSync(resolve(root, 'frontend/src/pages/admin/insights/AdminInsights.jsx'), 'utf8');
  assert.match(src, /insightsApi\.insightsExport\(exportBody\(\{ what, format, filters, group: groupKey \}\)\)/);
  assert.doesNotMatch(src, /createObjectURL|new Blob|figuresCsv/);
  assert.match(src, /data-testid="insights-group-export"/, 'the group lightbox opens the export on the group');
  const model = readFileSync(resolve(root, 'frontend/src/pages/admin/insights/insightsModel.js'), 'utf8');
  assert.doesNotMatch(model, /figuresCsv|csvCell/);
});
