/**
 * D455 — HQ · Support SLA policy panel and ticket bands (Session 16 item 6).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { SlaPolicyPanel, ticketCardProps } from '../src/pages/hq/HqSupportPage.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const render = (C, props) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(C, props)));
const text = renderedText;

test('the page source no longer claims tickets have no SLA band', () => {
  const src = read('frontend/src/pages/hq/HqSupportPage.jsx');
  assert.doesNotMatch(src, /NO TICKET HAS AN SLA/);
  assert.match(src, /D455/);
});

test('SlaPolicyPanel draws the three inherited bands', () => {
  const html = render(SlaPolicyPanel, {
    slaPolicy: {
      tiers: [
        { id: 'P1', hours: 24, description: 'Money, access, or data at risk' },
        { id: 'P2', hours: 48, description: 'A workflow is blocked, a workaround exists' },
        { id: 'P3', hours: 96, description: 'Wrong, but nobody is stopped' },
      ],
      note: 'Bands are set here and inherited whole',
      ticket_mapping: 'urgent → P1',
    },
    taxonomy: { available: true, items: [{ type: 'bug', open: 2 }] },
    failed: false,
  });
  const t = text(html);
  assert.match(t, /SLA policy and taxonomy/);
  assert.match(t, /P1/);
  assert.match(t, /24h/);
  assert.match(t, /bug/);
});

test('ticket queue cards pass SLA bands from the payload', () => {
  const data = {
    tickets: {
      available: true,
      complete: true,
      open: 1,
      buckets: {
        hq_held: {
          count: 1,
          oldest_age_hours: 30,
          bands: { ok: 0, due_soon: 0, past: 1 },
          items: [{
            id: 9,
            title: 'Export stuck',
            status: 'open',
            priority: 'urgent',
            age_hours: 30,
            sla_band: 'past',
            requester: 'LP',
            licence: null,
          }],
        },
        admin_product: { count: 0, oldest_age_hours: null, bands: { ok: 0, due_soon: 0, past: 0 }, items: [] },
        hq_staff: { count: 0, oldest_age_hours: null, bands: null, items: [] },
        account_closed: { count: 0, oldest_age_hours: null, bands: null, items: [] },
        not_on_record: { count: 0, oldest_age_hours: null, bands: null, items: [] },
      },
    },
  };
  const props = ticketCardProps(data, false, 'hq_held');
  assert.equal(props.bands.past, 1);
  assert.equal(props.items[0].band, 'past');
});
