import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import EventEditorPreview from '../src/pages/events/EventEditorPreview.jsx';

const emptyDraft = { title: '', summary: '', cover_url: '', cover_alt: '', timezone: 'Europe/Lisbon' };
const render = (form) => renderToStaticMarkup(React.createElement(EventEditorPreview, { form }));

test('blank fields have placeholders and the same fallback image as the saved social card', () => {
  const html = render(emptyDraft);
  assert.match(html, /\[Event title\]/);
  assert.match(html, /Date not recorded/);
  assert.match(html, /Date and format/);
  assert.match(html, /<img src="https:\/\/axal\.vc\/og\/event\.png/);
  assert.doesNotMatch(html, /undefined|NaN/);
});

test('the preview uses the two recorded crops and reflects only the shareable event copy', () => {
  const draft = {
    ...emptyDraft, title: 'Demo Day', summary: 'Meet founders.', starts_at: '2026-07-03T18:30',
    location_kind: 'hybrid', cover_url: 'https://images.example.test/event.jpg', cover_alt: 'A stage',
    location_url: 'https://meet.example.test/private', price_cents: 6500, capacity: 909,
    cover_crops: { card: { x: 0.25, y: 0, w: 0.5, h: 1 }, social: { x: 0, y: 0.25, w: 1, h: 0.5 } },
  };
  const html = render(draft);
  assert.match(html, /Demo Day — Axal VC StudioOS/);
  assert.match(html, /3 Jul 2026, 18:30 Europe\/Lisbon · Hybrid\. Meet founders\./);
  assert.match(html, /width:200%;height:100%;left:-50%;top:0%/);
  assert.match(html, /width:100%;height:200%;left:0%;top:-50%/);
  assert.doesNotMatch(html, /meet\.example|6500|909/);
  assert.match(render({ ...draft, title: 'Edited title' }), /Edited title — Axal VC StudioOS/);
});
