import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { LinkPainDialog } from '../src/workspaces/founder/ValidateDialogs.jsx';
import { partnershipViews, partnershipFilters, PartnershipsContent } from '../src/pages/founder/FounderGrowPartnerships.jsx';
import ZoneToolbar from '../src/workspaces/ZoneToolbar.jsx';
import { renderedText } from './_renderedText.mjs';
const render = (component, props) => renderToStaticMarkup(h(MemoryRouter, null, h(component, props)));

test('theme options show stored titles without inventing interview counts', () => {
  const html = render(LinkPainDialog, { open: true, hypotheses: [{ id: 1, code: 'H1', claim: 'A claim' }], painGroups: [{ id: 2, title: 'Slow onboarding' }, { id: 3, title: 'Missing feedback', count: 0 }] });
  const select = html.match(/<select[^>]*data-testid="select-link-pain-group"[^>]*>(.*?)<\/select>/s)[1];
  assert.deepEqual([...select.matchAll(/<option[^>]*>(.*?)<\/option>/gs)].map((m) => renderedText(m[1])), ['Slow onboarding', 'Missing feedback']);
});

const pitches = ['approved', 'published', 'proposed', 'rejected', 'withdrawn', 'signed', 'pending', 'unknown', null].map((status, i) => ({ id: i + 1, title: `Partner ${i + 1}`, status }));
for (const [view, expected] of Object.entries({ all: pitches.map((p) => p.title), signed: ['Partner 1', 'Partner 2'], 'in-motion': ['Partner 3'], dormant: ['Partner 4', 'Partner 5'] })) {
  test(`${view}: rendered rows and filter count agree with persisted statuses`, () => {
    const { rows, counts } = partnershipViews(pitches);
    const html = render(PartnershipsContent, { project: { id: 1, name: 'Fixture' }, pitches, attributions: [], visible: rows[view], view, error: '' });
    assert.deepEqual([...html.matchAll(/<tr[^>]*><td><strong>(.*?)<\/strong>/gs)].map((m) => renderedText(m[1])), expected);
    const toolbar = render(ZoneToolbar, { filters: partnershipFilters(view, () => {}, counts) });
    const chip = toolbar.match(new RegExp(`<button[^>]*data-testid="filter-partnerships-${view}"[^>]*>(.*?)<\\/button>`, 's'))[1];
    assert.match(renderedText(chip), new RegExp(`\\b${expected.length}\\b`));
  });
}
